const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const collectors = require('./src/engine/collectors');
const { buildReport } = require('./src/engine/rules');
const history = require('./src/engine/history');
const displayChecks = require('./src/engine/displayChecks');
const vramChecks = require('./src/engine/vramChecks');
const gpuStressChecks = require('./src/engine/gpuStressChecks');
const { buildComparison } = require('./src/engine/compare');
const { buildHtmlReport } = require('./src/engine/report');
const { buildInspectionReport } = require('./src/engine/inspectionReport');
const { buildInspectionReportHtml } = require('./src/engine/inspectionReportHtml');
const stress = require('./src/engine/stress');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#FAFAF9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  liveMonitorActive = false;
  if (liveMonitorTimer) { clearTimeout(liveMonitorTimer); liveMonitorTimer = null; }
  if (process.platform !== 'darwin') app.quit();
});

// ================= 전체 진단 =================
// CPU 트렌드 샘플링은 항상 하지 않는다 (기획서 18장 Test Scheduler 개념).
// 초기 스냅샷에서 CPU 부하가 이미 높을 때만 추가로 몇 번 더 샘플링해서
// "부하가 걸린 상태에서의 추이"를 본다. 부하가 낮으면 스킵해서 진단 시간을 아낀다.
ipcMain.handle('run-full-diagnostic', async (event, { symptom } = {}) => {
  const send = (stage) => event.sender.send('diagnostic-progress', stage);

  send('cpu');
  const cpu = await collectors.collectCpu();
  let cpuTrend = null;
  // 증상이 게임/버벅거림/크래시 계열이면, 부하가 지금 낮아도 짧게 한 번 더 확인해본다
  // (사용자가 문제 상황을 재현 중일 수도 있으므로 문턱값을 낮춘다).
  const cpuTrendThreshold = symptom === 'gaming' || symptom === 'crash' ? 40 : 70;
  if (cpu.loadPercent >= cpuTrendThreshold) {
    send('cpu-trend');
    cpuTrend = await collectors.sampleCpuTrend(4, 700);
  }

  send('memory');
  const memory = await collectors.collectMemory();

  send('gpu');
  const gpu = await collectors.collectGpu();
  let gpuTrend = null;
  const gpuTrendThreshold = symptom === 'gaming' ? 40 : 70;
  if (gpu.supported && gpu.nvidia.loadPercent >= gpuTrendThreshold) {
    send('gpu-trend');
    gpuTrend = await collectors.sampleGpuTrend(4, 700);
  }

  send('storage');
  const storage = await collectors.collectStorage();

  send('network');
  const network = await collectors.collectNetwork();

  send('display');
  const display = await collectors.collectDisplay();

  send('system');
  const system = await collectors.collectSystem();

  send('processes');
  const topProcesses = await collectors.collectTopProcesses(5);

  send('events');
  const eventLog = await collectors.collectEventLogs(7, 50);

  send('analyzing');
  const visualChecks = displayChecks.activeDisplayChecks(app.getPath('userData'));
  const vramCheck = vramChecks.activeVramCheck(app.getPath('userData'));
  const gpuStressCheck = gpuStressChecks.activeGpuStressCheck(app.getPath('userData'));
  const report = buildReport({ cpu, cpuTrend, memory, gpu, gpuTrend, storage, network, display, visualChecks, vramCheck, gpuStressCheck, system, symptom, topProcesses, eventLog });

  // raw에도 넣어둔다 — SMART 재검사처럼 raw로 report를 다시 만드는 경로에서 빠지면
  // 정정 후 리포트에서만 VRAM 근거가 사라져 버린다.
  const raw = { cpu, cpuTrend, memory, gpu, gpuTrend, storage, network, display, visualChecks, vramCheck, gpuStressCheck, system, topProcesses, eventLog };

  // 진단 전/후 비교: 새 기록을 남기기 전에 "직전 기록"을 먼저 읽어와 비교한다.
  const prevHistory = history.loadHistory(app.getPath('userData'));
  const prevEntry = prevHistory.length ? prevHistory[prevHistory.length - 1] : null;
  const currentMetrics = {
    cpuTempC: cpu.tempC, cpuLoadPercent: cpu.loadPercent,
    gpuTempC: gpu.nvidia?.tempC ?? null, gpuLoadPercent: gpu.nvidia?.loadPercent ?? null,
    memUsedPercent: memory.usedPercent, pingAvgMs: network.ping.avgMs,
  };
  report.comparison = buildComparison(prevEntry, currentMetrics);

  // 진단 기록에 요약 저장 (기획서 21장 Diagnosis History)
  history.appendHistory(app.getPath('userData'), report, raw);

  return { report, raw };
});

