// test-rules.js
// 실제 하드웨어 없이도 규칙 엔진(rules.js)이 올바르게 판정하는지 검증하는 자동 테스트.
// Node 표준 assert만 사용 — 별도 테스트 프레임워크 의존성 없음.
// 실행: node scripts/test-rules.js  (또는 npm run test-rules)

const assert = require('assert');
const { buildReport } = require('../src/engine/rules');
const { buildComparison } = require('../src/engine/compare');
const { summarizeBaselineSamples, compareToBaseline } = require('../src/engine/baseline');
const { analyzeMemoryConfig } = require('../src/engine/memoryConfig');
const { analyzeConfiguration } = require('../src/engine/overclock');
const { parsePingOutput } = require('../src/engine/collectors');
const { PROFILES, resolveProfile, listProfiles } = require('../src/engine/profiles');
const { listIssues, getIssue, wizardFor, RISK_ORDER } = require('../src/engine/issueDb');
const { versionInfo } = require('../src/engine/version');
const { sanitize: sanitizeSettings, DEFAULTS: SETTINGS_DEFAULTS } = require('../src/engine/settings');
const { compareSessions } = require('../src/engine/sessionCompare');
const { extractMetrics, hardwareKeyOf, scopeKeyOf } = require('../src/engine/sessions');
const { buildInspectionReport } = require('../src/engine/inspectionReport');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ---------- 공통 fixture 베이스 ----------
function baseInput(overrides = {}) {
  return {
    cpu: { model: 'Test CPU', loadPercent: 10, tempC: 45, clockGHz: 3.5 },
    cpuTrend: null,
    memory: { totalGB: 16, usedGB: 4, availableGB: 12, usedPercent: 25, swapUsedGB: 0, swapTotalGB: 0 },
    gpu: { controllers: [], nvidia: null, supported: false },
    gpuTrend: null,
    storage: { volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }], disks: [], smart: [], smartctlAvailable: false, io: null },
    network: { ping: { avgMs: 20, jitterMs: 3, lossPercent: 0 } },
    display: [{ model: 'Test Monitor', resolutionX: 1920, resolutionY: 1080, refreshRateHz: 144 }],
    system: { platform: 'win32', distro: 'Windows 11', driverErrors: [] },
    symptom: 'full',
    eventLog: { supported: false, events: [], days: 7, error: null },
    ...overrides,
  };
}
function findSection(report, cat) {
  return report.sections.find((s) => s.category === cat);
}

// ============================================================
section('CPU 진단');
// ============================================================

test('정상 CPU는 normal 상태이고 근거를 남긴다', () => {
  const r = buildReport(baseInput());
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'normal');
  assert.ok(cpu.normalEvidence.length > 0, 'normalEvidence가 비어있으면 안 됨');
});

test('CPU 95도 이상은 critical', () => {
  const r = buildReport(baseInput({ cpu: { model: 'x', loadPercent: 90, tempC: 96, clockGHz: 4 } }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'critical');
});

test('CPU 88도+고부하는 warning (단일 시점)', () => {
  const r = buildReport(baseInput({ cpu: { model: 'x', loadPercent: 85, tempC: 88, clockGHz: 4 } }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'warning');
});

test('CPU 80도+고부하는 watch (경고 임계값 미만)', () => {
  const r = buildReport(baseInput({ cpu: { model: 'x', loadPercent: 75, tempC: 80, clockGHz: 4 } }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'watch');
});

test('CPU 온도상승+클럭하락 추이는 warning (완전한 증거)', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'x', loadPercent: 90, tempC: 88, clockGHz: 4.1 },
    cpuTrend: [
      { t: 1, loadPercent: 90, tempC: 78, clockGHz: 4.8 },
      { t: 2, loadPercent: 90, tempC: 83, clockGHz: 4.4 },
      { t: 3, loadPercent: 90, tempC: 88, clockGHz: 4.1 },
    ],
  }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'warning');
  assert.ok(cpu.issues.some((i) => i.title.includes('스로틀링')));
});

test('CPU 온도상승+클럭유지 추이는 watch (부분 증거, 스로틀링 단정 안 함)', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'x', loadPercent: 90, tempC: 82, clockGHz: 4.7 },
    cpuTrend: [
      { t: 1, loadPercent: 90, tempC: 76, clockGHz: 4.8 },
      { t: 2, loadPercent: 90, tempC: 79, clockGHz: 4.75 },
      { t: 3, loadPercent: 90, tempC: 82, clockGHz: 4.7 },
    ],
  }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'watch');
  assert.ok(!cpu.issues.some((i) => i.title.includes('스로틀링이 의심')), '클럭이 유지되는데 스로틀링을 단정하면 안 됨');
});

test('CPU 고부하+RAM 사용 시 topProcesses가 issue에 붙는다', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'x', loadPercent: 97, tempC: 50, clockGHz: 4 },
    topProcesses: { byCpu: [{ name: 'chrome', pid: 123, cpuPercent: 80, memPercent: 5 }], byMem: [] },
  }));
  const cpu = findSection(r, 'CPU');
  const issue = cpu.issues.find((i) => i.title.includes('사용률'));
  assert.ok(issue.topProcesses && issue.topProcesses.length === 1);
  assert.strictEqual(issue.topProcesses[0].name, 'chrome');
});

// ============================================================
section('GPU 진단');
// ============================================================

test('NVIDIA 미지원 환경은 normal + note로 표시 (경고 아님)', () => {
  const r = buildReport(baseInput());
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal');
  assert.ok(gpu.note && gpu.note.includes('nvidia-smi'));
});

test('GPU 92도는 critical', () => {
  const r = buildReport(baseInput({
    gpu: { controllers: [{ vendor: 'NVIDIA', model: 'RTX 5070' }], nvidia: { loadPercent: 90, tempC: 92, clockMHz: 2000, clockMaxMHz: 2600, vramUsedMB: 4000, vramTotalMB: 12288, powerDrawW: 200 }, supported: true },
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'critical');
});

test('GPU 82도+고부하는 watch', () => {
  const r = buildReport(baseInput({
    gpu: { controllers: [{ vendor: 'NVIDIA', model: 'RTX 5070' }], nvidia: { loadPercent: 90, tempC: 82, clockMHz: 2000, clockMaxMHz: 2600, vramUsedMB: 4000, vramTotalMB: 12288, powerDrawW: 200 }, supported: true },
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'watch');
});

test('GPU 온도상승+클럭하락 추이는 warning', () => {
  const r = buildReport(baseInput({
    gpu: { controllers: [{ vendor: 'NVIDIA', model: 'RTX 5070' }], nvidia: { loadPercent: 95, tempC: 88, clockMHz: 2200, clockMaxMHz: 2600, vramUsedMB: 4000, vramTotalMB: 12288, powerDrawW: 220 }, supported: true },
    gpuTrend: [
      { t: 1, loadPercent: 95, tempC: 78, clockMHz: 2600 },
      { t: 2, loadPercent: 95, tempC: 83, clockMHz: 2400 },
      { t: 3, loadPercent: 95, tempC: 88, clockMHz: 2200 },
    ],
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'warning');
});

// ============================================================
section('Storage 진단 — SMART 미지원/이상 구분');
// ============================================================

test('smartctl 미설치는 watch (critical 아님)', () => {
  const r = buildReport(baseInput({
    storage: { volumes: [], disks: [], smart: [], smartctlAvailable: false, io: null },
  }));
  const storage = findSection(r, 'STORAGE');
  assert.strictEqual(storage.status, 'watch');
  assert.ok(storage.issues.some((i) => i.title.includes('확인할 수 없습니다')));
});

test('SMART FAILED는 critical', () => {
  const r = buildReport(baseInput({
    storage: { volumes: [], disks: [], smart: [{ device: '/dev/sda', healthy: false, status: 'failed' }], smartctlAvailable: true, io: null },
  }));
  const storage = findSection(r, 'STORAGE');
  assert.strictEqual(storage.status, 'critical');
});

test('SMART PASSED는 normal', () => {
  const r = buildReport(baseInput({
    storage: { volumes: [], disks: [], smart: [{ device: '/dev/sda', healthy: true, status: 'passed' }], smartctlAvailable: true, io: null },
  }));
  const storage = findSection(r, 'STORAGE');
  assert.strictEqual(storage.status, 'normal');
});

test('SMART 판독불가(healthy:null)는 watch, critical로 오판하지 않는다', () => {
  const r = buildReport(baseInput({
    storage: { volumes: [], disks: [], smart: [{ device: '/dev/sda', healthy: null, status: 'unknown' }], smartctlAvailable: true, io: null },
  }));
  const storage = findSection(r, 'STORAGE');
  assert.strictEqual(storage.status, 'watch');
});

test('디스크 사용률 90% 이상은 warning', () => {
  const r = buildReport(baseInput({
    storage: { volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 470, usePercent: 94 }], disks: [], smart: [], smartctlAvailable: false, io: null },
  }));
  const storage = findSection(r, 'STORAGE');
  assert.ok(storage.issues.some((i) => i.title.includes('여유 공간')));
});

// ============================================================
section('Network 진단');
// ============================================================

test('정상 네트워크는 normal', () => {
  const r = buildReport(baseInput());
  const net = findSection(r, 'NETWORK');
  assert.strictEqual(net.status, 'normal');
});

test('패킷 손실은 critical', () => {
  const r = buildReport(baseInput({ network: { ping: { avgMs: 20, jitterMs: 3, lossPercent: 2 } } }));
  const net = findSection(r, 'NETWORK');
  assert.strictEqual(net.status, 'critical');
});

test('높은 핑은 warning', () => {
  const r = buildReport(baseInput({ network: { ping: { avgMs: 150, jitterMs: 3, lossPercent: 0 } } }));
  const net = findSection(r, 'NETWORK');
  assert.strictEqual(net.status, 'warning');
});

// ============================================================
section('증상 기반 우선순위');
// ============================================================

test('gaming 증상은 GPU→CPU→RAM 순서 그대로 정렬한다', () => {
  const r = buildReport(baseInput({ symptom: 'gaming' }));
  const order = r.sections.map((s) => s.category);
  assert.deepStrictEqual(order.slice(0, 3), ['GPU', 'CPU', 'RAM'], '우선순위 리스트에 적힌 순서를 그대로 따라야 함');
  assert.ok(r.sections.find((s) => s.category === 'GPU').focused === true);
  assert.ok(r.sections.find((s) => s.category === 'NETWORK').focused === false);
});

// ============================================================
section('Windows 이벤트 로그 진단');
// ============================================================

test('이벤트 로그 미지원 환경(비Windows)은 normal + note', () => {
  const r = buildReport(baseInput());
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'normal');
  assert.ok(ev.note && ev.note.includes('Windows가 아닌'));
});

test('이벤트 없음은 normal + 근거 남김', () => {
  const r = buildReport(baseInput({ eventLog: { supported: true, events: [], days: 7, error: null } }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'normal');
  assert.ok(ev.normalEvidence.length > 0);
});

test('WHEA 오류 이벤트는 critical', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: null, events: [
      { time: '2026-08-01T00:00:00Z', id: 1, provider: 'Microsoft-Windows-WHEA-Logger', level: 'Error', message: 'A fatal hardware error has occurred.' },
    ] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'critical');
  assert.ok(ev.issues.some((i) => i.title.includes('WHEA')));
});

test('블루스크린(BugCheck) 이벤트는 critical', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: null, events: [
      { time: '2026-08-01T00:00:00Z', id: 1001, provider: 'BugCheck', level: 'Error', message: 'The computer has rebooted from a bugcheck.' },
    ] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'critical');
  assert.ok(ev.issues.some((i) => i.title.includes('블루스크린')));
});

test('Kernel-Power(예기치 않은 종료)는 warning', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: null, events: [
      { time: '2026-08-01T00:00:00Z', id: 41, provider: 'Microsoft-Windows-Kernel-Power', level: 'Critical', message: 'The system has rebooted without cleanly shutting down first.' },
    ] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'warning');
});

test('그래픽 드라이버 TDR(Display) 이벤트는 warning', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: null, events: [
      { time: '2026-08-01T00:00:00Z', id: 4101, provider: 'Display', level: 'Warning', message: 'Display driver stopped responding and has recovered.' },
    ] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'warning');
  assert.ok(ev.issues.some((i) => i.title.includes('그래픽 드라이버')));
});

test('Application Error가 1~2건이면 아직 issue로 잡지 않는다 (오탐 방지)', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: null, events: [
      { time: '2026-08-01T00:00:00Z', id: 1000, provider: 'Application Error', level: 'Error', message: 'chrome.exe crashed' },
    ] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'normal');
});

test('Application Error가 3건 이상이면 watch (critical/warning으로 과장하지 않음)', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: null, events: [
      { time: '2026-08-01T00:00:00Z', id: 1000, provider: 'Application Error', level: 'Error', message: 'game.exe crashed' },
      { time: '2026-08-02T00:00:00Z', id: 1000, provider: 'Application Error', level: 'Error', message: 'game.exe crashed' },
      { time: '2026-08-03T00:00:00Z', id: 1000, provider: 'Application Error', level: 'Error', message: 'game.exe crashed' },
    ] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'watch');
});

test('이벤트 로그 조회 실패(error)는 critical/warning이 아니라 note로만 안내', () => {
  const r = buildReport(baseInput({
    eventLog: { supported: true, days: 7, error: 'query_failed', events: [] },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'normal');
  assert.ok(ev.note && ev.note.includes('관리자 권한'));
});

test('crash 증상은 EVENTS를 최우선으로 정렬한다', () => {
  const r = buildReport(baseInput({ symptom: 'crash' }));
  assert.strictEqual(r.sections[0].category, 'EVENTS');
  assert.strictEqual(r.sections[0].focused, true);
});



test('직전 기록이 없으면 비교 결과 없음', () => {
  const c = buildComparison(null, { cpuTempC: 50 });
  assert.strictEqual(c, null);
});

test('온도 11도 개선을 정확히 계산한다', () => {
  const prev = { timestamp: '2026-01-01T00:00:00Z', metrics: { gpuTempC: 87 } };
  const c = buildComparison(prev, { gpuTempC: 76 });
  assert.strictEqual(c.hasChanges, true);
  const d = c.deltas.find((x) => x.key === 'gpuTempC');
  assert.strictEqual(d.diff, -11);
  assert.strictEqual(d.improved, true);
});

test('1~2도 미세 변화는 무시한다(오탐 방지)', () => {
  const prev = { timestamp: '2026-01-01T00:00:00Z', metrics: { cpuTempC: 60 } };
  const c = buildComparison(prev, { cpuTempC: 61 });
  assert.strictEqual(c.hasChanges, false);
});

test('GPU 부하는 낮아져도 "개선"이라고 단정하지 않는다 (맥락 의존 지표)', () => {
  const prev = { timestamp: '2026-01-01T00:00:00Z', metrics: { gpuLoadPercent: 98 } };
  const c = buildComparison(prev, { gpuLoadPercent: 20 });
  const d = c.deltas.find((x) => x.key === 'gpuLoadPercent');
  assert.strictEqual(d.neutral, true);
  assert.strictEqual(d.improved, null, 'load는 improved를 true/false로 단정하면 안 됨');
});

test('CPU 온도는 여전히 낮을수록 개선으로 판단한다', () => {
  const prev = { timestamp: '2026-01-01T00:00:00Z', metrics: { cpuTempC: 80 } };
  const c = buildComparison(prev, { cpuTempC: 60 });
  const d = c.deltas.find((x) => x.key === 'cpuTempC');
  assert.strictEqual(d.neutral, false);
  assert.strictEqual(d.improved, true);
});

section('Display 셀프체크 기록 반영 (불량화소/잔상/균일도)');
// ============================================================

test('셀프체크 기록이 없으면 DISPLAY는 기존처럼 정상 판정', () => {
  const r = buildReport(baseInput());
  const display = findSection(r, 'DISPLAY');
  assert.strictEqual(display.status, 'normal');
});

test('셀프체크 "이상 발견"은 DISPLAY를 warning으로 만들고 근거를 남긴다', () => {
  const r = buildReport(baseInput({
    visualChecks: [{ testId: 'DISP-04', label: '불량화소 테스트', verdict: 'issue', note: '좌상단에 밝은 점', checkedAt: '2026-08-01T00:00:00Z' }],
  }));
  const display = findSection(r, 'DISPLAY');
  assert.strictEqual(display.status, 'warning');
  const issue = display.issues.find((i) => i.title.includes('불량화소 테스트'));
  assert.ok(issue, '셀프체크 이슈가 있어야 함');
  assert.ok(issue.explanation.includes('좌상단에 밝은 점'), '메모가 설명에 포함되어야 함');
});

test('셀프체크 "이상 없음"은 critical/warning을 만들지 않고 정상 근거로만 남는다', () => {
  const r = buildReport(baseInput({
    visualChecks: [{ testId: 'DISP-02', label: '잔상·응답 테스트', verdict: 'pass', note: null, checkedAt: '2026-08-01T00:00:00Z' }],
  }));
  const display = findSection(r, 'DISPLAY');
  assert.strictEqual(display.status, 'normal');
  assert.ok(display.normalEvidence.some((e) => e.includes('잔상·응답 테스트')));
});

section('Correlation Engine — 서로 다른 카테고리 증거를 엮기');
// ============================================================

test('CPU 스로틀링 + 예기치 않은 종료 이벤트가 둘 다 있으면 서로 근거로 보강된다', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'x', loadPercent: 90, tempC: 88, clockGHz: 4.1 },
    cpuTrend: [
      { t: 1, loadPercent: 90, tempC: 78, clockGHz: 4.8 },
      { t: 2, loadPercent: 90, tempC: 83, clockGHz: 4.4 },
      { t: 3, loadPercent: 90, tempC: 88, clockGHz: 4.1 },
    ],
    eventLog: {
      supported: true, days: 7, error: null,
      events: [{ time: '2026-08-01T00:00:00Z', id: 41, provider: 'Microsoft-Windows-Kernel-Power', level: 'Critical', message: 'unexpected reboot' }],
    },
  }));
  const cpuIssue = findSection(r, 'CPU').issues.find((i) => i.title.includes('스로틀링'));
  const eventIssue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('예기치 않은 종료'));
  assert.ok(cpuIssue.evidence.some((e) => e.includes('종료')), 'CPU 스로틀링 쪽에 종료 이벤트가 근거로 추가되어야 함');
  assert.ok(cpuIssue.confidence > 87, 'CPU 스로틀링 신뢰도가 상관관계로 올라가야 함(원래 87)');
  assert.ok(eventIssue.confidence > 65, '종료 이벤트 신뢰도가 상관관계로 올라가야 함(원래 65)');
  assert.ok(eventIssue.evidence.some((e) => e.includes('CPU 열 스로틀링')), '종료 이벤트 쪽에 CPU 스로틀링이 근거로 추가되어야 함');
});

