// inspectionReport.js
// 개인용 진단 리포트(report.js)와는 다른, "판매자가 구매자에게 넘겨주는 상태 점검 문서"를 만든다.
//
// 중고차의 "성능·상태점검기록부"에서 아이디어를 가져왔다. 다만 이건 법적 인증이 아니라
// DiagBench 소프트웨어가 특정 시점에 측정한 결과일 뿐이라는 걸 문서 자체에 명확히 밝힌다.
// "인증서"라는 단어를 의도적으로 쓰지 않는다 — 이미 중소벤처기업부의 "성능인증(EPC)"이라는
// 별개의 공식 제도가 있어서, 소비자가 혼동할 수 있다.
//
// 핵심 원칙: "검사 완료"와 "고장 없음"을 절대 같은 말로 쓰지 않는다.
// 부하 테스트(Stress Test) 없이 기본 스캔만 했다면, 안정성(Stability) 항목은
// PASS가 아니라 "검사 안 함(null)"으로 남긴다. 안 돌린 검사를 정상으로 표시하는 것이
// 진단 프로그램에서 가장 위험한 거짓 안심이다.
//
// 위변조 방지에 대한 정직한 한계:
// 검증 코드는 하드웨어 식별값 + 발급 시각을 해시한 것이다. "복사/수정 실수"나
// "다른 PC 리포트 재사용"은 걸러내지만, 이 앱을 가진 판매자가 값을 조작해 발급하는 것까지는
// 막지 못한다. 진짜 위변조 방지(서버 서명)는 별도 백엔드가 필요하며 이번 버전엔 없다.

const crypto = require('crypto');
const { RESULT } = require('./resultStatus');

const VALIDITY_DAYS = 7;
const STATUS_RANK = { normal: 0, watch: 1, warning: 2, critical: 3 };
// payload 구조가 바뀌면 예전 리포트의 해시는 당연히 재계산과 달라진다. 그걸 "위변조"로
// 오해하지 않도록 버전을 payload 안에 넣는다.
// 3: 섹션에 result(PASS/NOT_TESTED/…)와 notTested를 추가. 페이로드 모양이 바뀌면 올린다.
const VERIFICATION_PAYLOAD_VERSION = 3;

// ---------- 위변조 감지용 canonical payload ----------
// 이전 버전은 하드웨어 식별값 + 카테고리 status만 해시했다. 그러면 예를 들어 RAM 검사에서
// 오류 개수가 바뀌거나 근거/조치 문구가 통째로 바뀌어도 status만 같으면 해시가 그대로여서,
// "리포트 내용이 바뀌었는데 검증은 통과"하는 구멍이 생긴다.
// 그래서 리포트가 실제로 주장하는 내용 전체(각 이슈의 근거·원인·조치, 부하 테스트 원자료,
// 검사 범위, 최종 등급)를 payload에 넣는다.
//
// JSON.stringify는 객체 키를 넣은 순서대로 쓰기 때문에, 같은 내용이라도 키 순서가 달라지면
// 다른 해시가 나온다. 그래서 아래 canonicalize()로 키를 정렬하고 undefined를 null로 통일한다.
function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') {
    // NaN/Infinity는 JSON에서 null이 되어버리므로 문자열로 남겨 구분한다.
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  Object.keys(value).sort().forEach((k) => { out[k] = canonicalize(value[k]); });
  return out;
}

function issueDigest(issue) {
  return {
    title: issue.title,
    level: issue.level,
    explanation: issue.explanation,
    confidence: issue.confidence ?? null,
    evidence: issue.evidence || [],
    causes: issue.causes || [],
    actions: issue.actions || [],
    verification: issue.verification || null,
  };
}