// ================= SMART 관리자 권한 재검사 =================
// 전체 진단(requireAdministrator 없이 실행)에서 특정 저장장치의 SMART 상태를
// 못 읽었을 때만, 그 장치 하나에 대해서만 관리자 권한으로 재조회한다.
// 새 raw/report를 만들되 comparison은 재계산하지 않고(저장장치와 무관한 값이라
// 그대로 유지) 히스토리에도 다시 남기지 않는다 — 원래 진단 결과를 "정정"하는
// 것이지 새 진단이 아니기 때문이다.
ipcMain.handle('retry-smart-elevated', async (event, { device, smartType, raw, symptom, comparison } = {}) => {
  const updatedEntry = await collectors.retrySmartElevated(device, smartType);
  const updatedSmart = raw.storage.smart.map((s) => (s.device === device ? { ...updatedEntry, type: s.type } : s));
  const newRaw = { ...raw, storage: { ...raw.storage, smart: updatedSmart } };
  const report = buildReport({ ...newRaw, symptom });
  report.comparison = comparison || null;
  return { report, raw: newRaw };
});

// ================= 디스플레이 셀프체크 기록 =================
// 불량화소/잔상/균일도는 사람이 눈으로 봐야 판단할 수 있어 자동 검사가 불가능하다.
// 사용자가 "디스플레이 테스트" 화면에서 직접 본 결과를 기록하면, 그 값을 전체 진단의
// DISPLAY 섹션이 근거로 사용한다(evaluateDisplay).
ipcMain.handle('get-display-checks', () => {
  return displayChecks.loadDisplayChecks(app.getPath('userData'));
});
ipcMain.handle('save-display-check', (event, { testId, verdict, note } = {}) => {
  return displayChecks.saveDisplayCheckResult(app.getPath('userData'), { testId, verdict, note });
});

// ================= VRAM 검사 기록 =================
// VRAM 압박·무결성 테스트는 WebGL이 필요해 렌더러에서만 실행할 수 있다. 결과를 기록해두면
// 다음 전체 진단/점검 리포트가 GPU 섹션의 근거로 반영한다(evaluateGpu).
ipcMain.handle('get-vram-check', () => {
  return vramChecks.loadVramCheck(app.getPath('userData'));
});
ipcMain.handle('save-vram-check', (event, result = {}) => {
  return vramChecks.saveVramCheck(app.getPath('userData'), result);
});
ipcMain.handle('get-gpu-stress-check', () => {
  return gpuStressChecks.loadGpuStressCheck(app.getPath('userData'));
});
ipcMain.handle('save-gpu-stress-check', (event, result = {}) => {
  return gpuStressChecks.saveGpuStressCheck(app.getPath('userData'), result);
});

// ================= 실시간 모니터링 =================
// 1초 간격으로 센서를 읽어 렌더러로 push한다. collectLiveSample() 한 번이 이 PC 기준
// 800ms 안팎 걸려서(nvidia-smi 프로세스 스폰 포함), setInterval 대신 "완료 후 1초 대기"
// 방식으로 틱을 예약한다 — 느려질 때 틱이 겹쳐 쌓이는 걸 막기 위함.
let liveMonitorActive = false;
let liveMonitorTimer = null;

async function liveMonitorTick(sender) {
  if (!liveMonitorActive) return;
  try {
    const sample = await collectors.collectLiveSample();
    if (liveMonitorActive && !sender.isDestroyed()) sender.send('live-sample', sample);
  } catch { /* 이번 틱만 건너뛰고 다음 틱에서 재시도 */ }
  if (liveMonitorActive) liveMonitorTimer = setTimeout(() => liveMonitorTick(sender), 1000);
}

ipcMain.on('start-live-monitor', (event) => {
  if (liveMonitorTimer) clearTimeout(liveMonitorTimer);
  liveMonitorActive = true;
  liveMonitorTick(event.sender);
});
ipcMain.on('stop-live-monitor', () => {
  liveMonitorActive = false;
  if (liveMonitorTimer) { clearTimeout(liveMonitorTimer); liveMonitorTimer = null; }
});