test('GPU 스로틀링 + 그래픽 드라이버 TDR 이벤트가 둘 다 있으면 서로 근거로 보강된다', () => {
  const r = buildReport(baseInput({
    gpu: { controllers: [{ vendor: 'NVIDIA', model: 'RTX 5070' }], nvidia: { loadPercent: 95, tempC: 88, clockMHz: 2200, clockMaxMHz: 2600, vramUsedMB: 4000, vramTotalMB: 12288, powerDrawW: 220 }, supported: true },
    gpuTrend: [
      { t: 1, loadPercent: 95, tempC: 78, clockMHz: 2600 },
      { t: 2, loadPercent: 95, tempC: 83, clockMHz: 2400 },
      { t: 3, loadPercent: 95, tempC: 88, clockMHz: 2200 },
    ],
    eventLog: {
      supported: true, days: 7, error: null,
      events: [{ time: '2026-08-01T00:00:00Z', id: 4101, provider: 'Display', level: 'Warning', message: 'Display driver stopped responding and has recovered.' }],
    },
  }));
  const gpuIssue = findSection(r, 'GPU').issues.find((i) => i.title.includes('스로틀링'));
  const eventIssue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('그래픽 드라이버'));
  assert.ok(gpuIssue.confidence > 91, 'GPU 스로틀링 신뢰도가 상관관계로 올라가야 함(원래 91)');
  assert.ok(eventIssue.confidence > 70, 'TDR 이벤트 신뢰도가 상관관계로 올라가야 함(원래 70)');
  assert.ok(eventIssue.evidence.some((e) => e.includes('GPU 열 스로틀링')));
});

test('한쪽만 있으면(예: CPU 스로틀링만) 상관관계로 보강하지 않는다', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'x', loadPercent: 90, tempC: 88, clockGHz: 4.1 },
    cpuTrend: [
      { t: 1, loadPercent: 90, tempC: 78, clockGHz: 4.8 },
      { t: 2, loadPercent: 90, tempC: 83, clockGHz: 4.4 },
      { t: 3, loadPercent: 90, tempC: 88, clockGHz: 4.1 },
    ],
    // 이벤트 로그는 기본값(supported:false)이라 kernelPower 이벤트가 없음
  }));
  const cpuIssue = findSection(r, 'CPU').issues.find((i) => i.title.includes('스로틀링'));
  assert.strictEqual(cpuIssue.confidence, 87, '상응하는 이벤트가 없으면 신뢰도를 올리면 안 됨');
});

// ============================================================
section('VRAM 무결성 검사 기록 반영');
// ============================================================

// 렌더러가 저장하는 기록 형태(vramChecks.saveVramCheck의 출력)를 그대로 흉내낸다.
function vramCheckFixture(overrides = {}) {
  return {
    verdict: 'pass', mismatchWords: 0, contextLost: false, aborted: false,
    allocatedMB: 1024, coveredMB: 1024, totalMB: 3072, residencyLevel: 'ok',
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}
const nvidiaGpu = {
  controllers: [{ model: 'Test GPU' }],
  supported: true,
  nvidia: { loadPercent: 5, tempC: 40, clockMHz: 1500, vramUsedMB: 500, vramTotalMB: 3072 },
};

test('VRAM 검사 기록이 없으면 GPU는 기존처럼 정상 판정', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal');
  assert.ok(!gpu.normalEvidence.some((e) => e.includes('VRAM 무결성')), 'VRAM 검사 근거가 있으면 안 됨');
});

test('VRAM 검사 "이상 없음"은 이슈를 만들지 않고 근거로만 남는다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck: vramCheckFixture() }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal');
  assert.ok(gpu.normalEvidence.some((e) => e.includes('VRAM 무결성 간이검사: 이상 없음')));
});

test('VRAM 정상 근거에는 "확인된 범위"가 함께 적힌다 (전체 정상으로 읽히지 않도록)', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck: vramCheckFixture({ coveredMB: 1024, totalMB: 3072 }) }));
  const ev = findSection(r, 'GPU').normalEvidence.find((e) => e.includes('VRAM 무결성 간이검사'));
  assert.ok(ev.includes('3072MB 중 1024MB'), `범위가 빠졌음: ${ev}`);
});

test('VRAM 불일치는 GPU를 warning으로 만든다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck: vramCheckFixture({ verdict: 'issue', mismatchWords: 37 }) }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'warning');
  const issue = gpu.issues.find((i) => i.title.includes('VRAM 무결성 검사에서 불일치'));
  assert.ok(issue, '불일치 이슈가 있어야 함');
  assert.ok(issue.evidence.some((e) => e.includes('37')), '불일치 개수가 근거에 있어야 함');
  assert.ok(issue.verification, '재검사 방법을 안내해야 함');
});

test('VRAM 불일치를 원인 단정 없이 서술한다 (관측된 사실과 추정 분리)', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck: vramCheckFixture({ verdict: 'issue', mismatchWords: 5 }) }));
  const issue = findSection(r, 'GPU').issues.find((i) => i.title.includes('VRAM 무결성'));
  assert.ok(issue.causes.length > 1, '원인 후보가 하나로 단정되면 안 됨');
  assert.ok(issue.level !== 'critical', 'VRAM 셀 불량으로 단정해 critical로 올리면 안 됨');
});

test('컨텍스트 손실도 별도 warning으로 남는다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck: vramCheckFixture({ verdict: 'issue', contextLost: true }) }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'warning');
  assert.ok(gpu.issues.some((i) => i.title.includes('그래픽 컨텍스트가 손실')));
});

test('판단 보류는 이슈를 만들지 않지만 근거에는 남는다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    vramCheck: vramCheckFixture({ verdict: 'inconclusive', residencyLevel: 'unknown', coveredMB: null }),
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal', '판단 보류를 문제로 격상시키면 안 됨');
  const ev = gpu.normalEvidence.find((e) => e.includes('VRAM 무결성 간이검사: 판단 보류'));
  assert.ok(ev, '판단 보류 사실을 근거에 남겨야 함(아무 말도 없으면 정상으로 읽힘)');
  assert.ok(ev.includes('실제 VRAM에 올라갔는지 확인되지 않음'), `보류 사유가 빠졌음: ${ev}`);
});

test('NVIDIA가 아니어도 VRAM 검사 기록은 반영된다', () => {
  const r = buildReport(baseInput({ vramCheck: vramCheckFixture({ verdict: 'issue', mismatchWords: 12 }) }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'warning');
  assert.ok(gpu.issues.some((i) => i.title.includes('VRAM 무결성 검사에서 불일치')));
});

test('VRAM 불일치 + 그래픽 드라이버 TDR 이벤트는 서로 근거로 보강된다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    vramCheck: vramCheckFixture({ verdict: 'issue', mismatchWords: 9 }),
    eventLog: {
      supported: true, days: 7, error: null,
      events: [{ time: '2026-08-01T00:00:00Z', id: 4101, provider: 'Display', level: 'Warning', message: 'Display driver stopped responding and has recovered.' }],
    },
  }));
  const vramIssue = findSection(r, 'GPU').issues.find((i) => i.title.includes('VRAM 무결성'));
  const eventIssue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('그래픽 드라이버'));
  assert.ok(vramIssue.confidence > 74, 'VRAM 불일치 신뢰도가 올라가야 함(원래 74)');
  assert.ok(eventIssue.evidence.some((e) => e.includes('VRAM 무결성 검사')), 'TDR 이벤트 쪽에도 근거가 추가되어야 함');
});

test('VRAM 불일치만 있고 관련 이벤트가 없으면 보강하지 않는다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck: vramCheckFixture({ verdict: 'issue', mismatchWords: 9 }) }));
  const vramIssue = findSection(r, 'GPU').issues.find((i) => i.title.includes('VRAM 무결성'));
  assert.strictEqual(vramIssue.confidence, 74, '상응하는 이벤트가 없으면 신뢰도를 올리면 안 됨');
});

// ============================================================
section('점검 리포트 검사 범위 — VRAM');
// ============================================================

function inspectionOf({ vramCheck } = {}) {
  const diagnosisReport = buildReport(baseInput({ gpu: nvidiaGpu, vramCheck }));
  return buildInspectionReport(diagnosisReport, { disks: [] }, new Date().toISOString(), { included: false }, { vramCheck });
}

test('VRAM 검사 기록이 없으면 "검사 안 함"에 들어간다', () => {
  const rep = inspectionOf();
  assert.ok(rep.testScope.notTested.some((t) => t.includes('VRAM 무결성 간이검사')));
  assert.ok(!rep.testScope.completed.some((t) => t.includes('VRAM')));
});

test('VRAM 검사를 했으면 "검사 완료"에 실행일과 범위까지 적힌다', () => {
  const rep = inspectionOf({ vramCheck: vramCheckFixture() });
  const entry = rep.testScope.completed.find((t) => t.includes('VRAM 무결성 간이검사'));
  assert.ok(entry, 'completed에 있어야 함');
  assert.ok(entry.includes('3072MB 중 1024MB'), `검사 범위가 빠졌음: ${entry}`);
});

test('판단 보류로 끝난 VRAM 검사는 "검사 완료"로 위장하지 않는다', () => {
  const rep = inspectionOf({ vramCheck: vramCheckFixture({ verdict: 'inconclusive', coveredMB: null, residencyLevel: 'unknown' }) });
  assert.ok(!rep.testScope.completed.some((t) => t.includes('VRAM')), 'completed에 들어가면 안 됨');
  assert.ok(rep.testScope.notTested.some((t) => t.includes('판단 보류로 끝남')));
});

test('GPU 부하 테스트를 "미구현"이라고 적지 않는다 (실제로는 구현되어 있음)', () => {
  const rep = inspectionOf();
  const entry = rep.testScope.notTested.find((t) => t.includes('GPU 부하 테스트'));
  assert.ok(entry, 'GPU 부하 테스트가 검사 범위에 언급되어야 함');
  assert.ok(!entry.includes('미구현'), `실제로 구현된 기능을 미구현이라고 적으면 안 됨: ${entry}`);
});

// ============================================================
section('GPU 부하 테스트 기록 반영');
// ============================================================

function gpuStressFixture(overrides = {}) {
  return {
    verdict: 'pass', throttleSuspected: false, abortReason: null,
    maxTempC: 71, maxLoadPercent: 99,   // 실측: 최대 강도에서 99% 지속
    highLoadStartClockMHz: 1850, highLoadEndClockMHz: 1845,
    highLoadStartTempC: 68, highLoadEndTempC: 71,
    reachedStagePercent: 100, safetyTempC: 90,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('부하 테스트 기록이 없으면 GPU는 기존처럼 정상 판정', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal');
  assert.ok(!gpu.normalEvidence.some((e) => e.includes('GPU 부하 테스트')));
});

test('부하 테스트 완주는 이슈 없이 근거로만 남는다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, gpuStressCheck: gpuStressFixture() }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal');
  const ev = gpu.normalEvidence.find((e) => e.includes('GPU 부하 테스트'));
  assert.ok(ev && ev.includes('71°C'), `최고 온도가 근거에 있어야 함: ${ev}`);
});

test('부하 테스트 스로틀링은 GPU를 warning으로 만들고 실제 측정값을 근거로 남긴다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    gpuStressCheck: gpuStressFixture({
      verdict: 'issue', throttleSuspected: true, maxTempC: 84,
      highLoadStartClockMHz: 1850, highLoadEndClockMHz: 1500,
      highLoadStartTempC: 78, highLoadEndTempC: 84,
    }),
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'warning');
  const issue = gpu.issues.find((i) => i.title.includes('부하 테스트에서 GPU 열 스로틀링'));
  assert.ok(issue, '스로틀링 이슈가 있어야 함');
  assert.ok(issue.evidence.some((e) => e.includes('1850') && e.includes('1500')), '클럭 변화가 근거에 있어야 함');
  assert.ok(issue.verification, '재검사 방법을 안내해야 함');
});

test('안전 한계 온도 중단은 별도 warning이며, 일상 사용 온도로 단정하지 않는다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    gpuStressCheck: gpuStressFixture({ verdict: 'issue', abortReason: 'safety-temp', maxTempC: 90 }),
  }));
  const issue = findSection(r, 'GPU').issues.find((i) => i.title.includes('안전 한계 온도에서 자동 중단'));
  assert.ok(issue, '안전 한계 중단 이슈가 있어야 함');
  assert.ok(/실제 게임보다|일상 사용/.test(issue.explanation), '인위적 부하라는 단서를 달아야 함');
  assert.ok(issue.level !== 'critical', '부하 테스트 온도만으로 critical로 올리면 안 됨');
});

test('사용자가 중단한 부하 테스트는 정상으로 처리되지 않는다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    gpuStressCheck: gpuStressFixture({ verdict: 'inconclusive', abortReason: 'user', reachedStagePercent: 50 }),
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal', '판단 보류를 문제로 격상시키면 안 됨');
  const ev = gpu.normalEvidence.find((e) => e.includes('GPU 부하 테스트: 판단 보류'));
  assert.ok(ev && ev.includes('사용자가 중간에 중단'), `보류 사유가 빠졌음: ${ev}`);
});

test('부하가 실제로 안 걸린 테스트는 "이상 없음"이 아니라 판단 보류로 남는다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    gpuStressCheck: gpuStressFixture({ verdict: 'inconclusive', maxLoadPercent: 14, maxTempC: 42 }),
  }));
  const gpu = findSection(r, 'GPU');
  assert.strictEqual(gpu.status, 'normal');
  const ev = gpu.normalEvidence.find((e) => e.includes('GPU 부하 테스트: 판단 보류'));
  assert.ok(ev && ev.includes('14%'), `실제 사용률이 사유에 있어야 함: ${ev}`);
  assert.ok(ev.includes('창이 가려졌을'), '가능한 원인을 알려줘야 함');
});

test('완주한 부하 테스트 근거에는 실제 최고 사용률이 적힌다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, gpuStressCheck: gpuStressFixture({ maxLoadPercent: 99 }) }));
  const ev = findSection(r, 'GPU').normalEvidence.find((e) => e.includes('GPU 부하 테스트'));
  assert.ok(ev.includes('실제 최고 사용률 99%'), `실제 사용률이 빠졌음: ${ev}`);
});

test('센서를 못 읽은 부하 테스트도 판단 보류로 남는다', () => {
  const r = buildReport(baseInput({
    gpuStressCheck: gpuStressFixture({ verdict: 'inconclusive', maxTempC: null, highLoadStartClockMHz: null, highLoadEndClockMHz: null }),
  }));
  const ev = findSection(r, 'GPU').normalEvidence.find((e) => e.includes('GPU 부하 테스트: 판단 보류'));
  assert.ok(ev && ev.includes('센서'), `센서 미확인 사유가 있어야 함: ${ev}`);
});

test('부하 테스트 스로틀링 + TDR 이벤트는 서로 근거로 보강된다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    gpuStressCheck: gpuStressFixture({ verdict: 'issue', throttleSuspected: true }),
    eventLog: {
      supported: true, days: 7, error: null,
      events: [{ time: '2026-08-01T00:00:00Z', id: 4101, provider: 'Display', level: 'Warning', message: 'Display driver stopped responding and has recovered.' }],
    },
  }));
  const stressIssue = findSection(r, 'GPU').issues.find((i) => i.title.includes('부하 테스트에서 GPU 열 스로틀링'));
  const eventIssue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('그래픽 드라이버'));
  assert.ok(stressIssue.confidence > 80, '스로틀링 신뢰도가 올라가야 함(원래 80)');
  assert.ok(eventIssue.evidence.some((e) => e.includes('부하 테스트')));
});

