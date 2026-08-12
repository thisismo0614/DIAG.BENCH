// displayChecks.js
// 불량화소/잔상/균일도 같은 시각적 셀프체크는 소프트웨어가 자동으로 정상/이상을 판정할 수 없다
// (사람 눈으로만 확인 가능). 지금까지는 이 테스트들이 진단 화면과 완전히 분리된 "그냥 보여주기만
// 하는 도구"였는데, 사용자가 직접 본 결과를 기록하면 그걸 근거로 전체 진단(evaluateDisplay)에
// 반영되도록 연결한다.

const fs = require('fs');
const path = require('path');

const TESTS = {
  'DISP-04': '불량화소 테스트',
  'DISP-02': '잔상·응답 테스트',
  'DISP-08': '밝기 균일도 테스트',
};

// 기록이 오래되면 지금 상태를 반영하지 못하므로(그 사이 문제가 생기거나 없어질 수 있음) 유효기간을 둔다.
const STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30일

function checksFilePath(userDataDir) {
  return path.join(userDataDir, 'display-checks.json');
}

function loadDisplayChecks(userDataDir) {
  const file = checksFilePath(userDataDir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

// testId별로 가장 최근 결과 하나만 유지한다 — 과거 기록 누적이 아니라 "지금 상태"가 중요하다.
function saveDisplayCheckResult(userDataDir, { testId, verdict, note }) {
  if (!TESTS[testId]) throw new Error(`unknown testId: ${testId}`);
  if (verdict !== 'pass' && verdict !== 'issue') throw new Error(`unknown verdict: ${verdict}`);
  const checks = loadDisplayChecks(userDataDir);
  checks[testId] = { testId, label: TESTS[testId], verdict, note: note || null, checkedAt: new Date().toISOString() };
  fs.writeFileSync(checksFilePath(userDataDir), JSON.stringify(checks, null, 2), 'utf-8');
  return checks[testId];
}

// 진단 엔진에 넘길 형태: 유효기간이 지나지 않은 것만 배열로.
function activeDisplayChecks(userDataDir) {
  const checks = loadDisplayChecks(userDataDir);
  const now = Date.now();
  return Object.values(checks).filter((c) => now - new Date(c.checkedAt).getTime() < STALE_MS);
}

module.exports = { loadDisplayChecks, saveDisplayCheckResult, activeDisplayChecks, TESTS };