ipcMain.handle('save-live-recording', async (event, { samples } = {}) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '센서 기록 저장',
    defaultPath: `diagbench-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, JSON.stringify(samples, null, 2), 'utf-8');
  return { saved: true, filePath };
});

// ================= 진단 기록 =================
ipcMain.handle('get-history', () => {
  return history.loadHistory(app.getPath('userData'));
});
ipcMain.handle('clear-history', () => {
  history.clearHistory(app.getPath('userData'));
  return true;
});

// ================= 리포트 저장 =================
ipcMain.handle('save-report', async (event, { report, raw }) => {
  const system = raw.system || {};
  const html = buildHtmlReport(report, raw, system);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '진단 리포트 저장',
    defaultPath: `DIAGBENCH-report-${new Date().toISOString().slice(0, 10)}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, html, 'utf-8');
  return { saved: true, filePath };
});

// ================= 안정성 테스트 (Stability Tests) =================
// ⚠ 렌더러에서 오는 값은 신뢰하지 않는다. UI에서 이미 제한하더라도 여기서 다시 clamp한다
//    (`stress.clampNumber`가 비수치/NaN/범위 밖 값을 전부 안전한 값으로 접는다).
//    비정상적으로 큰 값이 넘어와도 디스크를 채우거나 메모리를 통째로 잡거나 CPU를 무한정
//    태우는 일이 생기지 않아야 한다.
ipcMain.handle('run-cpu-stress', async (event, { durationSec, safetyTempC } = {}) => {
  const testId = 'cpu-stress';
  const result = await stress.runCpuStressTest({
    testId,
    durationSec,     // 내부에서 5~300초로 clamp (센서 없으면 30초 상한)
    safetyTempC,     // 내부에서 60~100°C로 clamp
    onProgress: (p) => event.sender.send('stress-progress', { test: 'cpu', ...p }),
  });
  return result;
});
ipcMain.on('abort-cpu-stress', () => stress.requestAbort('cpu-stress'));

ipcMain.handle('run-storage-test', async (event, { sizeMB } = {}) => {
  // 테스트 파일 경로는 렌더러가 정하지 못한다 — 항상 앱의 임시 폴더에만 쓴다.
  const testDir = app.getPath('temp');
  return stress.runStorageThroughputTest({
    testDir,
    sizeMB,          // 내부에서 50~2048MB로 clamp
    onProgress: (p) => event.sender.send('stress-progress', { test: 'storage', ...p }),
  });
});

ipcMain.handle('run-ram-test', async (event, { sizeMB } = {}) => {
  return stress.runRamIntegrityTest({
    sizeMB,          // 내부에서 64~1024MB로 clamp
    onProgress: (p) => event.sender.send('stress-progress', { test: 'ram', ...p }),
  });
});

// 렌더러가 안전 범위를 알아야 UI에서도 같은 값으로 제한할 수 있다(두 곳이 어긋나지 않게).
ipcMain.handle('get-stress-limits', () => stress.LIMITS);

// ================= 판매용 점검 리포트 =================
// 전체 진단(run-full-diagnostic)과는 별개로, 하드웨어 시리얼까지 함께 수집해서
// 중고 거래용 "PC 상태 점검 리포트"를 만든다.
ipcMain.handle('run-inspection-scan', async (event, { includeDeepTests } = {}) => {
  const send = (stage) => event.sender.send('diagnostic-progress', stage);

  send('cpu');
  const cpu = await collectors.collectCpu();
  send('memory');
  const memory = await collectors.collectMemory();
  send('gpu');
  const gpu = await collectors.collectGpu();
  send('storage');
  const storage = await collectors.collectStorage();
  send('network');
  const network = await collectors.collectNetwork();
  send('display');
  const display = await collectors.collectDisplay();
  send('system');
  const system = await collectors.collectSystem();
  send('events');
  const eventLog = await collectors.collectEventLogs(7, 50);
  send('identity');
  const hardwareIdentity = await collectors.collectHardwareIdentity();

  let deepTests = { included: false };
  if (includeDeepTests) {
    send('deep-cpu');
    const cpuStress = await stress.runCpuStressTest({
      testId: 'inspection-cpu-stress', durationSec: 15, safetyTempC: 95,
      onProgress: (p) => event.sender.send('stress-progress', { test: 'cpu', ...p }),
    });
    send('deep-storage');
    const storageTest = await stress.runStorageThroughputTest({ testDir: app.getPath('temp'), sizeMB: 150 });
    send('deep-ram');
    const ramTest = await stress.runRamIntegrityTest({ sizeMB: 256 });
    deepTests = { included: true, cpuStress, storageTest, ramTest };
  }

  send('analyzing');
  const visualChecks = displayChecks.activeDisplayChecks(app.getPath('userData'));
  const vramCheck = vramChecks.activeVramCheck(app.getPath('userData'));
  const gpuStressCheck = gpuStressChecks.activeGpuStressCheck(app.getPath('userData'));
  const raw = { cpu, memory, gpu, storage, network, display, visualChecks, vramCheck, gpuStressCheck, system, eventLog, deepTests };
  // deepTests를 반드시 함께 넘긴다. 이게 빠지면 정밀 검사에서 오류가 나도 규칙 엔진이
  // 그 사실을 아예 못 봐서 최종 등급이 "정상"으로 나온다.
  const diagnosisReport = buildReport({ ...raw, cpuTrend: null, gpuTrend: null, symptom: 'full' });
  const issuedAt = new Date().toISOString();
  const inspectionReport = buildInspectionReport(diagnosisReport, hardwareIdentity, issuedAt, deepTests, { vramCheck, gpuStressCheck, smartDetails: storage.smart });
  const reportHtml = await buildInspectionReportHtml(inspectionReport, { expanded: false });

  return { inspectionReport, reportHtml, raw, hardwareIdentity, issuedAt, deepTests };
});