test('부하 테스트 스로틀링만 있고 관련 이벤트가 없으면 보강하지 않는다', () => {
  const r = buildReport(baseInput({ gpu: nvidiaGpu, gpuStressCheck: gpuStressFixture({ verdict: 'issue', throttleSuspected: true }) }));
  const issue = findSection(r, 'GPU').issues.find((i) => i.title.includes('부하 테스트에서 GPU 열 스로틀링'));
  assert.strictEqual(issue.confidence, 80, '상응하는 이벤트가 없으면 신뢰도를 올리면 안 됨');
});

test('VRAM 검사와 부하 테스트 결과는 동시에 반영된다', () => {
  const r = buildReport(baseInput({
    gpu: nvidiaGpu,
    vramCheck: vramCheckFixture({ verdict: 'issue', mismatchWords: 3 }),
    gpuStressCheck: gpuStressFixture({ verdict: 'issue', throttleSuspected: true }),
  }));
  const titles = findSection(r, 'GPU').issues.map((i) => i.title);
  assert.ok(titles.some((t) => t.includes('VRAM 무결성')), 'VRAM 이슈가 있어야 함');
  assert.ok(titles.some((t) => t.includes('부하 테스트에서 GPU 열 스로틀링')), '부하 테스트 이슈가 있어야 함');
});

test('부하 테스트 스로틀링은 점검 리포트의 Thermal Condition에도 반영된다', () => {
  const diagnosisReport = buildReport(baseInput({
    gpu: nvidiaGpu,
    gpuStressCheck: gpuStressFixture({ verdict: 'issue', throttleSuspected: true }),
  }));
  const rep = buildInspectionReport(diagnosisReport, { disks: [] }, new Date().toISOString(), { included: false }, {});
  assert.strictEqual(rep.categoryScores.thermalCondition, 'warning');
});

test('GPU 부하 테스트를 했으면 "검사 완료"에 실행일과 최고 온도가 적힌다', () => {
  const diagnosisReport = buildReport(baseInput({ gpu: nvidiaGpu }));
  const rep = buildInspectionReport(diagnosisReport, { disks: [] }, new Date().toISOString(), { included: false }, { gpuStressCheck: gpuStressFixture() });
  const entry = rep.testScope.completed.find((t) => t.includes('GPU 부하 테스트'));
  assert.ok(entry, 'completed에 있어야 함');
  assert.ok(entry.includes('71°C'), `최고 온도가 빠졌음: ${entry}`);
  assert.ok(entry.includes('99%'), `실제 최고 사용률이 빠졌음(얼마나 세게 돌렸는지 알 수 없음): ${entry}`);
});

test('중단된 GPU 부하 테스트는 "검사 완료"로 위장하지 않는다', () => {
  const diagnosisReport = buildReport(baseInput({ gpu: nvidiaGpu }));
  const rep = buildInspectionReport(diagnosisReport, { disks: [] }, new Date().toISOString(), { included: false },
    { gpuStressCheck: gpuStressFixture({ verdict: 'inconclusive', abortReason: 'user' }) });
  assert.ok(!rep.testScope.completed.some((t) => t.includes('GPU 부하 테스트')));
  assert.ok(rep.testScope.notTested.some((t) => t.includes('GPU 부하 테스트') && t.includes('판단 보류')));
});

// ============================================================
section('검사 기록 저장소 (유효기간·검증)');
// ============================================================

const os = require('os');
const fsx = require('fs');
const pathx = require('path');
const vramStore = require('../src/engine/vramChecks');
const gpuStore = require('../src/engine/gpuStressChecks');

function tmpDir(name) {
  const dir = pathx.join(os.tmpdir(), `diagbench-test-${name}-${process.pid}`);
  fsx.mkdirSync(dir, { recursive: true });
  return dir;
}

test('기록이 없으면 null을 돌려준다', () => {
  const dir = tmpDir('empty');
  assert.strictEqual(vramStore.activeVramCheck(dir), null);
  assert.strictEqual(gpuStore.activeGpuStressCheck(dir), null);
});

test('저장한 기록을 그대로 다시 읽는다 (checkedAt 자동 기록)', () => {
  const dir = tmpDir('save');
  const saved = gpuStore.saveGpuStressCheck(dir, { verdict: 'issue', throttleSuspected: true, maxTempC: 84 });
  assert.strictEqual(saved.verdict, 'issue');
  assert.strictEqual(saved.maxTempC, 84);
  assert.ok(saved.checkedAt, 'checkedAt이 있어야 함');
  assert.strictEqual(gpuStore.activeGpuStressCheck(dir).maxTempC, 84);
});

test('알 수 없는 verdict는 저장을 거부한다', () => {
  const dir = tmpDir('bad');
  assert.throws(() => vramStore.saveVramCheck(dir, { verdict: 'probably-fine' }), /unknown verdict/);
  assert.throws(() => gpuStore.saveGpuStressCheck(dir, { verdict: 'ok-ish' }), /unknown verdict/);
});

test('30일이 지난 기록은 없는 것으로 취급한다', () => {
  const dir = tmpDir('stale');
  const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  fsx.writeFileSync(pathx.join(dir, 'vram-check.json'),
    JSON.stringify({ verdict: 'pass', mismatchWords: 0, checkedAt: old }), 'utf-8');
  assert.ok(vramStore.loadVramCheck(dir), '파일 자체는 읽혀야 함(화면 표시용)');
  assert.strictEqual(vramStore.activeVramCheck(dir), null, '진단에는 반영되면 안 됨');
});

test('깨진 기록 파일은 기록 없음으로 취급한다 (잘못된 값으로 진단하지 않음)', () => {
  const dir = tmpDir('broken');
  fsx.writeFileSync(pathx.join(dir, 'gpu-stress-check.json'), '{ 이건 JSON이 아님', 'utf-8');
  assert.strictEqual(gpuStore.loadGpuStressCheck(dir), null);
  assert.strictEqual(gpuStore.activeGpuStressCheck(dir), null);
});

// ============================================================
section('정밀 검사 결과 → 최종 등급 (fixture 회귀 테스트)');
// ============================================================
// 이 프로그램에서 가장 위험한 회귀는 "검사에서 문제가 나왔는데 등급은 정상"이다.
// 시나리오를 통째로 고정해서 그런 회귀가 조용히 통과하지 못하게 한다.

const { FIXTURES } = require('./fixtures');
const { verifyInspectionReport, buildVerificationPayload, hashPayload } = require('../src/engine/inspectionReport');

function reportFor(fixture) {
  const diagnosisReport = buildReport(fixture.input);
  const inspection = buildInspectionReport(
    diagnosisReport,
    { systemUuid: 'TEST-UUID', baseboardSerial: 'BOARD-1', cpuModel: 'Test CPU', gpuUuid: 'GPU-1', disks: [{ serial: 'DISK-1' }] },
    '2026-08-13T00:00:00.000Z',
    fixture.input.deepTests || { included: false },
    { vramCheck: fixture.input.vramCheck || null, gpuStressCheck: fixture.input.gpuStressCheck || null },
  );
  return { diagnosisReport, inspection };
}

Object.entries(FIXTURES).forEach(([name, fixture]) => {
  test(`[${name}] ${fixture.description} → 등급 ${fixture.expect.grade}`, () => {
    const { diagnosisReport, inspection } = reportFor(fixture);
    assert.strictEqual(inspection.overallGrade.letter, fixture.expect.grade,
      `등급이 다름 (headline: ${diagnosisReport.headline})`);

    if (fixture.expect.stability !== undefined) {
      assert.strictEqual(inspection.categoryScores.stability, fixture.expect.stability,
        'Stability 점수가 기대와 다름');
    }
    if (fixture.expect.categoryWithIssue) {
      const sec = diagnosisReport.sections.find((s) => s.category === fixture.expect.categoryWithIssue);
      assert.ok(sec && sec.issues.length > 0,
        `${fixture.expect.categoryWithIssue} 카테고리에 이슈가 있어야 함`);
    }
    if (fixture.expect.normalAreasInclude) {
      fixture.expect.normalAreasInclude.forEach((cat) => {
        const sec = diagnosisReport.sections.find((s) => s.category === cat);
        assert.strictEqual(sec.status, 'normal', `${cat}는 정상이어야 함`);
      });
    }
    if (fixture.expect.eventStatus) {
      const sec = diagnosisReport.sections.find((s) => s.category === 'EVENTS');
      assert.strictEqual(sec.status, fixture.expect.eventStatus,
        `EVENTS 상태가 달라야 함. 이슈: ${sec.issues.map((i) => i.title).join(', ') || '없음'}`);
    }
    if (fixture.expect.cpuEvidenceIncludes) {
      const cpu = diagnosisReport.sections.find((s) => s.category === 'CPU');
      const all = [...cpu.normalEvidence, ...cpu.issues.flatMap((i) => i.evidence)].join(' ');
      assert.ok(all.includes(fixture.expect.cpuEvidenceIncludes),
        `CPU 근거에 "${fixture.expect.cpuEvidenceIncludes}"가 있어야 함: ${all}`);
    }
  });
});

test('[회귀 방지] 정밀 검사에서 오류가 나면 절대 A/A+ 등급이 나오지 않는다', () => {
  const failing = ['ram-error', 'storage-failure', 'storage-io-error', 'cpu-thermal-cutoff'];
  failing.forEach((name) => {
    const { inspection } = reportFor(FIXTURES[name]);
    assert.ok(!['A', 'A+'].includes(inspection.overallGrade.letter),
      `${name}: 검사에서 문제가 나왔는데 등급이 ${inspection.overallGrade.letter}임`);
  });
});

test('[회귀 방지] 정밀 검사 결과가 buildReport에 전달되지 않으면 즉시 드러난다', () => {
  // deepTests를 빼고 같은 입력을 돌리면 RAM 오류가 사라져야 한다(= 연결이 실제로 살아있다는 증거).
  const withDeep = buildReport(FIXTURES['ram-error'].input);
  const { deepTests, ...withoutDeep } = FIXTURES['ram-error'].input;
  const noDeep = buildReport(withoutDeep);
  const ramWith = withDeep.sections.find((s) => s.category === 'RAM');
  const ramWithout = noDeep.sections.find((s) => s.category === 'RAM');
  assert.strictEqual(ramWith.status, 'critical', 'deepTests를 넘기면 RAM이 critical이어야 함');
  assert.strictEqual(ramWithout.status, 'normal', 'deepTests가 없으면 RAM 오류를 알 수 없어야 함');
});

test('등급에는 항상 "왜 이 등급인지"와 "어디가 정상인지"가 함께 담긴다', () => {
  const { inspection } = reportFor(FIXTURES['abnormal-shutdown']);
  const g = inspection.gradeExplanation;
  assert.ok(g, 'gradeExplanation이 있어야 함');
  assert.ok(g.drivers.length > 0, '등급을 결정한 원인이 있어야 함');
  assert.ok(g.drivers[0].categoryLabel.includes('이벤트'), `원인이 이벤트여야 함: ${JSON.stringify(g.drivers[0])}`);
  assert.ok(g.normalAreas.includes('CPU') && g.normalAreas.includes('메모리'),
    `정상 영역이 함께 표시되어야 함: ${g.normalAreas.join(',')}`);
});

// ============================================================
section('위변조 감지 해시');
// ============================================================

test('같은 리포트는 항상 같은 해시를 만든다 (키 순서에 흔들리지 않음)', () => {
  const a = reportFor(FIXTURES['normal-pc-deep']).inspection;
  const b = reportFor(FIXTURES['normal-pc-deep']).inspection;
  assert.strictEqual(a.verificationHash, b.verificationHash);
  assert.ok(verifyInspectionReport(a), '자기 자신을 검증하면 통과해야 함');
});

test('부하 테스트 결과 숫자 하나만 바꿔도 검증에 실패한다', () => {
  const { inspection } = reportFor(FIXTURES['normal-pc-deep']);
  assert.ok(verifyInspectionReport(inspection), '원본은 통과해야 함');
  const tampered = JSON.parse(JSON.stringify(inspection));
  tampered.deepTests.ramTest.errors = 5;       // 리포트 내용을 조작
  assert.ok(!verifyInspectionReport(tampered), 'RAM 오류 개수를 바꿨는데 검증이 통과하면 안 됨');
});

test('이슈 근거 문구를 바꿔도 검증에 실패한다 (status만 해시하던 구멍 방지)', () => {
  const { inspection } = reportFor(FIXTURES['abnormal-shutdown']);
  const tampered = JSON.parse(JSON.stringify(inspection));
  const events = tampered.diagnosisReport.sections.find((s) => s.category === 'EVENTS');
  events.issues[0].evidence[0] = '최근 7일 1건';   // status는 그대로, 내용만 축소
  assert.ok(!verifyInspectionReport(tampered), '근거를 바꿨는데 검증이 통과하면 안 됨');
});

test('최종 등급을 바꿔치기하면 검증에 실패한다', () => {
  const { inspection } = reportFor(FIXTURES['ram-error']);
  const tampered = JSON.parse(JSON.stringify(inspection));
  tampered.overallGrade = { letter: 'A+', label: '정밀 검사 포함, 이상 징후 없음', level: 'normal' };
  assert.ok(!verifyInspectionReport(tampered), '등급을 바꿨는데 검증이 통과하면 안 됨');
});

test('검사 범위를 바꿔치기하면 검증에 실패한다 (검사 안 한 걸 했다고 위장)', () => {
  const { inspection } = reportFor(FIXTURES['normal-pc']);
  const tampered = JSON.parse(JSON.stringify(inspection));
  tampered.testScope.completed.push('RAM 무결성 간이검사');
  assert.ok(!verifyInspectionReport(tampered), '검사 범위를 바꿨는데 검증이 통과하면 안 됨');
});

test('하드웨어 시리얼을 바꾸면 검증에 실패한다 (다른 PC 리포트 재사용 방지)', () => {
  const { inspection } = reportFor(FIXTURES['normal-pc']);
  const tampered = JSON.parse(JSON.stringify(inspection));
  tampered.hardwareIdentity.baseboardSerial = 'OTHER-BOARD';
  assert.ok(!verifyInspectionReport(tampered), '시리얼을 바꿨는데 검증이 통과하면 안 됨');
});

test('payload는 키 순서와 무관하게 같은 해시를 만든다', () => {
  const args = {
    issuedAt: '2026-08-13T00:00:00.000Z',
    hardwareIdentity: { systemUuid: 'U', baseboardSerial: 'B', disks: [] },
    diagnosisReport: { sections: [], totalCritical: 0, totalWarnings: 0, totalWatch: 0 },
    deepTests: { included: false },
    extraChecks: {}, testScope: { completed: ['a'], notTested: [] },
    categoryScores: { hardwareHealth: 'normal' }, overallGrade: { letter: 'A' },
  };
  const h1 = hashPayload(buildVerificationPayload(args));
  // 키 순서를 뒤집은 동일 내용
  const reordered = { ...args, categoryScores: { hardwareHealth: 'normal' }, hardwareIdentity: { disks: [], baseboardSerial: 'B', systemUuid: 'U' } };
  const h2 = hashPayload(buildVerificationPayload(reordered));
  assert.strictEqual(h1, h2, '키 순서가 달라도 같은 해시여야 함');
});

test('Report ID는 내용이 정정돼도 유지된다 (ID와 해시의 역할 분리)', () => {
  const { inspection: a } = reportFor(FIXTURES['normal-pc']);
  const { inspection: b } = reportFor(FIXTURES['abnormal-shutdown']);
  // 같은 발급 시각 + 같은 하드웨어면 Report ID는 같고, 내용이 다르니 해시는 달라야 한다.
  assert.strictEqual(a.reportId, b.reportId, 'Report ID는 식별용이므로 유지되어야 함');
  assert.notStrictEqual(a.verificationHash, b.verificationHash, '내용이 다르면 해시는 달라야 함');
});

// ============================================================
section('이벤트 로그 집계 (개수 제한에 잘리지 않기)');
// ============================================================

const { withEvents } = require('./fixtures');

test('표시용 목록이 잘려도 전체 건수로 판정한다', () => {
  // Kernel-Power 19건인데 표시용 events에는 3건만 담겨 있는 상황
  const r = buildReport(baseInput({ eventLog: withEvents({ kernelPower: 19 }) }));
  const issue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('예기치 않은 종료'));
  assert.ok(issue, '이슈가 있어야 함');
  assert.ok(issue.title.includes('19건'), `잘린 개수(3건)가 아니라 전체 건수여야 함: ${issue.title}`);
});