// 생성과 검증이 반드시 같은 함수를 쓰도록 한 곳에만 둔다.
function buildVerificationPayload({ issuedAt, hardwareIdentity, diagnosisReport, deepTests, extraChecks, testScope, categoryScores, overallGrade }) {
  const hw = hardwareIdentity || {};
  const checks = extraChecks || {};
  return canonicalize({
    v: VERIFICATION_PAYLOAD_VERSION,
    issuedAt,
    hw: {
      systemSerial: hw.systemSerial ?? null,
      systemUuid: hw.systemUuid ?? null,
      baseboardSerial: hw.baseboardSerial ?? null,
      cpuModel: hw.cpuModel ?? null,
      gpuUuid: hw.gpuUuid ?? null,
      diskSerials: (hw.disks || []).map((d) => d.serial).filter(Boolean).sort(),
    },
    // 카테고리별 status만이 아니라 각 이슈의 실제 내용까지 포함한다.
    sections: (diagnosisReport.sections || []).map((s) => ({
      category: s.category,
      status: s.status,
      // 결과 상태(PASS/NOT_TESTED/…)와 못 한 검사 목록도 해시에 넣는다. 이게 빠져 있으면
      // "검사 안 함"을 "이상 없음"으로 바꿔치기해도 검증을 통과하게 된다.
      result: s.result || null,
      notTested: s.notTested || [],
      note: s.note || null,
      normalEvidence: s.normalEvidence || [],
      issues: (s.issues || []).map(issueDigest),
    })).sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0)),
    totals: {
      critical: diagnosisReport.totalCritical || 0,
      warning: diagnosisReport.totalWarnings || 0,
      watch: diagnosisReport.totalWatch || 0,
    },
    // 부하 테스트 원자료 전체. 값이 하나라도 바뀌면 해시가 바뀐다.
    deepTests: deepTests || { included: false },
    gpuStressCheck: checks.gpuStressCheck || null,
    vramCheck: checks.vramCheck || null,
    smartDetails: checks.smartDetails || null,
    testScope,
    categoryScores,
    overallGrade,
  });
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function worstStatus(sectionsByCat, categories) {
  let worst = 'normal';
  categories.forEach((c) => {
    const s = sectionsByCat[c];
    if (s && STATUS_RANK[s.status] > STATUS_RANK[worst]) worst = s.status;
  });
  return worst;
}

// CPU/GPU 이슈 중 온도·스로틀링 관련만 걸러서 "Thermal Condition" 점수를 따로 낸다.
function thermalStatus(sectionsByCat) {
  const issues = ['CPU', 'GPU'].flatMap((c) => (sectionsByCat[c]?.issues || []))
    .filter((i) => /온도|스로틀링/.test(i.title));
  if (issues.some((i) => i.level === 'critical')) return 'critical';
  if (issues.some((i) => i.level === 'warning')) return 'warning';
  if (issues.some((i) => i.level === 'watch')) return 'watch';
  return 'normal';
}

