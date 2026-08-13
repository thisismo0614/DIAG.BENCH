// resultStatus.js
// 검사 "결과 상태"의 어휘와 판정. (기획서 §10)
//
// 왜 필요한가 — 실제로 있던 버그를 고치기 위해서다.
// 지금까지 섹션 상태는 critical/warning/watch/normal 네 가지뿐이었다. 그래서
// **아무것도 측정하지 못한 카테고리가 "정상(normal)"으로 표시됐다.**
// 실측으로 확인한 예(nvidia-smi 없고 이벤트 로그 미지원인 환경):
//
//   GPU      온도·부하·클럭을 하나도 못 읽었는데      → normal
//   NETWORK  핑이 전부 null인데                       → normal
//   DISPLAY  디스플레이 목록이 비었는데               → normal
//   EVENTS   이벤트 로그를 아예 조회 못 했는데        → normal
//
// 이건 이 프로젝트가 가장 하지 말아야 한다고 정해둔 것 — "검사하지 않은 것을
// 정상이라고 말하는 것" — 바로 그것이다. 조용히 통과하기 때문에 가장 위험하다.
//
// 그래서 "검사했는데 이상 없음(PASS)"과 "검사를 못 함(NOT_TESTED)",
// "검사는 했는데 판단할 근거가 부족함(UNKNOWN)"을 서로 다른 값으로 분리한다.

const RESULT = {
  PASS: 'PASS',             // 검사했고 이상 없음
  WARNING: 'WARNING',       // 이상 가능성은 있으나 즉각적인 고장으로 판단할 수 없음
  ERROR: 'ERROR',           // 실제 오류가 확인됨
  CRITICAL: 'CRITICAL',     // 사용 중단 또는 즉각적인 조치가 권장되는 수준
  NOT_TESTED: 'NOT_TESTED', // 검사하지 않음 — 정상이라는 뜻이 절대 아니다
  UNKNOWN: 'UNKNOWN',       // 검사는 했으나 데이터가 부족해 판단 불가
};

const RESULT_LABEL = {
  PASS: '이상 없음',
  WARNING: '주의',
  ERROR: '오류 확인됨',
  CRITICAL: '즉시 조치 필요',
  NOT_TESTED: '검사 안 함',
  UNKNOWN: '판단 보류',
};

// 이 값들은 "이상이 있다"에 해당한다(등급/요약에서 문제로 센다).
const PROBLEM_RESULTS = [RESULT.WARNING, RESULT.ERROR, RESULT.CRITICAL];
// 이 값들은 "정상이라고 말할 수 없다"에 해당한다(문제는 아니지만 PASS도 아니다).
const INCONCLUSIVE_RESULTS = [RESULT.NOT_TESTED, RESULT.UNKNOWN];

// warning 이슈 중 "실제 오류가 확인된 것"을 ERROR로 올린다.
// 기준은 추측이 아니라 이미 이슈가 들고 있는 값이다:
//   - confidenceLevel === 'CONFIRMED'  (규칙 모듈이 측정 사실이라고 명시한 것)
//   - 또는 숫자 confidence가 매우 높음 (기존 이슈들의 VERY HIGH 구간)
const CONFIRMED_SCORE = 90;

function isConfirmed(issue) {
  if (issue.confidenceLevel === 'CONFIRMED') return true;
  return typeof issue.confidence === 'number' && issue.confidence >= CONFIRMED_SCORE;
}

// section: finalize()가 만든 섹션
// opts.tested       이 카테고리에서 실제로 측정한 것이 하나라도 있는가
// opts.unknown      측정은 했지만 판단할 근거가 부족한가
function deriveResult(section, { tested = true, unknown = false } = {}) {
  const issues = section.issues || [];

  // 이슈가 있으면 검사가 이뤄진 것이다 — 심각도가 먼저다.
  if (issues.some((i) => i.level === 'critical')) return RESULT.CRITICAL;
  if (issues.some((i) => i.level === 'warning' && isConfirmed(i))) return RESULT.ERROR;
  if (issues.some((i) => i.level === 'warning' || i.level === 'watch')) return RESULT.WARNING;

  // 이슈가 없을 때만 "검사를 했는가"가 결과를 가른다.
  // 이 순서가 핵심이다 — 검사를 못 했으면 PASS가 아니라 NOT_TESTED다.
  if (!tested) return RESULT.NOT_TESTED;
  if (unknown) return RESULT.UNKNOWN;
  return RESULT.PASS;
}

// 리포트 전체 요약. "검사 안 함"이 섞여 있으면 그 사실을 반드시 함께 말한다.
function summarizeResults(sections) {
  const counts = Object.fromEntries(Object.values(RESULT).map((r) => [r, 0]));
  sections.forEach((s) => { if (counts[s.result] !== undefined) counts[s.result] += 1; });
  return {
    counts,
    problems: PROBLEM_RESULTS.reduce((a, r) => a + counts[r], 0),
    inconclusive: INCONCLUSIVE_RESULTS.reduce((a, r) => a + counts[r], 0),
    passed: counts[RESULT.PASS],
    // 하나라도 검사하지 못한 게 있으면 "전부 정상"이라고 말할 수 없다.
    allTested: counts[RESULT.NOT_TESTED] === 0,
  };
}

module.exports = {
  RESULT, RESULT_LABEL, PROBLEM_RESULTS, INCONCLUSIVE_RESULTS,
  deriveResult, summarizeResults, isConfirmed,
};