test('많은 이벤트에 가려도 다른 계통 이벤트를 놓치지 않는다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ kernelPower: 100, whea: 2 }) }));
  const titles = findSection(r, 'EVENTS').issues.map((i) => i.title);
  assert.ok(titles.some((t) => t.includes('WHEA') && t.includes('2건')),
    `Kernel-Power 100건에 가려 WHEA를 놓치면 안 됨: ${titles.join(' / ')}`);
});

test('비정상 종료 근거에 계통별 내역이 함께 제시된다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ kernelPower: 19 }) }));
  const issue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('예기치 않은 종료'));
  const ev = issue.evidence.join(' ');
  assert.ok(ev.includes('WHEA') && ev.includes('BugCheck'), `계통별 내역이 있어야 함: ${ev}`);
  assert.ok(/우선 확인|가능성/.test(issue.explanation), '우선 확인할 영역을 제시해야 함');
});

test('[오탐 방지] 절전 진입/복귀는 비정상 종료로 세지 않는다', () => {
  // 실제 사용자 PC에서 나온 문제: Kernel-Power provider의 정상 이벤트(42/107/109)를
  // 전부 "비정상 종료"로 세는 바람에 멀쩡한 PC가 C등급을 받았다.
  const r = buildReport(baseInput({ eventLog: withEvents({ sleepEnter: 5, sleepResume: 5, shutdownNormal: 2 }) }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'normal', `정상 전원 이벤트만 있으면 정상이어야 함. 이슈: ${ev.issues.map((i) => i.title).join(', ')}`);
  assert.ok(!ev.issues.some((i) => i.title.includes('예기치 않은 종료')), '비정상 종료 이슈가 생기면 안 됨');
});

test('[오탐 방지] 걸러진 이벤트가 있으면 그 사실을 근거에 남긴다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ sleepEnter: 5, sleepResume: 5 }) }));
  const ev = findSection(r, 'EVENTS');
  assert.ok(ev.normalEvidence.some((e) => e.includes('판정에서 제외')),
    `제외된 이벤트를 밝혀야 함: ${ev.normalEvidence.join(' | ')}`);
});

test('진짜 비정상 종료(ID 41)는 정상 전원 이벤트에 섞여 있어도 잡아낸다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ kernelPower: 2, sleepEnter: 30, sleepResume: 30 }) }));
  const issue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('예기치 않은 종료'));
  assert.ok(issue, '진짜 비정상 종료는 잡아야 함');
  assert.ok(issue.title.includes('2건'), `정상 이벤트를 섞어 세면 안 됨: ${issue.title}`);
});

test('정정된 WHEA 오류는 critical이 아니라 watch로 처리한다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ wheaCorrected: 3 }) }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'watch', '정정된 오류만으로 critical이 되면 과잉 경고');
  const issue = ev.issues[0];
  assert.ok(/스스로 정정|정정된/.test(issue.explanation), '정정되었다는 사실을 설명해야 함');
});

test('정정 불가 WHEA 오류는 critical로 유지한다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ whea: 2 }) }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.status, 'critical');
});

test('원인을 PSU로 단정하지 않는다', () => {
  const r = buildReport(baseInput({ eventLog: withEvents({ kernelPower: 19 }) }));
  const issue = findSection(r, 'EVENTS').issues.find((i) => i.title.includes('예기치 않은 종료'));
  assert.ok(issue.causes.length >= 3, '원인 후보가 여러 개여야 함');
  assert.ok(!/PSU 고장입니다|파워 불량입니다/.test(issue.explanation), '원인을 확정적으로 단정하면 안 됨');
});

// ============================================================
section('SMART 속성 파싱 (실제 smartctl 출력 형식)');
// ============================================================
const { parseSmartAttributes, parseSmartIdentity, parseSmartHealthOutput } = require('../src/engine/collectors');

// 이 개발 PC의 실제 NVMe(SK hynix Gold P31) smartctl -H -i -A 출력을 그대로 가져온 것.
const NVME_SAMPLE = `smartctl 7.5 2025-04-30 r5714 [x86_64-w64-mingw32-w10-22H2] (AppVeyor)
Copyright (C) 2002-25, Bruce Allen, Christian Franke, www.smartmontools.org

=== START OF INFORMATION SECTION ===
Model Number:                       SHGP31-1000GM
Serial Number:                      ASD5N427911005D36
Firmware Version:                   41062C20
NVMe Version:                       1.3
Namespace 1 Size/Capacity:          1,000,204,886,016 [1.00 TB]

=== START OF SMART DATA SECTION ===
SMART overall-health self-assessment test result: PASSED

SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)
Critical Warning:                   0x00
Temperature:                        48 Celsius
Available Spare:                    100%
Available Spare Threshold:          10%
Percentage Used:                    0%
Data Units Read:                    24,187,796 [12.3 TB]
Data Units Written:                 20,776,840 [10.6 TB]
Power Cycles:                       664
Power On Hours:                     1,948
Unsafe Shutdowns:                   146
Media and Data Integrity Errors:    0
Error Information Log Entries:      0
`;

// SATA 장비가 이 PC에 없어서 실측 검증을 못 했다. smartctl의 표준 ATA 출력 형식으로 작성한
// 샘플이며, 실제 SATA/HDD가 있는 PC에서 반드시 한 번 확인해야 한다.
const ATA_SAMPLE = `smartctl 7.5 2025-04-30 r5714 [x86_64-w64-mingw32-w10-22H2] (AppVeyor)

=== START OF INFORMATION SECTION ===
Device Model:     ST4000DM004-2CV104
Serial Number:    ZFN1ABCD
Firmware Version: 0001
Rotation Rate:    5425 rpm

=== START OF READ SMART DATA SECTION ===
SMART overall-health self-assessment test result: PASSED

SMART Attributes Data Structure revision number: 10
Vendor Specific SMART Attributes with Thresholds:
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
  1 Raw_Read_Error_Rate     0x000f   118   099   006    Pre-fail  Always       -       179664408
  5 Reallocated_Sector_Ct   0x0033   100   100   010    Pre-fail  Always       -       72
  9 Power_On_Hours          0x0032   059   059   000    Old_age   Always       -       36523
 12 Power_Cycle_Count       0x0032   100   100   020    Old_age   Always       -       104
187 Reported_Uncorrect      0x0032   100   100   000    Old_age   Always       -       3
194 Temperature_Celsius     0x0022   032   045   000    Old_age   Always       -       32 (Min/Max 24/45)
197 Current_Pending_Sector  0x0012   100   100   000    Old_age   Always       -       8
198 Offline_Uncorrectable   0x0010   100   100   000    Old_age   Offline      -       8
199 UDMA_CRC_Error_Count    0x003e   200   200   000    Old_age   Always       -       12

`;

test('NVMe 출력에서 수명·오류·사용시간을 정확히 읽는다', () => {
  const a = parseSmartAttributes(NVME_SAMPLE);
  assert.strictEqual(a.kind, 'nvme');
  assert.strictEqual(a.powerOnHours, 1948, '천 단위 콤마가 있어도 숫자로 읽어야 함');
  assert.strictEqual(a.powerCycles, 664);
  assert.strictEqual(a.wearPercentUsed, 0);
  assert.strictEqual(a.availableSparePercent, 100);
  assert.strictEqual(a.availableSpareThreshold, 10);
  assert.strictEqual(a.mediaErrors, 0);
  assert.strictEqual(a.unsafeShutdowns, 146);
  assert.strictEqual(a.criticalWarningValue, 0);
  assert.strictEqual(a.temperatureC, 48);
  assert.ok(a.totalHostWritesTB > 10 && a.totalHostWritesTB < 11, `누적 쓰기 환산 오류: ${a.totalHostWritesTB}TB`);
});

test('NVMe 식별 정보(모델/시리얼/펌웨어)를 읽는다', () => {
  const id = parseSmartIdentity(NVME_SAMPLE);
  assert.strictEqual(id.model, 'SHGP31-1000GM');
  assert.strictEqual(id.serial, 'ASD5N427911005D36');
  assert.strictEqual(id.firmware, '41062C20');
});

test('ATA 속성 표에서 각 항목을 ID로 읽는다', () => {
  const a = parseSmartAttributes(ATA_SAMPLE);
  assert.strictEqual(a.kind, 'ata');
  assert.strictEqual(a.reallocatedSectors, 72);
  assert.strictEqual(a.pendingSectors, 8);
  assert.strictEqual(a.uncorrectableSectors, 8);
  assert.strictEqual(a.crcErrors, 12);
  assert.strictEqual(a.reportedUncorrect, 3);
  assert.strictEqual(a.powerOnHours, 36523);
  assert.strictEqual(a.powerCycles, 104);
});

test('RAW_VALUE에 부가 정보가 붙어 있어도 앞 숫자만 읽는다', () => {
  // "32 (Min/Max 24/45)" → 32
  const a = parseSmartAttributes(ATA_SAMPLE);
  assert.strictEqual(a.temperatureC, 32);
});

test('ATA 회전 속도로 HDD/SSD를 구분한다', () => {
  assert.strictEqual(parseSmartIdentity(ATA_SAMPLE).isSsd, false, '5425 rpm이면 HDD');
  const ssd = parseSmartIdentity(ATA_SAMPLE.replace('5425 rpm', 'Solid State Device'));
  assert.strictEqual(ssd.isSsd, true);
});

test('속성 표가 없는 출력에서는 null을 돌려준다 (억지로 만들지 않음)', () => {
  assert.strictEqual(parseSmartAttributes('SMART overall-health self-assessment test result: PASSED'), null);
});

test('전체 판정 파싱은 기존대로 동작한다 (오류 메시지의 failed에 걸리지 않음)', () => {
  assert.strictEqual(parseSmartHealthOutput(NVME_SAMPLE).healthy, true);
  assert.strictEqual(parseSmartHealthOutput('Smartctl open device: /dev/sda failed: Invalid argument').healthy, null);
});

// ============================================================
section('SMART 속성 → 진단 (PASSED인데 죽어가는 디스크 잡아내기)');
// ============================================================

function storageWithSmart(attributes, identity = { model: 'TEST-DISK' }) {
  return {
    volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }],
    disks: [],
    smart: [{ device: '/dev/sda', type: 'sat', healthy: true, status: 'passed', identity, attributes }],
    smartctlAvailable: true, io: null,
  };
}

test('SMART 전체 판정이 PASSED여도 대기 중 섹터가 있으면 경고한다', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'ata', pendingSectors: 3 }) }));
  const s = findSection(r, 'STORAGE');
  assert.strictEqual(s.status, 'warning');
  const issue = s.issues.find((i) => i.title.includes('읽기에 실패한 섹터'));
  assert.ok(issue, '대기 중 섹터 이슈가 있어야 함');
  assert.ok(/PASSED/.test(issue.explanation), '전체 판정이 정상이라는 점을 함께 설명해야 함');
});

test('대기 중 섹터가 많으면 critical로 올린다', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'ata', pendingSectors: 25 }) }));
  assert.strictEqual(findSection(r, 'STORAGE').status, 'critical');
});

test('CRC 오류는 디스크 고장이 아니라 케이블 문제로 안내한다', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'ata', crcErrors: 12 }) }));
  const issue = findSection(r, 'STORAGE').issues.find((i) => i.title.includes('CRC'));
  assert.ok(issue, 'CRC 이슈가 있어야 함');
  assert.strictEqual(issue.level, 'watch', 'CRC만으로 디스크 교체를 권하면 안 됨');
  assert.ok(issue.actions.some((a) => a.includes('케이블')), '케이블 교체를 먼저 안내해야 함');
});

test('재할당 섹터가 소수면 watch, 많으면 warning', () => {
  const few = buildReport(baseInput({ storage: storageWithSmart({ kind: 'ata', reallocatedSectors: 2 }) }));
  const many = buildReport(baseInput({ storage: storageWithSmart({ kind: 'ata', reallocatedSectors: 80 }) }));
  assert.strictEqual(findSection(few, 'STORAGE').status, 'watch', '소수 재할당으로 겁주면 안 됨');
  assert.strictEqual(findSection(many, 'STORAGE').status, 'warning');
});

test('NVMe 예비 영역이 임계값 이하면 critical', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'nvme', availableSparePercent: 8, availableSpareThreshold: 10 }) }));
  assert.strictEqual(findSection(r, 'STORAGE').status, 'critical');
});

test('NVMe critical warning 플래그를 그대로 반영한다', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'nvme', criticalWarning: '0x04', criticalWarningValue: 4 }) }));
  assert.strictEqual(findSection(r, 'STORAGE').status, 'critical');
});

test('쓰기 수명 100% 초과는 경고하되 "고장"이라고 하지 않는다', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'nvme', wearPercentUsed: 105 }) }));
  const issue = findSection(r, 'STORAGE').issues.find((i) => i.title.includes('쓰기 수명'));
  assert.strictEqual(issue.level, 'warning');
  assert.ok(/즉시 고장난다는 뜻은 아니/.test(issue.explanation), '수명 소진 = 고장으로 단정하면 안 됨');
});

test('제조사 임계값 이하 속성(WHEN_FAILED)은 critical', () => {
  const r = buildReport(baseInput({
    storage: storageWithSmart({ kind: 'ata', failingNow: [{ id: 5, name: 'Reallocated_Sector_Ct', whenFailed: 'FAILING_NOW' }] }),
  }));
  const issue = findSection(r, 'STORAGE').issues.find((i) => i.title.includes('제조사 기준'));
  assert.ok(issue && issue.level === 'critical');
});

test('속성이 전부 정상이면 이슈 없이 근거로만 남는다', () => {
  const r = buildReport(baseInput({
    storage: storageWithSmart({ kind: 'nvme', pendingSectors: null, reallocatedSectors: null, mediaErrors: 0, availableSparePercent: 100, availableSpareThreshold: 10, wearPercentUsed: 0, powerOnHours: 1948 }),
  }));
  const s = findSection(r, 'STORAGE');
  assert.strictEqual(s.status, 'normal');
  assert.ok(s.normalEvidence.some((e) => e.includes('SMART 상세 속성')), 'SMART 속성을 확인했다는 근거가 있어야 함');
});

test('사용 시간을 연 단위로 환산해 보여준다 (중고 거래 판단 근거)', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart({ kind: 'ata', powerOnHours: 36523 }) }));
  const ev = findSection(r, 'STORAGE').normalEvidence.join(' ');
  assert.ok(ev.includes('36,523시간'), `사용 시간이 있어야 함: ${ev}`);
  assert.ok(ev.includes('4.2년'), `연 단위 환산이 있어야 함: ${ev}`);
});

test('SMART 속성을 못 읽으면 아무 말도 지어내지 않는다', () => {
  const r = buildReport(baseInput({ storage: storageWithSmart(null) }));
  const s = findSection(r, 'STORAGE');
  assert.strictEqual(s.status, 'normal');
  assert.ok(!s.normalEvidence.some((e) => e.includes('SMART 상세 속성')), '못 읽었으면 확인했다고 하면 안 됨');
});

test('대기 중 섹터 + 디스크 오류 이벤트는 서로 근거로 보강된다', () => {
  const r = buildReport(baseInput({
    storage: storageWithSmart({ kind: 'ata', pendingSectors: 3 }),
    eventLog: withEvents({ disk: 4 }),
  }));
  const issue = findSection(r, 'STORAGE').issues.find((i) => i.title.includes('읽기에 실패한 섹터'));
  assert.ok(issue.confidence > 78, `상관관계로 신뢰도가 올라야 함(원래 78): ${issue.confidence}`);
});

// ============================================================
section('기준선(평소 상태) — 기준선 만들기');
// ============================================================

// 기준선 측정은 collectLiveSample() 결과를 모은 것이다. 그 모양 그대로 만든다.
function liveSample({ cpuLoad = 5, cpuTemp = 44, clock = 1.2, gpuLoad = 2, gpuTemp = 38, mem = 30, t = 0 }) {
  return {
    t: 1_700_000_000_000 + t * 1500,
    cpu: { loadPercent: cpuLoad, tempC: cpuTemp, clockGHz: clock },
    gpu: gpuLoad === null ? null : { loadPercent: gpuLoad, tempC: gpuTemp, clockMHz: 300, vramUsedMB: 500, vramTotalMB: 8192 },
    ram: { usedPercent: mem },
  };
}
function idleSamples(n = 12, over = {}) {
  return Array.from({ length: n }, (_, i) => liveSample({ ...over, t: i }));
}

test('유휴 샘플만 모이면 기준선을 만든다 (중앙값)', () => {
  const s = summarizeBaselineSamples(idleSamples(12), { cpuModel: 'Test CPU', gpuModel: 'Test GPU' });
  assert.strictEqual(s.verdict, 'ok');
  assert.strictEqual(s.record.cpuIdleTempC, 44);
  assert.strictEqual(s.record.gpuIdleTempC, 38);
  assert.strictEqual(s.record.memIdleUsedPercent, 30);
  assert.strictEqual(s.record.cpuModel, 'Test CPU');
});