function buildInspectionReport(diagnosisReport, hardwareIdentity, timestamp, deepTests, extraChecks) {
  const issuedAt = timestamp || new Date().toISOString();
  const validUntil = new Date(new Date(issuedAt).getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  deepTests = deepTests || { included: false };
  // 스캔 중에 돌린 검사(deepTests)와 달리, 사용자가 따로 실행해두고 기록만 남은 검사.
  // VRAM 검사와 GPU 부하 테스트가 여기 해당한다(둘 다 WebGL이 필요해 스캔 중에는 못 돌린다).
  const vramCheck = (extraChecks && extraChecks.vramCheck) || null;
  const gpuStressCheck = (extraChecks && extraChecks.gpuStressCheck) || null;
  // SMART 상세 속성은 리포트 본문에 원본 수치로 싣는다(중고 거래에서 가장 값어치 있는 정보).
  // 저장된 리포트를 나중에 다시 렌더링할 때도 같은 표가 나와야 하므로 리포트 안에 보관한다.
  const smartDetails = (extraChecks && extraChecks.smartDetails) || null;

  const hasIdentity = !!(hardwareIdentity.systemSerial || hardwareIdentity.systemUuid || hardwareIdentity.baseboardSerial
    || hardwareIdentity.gpuUuid || (hardwareIdentity.disks || []).some((d) => d.serial));

  const sectionsByCat = Object.fromEntries(diagnosisReport.sections.map((s) => [s.category, s]));

  // ---------- 검사 범위: 검사함 / 검사 안 함 ----------
  // ⚠ 예전에는 이 목록이 하드코딩이었다. 그래서 GPU를 실제로 못 읽은 PC에서도
  //   "GPU 기본 상태 — 검사 완료"라고 적혔다. 검사하지 않은 것을 검사했다고 주장하는 것은
  //   이 문서가 절대 하면 안 되는 일이라(기획서 §37), 실제 섹션 결과에서 뽑도록 바꿨다.
  const BASE_SCOPE = {
    CPU: 'CPU 기본 상태(온도·부하·클럭)',
    GPU: 'GPU 기본 상태',
    RAM: '메모리 사용량 및 모듈 구성',
    STORAGE: '저장장치 용량 및 SMART',
    NETWORK: '네트워크 핑/지터/손실',
    DISPLAY: '디스플레이 해상도·주사율',
    DRIVERS: '드라이버 오류 장치',
    EVENTS: 'Windows 이벤트 로그(최근 7일)',
  };
  const completed = [];
  const notTested = [];
  Object.entries(BASE_SCOPE).forEach(([cat, label]) => {
    const s = sectionsByCat[cat];
    if (!s) { notTested.push(`${label} (검사하지 않음)`); return; }
    if (s.result === RESULT.NOT_TESTED) {
      notTested.push(`${label} — ${s.note || '이 환경에서 측정할 수 없음'}`);
    } else {
      completed.push(label);
    }
    // 같은 카테고리 안에서 부분적으로 못 한 검사(예: CPU 온도 센서 없음)도 빠짐없이 적는다.
    (s.notTested || []).forEach((n) => notTested.push(n));
  });
  if (deepTests.included && deepTests.cpuStress) completed.push('CPU 부하 테스트(Stress Test)');
  else notTested.push('CPU 부하 테스트(Stress Test)');
  if (deepTests.included && deepTests.storageTest) completed.push('저장장치 처리량 테스트');
  else notTested.push('저장장치 처리량 테스트');
  if (deepTests.included && deepTests.ramTest) completed.push('RAM 무결성 간이검사');
  else notTested.push('RAM 무결성 간이검사');
  // VRAM 검사는 이 스캔 중에 실행되는 게 아니라, 사용자가 안정성 화면에서 따로 돌려둔 기록을
  // 반영하는 것이다. "언제 한 검사인지"까지 적어야 구매자가 이 문서를 제대로 읽을 수 있다.
  if (vramCheck && (vramCheck.verdict === 'pass' || vramCheck.verdict === 'issue')) {
    const when = new Date(vramCheck.checkedAt).toLocaleDateString('ko-KR');
    const coverage = vramCheck.coveredMB !== null && vramCheck.totalMB
      ? `전체 ${vramCheck.totalMB}MB 중 ${Math.round(vramCheck.coveredMB)}MB 범위`
      : '검사 범위 확인 안 됨';
    completed.push(`VRAM 무결성 간이검사 (${when} 실행, ${coverage})`);
  } else if (vramCheck && vramCheck.verdict === 'inconclusive') {
    notTested.push('VRAM 무결성 간이검사 (실행했으나 판단 보류로 끝남)');
  } else {
    notTested.push('VRAM 무결성 간이검사');
  }
  if (gpuStressCheck && (gpuStressCheck.verdict === 'pass' || gpuStressCheck.verdict === 'issue')) {
    const when = new Date(gpuStressCheck.checkedAt).toLocaleDateString('ko-KR');
    // "부하 테스트를 했다"만 적으면 얼마나 세게 돌렸는지 알 수 없다. 실제로 걸린 사용률까지 적는다.
    const load = gpuStressCheck.maxLoadPercent !== null ? `최고 사용률 ${Math.round(gpuStressCheck.maxLoadPercent)}%` : null;
    const peak = gpuStressCheck.maxTempC !== null ? `최고 온도 ${Math.round(gpuStressCheck.maxTempC)}°C` : '온도 측정 불가';
    completed.push(`GPU 부하 테스트 (${when} 실행, ${[load, peak].filter(Boolean).join(', ')})`);
  } else if (gpuStressCheck && gpuStressCheck.verdict === 'inconclusive') {
    notTested.push('GPU 부하 테스트 (실행했으나 판단 보류로 끝남)');
  } else {
    notTested.push('GPU 부하 테스트');
  }
  notTested.push('HDR/색영역 정밀 측정 (미구현)');

  // ---------- 세부 영역 점수 ----------
  const hardwareHealth = worstStatus(sectionsByCat, ['CPU', 'GPU', 'RAM', 'STORAGE']);
  const thermalCondition = thermalStatus(sectionsByCat);
  const storageHealth = sectionsByCat.STORAGE ? sectionsByCat.STORAGE.status : 'normal';
  const softwareCondition = worstStatus(sectionsByCat, ['DRIVERS', 'EVENTS']);

  // Stability = "부하를 걸었을 때 버티는가" + "최근 실제로 뻗은 기록이 있는가".
  // 부하 테스트 결과는 이미 규칙 엔진이 CPU/RAM/STORAGE 섹션의 이슈로 만들어놨으므로,
  // 여기서 임계값을 다시 구현하지 않고 그 이슈들을 읽어서 반영한다(판정 기준이 두 곳에
  // 흩어지면 반드시 어긋난다).
  let stability = null; // null = 검사 안 함
  if (deepTests.included) {
    const stressRelated = /부하 테스트|무결성|쓴 데이터와 읽은 데이터|읽기\/쓰기 중 오류/;
    const stressIssueWorst = ['CPU', 'RAM', 'STORAGE', 'GPU']
      .flatMap((c) => (sectionsByCat[c]?.issues || []))
      .filter((i) => stressRelated.test(i.title))
      .reduce((worst, i) => (STATUS_RANK[i.level] > STATUS_RANK[worst] ? i.level : worst), 'normal');
    const eventsWorst = worstStatus(sectionsByCat, ['EVENTS']);
    stability = STATUS_RANK[stressIssueWorst] > STATUS_RANK[eventsWorst] ? stressIssueWorst : eventsWorst;
  }

  const categoryScores = { hardwareHealth, thermalCondition, storageHealth, softwareCondition, stability };

  // ---------- 종합 등급 ----------
  const criticalCount = diagnosisReport.totalCritical || 0;
  const warningCount = diagnosisReport.totalWarnings || 0;
  const watchCount = diagnosisReport.totalWatch || 0;

  // 검사 자체를 못 한 카테고리가 있으면 "이상 징후 없음"이라고 말할 수 없다.
  // 등급은 검사된 범위에 대한 판정이므로 글자는 유지하되, A+/A의 문구가 실제보다
  // 넓게 읽히지 않도록 범위를 함께 적고 A+는 주지 않는다(A+는 "정밀 검사 포함"이라는 뜻이라
  // 일부를 아예 못 검사한 상태와 양립할 수 없다).
  const untestedCategories = Object.keys(BASE_SCOPE)
    .filter((c) => !sectionsByCat[c] || sectionsByCat[c].result === RESULT.NOT_TESTED);
  const coverageComplete = untestedCategories.length === 0;

  let overallGrade;
  if (criticalCount > 0) overallGrade = { letter: 'D', label: '주요 문제 발견', level: 'critical' };
  else if (warningCount > 0) overallGrade = { letter: 'C', label: '확인이 필요한 문제 존재', level: 'warning' };
  else if (watchCount > 0) overallGrade = { letter: 'B', label: '경미한 주의사항 있음', level: 'watch' };
  else if (!coverageComplete) overallGrade = { letter: 'A', label: '검사한 항목 기준 정상 (일부 항목 미검사)', level: 'normal' };
  else if (deepTests.included) overallGrade = { letter: 'A+', label: '정밀 검사 포함, 이상 징후 없음', level: 'normal' };
  else overallGrade = { letter: 'A', label: '기본 검사 기준 정상', level: 'normal' };
  overallGrade.coverageComplete = coverageComplete;

  // 등급 글자 하나만 보면 "이 PC 전체가 C급"으로 읽힌다. 실제로는 하드웨어는 멀쩡한데
  // 이벤트 로그 하나 때문에 C가 되는 경우가 흔하다. 그래서 등급과 함께
  // "무엇 때문에 이 등급인지 / 어디는 정상인지"를 항상 같이 들고 다닌다.
  const CATEGORY_LABEL = {
    CPU: 'CPU', GPU: 'GPU', RAM: '메모리', STORAGE: '저장장치',
    NETWORK: '네트워크', DISPLAY: '디스플레이', DRIVERS: '드라이버', EVENTS: '시스템 이벤트 기록',
  };
  const gradeDrivers = diagnosisReport.sections
    .flatMap((s) => (s.issues || [])
      .filter((i) => i.level === 'critical' || i.level === 'warning')
      .map((i) => ({ category: s.category, categoryLabel: CATEGORY_LABEL[s.category] || s.category, level: i.level, title: i.title })))
    .sort((a, b) => STATUS_RANK[b.level] - STATUS_RANK[a.level]);
  // ⚠ "어디가 정상인지"에는 **실제로 검사한 것만** 넣는다.
  //   예전에는 status === 'normal' 기준이라, 측정조차 못 한 카테고리가 "정상 영역"으로
  //   나열됐다. 구매자에게 가장 직접적으로 잘못된 정보를 주는 자리였다.
  const normalAreas = diagnosisReport.sections
    .filter((s) => s.result === RESULT.PASS)
    .map((s) => CATEGORY_LABEL[s.category] || s.category);
  const watchAreas = diagnosisReport.sections
    .filter((s) => s.status === 'watch')
    .map((s) => CATEGORY_LABEL[s.category] || s.category);
  const notTestedAreas = diagnosisReport.sections
    .filter((s) => s.result === RESULT.NOT_TESTED)
    .map((s) => CATEGORY_LABEL[s.category] || s.category);
  const gradeExplanation = { drivers: gradeDrivers, normalAreas, watchAreas, notTestedAreas };

  // ---------- 위변조 감지 해시 ----------
  // 등급과 검사 범위까지 확정된 뒤에 계산한다 — 리포트가 실제로 주장하는 내용 전부를 덮기 위해서.
  const verificationPayload = buildVerificationPayload({
    issuedAt, hardwareIdentity, diagnosisReport, deepTests,
    extraChecks: { vramCheck, gpuStressCheck, smartDetails },
    testScope: { completed, notTested }, categoryScores, overallGrade,
  });
  const verificationHash = hashPayload(verificationPayload);
  // Report ID는 "이 문서를 가리키는 이름"(조회/식별용), verificationHash는 "내용이 안 바뀌었다는 증거".
  // 역할이 다르므로 ID는 발급 시각 + 하드웨어 식별값에서만 뽑는다 — 내용이 정정돼도 같은 문서를
  // 계속 같은 이름으로 부를 수 있어야 하기 때문(예: SMART 관리자 권한 재검사로 내용만 갱신).
  const identityKey = hashPayload(canonicalize({ issuedAt, hw: verificationPayload.hw }));
  const reportId = `DB-${issuedAt.slice(0, 10).replace(/-/g, '')}-${identityKey.slice(0, 8).toUpperCase()}`;

  return {
    reportId,
    verificationPayloadVersion: VERIFICATION_PAYLOAD_VERSION,
    gradeExplanation,
    issuedAt,
    validUntil,
    validityDays: VALIDITY_DAYS,
    verificationHash,
    hasIdentity,
    hardwareIdentity,
    overallGrade,
    categoryScores,
    testScope: { completed, notTested },
    deepTestsIncluded: !!deepTests.included,
    deepTests,
    // 검증할 때 payload를 똑같이 다시 만들 수 있도록 리포트 안에 함께 보관한다.
    // 이게 빠지면 저장된 리포트를 나중에 검증할 수 없다.
    vramCheck,
    gpuStressCheck,
    smartDetails,
    diagnosisReport,
  };
}

// 생성 때와 완전히 같은 함수(buildVerificationPayload)로 payload를 다시 만들어 비교한다.
// 두 곳에 따로 구현하면 언젠가 반드시 어긋나서, 멀쩡한 리포트를 위조로 판정하게 된다.
function verifyInspectionReport(inspectionReport) {
  const payload = buildVerificationPayload({
    issuedAt: inspectionReport.issuedAt,
    hardwareIdentity: inspectionReport.hardwareIdentity,
    diagnosisReport: inspectionReport.diagnosisReport,
    deepTests: inspectionReport.deepTests,
    extraChecks: {
      vramCheck: inspectionReport.vramCheck || null,
      gpuStressCheck: inspectionReport.gpuStressCheck || null,
      smartDetails: inspectionReport.smartDetails || null,
    },
    testScope: inspectionReport.testScope,
    categoryScores: inspectionReport.categoryScores,
    overallGrade: inspectionReport.overallGrade,
  });
  return hashPayload(payload) === inspectionReport.verificationHash;
}

// 리포트를 공유/공개할 때 시리얼 전체를 노출하지 않기 위한 마스킹.
// 뒤 4자리만 남기고 나머지는 * 처리한다. (검증 해시는 원본 전체 값으로 계산되므로
// 마스킹은 "표시"에만 적용되고 위변조 감지 능력에는 영향 없음)
function maskSerial(serial) {
  if (!serial) return serial;
  const s = String(serial);
  if (s.length <= 4) return '*'.repeat(s.length);
  return '*'.repeat(s.length - 4) + s.slice(-4);
}

module.exports = {
  buildInspectionReport, verifyInspectionReport, maskSerial, VALIDITY_DAYS,
  buildVerificationPayload, hashPayload, canonicalize, VERIFICATION_PAYLOAD_VERSION,
};
