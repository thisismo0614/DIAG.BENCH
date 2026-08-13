// sessionCompare.js
// 두 검사 세션을 비교한다. (기획서 §16~17 전후 비교, §30~31 거래 전후 하드웨어 비교)
//
// 쓰는 곳이 두 가지다:
//   수리점  입고 검사 ↔ 출고 검사  → "무엇이 실제로 좋아졌는가"를 데이터로 보여준다
//   중고거래 판매자 검사 ↔ 구매자 검사 → "받은 PC가 그때 그 PC인가"를 대조한다
//
// ⚠ 이 비교가 거짓말하기 쉬운 지점들 — 전부 여기서 막는다.
//
//   1. **한쪽이 측정되지 않은 항목은 비교하지 않는다.**
//      입고 때 GPU 온도를 못 쟀는데 출고 때 75°C가 나왔다고 "개선"이라 할 수 없다.
//      null이 섞이면 그 항목은 '비교 불가'로 남긴다.
//
//   2. **검사 범위가 다르면 비교 자체가 성립하지 않는다.**
//      입고는 부하 테스트를 돌리고 출고는 안 돌렸다면 최고 온도를 나란히 놓을 수 없다.
//      그래서 프로필이 다르면 경고를 달고, 부하 테스트 유무가 다른 항목은 비교에서 뺀다.
//
//   3. **하드웨어가 같다고 "인증"하지 않는다.**
//      OS에서 읽을 수 있는 식별값(시리얼·모델)이 일치하는지 대조할 뿐이다.
//      부품을 물리적으로 바꿔치기한 경우까지 잡아낸다고 말하면 안 된다.
//
//   4. **미세한 변화를 개선/악화라고 부르지 않는다.** 항목마다 무시 임계값을 둔다.

const METRICS = [
  { key: 'cpuMaxTempC', label: 'CPU 최고 온도', unit: '°C', lowerIsBetter: true, minDelta: 2, needsDeep: true },
  { key: 'gpuMaxTempC', label: 'GPU 최고 온도', unit: '°C', lowerIsBetter: true, minDelta: 2 },
  { key: 'ramSpeedMTs', label: '메모리 동작 속도', unit: ' MT/s', lowerIsBetter: false, minDelta: 1 },
  { key: 'wheaErrors', label: '하드웨어 오류(WHEA)', unit: '건', lowerIsBetter: true, minDelta: 1 },
  { key: 'unexpectedShutdowns', label: '예기치 않은 종료', unit: '건', lowerIsBetter: true, minDelta: 1 },
  { key: 'bugchecks', label: '블루스크린', unit: '건', lowerIsBetter: true, minDelta: 1 },
  { key: 'driverErrors', label: '드라이버 오류 장치', unit: '개', lowerIsBetter: true, minDelta: 1 },
  { key: 'ramTestErrors', label: 'RAM 검사 오류', unit: '개', lowerIsBetter: true, minDelta: 1, needsDeep: true },
  // 저장장치 처리량은 실행할 때마다 흔들린다. 절대값이 아니라 비율로 판단한다.
  { key: 'storageWriteMBps', label: '저장장치 쓰기 속도', unit: ' MB/s', lowerIsBetter: false, minDeltaPercent: 10, needsDeep: true },
  { key: 'storageReadMBps', label: '저장장치 읽기 속도', unit: ' MB/s', lowerIsBetter: false, minDeltaPercent: 10, needsDeep: true },
];

const GRADE_RANK = { 'A+': 5, A: 4, B: 3, C: 2, D: 1 };