test('[핵심] 측정 중 부하가 걸려 있으면 기준선으로 저장하지 않는다', () => {
  // 이걸 저장해버리면 "평소 온도 78°C"가 되어 이후 모든 진단이 조용히 틀린다.
  const busy = Array.from({ length: 12 }, (_, i) => liveSample({ cpuLoad: 85, cpuTemp: 78, t: i }));
  const s = summarizeBaselineSamples(busy, {});
  assert.strictEqual(s.verdict, 'not-idle');
  assert.strictEqual(s.record, null, '부하 상태인데 record가 만들어지면 안 됨');
  assert.ok(s.reason.includes('85'), '왜 거부됐는지 실제 부하 값을 알려줘야 함');
});

test('일부만 부하여도 유휴 비율이 기준 미만이면 거부한다', () => {
  const mixed = [
    ...Array.from({ length: 5 }, (_, i) => liveSample({ t: i })),
    ...Array.from({ length: 7 }, (_, i) => liveSample({ cpuLoad: 70, cpuTemp: 70, t: 5 + i })),
  ];
  assert.strictEqual(summarizeBaselineSamples(mixed, {}).verdict, 'not-idle');
});

test('스파이크가 한두 개 섞인 정도는 기준선으로 인정하되 그 샘플은 뺀다', () => {
  const mostlyIdle = [
    ...Array.from({ length: 10 }, (_, i) => liveSample({ t: i })),
    liveSample({ cpuLoad: 90, cpuTemp: 80, t: 10 }),
    liveSample({ cpuLoad: 88, cpuTemp: 79, t: 11 }),
  ];
  const s = summarizeBaselineSamples(mostlyIdle, {});
  assert.strictEqual(s.verdict, 'ok');
  assert.strictEqual(s.record.idleSampleCount, 10);
  assert.strictEqual(s.record.cpuIdleTempC, 44, '부하 샘플이 중앙값에 섞이면 안 됨');
});

test('샘플이 너무 적으면 기준선을 만들지 않는다', () => {
  const s = summarizeBaselineSamples(idleSamples(3), {});
  assert.strictEqual(s.verdict, 'insufficient-samples');
  assert.strictEqual(s.record, null);
});

test('GPU가 유휴가 아니면 GPU 기준선만 비우고 CPU 기준선은 살린다', () => {
  const s = summarizeBaselineSamples(idleSamples(12, { gpuLoad: 75, gpuTemp: 70 }), {});
  assert.strictEqual(s.verdict, 'ok');
  assert.strictEqual(s.record.cpuIdleTempC, 44, 'CPU 기준선까지 버리면 안 됨');
  assert.strictEqual(s.record.gpuIdleTempC, null);
  assert.ok(s.record.gpuNote, 'GPU 기준선을 왜 안 만들었는지 남겨야 함');
});

test('GPU 값을 읽을 수 없어도(비NVIDIA) CPU 기준선은 만들어진다', () => {
  const s = summarizeBaselineSamples(idleSamples(12, { gpuLoad: null }), {});
  assert.strictEqual(s.verdict, 'ok');
  assert.strictEqual(s.record.gpuIdleTempC, null);
  assert.ok(s.record.gpuNote.includes('nvidia-smi'));
});

// ============================================================
section('기준선(평소 상태) — 지금 값과 비교');
// ============================================================

function baselineRecord(over = {}) {
  return {
    cpuModel: 'Test CPU', gpuModel: 'Test GPU',
    sampleCount: 12, idleSampleCount: 12, durationSec: 17,
    cpuIdleTempC: 44, cpuIdleLoadPercent: 5, cpuIdleClockGHz: 1.2, cpuIdleTempSpreadC: 2,
    gpuIdleTempC: 38, gpuIdleLoadPercent: 2, memIdleUsedPercent: 30, gpuNote: null,
    checkedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    ...over,
  };
}
function nowState(over = {}) {
  return {
    cpuModel: 'Test CPU', gpuModel: 'Test GPU',
    cpu: { loadPercent: 6, tempC: 46 },
    gpu: { loadPercent: 3, tempC: 39 },
    memUsedPercent: 31,
    ...over,
  };
}
const deltaOf = (c, key) => c.deltas.find((d) => d.key === key);

test('기준선이 없으면 비교하지 않는다', () => {
  const c = compareToBaseline(null, nowState());
  assert.strictEqual(c.available, false);
  assert.strictEqual(c.reason, 'no-baseline');
});

test('평소와 비슷하면 아무 등급도 올리지 않는다', () => {
  const c = compareToBaseline(baselineRecord(), nowState());
  assert.ok(c.available);
  assert.ok(c.deltas.every((d) => d.level === 'normal'));
});

test('유휴 온도가 평소보다 10°C 높으면 watch', () => {
  const c = compareToBaseline(baselineRecord(), nowState({ cpu: { loadPercent: 6, tempC: 54 } }));
  assert.strictEqual(deltaOf(c, 'cpuIdleTempC').level, 'watch');
});

test('유휴 온도가 평소보다 15°C 높으면 warning', () => {
  const c = compareToBaseline(baselineRecord(), nowState({ cpu: { loadPercent: 6, tempC: 59 } }));
  const d = deltaOf(c, 'cpuIdleTempC');
  assert.strictEqual(d.level, 'warning');
  assert.strictEqual(d.diff, 15);
});

test('평소보다 낮아진 것은 등급을 올리지 않는다', () => {
  const c = compareToBaseline(baselineRecord(), nowState({ cpu: { loadPercent: 6, tempC: 30 } }));
  assert.strictEqual(deltaOf(c, 'cpuIdleTempC').level, 'normal');
});

test('[핵심] 지금 부하가 걸려 있으면 유휴 기준선과 비교하지 않는다', () => {
  // 이 가드가 없으면 게임 중 진단은 무조건 "평소보다 30°C 높음"이 되어 100% 오탐이 난다.
  const c = compareToBaseline(baselineRecord(), nowState({ cpu: { loadPercent: 92, tempC: 78 } }));
  const d = deltaOf(c, 'cpuIdleTempC');
  assert.strictEqual(d.skipped, 'not-idle');
  assert.strictEqual(d.level, 'normal');
  assert.strictEqual(d.diff, null, '비교하지 않았으면 차이를 계산해서도 안 됨');
});

test('GPU만 부하 중이면 GPU 항목만 건너뛰고 CPU는 비교한다', () => {
  const c = compareToBaseline(baselineRecord(), nowState({ gpu: { loadPercent: 99, tempC: 72 }, cpu: { loadPercent: 6, tempC: 60 } }));
  assert.strictEqual(deltaOf(c, 'gpuIdleTempC').skipped, 'not-idle');
  assert.strictEqual(deltaOf(c, 'cpuIdleTempC').level, 'warning');
});

test('CPU가 바뀌었으면 기준선 전체를 쓰지 않는다', () => {
  const c = compareToBaseline(baselineRecord(), nowState({ cpuModel: 'Another CPU', cpu: { loadPercent: 6, tempC: 70 } }));
  assert.strictEqual(c.available, false);
  assert.strictEqual(c.reason, 'hardware-changed');
  assert.strictEqual(c.deltas.length, 0);
});

test('GPU만 바뀌었으면 GPU 항목만 건너뛰고 CPU 비교는 유지한다', () => {
  const c = compareToBaseline(baselineRecord(), nowState({ gpuModel: 'New GPU', cpu: { loadPercent: 6, tempC: 60 } }));
  assert.ok(c.available);
  assert.strictEqual(deltaOf(c, 'gpuIdleTempC').skipped, 'gpu-changed');
  assert.strictEqual(deltaOf(c, 'cpuIdleTempC').level, 'warning');
});

test('오래된 기준선은 버리지 않고 stale로 표시한다', () => {
  // 버리면 정작 "몇 달에 걸쳐 나빠지는 변화"를 못 잡는다.
  const old = baselineRecord({ checkedAt: new Date(Date.now() - 200 * 86400000).toISOString() });
  const c = compareToBaseline(old, nowState({ cpu: { loadPercent: 6, tempC: 60 } }));
  assert.strictEqual(c.stale, true);
  assert.strictEqual(c.ageDays, 200);
  assert.strictEqual(deltaOf(c, 'cpuIdleTempC').level, 'warning');
});

test('기준선에 GPU 값이 없으면 GPU 항목은 비교 대상에 들어가지 않는다', () => {
  const c = compareToBaseline(baselineRecord({ gpuIdleTempC: null }), nowState());
  assert.strictEqual(deltaOf(c, 'gpuIdleTempC'), undefined);
});

// ============================================================
section('기준선(평소 상태) — 진단 엔진 연동');
// ============================================================

test('[회귀 방지] 기준선이 buildReport에 전달되지 않으면 즉시 드러난다', () => {
  // deepTests가 buildReport에 안 넘어가서 "RAM 오류인데 등급 정상"이 났던 것과 같은 유형의 회귀.
  // 기준선을 넘겼는데 CPU 섹션이 normal이면 어딘가에서 값이 끊긴 것이다.
  const r = buildReport(baseInput({
    cpu: { model: 'Test CPU', loadPercent: 6, tempC: 60, clockGHz: 1.2 },
    baseline: baselineRecord(),
  }));
  assert.notStrictEqual(findSection(r, 'CPU').status, 'normal',
    '기준선 대비 +16°C인데 CPU가 normal이면 기준선이 규칙 엔진까지 도달하지 못한 것');
});

test('유휴 온도가 평소보다 크게 높으면 CPU warning 이슈가 생긴다', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'Test CPU', loadPercent: 6, tempC: 60, clockGHz: 1.2 },
    baseline: baselineRecord(),
  }));
  const issue = findSection(r, 'CPU').issues.find((i) => i.title.includes('평소보다'));
  assert.ok(issue, '평소 대비 이슈가 있어야 함');
  assert.strictEqual(issue.level, 'warning');
  assert.ok(issue.evidence.some((e) => e.includes('44')), '기준선 값이 근거에 있어야 함');
  assert.ok(issue.evidence.some((e) => e.includes('60')), '현재 값이 근거에 있어야 함');
});

test('원인 후보에 실내 온도·잔열을 하드웨어 고장보다 먼저 적는다', () => {
  // 온도 상승의 가장 흔한 원인은 계절과 잔열이다. 그걸 빼고 "쿨러 고장"부터 말하면 과잉 경고다.
  const r = buildReport(baseInput({
    cpu: { model: 'Test CPU', loadPercent: 6, tempC: 60, clockGHz: 1.2 },
    baseline: baselineRecord(),
  }));
  const issue = findSection(r, 'CPU').issues.find((i) => i.title.includes('평소보다'));
  assert.ok(issue.causes[0].includes('실내 온도'), `첫 원인 후보가 실내 온도여야 함: ${issue.causes[0]}`);
  assert.ok(issue.confidence <= 60, `확정할 수 없는 판정이라 confidence를 60 이하로: ${issue.confidence}`);
});

test('기준선 대비 정상이면 근거 줄에 평소 값을 남긴다', () => {
  const r = buildReport(baseInput({ cpu: { model: 'Test CPU', loadPercent: 6, tempC: 46, clockGHz: 1.2 }, baseline: baselineRecord() }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.status, 'normal');
  assert.ok(cpu.normalEvidence.some((e) => e.includes('평소')), '정상 판정도 평소 대비 근거를 남겨야 함');
});

test('[핵심] 부하 중 진단은 기준선 때문에 등급이 올라가지 않는다', () => {
  // 게임 중 진단할 때마다 "평소보다 뜨겁다"고 하면 이 기능은 쓸모없는 소음이 된다.
  const r = buildReport(baseInput({
    cpu: { model: 'Test CPU', loadPercent: 92, tempC: 74, clockGHz: 4.5 },
    baseline: baselineRecord(),
  }));
  const cpu = findSection(r, 'CPU');
  assert.ok(!cpu.issues.some((i) => i.title.includes('평소보다')), '부하 중에는 평소 대비 이슈를 만들면 안 됨');
});

test('기준선이 없으면 기존 진단 결과가 달라지지 않는다', () => {
  const withNothing = buildReport(baseInput());
  const withNull = buildReport(baseInput({ baseline: null }));
  assert.strictEqual(withNothing.totalWarnings, withNull.totalWarnings);
  assert.strictEqual(findSection(withNull, 'CPU').status, 'normal');
});

test('유휴 메모리 사용률이 평소보다 크게 높으면 RAM watch', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'Test CPU', loadPercent: 6, tempC: 46, clockGHz: 1.2 },
    memory: { totalGB: 16, usedGB: 9, availableGB: 7, usedPercent: 55, swapUsedGB: 0, swapTotalGB: 0 },
    baseline: baselineRecord(),
  }));
  const ram = findSection(r, 'RAM');
  assert.strictEqual(ram.status, 'watch');
  assert.ok(ram.issues.some((i) => i.title.includes('평소보다')));
});

test('리포트에 기준선 비교 결과가 표시용으로 실린다', () => {
  const r = buildReport(baseInput({ cpu: { model: 'Test CPU', loadPercent: 6, tempC: 46, clockGHz: 1.2 }, baseline: baselineRecord() }));
  assert.ok(r.baseline, 'report.baseline이 있어야 화면에서 표를 그릴 수 있다');
  assert.strictEqual(r.baseline.available, true);
  assert.strictEqual(r.baseline.ageDays, 10);
});

// ============================================================
section('메모리 구성 진단 (혼합 DIMM · 정격 대비 속도 · 채널)');
// ============================================================

function dimm(over = {}) {
  return {
    slot: 'ChannelA-DIMM0', bank: 'BANK 0', manufacturer: 'Samsung',
    partNumber: 'M378A1G43EB1-CPB', capacityGB: 8,
    ratedSpeedMTs: 3200, configuredSpeedMTs: 3200, voltageV: 1.2,
    type: 'DDR4', serial: '1', ...over,
  };
}
function memMods(modules, over = {}) {
  return {
    supported: true, modules, totalSlots: 4, usedSlots: modules.length,
    maxCapacityGB: 64, timingsAvailable: false, error: null, ...over,
  };
}
// 이 개발 PC의 실제 구성(Samsung 8GB×4, 전부 동일, 정격=현재 2133)
const REAL_PC_MODULES = memMods([0, 1, 2, 3].map((i) => dimm({
  slot: `Channel${i < 2 ? 'A' : 'B'}-DIMM${i % 2}`, bank: `BANK ${i}`,
  ratedSpeedMTs: 2133, configuredSpeedMTs: 2133, serial: String(15292416 + i),
})));

test('동일 모듈이 정격대로 돌면 이슈 없이 근거만 남는다 (이 PC 실제 구성)', () => {
  const c = analyzeMemoryConfig(REAL_PC_MODULES);
  assert.strictEqual(c.findings.length, 0, `이슈가 없어야 함: ${c.findings.map((f) => f.ruleId).join(', ')}`);
  assert.ok(c.evidence.some((e) => e.includes('동일 사양')));
  assert.ok(c.evidence.some((e) => e.includes('2133')));
});

test('[기획서 §7 핵심 사례] 혼합 DIMM + 정격 미달 → 경고', () => {
  // XMP 3200 2개 + 기본 2666 2개 → 전체가 2666으로 동작
  const c = analyzeMemoryConfig(memMods([
    dimm({ slot: 'ChannelA-DIMM0', partNumber: 'AAA-3200', ratedSpeedMTs: 3200, configuredSpeedMTs: 2666 }),
    dimm({ slot: 'ChannelA-DIMM1', partNumber: 'AAA-3200', ratedSpeedMTs: 3200, configuredSpeedMTs: 2666 }),
    dimm({ slot: 'ChannelB-DIMM0', partNumber: 'BBB-2666', ratedSpeedMTs: 2666, configuredSpeedMTs: 2666 }),
    dimm({ slot: 'ChannelB-DIMM1', partNumber: 'BBB-2666', ratedSpeedMTs: 2666, configuredSpeedMTs: 2666 }),
  ]));
  const f = c.findings.find((x) => x.ruleId === 'MEMORY-MIXED-DIMM-BELOW-RATED');
  assert.ok(f, `혼합+정격미달 규칙이 걸려야 함: ${c.findings.map((x) => x.ruleId).join(', ')}`);
  assert.strictEqual(f.level, 'warning');
  assert.ok(f.explanation.includes('2666') && f.explanation.includes('3200'));
  assert.strictEqual(c.summary.mixed, true);
});

test('[핵심] 혼합이어도 전부 정격대로 돌면 이슈로 올리지 않는다', () => {
  // "혼합 RAM = 문제"라고 단정하면 멀쩡한 PC를 문제 있다고 말하게 된다.
  const c = analyzeMemoryConfig(memMods([
    dimm({ slot: 'ChannelA-DIMM0', partNumber: 'AAA-3200', ratedSpeedMTs: 3200, configuredSpeedMTs: 3200 }),
    dimm({ slot: 'ChannelB-DIMM0', partNumber: 'BBB-3200', ratedSpeedMTs: 3200, configuredSpeedMTs: 3200 }),
  ]));
  assert.strictEqual(c.summary.mixed, true, '혼합이라는 사실은 기록해야 함');
  assert.strictEqual(c.findings.length, 0, '혼합만으로 이슈를 올리면 안 됨');
  assert.ok(c.evidence.some((e) => e.includes('서로 다른 모듈')), '혼합 사실은 근거로 남겨야 함');
});