// SMART 조회가 실패한 장치 하나만 관리자 권한으로 재조회해서 점검 리포트를 다시 만든다.
// issuedAt(발급 시각)은 원래 스캔 시점 그대로 유지한다 — "재발급"이 아니라 "정정"이기 때문.
// 다만 verificationHash/reportId는 STORAGE 상태가 바뀌면 그 값을 반영해 함께 바뀐다(의도된 동작:
// 저장된 리포트는 항상 그 시점에 실제로 확인된 최신 SMART 상태를 반영해야 한다).
ipcMain.handle('retry-smart-elevated-inspection', async (event, { device, smartType, raw, hardwareIdentity, issuedAt, deepTests } = {}) => {
  const updatedEntry = await collectors.retrySmartElevated(device, smartType);
  const updatedSmart = raw.storage.smart.map((s) => (s.device === device ? { ...updatedEntry, type: s.type } : s));
  const newRaw = { ...raw, storage: { ...raw.storage, smart: updatedSmart }, deepTests: deepTests || raw.deepTests };
  const diagnosisReport = buildReport({ ...newRaw, cpuTrend: null, gpuTrend: null, symptom: 'full' });
  const inspectionReport = buildInspectionReport(diagnosisReport, hardwareIdentity, issuedAt, deepTests, { vramCheck: newRaw.vramCheck || null, gpuStressCheck: newRaw.gpuStressCheck || null, smartDetails: newRaw.storage.smart });
  const reportHtml = await buildInspectionReportHtml(inspectionReport, { expanded: false });
  return { inspectionReport, reportHtml, raw: newRaw };
});

// 화면에 보이는 것과 같은 문서를 파일로 저장한다. HTML/PDF 중 사용자가 고른 형식으로 저장한다.
// PDF는 인쇄 순간의 DOM을 그대로 굳히는 정적 문서라 <details>가 접힌 채면 그 안의 내용을
// 다시는 못 보게 되므로, PDF로 저장할 때만 상세설명을 강제로 펼친 버전을 새로 만든다.
// HTML은 저장 후에도 브라우저에서 계속 상호작용 가능하니 화면과 동일하게 접은 채로 저장한다.
ipcMain.handle('save-inspection-report', async (event, { inspectionReport, format } = {}) => {
  if (format === 'html') {
    const html = await buildInspectionReportHtml(inspectionReport, { expanded: false });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'PC 상태 점검 리포트 저장 (HTML)',
      defaultPath: `${inspectionReport.reportId}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, html, 'utf-8');
    return { saved: true, filePath };
  }

  const html = await buildInspectionReportHtml(inspectionReport, { expanded: true });
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'PC 상태 점검 리포트 저장 (PDF)',
    defaultPath: `${inspectionReport.reportId}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { saved: false };

  const printWin = new BrowserWindow({ show: false });
  try {
    await printWin.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
    const pdfBuffer = await printWin.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    fs.writeFileSync(filePath, pdfBuffer);
  } finally {
    printWin.destroy();
  }
  return { saved: true, filePath };
});