function round(n, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// before/after: sessions.js가 만든 세션 요약
function compareSessions(before, after) {
  if (!before || !after) {
    return { available: false, reason: 'missing-session', rows: [], hardware: null, grade: null, warnings: [] };
  }

  const warnings = [];
  const bothDeep = !!(before.deepTestsIncluded && after.deepTestsIncluded);
  // ⚠ 프로필 **이름**이 아니라 실제 검사 **범위**로 판단한다.
  //   수리 입고/출고는 이름은 다르지만 범위가 같도록 일부러 맞춰둔 짝이다. 이름으로 비교하면
  //   정상적인 입고→출고 비교마다 "프로필이 다릅니다" 경고가 떠서, 정작 진짜 경고를 흘려보게 된다.
  const scopeDiffers = (before.scopeKey && after.scopeKey)
    ? before.scopeKey !== after.scopeKey
    : before.profileId !== after.profileId;
  if (scopeDiffers) {
    warnings.push(`검사 범위가 서로 다릅니다(${before.profileLabel} → ${after.profileLabel}). 일부 항목은 나란히 비교할 수 없습니다.`);
  }
  if (!bothDeep && (before.deepTestsIncluded || after.deepTestsIncluded)) {
    warnings.push('한쪽만 부하 테스트를 실행했습니다. 부하를 걸어야 나오는 항목(최고 온도, 처리량, RAM 검사)은 비교에서 제외했습니다.');
  }

  const rows = [];
  METRICS.forEach((m) => {
    const b = before.metrics ? before.metrics[m.key] : null;
    const a = after.metrics ? after.metrics[m.key] : null;

    // 부하를 걸어야 나오는 값인데 한쪽이라도 부하 테스트를 안 했으면 비교 대상이 아니다.
    if (m.needsDeep && !bothDeep) {
      if (isNum(b) || isNum(a)) {
        rows.push({ key: m.key, label: m.label, unit: m.unit, before: b ?? null, after: a ?? null, diff: null, verdict: 'not-comparable', reason: '양쪽 모두 부하 테스트를 실행했을 때만 비교할 수 있습니다' });
      }
      return;
    }
    if (!isNum(b) || !isNum(a)) {
      // 한쪽이라도 측정 못 했으면 개선/악화를 말하지 않는다.
      if (isNum(b) || isNum(a)) {
        rows.push({ key: m.key, label: m.label, unit: m.unit, before: isNum(b) ? b : null, after: isNum(a) ? a : null, diff: null, verdict: 'not-comparable', reason: '한쪽에서 측정되지 않아 비교할 수 없습니다' });
      }
      return;
    }

    const diff = round(a - b);
    const threshold = m.minDeltaPercent ? Math.max(b * m.minDeltaPercent / 100, 1) : m.minDelta;
    let verdict;
    if (Math.abs(diff) < threshold) verdict = 'unchanged';
    else verdict = (m.lowerIsBetter ? diff < 0 : diff > 0) ? 'improved' : 'worsened';

    rows.push({ key: m.key, label: m.label, unit: m.unit, before: round(b), after: round(a), diff, verdict, reason: null });
  });

  // 등급 변화
  let grade = null;
  if (before.grade && after.grade) {
    const rb = GRADE_RANK[before.grade] || 0;
    const ra = GRADE_RANK[after.grade] || 0;
    grade = {
      before: before.grade, after: after.grade,
      verdict: ra === rb ? 'unchanged' : ra > rb ? 'improved' : 'worsened',
    };
  }

  const hardware = compareHardware(before.hardware, after.hardware);

  const improved = rows.filter((r) => r.verdict === 'improved').length;
  const worsened = rows.filter((r) => r.verdict === 'worsened').length;

  return {
    available: true,
    reason: null,
    before: { at: before.issuedAt, profileId: before.profileId, profileLabel: before.profileLabel, reportId: before.reportId },
    after: { at: after.issuedAt, profileId: after.profileId, profileLabel: after.profileLabel, reportId: after.reportId },
    rows, grade, hardware, warnings,
    summary: { improved, worsened, comparable: rows.filter((r) => r.verdict !== 'not-comparable').length },
  };
}

// ---------- 하드웨어 구성 비교 (기획서 §31) ----------
// "같은 PC인가"를 절대적으로 인증하는 것이 아니라, **OS에서 읽을 수 있는 식별값이
// 일치하는지 대조**하는 것이다. 이 한계를 결과에 명시해서 들고 다닌다.
function compareHardware(before, after) {
  if (!before || !after) return null;

  const items = [
    { key: 'cpuModel', label: 'CPU' },
    { key: 'gpuModels', label: 'GPU', isList: true },
    { key: 'memoryTotalGB', label: '메모리 용량', unit: 'GB' },
    { key: 'memoryModuleCount', label: '메모리 모듈 수', unit: '개' },
    { key: 'diskSerials', label: '저장장치', isList: true },
    { key: 'baseboardSerial', label: '메인보드 시리얼' },
  ];

  const rows = [];
  items.forEach((it) => {
    const b = before[it.key];
    const a = after[it.key];
    const bothMissing = (b === null || b === undefined || (Array.isArray(b) && !b.length))
      && (a === null || a === undefined || (Array.isArray(a) && !a.length));
    if (bothMissing) return;

    const norm = (v) => (Array.isArray(v) ? [...v].filter(Boolean).sort().join(', ') : (v ?? null));
    const nb = norm(b);
    const na = norm(a);
    let verdict;
    if (nb === null || na === null) verdict = 'unknown';
    else verdict = nb === na ? 'match' : 'differs';
    rows.push({ key: it.key, label: it.label, before: nb, after: na, verdict });
  });

  const differs = rows.filter((r) => r.verdict === 'differs');
  const unknown = rows.filter((r) => r.verdict === 'unknown');

  return {
    rows,
    // 하나라도 다르면 "일치"라고 말하지 않는다.
    verdict: differs.length ? 'differs' : (unknown.length ? 'partial' : 'match'),
    differsCount: differs.length,
    unknownCount: unknown.length,
    limitation: 'OS에서 읽을 수 있는 식별값(모델·시리얼)을 대조한 결과입니다. '
      + '식별값을 읽을 수 없는 부품이나 물리적 교체까지 확인하는 것은 아닙니다.',
  };
}

module.exports = { compareSessions, compareHardware, METRICS, GRADE_RANK };