test('동일 모듈인데 정격보다 낮으면 watch (BIOS 설정 가능성)', () => {
  const c = analyzeMemoryConfig(memMods([
    dimm({ slot: 'ChannelA-DIMM0', ratedSpeedMTs: 3200, configuredSpeedMTs: 2133 }),
    dimm({ slot: 'ChannelB-DIMM0', ratedSpeedMTs: 3200, configuredSpeedMTs: 2133 }),
  ]));
  const f = c.findings.find((x) => x.ruleId === 'MEMORY-BELOW-RATED-SPEED');
  assert.ok(f);
  assert.strictEqual(f.level, 'watch');
});

test('[기획서 §8] 정격보다 높으면 "설정 변경됨"으로 알리되 고장이라 하지 않는다', () => {
  const c = analyzeMemoryConfig(memMods([
    dimm({ slot: 'ChannelA-DIMM0', ratedSpeedMTs: 2666, configuredSpeedMTs: 3200 }),
    dimm({ slot: 'ChannelB-DIMM0', ratedSpeedMTs: 2666, configuredSpeedMTs: 3200 }),
  ]));
  const f = c.findings.find((x) => x.ruleId === 'MEMORY-ABOVE-RATED-SPEED');
  assert.ok(f);
  assert.strictEqual(f.level, 'watch');
  assert.ok(!/고장|불량/.test(f.title), `제목에서 고장이라고 단정하면 안 됨: ${f.title}`);
  assert.ok(/고장은 아니/.test(f.explanation), '설명에서 고장이 아니라는 점을 분명히 해야 함');
  assert.ok(f.evidence.some((e) => e.includes('불안정하다는 뜻은 아닙니다')));
});

test('싱글 채널 장착을 감지한다', () => {
  const c = analyzeMemoryConfig(memMods([
    dimm({ slot: 'ChannelA-DIMM0' }), dimm({ slot: 'ChannelA-DIMM1' }),
  ]));
  assert.ok(c.findings.find((x) => x.ruleId === 'MEMORY-SINGLE-CHANNEL'));
});

test('슬롯 이름에서 채널을 못 읽으면 채널 얘기를 아예 하지 않는다', () => {
  const c = analyzeMemoryConfig(memMods([
    dimm({ slot: 'XPG-SLOT-1' }), dimm({ slot: 'XPG-SLOT-2' }),
  ]));
  assert.strictEqual(c.summary.channelsKnown, false);
  assert.ok(!c.findings.find((x) => x.ruleId === 'MEMORY-SINGLE-CHANNEL'), '근거 없이 싱글 채널이라 하면 안 됨');
  assert.ok(c.notTested.some((n) => n.includes('채널')), '검사 못 한 것으로 명시해야 함');
});

test('타이밍은 항상 "검사 안 함"으로 명시한다 (OS에서 못 읽음)', () => {
  const c = analyzeMemoryConfig(REAL_PC_MODULES);
  assert.ok(c.notTested.some((n) => n.includes('타이밍')));
  assert.ok(c.evidence.some((e) => e.includes('정상이라는 뜻이 아닙니다')));
});

test('모듈 정보를 못 읽으면 정상이 아니라 "검사 안 함"이다', () => {
  const c = analyzeMemoryConfig({ supported: false, modules: [], error: '조회 실패' });
  assert.strictEqual(c.findings.length, 0);
  assert.ok(c.notTested.length > 0, '못 읽은 것은 검사 안 함으로 남아야 함');
});

test('모듈 정보가 아예 없어도(구버전 raw) 진단이 깨지지 않는다', () => {
  const c = analyzeMemoryConfig(undefined);
  assert.strictEqual(c.supported, false);
  assert.strictEqual(c.findings.length, 0);
});

test('진단 엔진에 연결되어 RAM 섹션 상태를 바꾼다', () => {
  const r = buildReport(baseInput({
    memoryModules: memMods([
      dimm({ slot: 'ChannelA-DIMM0', partNumber: 'AAA-3200', ratedSpeedMTs: 3200, configuredSpeedMTs: 2666 }),
      dimm({ slot: 'ChannelB-DIMM0', partNumber: 'BBB-2666', ratedSpeedMTs: 2666, configuredSpeedMTs: 2666 }),
    ]),
  }));
  const ram = findSection(r, 'RAM');
  assert.strictEqual(ram.status, 'warning');
  const issue = ram.issues.find((i) => i.ruleId === 'MEMORY-MIXED-DIMM-BELOW-RATED');
  assert.ok(issue, 'Rule ID가 이슈에 실려야 함');
  assert.ok(issue.ruleVersion, 'Rule 버전이 실려야 함 (과거 결과 설명용)');
  assert.strictEqual(issue.confidenceLevel, 'STRONG_INDICATION');
  assert.ok(ram.memoryConfig, 'RAM 섹션에 구성 요약이 실려야 함');
});

test('[기획서 §14] 조치마다 위험도가 붙는다', () => {
  const r = buildReport(baseInput({
    memoryModules: memMods([
      dimm({ slot: 'ChannelA-DIMM0', ratedSpeedMTs: 3200, configuredSpeedMTs: 2133 }),
      dimm({ slot: 'ChannelB-DIMM0', ratedSpeedMTs: 3200, configuredSpeedMTs: 2133 }),
    ]),
  }));
  const issue = findSection(r, 'RAM').issues.find((i) => i.ruleId === 'MEMORY-BELOW-RATED-SPEED');
  assert.ok(issue.actionDetails.length > 0);
  assert.ok(issue.actionDetails.every((a) => a.risk), '모든 조치에 위험도가 있어야 함');
  assert.ok(issue.actionDetails.some((a) => a.risk === 'SAFE'), '확인만 하는 안전한 조치가 먼저 있어야 함');
  assert.ok(issue.actionDetails.some((a) => a.risk === 'INTERMEDIATE'), 'BIOS 변경은 INTERMEDIATE여야 함');
  assert.strictEqual(issue.actions.length, issue.actionDetails.length, '기존 문자열 배열도 유지되어야 함');
});

test('메모리 구성이 없으면 기존 RAM 진단이 달라지지 않는다', () => {
  const withNothing = buildReport(baseInput());
  assert.strictEqual(findSection(withNothing, 'RAM').status, 'normal');
});

// ============================================================
section('설정 변경(오버클럭/언더볼팅) 상태 진단');
// ============================================================

function ocState(over = {}) {
  return {
    cpu: {
      model: 'Intel(R) Xeon(R) CPU E3-1230 v5 @ 3.40GHz', stockBaseGHz: 3.4, maxClockGHz: 3.4,
      bclkMHz: 100, voltageV: null, voltageReadable: false, readable: true, ...(over.cpu || {}),
    },
    gpu: {
      supported: true, powerLimitW: 120, defaultPowerLimitW: 120, minPowerLimitW: 60,
      maxPowerLimitW: 140, enforcedPowerLimitW: 120, maxClockMHz: 1923, maxMemClockMHz: 4004, ...(over.gpu || {}),
    },
  };
}
const stockMemSummary = { currentMTs: 2133, highestRatedMTs: 2133 };

test('정품 설정이면 stock으로 판정하고 이슈를 만들지 않는다 (이 PC 실제 값)', () => {
  const c = analyzeConfiguration({ overclockState: ocState(), memorySummary: stockMemSummary });
  assert.strictEqual(c.cpu.status, 'stock');
  assert.strictEqual(c.gpu.status, 'stock');
  assert.strictEqual(c.memory.status, 'stock');
  assert.strictEqual(c.modified, false);
  assert.strictEqual(c.cpu.findings.length + c.gpu.findings.length, 0);
});

test('[기획서 §8] GPU 전력 제한이 기본값과 다르면 "설정 변경됨"', () => {
  const c = analyzeConfiguration({ overclockState: ocState({ gpu: { powerLimitW: 140 } }), memorySummary: stockMemSummary });
  assert.strictEqual(c.gpu.status, 'modified');
  const f = c.gpu.findings.find((x) => x.ruleId === 'GPU-POWER-LIMIT-MODIFIED');
  assert.ok(f);
  assert.strictEqual(f.confidence, 'CONFIRMED', '드라이버가 준 값 비교라 확실해야 함');
  assert.ok(f.title.includes('상향'));
});

test('전력 제한 하향(언더볼팅/저소음)도 같은 규칙으로 잡는다', () => {
  const c = analyzeConfiguration({ overclockState: ocState({ gpu: { powerLimitW: 90 } }), memorySummary: stockMemSummary });
  assert.ok(c.gpu.findings[0].title.includes('하향'));
});

test('CPU 기본 클럭이 정품보다 높으면 설정 변경으로 본다', () => {
  const c = analyzeConfiguration({ overclockState: ocState({ cpu: { maxClockGHz: 3.8, bclkMHz: 112 } }), memorySummary: stockMemSummary });
  assert.strictEqual(c.cpu.status, 'modified');
  const f = c.cpu.findings.find((x) => x.ruleId === 'CPU-BASE-CLOCK-MODIFIED');
  assert.ok(f);
  assert.ok(f.evidence.some((e) => e.includes('112')), 'BCLK 이탈도 근거에 넣어야 함');
});

test('반올림 오차(3401MHz ↔ 3.40GHz)를 오버클럭으로 오판하지 않는다', () => {
  const c = analyzeConfiguration({ overclockState: ocState({ cpu: { maxClockGHz: 3.41 } }), memorySummary: stockMemSummary });
  assert.strictEqual(c.cpu.status, 'stock');
});

test('모델명에 정품 클럭이 없으면 판정하지 않고 검사 안 함으로 남긴다', () => {
  // AMD 모델명에는 "@ x.xxGHz"가 없는 경우가 많다. 비교 기준이 없으면 말하지 않는다.
  const c = analyzeConfiguration({
    overclockState: ocState({ cpu: { model: 'AMD Ryzen 7 5800X 8-Core Processor', stockBaseGHz: null, maxClockGHz: 3.8 } }),
    memorySummary: stockMemSummary,
  });
  assert.strictEqual(c.cpu.status, 'unknown');
  assert.strictEqual(c.cpu.findings.length, 0);
  assert.ok(c.notTested.some((n) => n.includes('정품 값')));
});

test('CPU 전압을 못 읽으면 언더볼팅 여부를 검사 안 함으로 명시한다', () => {
  const c = analyzeConfiguration({ overclockState: ocState(), memorySummary: stockMemSummary });
  assert.ok(c.notTested.some((n) => n.includes('전압')));
});

test('GPU 최대 부스트 클럭은 판정에 쓰지 않고 참고값으로만 남긴다', () => {
  // 공장 OC 모델은 원래 레퍼런스보다 높다. 이걸로 판정하면 멀쩡한 카드를 OC라고 하게 된다.
  const c = analyzeConfiguration({ overclockState: ocState({ gpu: { maxClockMHz: 2100 } }), memorySummary: stockMemSummary });
  assert.strictEqual(c.gpu.status, 'stock');
  assert.ok(c.gpu.evidence.some((e) => e.includes('판정에 쓰지 않음')));
});

test('메모리가 정격보다 높으면 profile-active', () => {
  const c = analyzeConfiguration({ overclockState: ocState(), memorySummary: { currentMTs: 3200, highestRatedMTs: 2666 } });
  assert.strictEqual(c.memory.status, 'profile-active');
  assert.strictEqual(c.modified, true);
});

test('nvidia-smi를 못 쓰면 GPU 설정을 unknown으로 두고 complete=false', () => {
  const c = analyzeConfiguration({ overclockState: ocState({ gpu: { supported: false } }), memorySummary: stockMemSummary });
  assert.strictEqual(c.gpu.status, 'unknown');
  assert.strictEqual(c.complete, false, '판정 못 한 항목이 있으면 "전부 정품"이라고 할 수 없다');
});

test('진단 엔진에 연결되어 GPU 섹션에 이슈로 나타난다', () => {
  const r = buildReport(baseInput({
    gpu: { controllers: [{ model: 'Test GPU' }], supported: true, nvidia: { loadPercent: 5, tempC: 40, clockMHz: 1500, vramUsedMB: 500, vramTotalMB: 8192 } },
    overclockState: ocState({ gpu: { powerLimitW: 140 } }),
  }));
  const g = findSection(r, 'GPU');
  assert.ok(g.issues.find((i) => i.ruleId === 'GPU-POWER-LIMIT-MODIFIED'));
  assert.strictEqual(g.configStatus, 'modified');
  assert.ok(r.configuration, '리포트 최상위에 설정 상태 요약이 실려야 함');
});

test('[기획서 §12] 설정 변경 + 하드웨어 오류 이벤트 → 조사 대상으로 올린다', () => {
  const r = buildReport(baseInput({
    overclockState: ocState({ gpu: { powerLimitW: 140 } }),
    eventLog: withEvents({ whea: 3 }),
  }));
  const sys = findSection(r, 'EVENTS');
  const issue = sys.issues.find((i) => i.ruleId === 'CONFIG-STABILITY-INVESTIGATION');
  assert.ok(issue, '둘 다 있으면 조사 대상으로 올려야 함');
  assert.strictEqual(issue.confidenceLevel, 'NEEDS_VERIFICATION', '인과를 단정하면 안 됨');
  assert.ok(issue.evidence.some((e) => e.includes('인과관계는 확인되지 않았습니다')));
});

test('[핵심] 설정만 변경되고 오류가 없으면 조사 대상으로 올리지 않는다', () => {
  const r = buildReport(baseInput({ overclockState: ocState({ gpu: { powerLimitW: 140 } }) }));
  const sys = findSection(r, 'EVENTS');
  assert.ok(!sys.issues.find((i) => i.ruleId === 'CONFIG-STABILITY-INVESTIGATION'),
    '설정 변경만으로 문제라고 하면 과잉 경고다');
});

test('[핵심] 오류만 있고 설정이 정품이면 설정 탓을 하지 않는다', () => {
  const r = buildReport(baseInput({ overclockState: ocState(), eventLog: withEvents({ whea: 3 }) }));
  const sys = findSection(r, 'EVENTS');
  assert.ok(!sys.issues.find((i) => i.ruleId === 'CONFIG-STABILITY-INVESTIGATION'));
});

test('설정 정보가 없어도 기존 진단이 깨지지 않는다', () => {
  const r = buildReport(baseInput());
  assert.strictEqual(findSection(r, 'CPU').status, 'normal');
  assert.strictEqual(findSection(r, 'DRIVERS').status, 'normal');
  assert.ok(r.configuration.notTested.length > 0, '못 읽었으면 검사 안 함으로 남아야 함');
});

// ============================================================
section('결과 상태 6단계 — "검사 안 함"을 정상이라고 말하지 않는다');
// ============================================================

// 아무것도 측정할 수 없는 환경(비NVIDIA + 오프라인 + 헤드리스 + 비Windows).
function untestableInput(over = {}) {
  return baseInput({
    gpu: { controllers: [{ model: 'AMD Radeon RX 6600' }], nvidia: null, supported: false },
    network: { ping: { avgMs: null, jitterMs: null, lossPercent: null } },
    display: [],
    system: { platform: 'linux', distro: 'Ubuntu', driverErrors: [] },
    eventLog: { supported: false, events: [], days: 7, error: null },
    ...over,
  });
}

test('[회귀 방지] 측정 못 한 카테고리는 PASS가 아니라 NOT_TESTED다', () => {
  // 이 프로젝트가 가장 하지 말아야 할 것 — 검사하지 않은 것을 정상이라고 말하는 것.
  // 예전에는 아래 네 카테고리가 전부 status=normal(정상)으로 나왔다.
  const r = buildReport(untestableInput());
  ['GPU', 'NETWORK', 'DISPLAY', 'DRIVERS', 'EVENTS'].forEach((cat) => {
    assert.strictEqual(findSection(r, cat).result, 'NOT_TESTED',
      `${cat}: 측정한 게 없는데 ${findSection(r, cat).result}로 나옴`);
  });
});

test('NOT_TESTED 섹션은 "정상 근거"를 만들지 않는다', () => {
  const r = buildReport(untestableInput());
  ['GPU', 'NETWORK', 'DISPLAY', 'DRIVERS', 'EVENTS'].forEach((cat) => {
    assert.strictEqual(findSection(r, cat).normalEvidence.length, 0,
      `${cat}: 검사도 안 했는데 정상 근거가 있음`);
  });
});

test('측정한 카테고리는 그대로 PASS다', () => {
  const r = buildReport(untestableInput());
  assert.strictEqual(findSection(r, 'CPU').result, 'PASS');
  assert.strictEqual(findSection(r, 'RAM').result, 'PASS');
});

test('headline이 검사하지 못한 항목을 숨기지 않는다', () => {
  const r = buildReport(untestableInput({
    storage: { volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }], disks: [], smart: [], smartctlAvailable: true, io: null },
  }));
  assert.ok(/검사하지 못했습니다/.test(r.headline), `headline: ${r.headline}`);
  assert.strictEqual(r.resultSummary.allTested, false);
});

test('전부 검사한 정상 PC는 "현재 시스템은 정상입니다"를 그대로 유지한다', () => {
  const r = buildReport(baseInput({
    gpu: { controllers: [{ model: 'Test GPU' }], supported: true, nvidia: { loadPercent: 5, tempC: 40, clockMHz: 1500, vramUsedMB: 500, vramTotalMB: 8192 } },
    storage: { volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }], disks: [], smart: [{ device: '/dev/sda', healthy: true, type: 'nvme' }], smartctlAvailable: true, io: null },
    eventLog: withEvents({}),
  }));
  assert.strictEqual(r.headline, '현재 시스템은 정상입니다.');
  assert.strictEqual(r.resultSummary.allTested, true);
});

test('실제 오류가 확인된 warning은 ERROR로, 가능성 수준은 WARNING으로 구분한다', () => {
  // GPU 전력 제한 변경은 드라이버 값 비교라 CONFIRMED — 다만 level이 watch라 WARNING이다.
  const watchOnly = buildReport(baseInput({
    gpu: { controllers: [{ model: 'Test GPU' }], supported: true, nvidia: { loadPercent: 5, tempC: 40, clockMHz: 1500, vramUsedMB: 500, vramTotalMB: 8192 } },
    overclockState: ocState({ gpu: { powerLimitW: 140 } }),
  }));
  assert.strictEqual(findSection(watchOnly, 'GPU').result, 'WARNING');

  // 패킷 손실은 confidence 90 — 실제로 측정된 오류다.
  const confirmed = buildReport(baseInput({ network: { ping: { avgMs: 20, jitterMs: 3, lossPercent: 5 } } }));
  assert.strictEqual(findSection(confirmed, 'NETWORK').result, 'CRITICAL');
});

test('부분적으로 못 한 검사도 목록으로 남는다 (검사 범위 공개)', () => {
  const r = buildReport(baseInput({ cpu: { model: 'Test CPU', loadPercent: 10, tempC: null, clockGHz: 3.5 } }));
  const cpu = findSection(r, 'CPU');
  assert.strictEqual(cpu.result, 'PASS', '부하는 쟀으므로 PASS가 맞다');
  assert.ok(cpu.notTested.some((n) => n.includes('CPU 온도')), '온도를 못 쟀다는 사실은 남아야 한다');
  assert.ok(r.notTested.some((n) => n.category === 'CPU' && n.item.includes('온도')));
});

// ============================================================
section('진단 프로필 (기획서 §19)');
// ============================================================

test('프로필 8종이 모두 정의되어 있다', () => {
  const ids = listProfiles().map((p) => p.id).sort();
  assert.deepStrictEqual(ids,
    ['full', 'gaming', 'preDelivery', 'quick', 'repairExit', 'repairIntake', 'stability', 'usedPc'].sort());
});

test('모든 프로필이 목적·대상·소요 시간을 밝힌다', () => {
  listProfiles().forEach((p) => {
    assert.ok(p.label && p.purpose && p.audience, `${p.id}: 설명이 비어 있음`);
    assert.ok(p.estimatedSec > 0, `${p.id}: 예상 소요 시간이 없음`);
  });
});

test('모르는 프로필 id는 전체 진단으로 안전하게 떨어진다', () => {
  assert.strictEqual(resolveProfile('없는프로필').id, 'full');
  assert.strictEqual(resolveProfile(undefined).id, 'full');
});

test('[핵심] 프로필이 끈 검사는 정상이 아니라 NOT_TESTED로 남는다', () => {
  // 빠른 점검은 이벤트 로그를 조회하지 않는다. 3초 만에 전부 초록색이 되면
  // 사용자는 "이 PC는 멀쩡하다"고 읽는다 — 실제로는 재부팅 이력을 안 본 것이다.
  const r = buildReport(baseInput({
    profile: { id: 'quick' },
    eventLog: { supported: false, events: [], counts: [], totalCount: 0, days: 0, maxEvents: 0, truncated: false, error: null },
  }));
  const ev = findSection(r, 'EVENTS');
  assert.strictEqual(ev.result, 'NOT_TESTED');
  assert.strictEqual(ev.skippedByProfile, true);
  assert.ok(ev.note.includes('빠른 점검'), `건너뛴 이유를 프로필 기준으로 적어야 함: ${ev.note}`);
});

test('"이 프로필에서는 안 함"과 "이 환경에서 못 함"을 구분한다', () => {
  const skipped = buildReport(baseInput({
    profile: { id: 'quick' },
    eventLog: { supported: false, events: [], counts: [], totalCount: 0, days: 0, maxEvents: 0, truncated: false, error: null },
  }));
  const cantDo = buildReport(baseInput({
    profile: { id: 'full' },
    eventLog: { supported: false, events: [], counts: [], totalCount: 0, days: 0, maxEvents: 0, truncated: false, error: null },
  }));
  assert.ok(findSection(skipped, 'EVENTS').note.includes('빠른 점검'));
  assert.ok(findSection(cantDo, 'EVENTS').note.includes('Windows가 아닌'));
  assert.strictEqual(findSection(cantDo, 'EVENTS').skippedByProfile, undefined);
});

test('실제로 측정된 카테고리는 프로필이 껐어도 덮어쓰지 않는다', () => {
  // 프로필이 껐더라도 다른 경로로 값이 들어왔다면 그건 실제 측정 결과다.
  const r = buildReport(baseInput({ profile: { id: 'quick' }, eventLog: withEvents({ kernelPower: 5 }) }));
  const ev = findSection(r, 'EVENTS');
  assert.notStrictEqual(ev.result, 'NOT_TESTED');
  assert.ok(!ev.skippedByProfile);
});

test('리포트가 어떤 프로필로 검사했는지 밝힌다', () => {
  const r = buildReport(baseInput({ profile: { id: 'usedPc' } }));
  assert.strictEqual(r.profile.id, 'usedPc');
  assert.ok(r.profile.label && r.profile.purpose);
  assert.strictEqual(r.profile.runsDeepTests, true);
});

test('게임 진단 프로필은 GPU를 맨 앞으로 정렬한다', () => {
  const r = buildReport(baseInput({
    profile: { id: 'gaming' },
    gpu: { controllers: [{ model: 'Test GPU' }], supported: true, nvidia: { loadPercent: 5, tempC: 40, clockMHz: 1500, vramUsedMB: 500, vramTotalMB: 8192 } },
  }));
  assert.strictEqual(r.sections[0].category, 'GPU');
  assert.strictEqual(r.sections[0].focused, true);
});

test('수리 입고/출고 프로필은 같은 검사 범위를 갖는다', () => {
  // 범위가 다르면 전후 비교가 성립하지 않는다.
  const intake = PROFILES.repairIntake;
  const exit = PROFILES.repairExit;
  assert.deepStrictEqual(intake.collect, exit.collect);
  assert.deepStrictEqual(intake.deep, exit.deep);
  assert.strictEqual(intake.sessionRole, 'intake');
  assert.strictEqual(exit.sessionRole, 'exit');
  assert.strictEqual(exit.requiresPair, 'repairIntake');
});

test('프로필이 원래 안 하는 검사도 점검 리포트의 검사 범위에 실린다', () => {
  const diagnosisReport = buildReport(baseInput({ profile: { id: 'quick' } }));
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  assert.ok(inspection.testScope.notTested.some((n) => n.includes('빠른 점검에서는')),
    `프로필이 안 하는 검사가 범위에 없음: ${inspection.testScope.notTested.join(' / ')}`);
  assert.strictEqual(inspection.profile.id, 'quick');
});

test('프로필을 바꿔치기하면 검증에 실패한다', () => {
  // "빠른 점검" 결과를 "중고 PC 점검"이었다고 바꿔 적으면 안 된다.
  const diagnosisReport = buildReport(baseInput({ profile: { id: 'quick' } }));
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  assert.ok(verifyInspectionReport(inspection));
  const tampered = JSON.parse(JSON.stringify(inspection));
  tampered.diagnosisReport.profile.id = 'usedPc';
  tampered.diagnosisReport.profile.label = '중고 PC 점검';
  assert.ok(!verifyInspectionReport(tampered), '프로필을 바꿨는데 검증이 통과하면 안 됨');
});

test('프로필 없이 부른 기존 경로는 그대로 동작한다', () => {
  const r = buildReport(baseInput());
  assert.strictEqual(r.profile, null);
  assert.strictEqual(findSection(r, 'CPU').status, 'normal');
});

// ============================================================
section('검사 데이터 버전 (기획서 §59) · 표시 모드 설정 (§18)');
// ============================================================

test('리포트에 앱·엔진·룰셋 버전이 함께 기록된다', () => {
  const r = buildReport(baseInput());
  assert.ok(r.versions, '버전 정보가 리포트에 있어야 함');
  assert.ok(/^\d+\.\d+\.\d+$/.test(r.versions.app), `앱 버전 형식: ${r.versions.app}`);
  assert.ok(r.versions.engine && r.versions.ruleset);
  assert.ok(r.versions.label.includes('Diagnostic Engine'), r.versions.label);
});

test('앱 버전은 package.json과 일치한다', () => {
  // 손으로 적어두면 릴리스 때마다 어긋난다.
  assert.strictEqual(versionInfo().app, require('../package.json').version);
});

test('점검 리포트에도 버전이 실린다', () => {
  const diagnosisReport = buildReport(baseInput());
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  assert.ok(inspection.versions, '성적서가 어느 버전의 판정인지 밝혀야 함');
  assert.strictEqual(inspection.versions.ruleset, versionInfo().ruleset);
});

test('버전을 바꿔치기하면 검증에 실패한다', () => {
  // 다른 규칙 버전의 판정을 이 버전 것이라고 주장하면 안 된다.
  const diagnosisReport = buildReport(baseInput());
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  assert.ok(verifyInspectionReport(inspection));
  const tampered = JSON.parse(JSON.stringify(inspection));
  tampered.diagnosisReport.versions.ruleset = '2099.01.1';
  assert.ok(!verifyInspectionReport(tampered));
});

test('표시 모드는 알려진 값만 받아들인다', () => {
  // 파일이나 렌더러에서 오는 값을 그대로 믿지 않는다.
  assert.deepStrictEqual(sanitizeSettings({ viewMode: 'expert' }), { viewMode: 'expert' });
  assert.deepStrictEqual(sanitizeSettings({ viewMode: 'god-mode' }), {});
  assert.deepStrictEqual(sanitizeSettings({ 판정: '전부정상' }), {}, '모르는 키는 무시해야 함');
});

test('기본값은 basic이다', () => {
  assert.strictEqual(SETTINGS_DEFAULTS.viewMode, 'basic');
});

// ============================================================
section('문제 해결 지식 DB (기획서 §39) · 해결 Wizard (§44) · 안전 설계 (§45)');
// ============================================================

test('모든 항목이 필수 필드를 빠짐없이 갖는다', () => {
  listIssues().forEach((e) => {
    ['version', 'category', 'title', 'detection', 'symptoms', 'causes', 'actions', 'verification'].forEach((k) => {
      assert.ok(e[k] && (!Array.isArray(e[k]) || e[k].length), `${e.id}: ${k}가 비어 있음`);
    });
  });
});

test('[기획서 §14] 모든 조치에 위험도가 붙어 있다', () => {
  // 위험도가 없는 조치는 사용자가 "이걸 내가 해도 되나"를 판단할 근거가 없다.
  listIssues().forEach((e) => {
    e.actions.forEach((a) => {
      assert.ok(a.text, `${e.id}: 조치 문구가 비어 있음`);
      assert.ok(RISK_ORDER.includes(a.risk), `${e.id}: 알 수 없는 위험도 ${a.risk}`);
    });
  });
});

test('확인만 하는 안전한 조치가 항상 먼저 온다', () => {
  // 되돌리기 어려운 것부터 제시하면 사용자가 불필요한 위험을 감수하게 된다.
  listIssues().forEach((e) => {
    assert.strictEqual(e.actions[0].risk, 'SAFE', `${e.id}: 첫 조치가 SAFE가 아님 (${e.actions[0].risk})`);
  });
});

test('Wizard가 있는 항목은 마지막 단계가 재검사다', () => {
  // "고쳤다"로 끝나면 개선됐는지 알 수 없다. 반드시 다시 재서 확인하게 한다.
  listIssues().filter((e) => e.wizard && e.wizard.length).forEach((e) => {
    const last = e.wizard[e.wizard.length - 1];
    assert.ok(/재검사|재측정|확인/.test(last.title), `${e.id}: 마지막 단계가 재검사가 아님 — ${last.title}`);
  });
});

test('Wizard 단계에도 전부 위험도가 있다', () => {
  listIssues().filter((e) => e.wizard).forEach((e) => {
    e.wizard.forEach((s) => {
      assert.ok(RISK_ORDER.includes(s.risk), `${e.id}: 단계 "${s.title}"에 위험도가 없음`);
      assert.ok(s.detail && s.detail.length > 10, `${e.id}: 단계 "${s.title}" 설명이 부실함`);
    });
  });
});

test('[기획서 §45] 되돌리기 어려운 단계가 있으면 먼저 경고한다', () => {
  const w = wizardFor('MEMORY-MIXED-DIMM-BELOW-RATED');
  assert.ok(w);
  assert.strictEqual(w.highestRisk, 'INTERMEDIATE');
  assert.ok(w.warning && w.warning.includes('되돌리기 어려운'), w.warning);
  assert.ok(w.warning.includes('CMOS'), '복구 방법까지 알려줘야 함');
});

test('안전한 단계만 있는 절차에는 불필요한 경고를 달지 않는다', () => {
  const w = wizardFor('BASELINE-IDLE-MEMORY-RISE');
  assert.ok(w);
  assert.strictEqual(w.warning, null, `불필요한 경고: ${w.warning}`);
});

test('Wizard 단계에 번호와 위험도 설명이 붙는다', () => {
  const w = wizardFor('CPU-BASE-CLOCK-MODIFIED');
  assert.strictEqual(w.steps[0].index, 1);
  assert.ok(w.steps.every((s) => s.riskLabel));
});

test('절차가 없는 문제에는 Wizard를 만들어 붙이지 않는다', () => {
  assert.strictEqual(wizardFor('없는-문제-ID'), null);
});

test('[핵심] 규칙이 만든 이슈와 지식 DB의 안내가 어긋나지 않는다', () => {
  // 안내 문구를 두 곳에서 각자 쓰면 화면·리포트·Wizard가 서로 다른 말을 하게 된다.
  const r = buildReport(baseInput({
    memoryModules: memMods([
      dimm({ slot: 'ChannelA-DIMM0', partNumber: 'AAA-3200', ratedSpeedMTs: 3200, configuredSpeedMTs: 2666 }),
      dimm({ slot: 'ChannelB-DIMM0', partNumber: 'BBB-2666', ratedSpeedMTs: 2666, configuredSpeedMTs: 2666 }),
    ]),
  }));
  const issue = findSection(r, 'RAM').issues.find((i) => i.ruleId === 'MEMORY-MIXED-DIMM-BELOW-RATED');
  const kb = getIssue('MEMORY-MIXED-DIMM-BELOW-RATED');
  assert.deepStrictEqual(issue.causes, kb.causes, '원인 후보가 DB와 달라짐');
  assert.deepStrictEqual(issue.actionDetails, kb.actions, '조치가 DB와 달라짐');
  assert.strictEqual(issue.verification, kb.verification, '재검사 방법이 DB와 달라짐');
  assert.strictEqual(issue.ruleVersion, kb.version, '버전이 DB와 달라짐');
});

test('이슈에 Wizard가 실려 화면에서 바로 쓸 수 있다', () => {
  const r = buildReport(baseInput({
    memoryModules: memMods([
      dimm({ slot: 'ChannelA-DIMM0', ratedSpeedMTs: 3200, configuredSpeedMTs: 2133 }),
      dimm({ slot: 'ChannelB-DIMM0', ratedSpeedMTs: 3200, configuredSpeedMTs: 2133 }),
    ]),
  }));
  const issue = findSection(r, 'RAM').issues.find((i) => i.ruleId === 'MEMORY-BELOW-RATED-SPEED');
  assert.ok(issue.wizard, 'Wizard가 이슈에 붙어야 함');
  assert.ok(issue.wizard.steps.length >= 3);
  assert.strictEqual(issue.wizard.issueId, 'MEMORY-BELOW-RATED-SPEED');
});

test('기준선 이슈도 Issue ID와 Wizard를 갖는다', () => {
  const r = buildReport(baseInput({
    cpu: { model: 'Test CPU', loadPercent: 6, tempC: 60, clockGHz: 1.2 },
    baseline: baselineRecord(),
  }));
  const issue = findSection(r, 'CPU').issues.find((i) => i.ruleId === 'BASELINE-IDLE-TEMP-RISE');
  assert.ok(issue, '기준선 이슈에 Issue ID가 있어야 함');
  assert.ok(issue.wizard, '기준선 이슈에도 해결 절차가 있어야 함');
  assert.ok(issue.wizard.steps.some((s) => s.screen === 'view-baseline'), '기준선 재측정 화면으로 안내해야 함');
});

test('Issue ID는 중복되지 않는다', () => {
  const ids = listIssues().map((e) => e.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

// ============================================================
section('전후 비교 (기획서 §16~17) · 하드웨어 구성 대조 (§31)');
// ============================================================

function sess(over = {}) {
  return {
    id: 's1', issuedAt: '2026-08-13T00:00:00Z',
    profileId: 'repairIntake', profileLabel: '수리 입고 검사', sessionRole: 'intake',
    scopeKey: 'SCOPE-A', reportId: 'DB-1', grade: 'C', deepTestsIncluded: true, hardwareKey: 'k1',
    hardware: { cpuModel: 'Test CPU', gpuModels: ['Test GPU'], memoryTotalGB: 32, memoryModuleCount: 4, diskSerials: ['D1'], baseboardSerial: 'B1' },
    metrics: {
      cpuMaxTempC: 94, gpuMaxTempC: 82, ramSpeedMTs: 2666, wheaErrors: 4,
      unexpectedShutdowns: 2, bugchecks: 1, driverErrors: 3, ramTestErrors: 0,
      storageWriteMBps: 480, storageReadMBps: 1200,
    },
    ...over,
  };
}
const rowOf = (c, key) => c.rows.find((r) => r.key === key);

test('[기획서 §17] 수리 전후 표를 만든다', () => {
  const before = sess();
  const after = sess({
    id: 's2', profileId: 'repairExit', profileLabel: '수리 출고 검사', sessionRole: 'exit', grade: 'A',
    metrics: { ...sess().metrics, cpuMaxTempC: 76, gpuMaxTempC: 75, ramSpeedMTs: 3200, wheaErrors: 0, driverErrors: 0 },
  });
  const c = compareSessions(before, after);
  assert.ok(c.available);
  assert.strictEqual(rowOf(c, 'cpuMaxTempC').verdict, 'improved');
  assert.strictEqual(rowOf(c, 'cpuMaxTempC').diff, -18);
  assert.strictEqual(rowOf(c, 'ramSpeedMTs').verdict, 'improved', '메모리 속도는 높을수록 좋다');
  assert.strictEqual(rowOf(c, 'wheaErrors').verdict, 'improved');
  assert.strictEqual(c.grade.verdict, 'improved');
});

test('나빠진 항목은 악화로 정확히 표시한다', () => {
  const c = compareSessions(sess(), sess({ id: 's2', metrics: { ...sess().metrics, cpuMaxTempC: 99 } }));
  assert.strictEqual(rowOf(c, 'cpuMaxTempC').verdict, 'worsened');
});

test('미세한 변화는 개선/악화라고 하지 않는다', () => {
  const c = compareSessions(sess(), sess({ id: 's2', metrics: { ...sess().metrics, cpuMaxTempC: 93 } }));
  assert.strictEqual(rowOf(c, 'cpuMaxTempC').verdict, 'unchanged');
});

test('저장장치 처리량은 절대값이 아니라 비율로 판단한다', () => {
  // NVMe 1200MB/s에서 20MB/s 차이는 노이즈다.
  const small = compareSessions(sess(), sess({ id: 's2', metrics: { ...sess().metrics, storageReadMBps: 1220 } }));
  assert.strictEqual(rowOf(small, 'storageReadMBps').verdict, 'unchanged');
  const big = compareSessions(sess(), sess({ id: 's2', metrics: { ...sess().metrics, storageReadMBps: 600 } }));
  assert.strictEqual(rowOf(big, 'storageReadMBps').verdict, 'worsened');
});

test('[핵심] 한쪽에서 측정되지 않은 항목은 개선이라고 하지 않는다', () => {
  const before = sess({ metrics: { ...sess().metrics, gpuMaxTempC: null } });
  const after = sess({ id: 's2', metrics: { ...sess().metrics, gpuMaxTempC: 60 } });
  const r = rowOf(compareSessions(before, after), 'gpuMaxTempC');
  assert.strictEqual(r.verdict, 'not-comparable');
  assert.strictEqual(r.diff, null);
  assert.ok(r.reason.includes('측정되지 않아'));
});

test('[핵심] 한쪽만 부하 테스트를 했으면 부하 항목을 비교하지 않는다', () => {
  // 부하 중 최고 온도와 유휴 온도를 나란히 놓으면 비교가 통째로 거짓이 된다.
  const before = sess();
  const after = sess({ id: 's2', deepTestsIncluded: false });
  const c = compareSessions(before, after);
  assert.strictEqual(rowOf(c, 'cpuMaxTempC').verdict, 'not-comparable');
  assert.ok(c.warnings.some((w) => w.includes('부하 테스트')));
  assert.notStrictEqual(rowOf(c, 'wheaErrors').verdict, 'not-comparable');
});

test('검사 범위가 다르면 경고를 단다', () => {
  const c = compareSessions(
    sess(),
    sess({ id: 's2', profileId: 'quick', profileLabel: '빠른 점검', scopeKey: 'SCOPE-B' }));
  assert.ok(c.warnings.some((w) => w.includes('검사 범위')));
});

test('[핵심] 이름만 다르고 범위가 같으면 경고하지 않는다 (입고↔출고)', () => {
  // 수리 입고/출고는 이름은 다르지만 범위가 같도록 일부러 맞춰둔 짝이다.
  // 여기서 매번 경고가 뜨면 정작 진짜 경고를 흘려보게 된다.
  const key = scopeKeyOf(PROFILES.repairIntake);
  assert.strictEqual(key, scopeKeyOf(PROFILES.repairExit), '입고/출고 범위 지문이 같아야 함');
  const c = compareSessions(
    sess({ scopeKey: key }),
    sess({ id: 's2', profileId: 'repairExit', profileLabel: '수리 출고 검사', scopeKey: key }));
  assert.ok(!c.warnings.some((w) => w.includes('검사 범위')), `불필요한 경고: ${c.warnings.join(' / ')}`);
});

test('비교할 세션이 없으면 비교하지 않는다', () => {
  assert.strictEqual(compareSessions(null, sess()).available, false);
  assert.strictEqual(compareSessions(sess(), null).reason, 'missing-session');
});

test('[기획서 §31] 하드웨어 구성이 같으면 일치로 표시한다', () => {
  const c = compareSessions(sess(), sess({ id: 's2' }));
  assert.strictEqual(c.hardware.verdict, 'match');
  assert.strictEqual(c.hardware.differsCount, 0);
});

test('[기획서 §31] GPU가 바뀌었으면 다름으로 표시한다', () => {
  const after = sess({ id: 's2', hardware: { ...sess().hardware, gpuModels: ['Other GPU'] } });
  const c = compareSessions(sess(), after);
  assert.strictEqual(c.hardware.verdict, 'differs');
  assert.strictEqual(c.hardware.rows.find((r) => r.key === 'gpuModels').verdict, 'differs');
});

test('하드웨어 대조는 "인증"이 아니라는 한계를 명시한다', () => {
  const c = compareSessions(sess(), sess({ id: 's2' }));
  assert.ok(c.hardware.limitation.includes('물리적 교체'), c.hardware.limitation);
});

test('식별값을 못 읽은 항목은 일치라고 하지 않는다', () => {
  const after = sess({ id: 's2', hardware: { ...sess().hardware, baseboardSerial: null } });
  const c = compareSessions(sess(), after);
  assert.strictEqual(c.hardware.rows.find((r) => r.key === 'baseboardSerial').verdict, 'unknown');
  assert.strictEqual(c.hardware.verdict, 'partial');
});

test('세션 지표는 못 읽은 값을 0으로 채우지 않는다', () => {
  // 0으로 채우면 "오류 0건"이라는 없는 사실을 만들어낸다.
  const report = buildReport(baseInput({ eventLog: { supported: false, events: [], days: 7, error: null } }));
  const m = extractMetrics(report, { deepTests: { included: false }, eventLog: { supported: false }, system: { driverQueryOk: false, driverErrors: [] } });
  assert.strictEqual(m.wheaErrors, null);
  assert.strictEqual(m.driverErrors, null);
  assert.strictEqual(m.cpuMaxTempC, null);
});

test('부하 테스트를 돌렸으면 그때의 최고 온도를 남긴다', () => {
  const report = buildReport(baseInput());
  const m = extractMetrics(report, {
    deepTests: { included: true, cpuStress: { maxTempC: 88 }, ramTest: { errors: 0 }, storageTest: { writeMBps: 500, readMBps: 1100 } },
    eventLog: { supported: true, counts: [{ provider: 'Microsoft-Windows-WHEA-Logger', id: 18, count: 2 }] },
    system: { driverQueryOk: true, driverErrors: [{}] },
  });
  assert.strictEqual(m.cpuMaxTempC, 88);
  assert.strictEqual(m.wheaErrors, 2);
  assert.strictEqual(m.driverErrors, 1);
});

test('하드웨어 열쇠는 식별값이 하나도 없으면 만들지 않는다', () => {
  assert.strictEqual(hardwareKeyOf({}), null);
  assert.ok(hardwareKeyOf({ cpuModel: 'Test CPU', memoryTotalGB: 32 }));
});

// ============================================================
section('수집 계층 — 언어/플랫폼 가정 때문에 조용히 실패하던 것들');
// ============================================================

test('[회귀 방지] 한국어 Windows의 ping 출력(인코딩 깨짐)에서도 값을 읽는다', () => {
  // 실제로 이 개발 PC에서 나온 출력. CP949가 깨져서 "시간="이 매칭되지 않아
  // 핑이 3ms로 멀쩡히 성공했는데도 avgMs=null이 됐고, 네트워크는 "정상"으로 표시됐다.
  const mojibake = '\r\nPing 1.1.1.1 32����Ʈ ������ ���:\r\n'
    + '1.1.1.1�� ����: ����Ʈ=32 �ð�=3ms TTL=56\r\n'
    + '1.1.1.1�� ����: ����Ʈ=32 �ð�=3ms TTL=56\r\n'
    + '1.1.1.1�� ����: ����Ʈ=32 �ð�=4ms TTL=56\r\n\r\n'
    + '1.1.1.1�� ���� Ping ���:\r\n    ��Ŷ: ���� = 3, ���� = 3, �ս� = 0 (0% �ս�),\r\n';
  const p = parsePingOutput(mojibake);
  assert.strictEqual(p.avgMs, 3.3, `평균을 읽어야 함: ${JSON.stringify(p)}`);
  assert.strictEqual(p.lossPercent, 0);
  assert.ok(p.jitterMs !== null);
});

test('영어 Windows ping 출력도 그대로 읽는다', () => {
  const en = 'Reply from 1.1.1.1: bytes=32 time=12ms TTL=56\r\n'
    + 'Reply from 1.1.1.1: bytes=32 time=14ms TTL=56\r\n'
    + 'Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),\r\n';
  const p = parsePingOutput(en);
  assert.strictEqual(p.avgMs, 13);
  assert.strictEqual(p.lossPercent, 0);
});

test('리눅스 ping 출력도 그대로 읽는다', () => {
  const linux = '64 bytes from 1.1.1.1: icmp_seq=1 ttl=56 time=11.2 ms\n'
    + '64 bytes from 1.1.1.1: icmp_seq=2 ttl=56 time=12.8 ms\n'
    + '2 packets transmitted, 2 received, 0% packet loss\n';
  const p = parsePingOutput(linux);
  assert.strictEqual(p.avgMs, 12);
  assert.strictEqual(p.lossPercent, 0);
});

test('패킷 손실이 있으면 손실률을 읽는다', () => {
  const lossy = 'Reply from 1.1.1.1: bytes=32 time=12ms TTL=56\r\n'
    + 'Packets: Sent = 5, Received = 1, Lost = 4 (80% loss),\r\n';
  assert.strictEqual(parsePingOutput(lossy).lossPercent, 80);
});

test('ping이 아예 실패하면 값을 지어내지 않는다', () => {
  const p = parsePingOutput(null);
  assert.strictEqual(p.avgMs, null);
  assert.strictEqual(p.lossPercent, null);
});

test('[회귀 방지] 드라이버 조회에 실패하면 "오류 장치 0개"라고 하지 않는다', () => {
  // si.osInfo().platform이 Windows에서 'Windows'를 반환하는 바람에 조회가 한 번도
  // 실행되지 않았는데도 DRIVERS가 늘 "정상"으로 나왔다.
  const failed = buildReport(baseInput({
    system: { platform: 'win32', distro: 'Windows 11', driverErrors: [], driverQueryOk: false },
  }));
  const d = findSection(failed, 'DRIVERS');
  assert.strictEqual(d.result, 'NOT_TESTED', `조회 실패인데 ${d.result}`);
  assert.strictEqual(d.normalEvidence.length, 0);

  const ok = buildReport(baseInput({
    system: { platform: 'win32', distro: 'Windows 11', driverErrors: [], driverQueryOk: true },
  }));
  assert.strictEqual(findSection(ok, 'DRIVERS').result, 'PASS');
});

test('드라이버 조회가 성공하고 오류 장치가 있으면 이슈로 올린다', () => {
  const r = buildReport(baseInput({
    system: { platform: 'win32', distro: 'Windows 11', driverQueryOk: true, driverErrors: [{ FriendlyName: 'PCI 장치' }, { FriendlyName: '알 수 없는 장치' }] },
  }));
  const d = findSection(r, 'DRIVERS');
  assert.strictEqual(d.result, 'WARNING');
  assert.ok(d.issues[0].explanation.includes('PCI 장치'));
});

// ============================================================
section('점검 리포트 — 검사 범위와 등급의 정직성');
// ============================================================

test('[회귀 방지] 검사 범위를 실제 결과에서 뽑는다 (하드코딩 금지)', () => {
  // 예전에는 completed 목록이 하드코딩이라, GPU를 못 읽은 PC에서도
  // "GPU 기본 상태 — 검사 완료"라고 적혔다.
  const diagnosisReport = buildReport(untestableInput());
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  assert.ok(!inspection.testScope.completed.some((c) => c.includes('GPU 기본 상태')),
    `측정 못 한 GPU가 검사 완료로 적힘: ${inspection.testScope.completed.join(', ')}`);
  assert.ok(inspection.testScope.notTested.some((c) => c.includes('GPU 기본 상태')));
  assert.ok(inspection.testScope.notTested.some((c) => c.includes('네트워크')));
});

test('[회귀 방지] 측정 못 한 카테고리를 "정상 영역"으로 나열하지 않는다', () => {
  const diagnosisReport = buildReport(untestableInput());
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  const normal = inspection.gradeExplanation.normalAreas;
  ['GPU', '네트워크', '디스플레이', '드라이버', '시스템 이벤트 기록'].forEach((label) => {
    assert.ok(!normal.includes(label), `검사도 안 한 ${label}이 정상 영역에 있음: ${normal.join(', ')}`);
  });
  assert.ok(inspection.gradeExplanation.notTestedAreas.length > 0, '미검사 영역을 따로 밝혀야 함');
});

test('일부를 검사하지 못했으면 A+를 주지 않고 등급 문구에 밝힌다', () => {
  // 이슈는 하나도 없지만 GPU/네트워크/디스플레이/드라이버/이벤트를 못 검사한 상태.
  const diagnosisReport = buildReport(untestableInput({
    storage: { volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }], disks: [], smart: [{ device: '/dev/sda', healthy: true, type: 'nvme' }], smartctlAvailable: true, io: null },
  }));
  assert.strictEqual(diagnosisReport.totalWatch, 0, `이 시나리오에는 이슈가 없어야 함: ${diagnosisReport.headline}`);
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z',
    { included: true, cpuStress: null, storageTest: null, ramTest: null }, {});
  assert.notStrictEqual(inspection.overallGrade.letter, 'A+');
  assert.ok(inspection.overallGrade.label.includes('미검사'), inspection.overallGrade.label);
  assert.strictEqual(inspection.overallGrade.coverageComplete, false);
});

test('"검사 안 함"을 "이상 없음"으로 바꿔치기하면 검증에 실패한다', () => {
  const diagnosisReport = buildReport(untestableInput());
  const inspection = buildInspectionReport(diagnosisReport, { systemSerial: 'S1' }, '2026-08-13T00:00:00Z', { included: false }, {});
  assert.ok(verifyInspectionReport(inspection), '원본은 통과해야 함');
  const tampered = JSON.parse(JSON.stringify(inspection));
  const gpu = tampered.diagnosisReport.sections.find((s) => s.category === 'GPU');
  gpu.result = 'PASS';
  gpu.notTested = [];
  assert.ok(!verifyInspectionReport(tampered), '검사 범위를 바꿨는데 검증이 통과하면 안 됨');
});

// ============================================================
console.log(`\n${'-'.repeat(40)}`);
console.log(`총 ${passed + failed}개 중 ${passed}개 통과, ${failed}개 실패`);
if (failed > 0) {
  console.log('실패한 테스트가 있습니다.');
  process.exit(1);
} else {
  console.log('모든 규칙 테스트 통과.');
}
