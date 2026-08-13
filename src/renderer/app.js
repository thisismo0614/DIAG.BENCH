/* ============================================================
   NAVIGATION
============================================================ */
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const wasLive = document.getElementById('view-live').classList.contains('active');
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.target).classList.add('active');

    // 실시간 모니터링은 메인 프로세스에서 1초 간격 폴링을 도는 방식이라, 화면을 떠나면
    // 반드시 멈춰야 한다 — 안 그러면 화면 밖에서도 계속 센서를 읽고 IPC를 쏘게 된다.
    if (wasLive && btn.dataset.target !== 'view-live') window.diagAPI.stopLiveMonitor();
    if (btn.dataset.target === 'view-live') window.diagAPI.startLiveMonitor();
  });
});

/* ============================================================
   DASHBOARD — 전체 진단
============================================================ */
const stageLabels = {
  cpu: 'CPU 상태 확인 중', 'cpu-trend': 'CPU 온도·클럭 추이 측정 중',
  memory: '메모리 확인 중',
  gpu: 'GPU 상태 확인 중', 'gpu-trend': 'GPU 온도·클럭 추이 측정 중',
  storage: '저장장치 확인 중', network: '네트워크 핑 측정 중',
  display: '디스플레이 확인 중', system: '드라이버 상태 확인 중',
  processes: '프로세스 자원 사용량 확인 중',
  events: 'Windows 이벤트 로그 확인 중',
  analyzing: '진단 결과 분석 중',
};
const catLabelKo = {
  CPU: 'CPU', GPU: 'GPU', RAM: '메모리', STORAGE: '저장장치',
  NETWORK: '네트워크', DISPLAY: '디스플레이', DRIVERS: '드라이버',
  EVENTS: 'Windows 이벤트',
};

const idleView = document.getElementById('idle-view');
const progressView = document.getElementById('progress-view');
const resultView = document.getElementById('result-view');
const progressStage = document.getElementById('progress-stage');
const headlineText = document.getElementById('headline-text');
const healthGrid = document.getElementById('health-grid');
const detailList = document.getElementById('detail-list');

let lastReport = null;
let lastRaw = null;
let lastSymptom = 'full';

function showDashboardView(view) {
  idleView.style.display = view === 'idle' ? 'flex' : 'none';
  progressView.style.display = view === 'progress' ? 'flex' : 'none';
  resultView.style.display = view === 'result' ? 'block' : 'none';
}

async function runDiagnostic(symptom) {
  lastSymptom = symptom || 'full';
  showDashboardView('progress');
  progressStage.textContent = '준비 중...';
  window.diagAPI.onProgress((stage) => { progressStage.textContent = stageLabels[stage] || stage; });

  const { report, raw } = await window.diagAPI.runFullDiagnostic({ symptom: lastSymptom });
  lastReport = report; lastRaw = raw;
  renderReport(report);
  showDashboardView('result');
}

document.querySelectorAll('.symptom-btn').forEach((btn) => {
  btn.addEventListener('click', () => runDiagnostic(btn.dataset.symptom));
});

function badgeLabel(status) {
  if (status === 'normal') return '정상';
  if (status === 'warning') return '주의';
  if (status === 'critical') return '위험';
  if (status === 'watch') return '관찰 필요';
  return status;
}

function renderReport(report) {
  headlineText.textContent = report.headline;
  document.getElementById('headline-eyebrow').textContent = `진단 결과 · ${report.symptomLabel}`;

  renderComparison(report.comparison);

  healthGrid.innerHTML = '';
  report.sections.forEach((s) => {
    const cell = document.createElement('div');
    cell.className = 'health-cell';
    cell.innerHTML = `
      <div class="cat">${catLabelKo[s.category] || s.category}${s.focused ? '<span class="focused-tag">우선확인</span>' : ''}</div>
      <span class="health-badge ${s.status}">${badgeLabel(s.status)}</span>
      ${s.status === 'normal' && s.normalEvidence.length ? `<div class="normal-evidence">${s.normalEvidence.join(' · ')}</div>` : ''}
    `;
    healthGrid.appendChild(cell);
  });

  detailList.innerHTML = '';
  report.sections.forEach((s) => {
    if (s.note) {
      const note = document.createElement('div');
      note.className = 'note-card';
      note.textContent = `${catLabelKo[s.category] || s.category} · ${s.note}`;
      detailList.appendChild(note);
    }
    s.issues.forEach((issue) => {
      const card = document.createElement('div');
      card.className = `detail-card ${issue.level}`;
      card.innerHTML = `
        <div class="detail-head">
          <span class="health-badge ${issue.level}">${badgeLabel(issue.level)}</span>
          <span class="detail-cat">${catLabelKo[s.category] || s.category}</span>
          ${issue.confidence !== null ? `<span class="confidence-chip ${issue.confidenceLabel.replace(' ', '_')}" title="이 판정을 뒷받침하는 근거가 얼마나 많고 서로 일치하는지를 나타냅니다. 통계적 확률이 아니라 규칙 기반 점수입니다.">판단 근거 강도 ${issue.confidenceLabel}</span>` : ''}
        </div>
        <div class="detail-title">${issue.title}</div>
        <div class="detail-explain">${issue.explanation}</div>
        <div class="detail-cols">
          <div class="detail-col"><div class="detail-col-label">가능한 원인</div><ul>${issue.causes.map((c) => `<li>${c}</li>`).join('')}</ul></div>
          <div class="detail-col"><div class="detail-col-label">권장 조치</div><ul>${issue.actions.map((a) => `<li>${a}</li>`).join('')}</ul></div>
        </div>
        ${issue.topProcesses ? `
          <div class="process-list">
            <div class="detail-col-label">점유율 높은 프로세스</div>
            ${issue.topProcesses.map((p) => `<div class="process-row"><span>${p.name} <span class="pid">#${p.pid}</span></span><span>CPU ${p.cpuPercent}% · MEM ${p.memPercent}%</span></div>`).join('')}
          </div>` : ''}
        ${issue.evidence.length ? `<div class="detail-evidence">근거: ${issue.evidence.join(' · ')}</div>` : ''}
        ${issue.verification ? `<div class="detail-verify"><b>재검사 방법:</b> ${issue.verification}</div>` : ''}
        ${issue.code === 'smart-unknown' ? `
          <div class="detail-actions">
            <button class="btn btn-elevate-retry" data-device="${issue.device}" data-smart-type="${issue.smartType || ''}">관리자 권한으로 재검사</button>
            <span class="detail-actions-status"></span>
          </div>` : ''}
      `;
      detailList.appendChild(card);
    });
  });
}

// SMART를 못 읽은 장치 카드에서 "관리자 권한으로 재검사"를 누르면, 그 장치 하나에 대해서만
// UAC 승인을 받아 smartctl을 재실행한다. 앱 전체를 관리자 권한으로 띄우지 않기 위한 절충안.
detailList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-elevate-retry');
  if (!btn || !lastRaw || !lastReport) return;
  const device = btn.dataset.device;
  const smartType = btn.dataset.smartType || null;
  const statusEl = btn.nextElementSibling;
  btn.disabled = true;
  if (statusEl) statusEl.textContent = '관리자 권한 창이 뜨면 승인해주세요...';

  const { report, raw } = await window.diagAPI.retrySmartElevated({
    device, smartType, raw: lastRaw, symptom: lastSymptom, comparison: lastReport.comparison,
  });
  lastReport = report; lastRaw = raw;
  renderReport(report);
});

function renderComparison(comparison) {
  const existing = document.getElementById('comparison-card');
  if (existing) existing.remove();
  if (!comparison || !comparison.hasChanges) return;

  const card = document.createElement('div');
  card.id = 'comparison-card';
  card.className = 'device-panel';
  const prevTime = new Date(comparison.previousTimestamp).toLocaleString('ko-KR');
  card.innerHTML = `
    <div class="device-panel-title" style="margin-bottom:10px;">이전 진단 대비 변화 (${prevTime})</div>
    <div class="compare-rows">
      ${comparison.deltas.map((d) => `
        <div class="compare-row ${d.neutral ? 'neutral' : (d.improved ? 'improved' : 'worsened')}">
          <span class="compare-label">${d.label}</span>
          <span class="compare-values">${d.prevVal}${d.unit} → ${d.curVal}${d.unit}</span>
          <span class="compare-tag">${d.neutral ? '변화' : (d.improved ? '개선' : '악화')} ${Math.abs(d.diff)}${d.unit}</span>
        </div>`).join('')}
    </div>
  `;
  headlineText.closest('.headline-card').insertAdjacentElement('afterend', card);
}

document.getElementById('rerun-btn').addEventListener('click', () => runDiagnostic(lastSymptom));
document.getElementById('back-to-symptom-btn').addEventListener('click', () => showDashboardView('idle'));
document.getElementById('save-report-btn').addEventListener('click', async () => {
  if (!lastReport) return;
  const btn = document.getElementById('save-report-btn');
  btn.textContent = '저장 중...'; btn.disabled = true;
  const res = await window.diagAPI.saveReport({ report: lastReport, raw: lastRaw });
  btn.textContent = res.saved ? '저장 완료' : '리포트 저장';
  btn.disabled = false;
  if (res.saved) setTimeout(() => { btn.textContent = '리포트 저장'; }, 2000);
});

/* ============================================================
   판매용 점검 리포트
============================================================ */
let lastInspectionReport = null;
let lastInspectionReportHtml = null;
let lastInspectionRaw = null;
let lastInspectionHardwareIdentity = null;
let lastInspectionIssuedAt = null;
let lastInspectionDeepTests = null;

function showInspectionView(view) {
  document.getElementById('inspection-idle').style.display = view === 'idle' ? 'block' : 'none';
  document.getElementById('inspection-progress').style.display = view === 'progress' ? 'flex' : 'none';
  document.getElementById('inspection-result').style.display = view === 'result' ? 'block' : 'none';
}

async function runInspectionScan() {
  showInspectionView('progress');
  const stageEl = document.getElementById('inspection-progress-stage');
  stageEl.textContent = '준비 중...';
  const deepStageLabels = { 'deep-cpu': '정밀 검사: CPU 부하 테스트 중 (15초)', 'deep-storage': '정밀 검사: 저장장치 처리량 측정 중', 'deep-ram': '정밀 검사: RAM 무결성 검사 중' };
  window.diagAPI.onProgress((stage) => {
    stageEl.textContent = (stage === 'identity') ? '하드웨어 시리얼 확인 중' : (deepStageLabels[stage] || stageLabels[stage] || stage);
  });

  const includeDeepTests = document.getElementById('inspection-deep-toggle').checked;
  const { inspectionReport, reportHtml, raw, hardwareIdentity, issuedAt, deepTests } = await window.diagAPI.runInspectionScan({ includeDeepTests });
  lastInspectionReport = inspectionReport;
  lastInspectionReportHtml = reportHtml;
  lastInspectionRaw = raw;
  lastInspectionHardwareIdentity = hardwareIdentity;
  lastInspectionIssuedAt = issuedAt;
  lastInspectionDeepTests = deepTests;
  renderInspectionReport(inspectionReport, reportHtml);
  showInspectionView('result');
}

// 화면에 보여주는 것과 PDF로 저장되는 것이 항상 같은 문서이도록, buildInspectionReportHtml()이
// 만든 HTML을 그대로 iframe에 넣는다(별도의 화면용 템플릿을 만들어 관리하지 않는다).
function renderInspectionReport(insp, reportHtml) {
  const frame = document.getElementById('inspection-report-frame');
  frame.srcdoc = reportHtml;
  frame.onload = () => {
    try {
      const doc = frame.contentWindow.document;
      const resize = () => { frame.style.height = doc.documentElement.scrollHeight + 'px'; };
      resize();
      // "상세설명"(<details>)을 펼치면 내용이 늘어나는데, toggle 이벤트는 버블링되지 않으므로
      // document에서 캡처 단계로 잡아야 어느 항목을 펼치든 iframe 높이가 다시 계산된다.
      doc.addEventListener('toggle', resize, true);
    } catch { /* noop */ }
  };

  // 저장장치 SMART를 판별 못 한 장치가 있으면, 그 장치만 관리자 권한으로 재검사할 수 있는
  // 버튼을 붙인다. 저장되는 리포트는 특정 시점의 고정 문서라 여기엔 안 넣고, 앱 화면에만
  // 별도 패널로 둔다.
  const storageSection = (insp.diagnosisReport?.sections || []).find((s) => s.category === 'STORAGE');
  const smartUnknownIssues = storageSection ? storageSection.issues.filter((i) => i.code === 'smart-unknown') : [];
  const panelEl = document.getElementById('inspection-smart-retry-panel');
  const retryEl = document.getElementById('inspection-smart-retry');
  if (smartUnknownIssues.length) {
    panelEl.style.display = 'block';
    retryEl.innerHTML = smartUnknownIssues.map((issue) => `
      <div class="detail-actions">
        <span class="detail-actions-status">${issue.title}</span>
        <button class="btn btn-elevate-retry-insp" data-device="${issue.device}" data-smart-type="${issue.smartType || ''}">관리자 권한으로 재검사</button>
      </div>
    `).join('');
  } else {
    panelEl.style.display = 'none';
    retryEl.innerHTML = '';
  }
}

document.getElementById('inspection-smart-retry').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-elevate-retry-insp');
  if (!btn || !lastInspectionRaw) return;
  const device = btn.dataset.device;
  const smartType = btn.dataset.smartType || null;
  const statusEl = btn.previousElementSibling;
  btn.disabled = true;
  if (statusEl) statusEl.textContent = '관리자 권한 창이 뜨면 승인해주세요...';

  const { inspectionReport, reportHtml, raw } = await window.diagAPI.retrySmartElevatedInspection({
    device, smartType, raw: lastInspectionRaw, hardwareIdentity: lastInspectionHardwareIdentity,
    issuedAt: lastInspectionIssuedAt, deepTests: lastInspectionDeepTests,
  });
  lastInspectionReport = inspectionReport;
  lastInspectionReportHtml = reportHtml;
  lastInspectionRaw = raw;
  renderInspectionReport(inspectionReport, reportHtml);
});

document.getElementById('inspection-start').addEventListener('click', runInspectionScan);
document.getElementById('inspection-rerun').addEventListener('click', runInspectionScan);
async function saveInspectionAs(format, btnId, defaultLabel) {
  if (!lastInspectionReport) return;
  const btn = document.getElementById(btnId);
  btn.textContent = '저장 중...'; btn.disabled = true;
  const res = await window.diagAPI.saveInspectionReport({ inspectionReport: lastInspectionReport, format });
  btn.textContent = res.saved ? '저장 완료' : defaultLabel;
  btn.disabled = false;
  if (res.saved) setTimeout(() => { btn.textContent = defaultLabel; }, 2000);
}
document.getElementById('inspection-save-pdf').addEventListener('click', () => saveInspectionAs('pdf', 'inspection-save-pdf', 'PDF로 저장 (QR 포함)'));
document.getElementById('inspection-save-html').addEventListener('click', () => saveInspectionAs('html', 'inspection-save-html', 'HTML로 저장 (QR 포함)'));

async function loadHistoryView() {
  const list = document.getElementById('history-list');
  const items = await window.diagAPI.getHistory();
  if (!items.length) {
    list.innerHTML = '<p class="mini-desc">아직 진단 기록이 없습니다. 대시보드에서 전체 진단을 실행하면 여기에 쌓입니다.</p>';
    return;
  }
  list.innerHTML = items.slice().reverse().map((e) => {
    const t = new Date(e.timestamp).toLocaleString('ko-KR');
    const m = e.metrics;
    const metricsHtml = [
      m.cpuTempC !== null ? `CPU ${m.cpuTempC}°C` : null,
      m.cpuLoadPercent !== null ? `CPU 부하 ${m.cpuLoadPercent}%` : null,
      m.gpuTempC !== null ? `GPU ${m.gpuTempC}°C` : null,
      m.memUsedPercent !== null ? `메모리 ${m.memUsedPercent}%` : null,
      m.pingAvgMs !== null ? `핑 ${m.pingAvgMs}ms` : null,
    ].filter(Boolean).join(' · ');
    return `
      <div class="history-item">
        <div>
          <div class="history-time">${t}</div>
          <div class="history-headline">${e.headline}</div>
        </div>
        <div class="history-metrics">${metricsHtml || '측정값 없음'}</div>
      </div>`;
  }).join('');
}
document.getElementById('history-refresh-btn').addEventListener('click', loadHistoryView);
document.getElementById('history-clear-btn').addEventListener('click', async () => {
  await window.diagAPI.clearHistory();
  loadHistoryView();
});
document.querySelector('[data-target="view-history"]').addEventListener('click', loadHistoryView);

/* ============================================================
   BASELINE — 평소 상태 기준선
   ------------------------------------------------------------
   여기서는 아무것도 판정하지 않는다. 저장 여부(verdict)는 메인 프로세스의
   summarizeBaselineSamples가 정하고, 화면은 그 결과를 보여주기만 한다.
   렌더러가 따로 "이 정도면 괜찮겠지" 하고 저장해버리면 부하 상태가 평소로 굳는다.
============================================================ */
const baselineProgressEl = document.getElementById('baseline-progress');
const baselineResultEl = document.getElementById('baseline-result');
const baselineCurrentEl = document.getElementById('baseline-current');
const baselineCaptureBtn = document.getElementById('baseline-capture-btn');

window.diagAPI.onBaselineProgress(({ done, total }) => {
  baselineProgressEl.style.display = 'block';
  baselineProgressEl.textContent = `측정 중... ${done}/${total} 샘플 (PC를 그대로 두세요)`;
});

function fmtBaselineRow(label, value, unit) {
  if (value === null || value === undefined) return '';
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}<span class="unit">${unit}</span></div></div>`;
}

function renderBaseline(b) {
  if (!b) {
    baselineCurrentEl.innerHTML = '<p class="mini-desc">저장된 기준선이 없습니다. 위에서 측정을 실행하면 다음 진단부터 "평소 대비" 비교가 붙습니다.</p>';
    return;
  }
  const captured = new Date(b.checkedAt);
  const ageDays = Math.max(0, Math.floor((Date.now() - captured.getTime()) / 86400000));
  const cards = [
    fmtBaselineRow('CPU 온도', b.cpuIdleTempC, '°C'),
    fmtBaselineRow('CPU 사용률', b.cpuIdleLoadPercent, '%'),
    fmtBaselineRow('CPU 클럭', b.cpuIdleClockGHz, 'GHz'),
    fmtBaselineRow('GPU 온도', b.gpuIdleTempC, '°C'),
    fmtBaselineRow('메모리 사용률', b.memIdleUsedPercent, '%'),
  ].filter(Boolean).join('');

  // 기준선이 얼마나 믿을 만한지도 함께 보여준다 — 편차가 크면 "평소 값"이라고 하기 어렵다.
  const notes = [
    `측정 시각: ${captured.toLocaleString('ko-KR')} (${ageDays === 0 ? '오늘' : `${ageDays}일 전`})`,
    `유효 샘플 ${b.idleSampleCount}/${b.sampleCount}개${b.durationSec ? ` · ${b.durationSec}초간 측정` : ''}`,
    b.cpuIdleTempSpreadC !== null ? `측정 중 CPU 온도 편차 ${b.cpuIdleTempSpreadC}°C` : null,
    b.cpuModel ? `기준 CPU: ${b.cpuModel}` : null,
    b.gpuModel ? `기준 GPU: ${b.gpuModel}` : null,
    b.gpuNote,
  ].filter(Boolean);

  baselineCurrentEl.innerHTML = `
    <div class="metric-grid">${cards}</div>
    <ul class="mini-desc" style="margin-top:12px;padding-left:18px;">
      ${notes.map((n) => `<li>${n}</li>`).join('')}
    </ul>`;
}

async function loadBaselineView() {
  renderBaseline(await window.diagAPI.getBaseline());
}

baselineCaptureBtn.addEventListener('click', async () => {
  baselineCaptureBtn.disabled = true;
  baselineCaptureBtn.textContent = '측정 중...';
  baselineResultEl.innerHTML = '';
  try {
    const res = await window.diagAPI.captureBaseline();
    baselineProgressEl.style.display = 'none';
    if (res.saved) {
      baselineResultEl.innerHTML = `<div class="note-card">기준선을 저장했습니다. 샘플 ${res.sampleCount}개 중 ${res.idleSampleCount}개가 유휴 상태였습니다. 다음 전체 진단부터 "평소 대비" 비교가 함께 표시됩니다.</div>`;
    } else {
      // 저장하지 않은 이유를 그대로 보여준다. "실패"가 아니라 "이 측정은 평소 상태가 아니었다"는 뜻이다.
      baselineResultEl.innerHTML = `<div class="note-card">기준선으로 저장하지 않았습니다.<br>${res.reason}</div>`;
    }
    await loadBaselineView();
  } finally {
    baselineCaptureBtn.disabled = false;
    baselineCaptureBtn.textContent = '기준선 측정 시작';
  }
});

document.getElementById('baseline-clear-btn').addEventListener('click', async () => {
  await window.diagAPI.clearBaseline();
  baselineResultEl.innerHTML = '';
  await loadBaselineView();
});

document.querySelector('[data-target="view-baseline"]').addEventListener('click', async () => {
  const plan = await window.diagAPI.getBaselineCapturePlan();
  document.getElementById('baseline-plan-desc').innerHTML =
    `${plan.samples}개 샘플을 ${plan.intervalMs / 1000}초 간격으로 약 ${plan.estimatedSec}초간 측정합니다. `
    + '측정 중에는 <b>다른 프로그램을 모두 종료</b>하고 PC를 그대로 두세요. '
    + '측정 도중 부하가 걸리면 그 값은 "평소"가 아니므로 기준선으로 저장하지 않습니다.';
  loadBaselineView();
});

/* ============================================================
   STABILITY TESTS
============================================================ */
window.diagAPI.onStressProgress((data) => {
  if (data.test === 'cpu') {
    document.getElementById('cpu-stress-elapsed').textContent = `${data.elapsed.toFixed(1)}초`;
    document.getElementById('cpu-stress-temp').textContent =
      `${data.tempC ?? '–'}°C / 최고 ${data.maxTemp ?? '–'}°C`;
    document.getElementById('cpu-stress-clock').textContent = data.clockGHz ? `${data.clockGHz}GHz` : '–';
  }
});

document.getElementById('cpu-stress-start').addEventListener('click', async () => {
  const startBtn = document.getElementById('cpu-stress-start');
  const abortBtn = document.getElementById('cpu-stress-abort');
  const badge = document.getElementById('cpu-stress-badge');
  const resultEl = document.getElementById('cpu-stress-result');
  startBtn.disabled = true; abortBtn.disabled = false;
  badge.textContent = '테스트 중'; badge.className = 'badge badge-warn';
  resultEl.textContent = '';
  document.getElementById('cpu-stress-cores').textContent = String(navigator.hardwareConcurrency || '–');

  const result = await window.diagAPI.runCpuStress({ durationSec: 15, safetyTempC: 95 });

  startBtn.disabled = false; abortBtn.disabled = true;
  // 화면 배지와 진단 엔진 판정이 어긋나면 안 된다. 엔진(cpuStressFindings)과 같은 기준으로
  // "안전 한계 도달/실행 실패 = 문제", "사용자 중단 = 판단 보류", "완주 = 완료"로 표시한다.
  if (result.abortKind === 'safety-temp' || result.abortKind === 'worker-error') {
    badge.textContent = result.abortKind === 'safety-temp' ? '안전 한계 도달' : '실행 실패';
    badge.className = 'badge badge-bad';
  } else if (result.aborted) {
    badge.textContent = '판단 보류'; badge.className = 'badge badge-warn';
  } else {
    badge.textContent = '완료'; badge.className = 'badge badge-good';
  }
  const lines = [
    `실행 시간: ${result.durationSec}초 (${result.coreCount}코어 사용)`,
    result.maxTempC !== null ? `최고 온도: ${result.maxTempC}°C` : '온도 센서 미지원 환경',
    result.maxLoadPercent !== null ? `실제 걸린 최고 부하: ${Math.round(result.maxLoadPercent)}%` : '',
    result.minClockGHz !== null ? `클럭 범위: ${result.minClockGHz}GHz ~ ${result.maxClockGHz}GHz` : '',
    result.clockDroppedUnderLoad ? '⚠ 부하 중 클럭 하락이 감지되었습니다 (열 제한 또는 전력 관리 동작)' : '',
    // 센서가 없으면 "온도 안전장치가 동작한다"고 말하면 안 된다.
    result.tempSensorAvailable === false
      ? `⚠ 이 시스템은 CPU 온도 센서를 읽을 수 없어 온도 기반 자동 중단을 쓸 수 없습니다. 대신 ${result.effectiveDurationSec}초 시간 제한 안전 모드로 실행했습니다.`
      : '',
    result.loadAchieved === false ? `⚠ 부하가 ${Math.round(result.maxLoadPercent)}%까지밖에 올라가지 않아 충분히 밀어붙였다고 보기 어렵습니다.` : '',
    result.aborted ? `중단 사유: ${result.abortReason}` : '',
    result.abortKind === 'user' ? '끝까지 실행하지 않았으므로 이 결과를 "이상 없음"으로 볼 수 없습니다.' : '',
  ].filter(Boolean);
  resultEl.textContent = lines.join('\n');
});
document.getElementById('cpu-stress-abort').addEventListener('click', () => {
  window.diagAPI.abortCpuStress();
});

document.getElementById('storage-test-start').addEventListener('click', async () => {
  const btn = document.getElementById('storage-test-start');
  const badge = document.getElementById('storage-test-badge');
  const resultEl = document.getElementById('storage-test-result');
  btn.disabled = true; badge.textContent = '측정 중'; badge.className = 'badge badge-warn';
  resultEl.textContent = '';
  const result = await window.diagAPI.runStorageTest({ sizeMB: 200 });
  btn.disabled = false;
  if (result.verifyMismatch) {
    badge.textContent = '데이터 불일치'; badge.className = 'badge badge-bad';
    resultEl.textContent = '⚠ 쓴 데이터와 읽은 데이터가 일치하지 않았습니다. 속도 문제가 아니라 데이터 손상 신호입니다.\n중요 데이터를 백업하고 SMART 상태를 함께 확인하세요.';
  } else if (result.error) {
    badge.textContent = '검사 실패'; badge.className = 'badge badge-bad';
    resultEl.textContent = `검사를 완료하지 못했습니다 (${result.errorStage || '단계 미상'})\n${result.error}`;
  } else {
    badge.textContent = '완료'; badge.className = 'badge badge-good';
    resultEl.textContent = `쓰기 속도: ${result.writeMBps} MB/s\n읽기 속도: ${result.readMBps} MB/s\n(테스트 파일 ${result.sizeMB}MB, 자동 삭제됨)\n`
      + '※ 처리량은 장치 종류(HDD/SATA SSD/NVMe)에 따라 정상 범위가 크게 달라, 속도만으로는 정상/이상을 판정하지 않습니다.';
  }
});

document.getElementById('ram-test-start').addEventListener('click', async () => {
  const btn = document.getElementById('ram-test-start');
  const badge = document.getElementById('ram-test-badge');
  const resultEl = document.getElementById('ram-test-result');
  btn.disabled = true; badge.textContent = '검사 중'; badge.className = 'badge badge-warn';
  resultEl.textContent = '';
  const result = await window.diagAPI.runRamTest({ sizeMB: 256 });
  btn.disabled = false;
  if (!result.completed) {
    // 검사를 못 끝냈으면 정상이 아니라 판단 보류다.
    badge.textContent = '판단 보류'; badge.className = 'badge badge-warn';
    resultEl.textContent = `검사를 완료하지 못했습니다.\n${result.error || '원인 미상'}`;
  } else if (result.passed) {
    badge.textContent = '정상'; badge.className = 'badge badge-good';
    resultEl.textContent = `검사 용량: ${result.sizeMB}MB (패턴 ${result.patternsRun}종)\n불일치 발견: 0건\n`
      + '※ 소프트웨어 자가점검이며 MemTest86 같은 부팅형 정밀 검사를 대체하지 않습니다.';
  } else {
    badge.textContent = '오류 감지'; badge.className = 'badge badge-bad';
    resultEl.textContent = `검사 용량: ${result.sizeMB}MB (패턴 ${result.patternsRun}종)\n불일치 발견: ${result.errors.toLocaleString()}건`
      + `${result.firstErrorOffset !== null ? `\n첫 발생 위치: ${result.firstErrorOffset.toLocaleString()}바이트 지점` : ''}\n`
      + '⚠ 중요 데이터를 백업하고, 메모리 오버클럭(XMP/EXPO)을 끈 뒤 재검사한 다음 MemTest86으로 교차 확인하세요.';
  }
});

/* ============================================================
   GPU STRESS TEST
   CPU/저장장치/RAM 부하 테스트는 메인 프로세스(Node)에서 직접 부하를 만들 수 있지만,
   GPU는 CUDA 같은 게 없어도 Chromium의 실제 GPU 가속 렌더링(WebGL)으로 부하를 만들 수
   있다는 걸 이 세션에서 직접 측정해 확인했다(유휴 28% → 렌더링 중 51~58%, 전력 소모 증가).
   부하 자체는 여기(렌더러)에서 WebGL로 만들고, 온도/클럭 같은 센서 값은 메인 프로세스의
   nvidia-smi 폴링(live-sample, 실시간 모니터링과 동일한 인프라 재사용)으로 받는다.
============================================================ */
const GPU_STRESS_STAGES = [10, 30, 50, 75, 90, 100]; // 부하 강도 %
const GPU_STRESS_STAGE_SEC = 3;
const GPU_STRESS_SAFETY_TEMP_C = 90;

// 프레임당 드로우 콜 수. 예전에는 프레임당 한 번만 그렸는데, 화면 주사율(vsync) 때문에
// 프레임 사이에 GPU가 놀아서 실제 부하가 잘 안 걸렸다 — 이 PC에서 실측하니 최대 강도에서도
// nvidia-smi 기준 평균 29%에 그쳤다. 프레임당 여러 번 그리도록 바꿔서 다시 측정한 결과:
//   1회 29% / 4회 58% / 16회 99% / 48회 99% (전부 65fps 유지)
// 16회에서 포화되고 그 이상은 의미가 없어서 16으로 정했다. 프레임률이 유지되므로
// 한 프레임이 지나치게 길어져 드라이버 워치독(TDR)에 걸릴 위험도 없다.
const GPU_STRESS_DRAWS_PER_FRAME = 16;

// 부하가 실제로 걸렸다고 보는 최소 GPU 사용률. 창을 최소화하면 렌더링(rAF)이 멈춰서
// "테스트는 돌았는데 GPU는 놀았다"는 상황이 실제로 가능하다. 그때 "이상 없음"이라고
// 말하지 않기 위한 최소 기준이다.
const GPU_STRESS_MIN_LOAD_PERCENT = 50;

let gpuStressGl = null;
let gpuStressUniforms = null;
let gpuStressRafId = null;
let gpuStressAbort = false;

function initGpuStressGl() {
  if (gpuStressGl) return gpuStressGl;
  const canvas = document.getElementById('gpu-stress-canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return null;

  const vsSource = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.0,1.0); }';
  // 픽셀마다 반복 연산을 여러 번 돌리는 프래그먼트 셰이더. iterations를 늘릴수록 GPU가 더 바빠진다.
  const fsSource = `
    precision highp float;
    uniform vec2 res;
    uniform float t;
    uniform int iterations;
    void main() {
      vec2 uv = (gl_FragCoord.xy / res.xy) * 2.0 - 1.0;
      vec3 col = vec3(0.0);
      vec2 z = uv;
      for (int i = 0; i < 400; i++) {
        if (i >= iterations) break;
        z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + uv * sin(t*0.1);
        col += 0.002 * vec3(sin(z.x*10.0), cos(z.y*10.0), sin((z.x+z.y)*5.0));
      }
      gl_FragColor = vec4(abs(col), 1.0);
    }
  `;
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pLoc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(pLoc);
  gl.vertexAttribPointer(pLoc, 2, gl.FLOAT, false, 0, 0);

  const resLoc = gl.getUniformLocation(prog, 'res');
  const tLoc = gl.getUniformLocation(prog, 't');
  const iterLoc = gl.getUniformLocation(prog, 'iterations');
  gl.uniform2f(resLoc, canvas.width, canvas.height);

  gpuStressGl = gl;
  gpuStressUniforms = { tLoc, iterLoc };
  return gl;
}

function renderGpuStressFrame(iterations, draws = 1) {
  const gl = gpuStressGl;
  const canvas = document.getElementById('gpu-stress-canvas');
  gl.uniform1f(gpuStressUniforms.tLoc, performance.now() * 0.001);
  gl.uniform1i(gpuStressUniforms.iterLoc, iterations);
  gl.viewport(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < draws; i++) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // 그린 작업이 다음 프레임으로 무한정 밀리지 않도록 프레임마다 GPU를 기다린다.
  // (이게 없으면 명령만 쌓이고 실제 부하 시점이 흐려진다)
  gl.finish();
}

document.getElementById('gpu-stress-start').addEventListener('click', async () => {
  const startBtn = document.getElementById('gpu-stress-start');
  const abortBtn = document.getElementById('gpu-stress-abort');
  const badge = document.getElementById('gpu-stress-badge');
  const resultEl = document.getElementById('gpu-stress-result');
  const stageEl = document.getElementById('gpu-stress-stage');
  const elapsedEl = document.getElementById('gpu-stress-elapsed');

  const gl = initGpuStressGl();
  if (!gl) {
    badge.textContent = '지원 안 함'; badge.className = 'badge badge-bad';
    resultEl.textContent = 'WebGL을 초기화하지 못했습니다.';
    return;
  }

  startBtn.disabled = true; abortBtn.disabled = false;
  badge.textContent = '테스트 중'; badge.className = 'badge badge-warn';
  resultEl.textContent = '';
  gpuStressAbort = false;

  const samples = []; // { stagePercent, loadPercent, tempC, clockMHz, vramUsedMB, vramTotalMB }
  let gpuSeen = false;
  let maxTempSeen = null;
  let abortReason = null;

  const onSample = (sample) => {
    if (!sample.gpu) return;
    gpuSeen = true;
    const g = sample.gpu;
    document.getElementById('gpu-stress-load-temp').textContent = `${Math.round(g.loadPercent)}% / ${Math.round(g.tempC)}°C`;
    document.getElementById('gpu-stress-clock-vram').textContent =
      `${Math.round(g.clockMHz)}MHz / ${Math.round(g.vramUsedMB)}~${Math.round(g.vramTotalMB)}MB`;
    maxTempSeen = maxTempSeen === null ? g.tempC : Math.max(maxTempSeen, g.tempC);
    samples.push({ stagePercent: currentStagePercent, ...g });
    if (g.tempC >= GPU_STRESS_SAFETY_TEMP_C) {
      abortReason = `GPU 온도가 안전 한계(${GPU_STRESS_SAFETY_TEMP_C}°C)에 도달`;
      gpuStressAbort = true;
    }
  };

  let currentStagePercent = GPU_STRESS_STAGES[0];
  liveSampleListeners.add(onSample);
  window.diagAPI.startLiveMonitor();

  const testStart = performance.now();
  function frameLoop() {
    if (gpuStressAbort) return;
    // 강도는 셰이더 반복 횟수와 프레임당 드로우 콜 수를 함께 올려서 조절한다.
    renderGpuStressFrame(
      Math.round((currentStagePercent / 100) * 400),
      Math.max(1, Math.round((currentStagePercent / 100) * GPU_STRESS_DRAWS_PER_FRAME)),
    );
    elapsedEl.textContent = `${((performance.now() - testStart) / 1000).toFixed(1)}초`;
    gpuStressRafId = requestAnimationFrame(frameLoop);
  }
  gpuStressRafId = requestAnimationFrame(frameLoop);

  for (const stagePercent of GPU_STRESS_STAGES) {
    if (gpuStressAbort) break;
    currentStagePercent = stagePercent;
    stageEl.textContent = `${stagePercent}%`;
    await new Promise((r) => setTimeout(r, GPU_STRESS_STAGE_SEC * 1000));
  }

  if (gpuStressRafId) cancelAnimationFrame(gpuStressRafId);
  gpuStressRafId = null;
  liveSampleListeners.delete(onSample);
  window.diagAPI.stopLiveMonitor();

  startBtn.disabled = false; abortBtn.disabled = true;

  // 중단 사유를 구분한다: 안전 한계 온도 도달(abortReason이 채워짐)은 그 자체가 관측 결과이고,
  // 사용자가 누른 중단은 "끝까지 안 돌린 것"이라 정상이라고 말할 수 없는 경우다.
  const summary = buildGpuStressSummary({
    samples, gpuSeen, maxTempSeen,
    abortKind: abortReason ? 'safety-temp' : (gpuStressAbort ? 'user' : null),
    safetyTempC: GPU_STRESS_SAFETY_TEMP_C,
    reachedStagePercent: currentStagePercent,
  });
  badge.textContent = summary.badgeText;
  badge.className = summary.badgeClass;

  const lines = [...summary.lines];
  if (summary.verdict) {
    // VRAM 검사와 같은 방식으로 기록해두면 다음 전체 진단이 GPU 근거로 쓴다(gpuStressChecks.js).
    try {
      const saved = await window.diagAPI.saveGpuStressCheck(summary.record);
      renderGpuStressLastCheck(saved);
      lines.push(summary.verdict === 'inconclusive'
        ? '이 결과는 기록되며, 전체 진단에서는 "판단 보류"로만 표시되고 정상/이상 어느 쪽으로도 반영되지 않습니다.'
        : '이 결과는 기록되어 다음 전체 진단과 판매용 점검 리포트에 GPU 근거로 반영됩니다.');
    } catch {
      lines.push('결과를 기록하지 못했습니다(진단에는 반영되지 않습니다).');
    }
  }
  resultEl.textContent = lines.join('\n');
});

// 결과 해석과 판정. 실제로 스로틀링이 나는 GPU를 만들어낼 수 없어서 순수 함수로 분리해두고
// 가짜 입력으로 분기를 검증한다(VRAM 테스트와 같은 방식).
function buildGpuStressSummary({ samples, gpuSeen, maxTempSeen, abortKind, safetyTempC, reachedStagePercent }) {
  if (!gpuSeen) {
    // 센서를 못 읽으면 부하는 걸렸어도 온도·클럭을 확인할 수 없다 → 정상이라고 말할 수 없다.
    return {
      verdict: 'inconclusive',
      badgeText: '판단 보류', badgeClass: 'badge badge-warn',
      lines: ['GPU 센서 값을 가져오지 못했습니다. NVIDIA GPU가 아니거나 nvidia-smi를 찾을 수 없어, 부하는 걸었지만 온도·클럭 변화를 확인하지 못했습니다.'],
      record: {
        verdict: 'inconclusive', throttleSuspected: false, abortReason: abortKind,
        maxTempC: null, maxLoadPercent: null,
        highLoadStartClockMHz: null, highLoadEndClockMHz: null,
        highLoadStartTempC: null, highLoadEndTempC: null,
        reachedStagePercent: reachedStagePercent ?? null, safetyTempC: safetyTempC ?? null,
      },
    };
  }

  // 최고 부하 단계(90~100%)에서 온도 상승 + 클럭 하락이 함께 확인되면 스로틀링 의심으로 판정한다
  // (evaluateGpu의 gpuTrend 판정과 같은 방식: 부하 지속 + 온도상승 + 클럭하락).
  const highLoad = samples.filter((s) => s.stagePercent >= 90);
  const first = highLoad.length >= 2 ? highLoad[0] : null;
  const last = highLoad.length >= 2 ? highLoad[highLoad.length - 1] : null;
  const throttleSuspected = !!(first && last && (last.tempC - first.tempC >= 2) && (first.clockMHz - last.clockMHz >= 50));

  // 부하가 실제로 걸렸는지 확인한다. 창을 최소화하면 브라우저가 렌더링을 멈춰서
  // "테스트는 끝났는데 GPU는 논" 상태가 실제로 나온다 — 그걸 정상으로 기록하면 안 된다.
  const maxLoadPercent = samples.length ? Math.max(...samples.map((s) => s.loadPercent)) : null;
  const loadAchieved = maxLoadPercent !== null && maxLoadPercent >= GPU_STRESS_MIN_LOAD_PERCENT;

  let verdict;
  if (throttleSuspected || abortKind === 'safety-temp') verdict = 'issue';
  else if (abortKind === 'user') verdict = 'inconclusive';   // 끝까지 안 돌렸으면 정상이라고 말하지 않는다
  else if (!loadAchieved) verdict = 'inconclusive';          // 부하가 안 걸렸으면 "이상 없음"이라고 말할 수 없다
  else verdict = 'pass';

  const badge = {
    issue: { badgeText: abortKind === 'safety-temp' ? '중단됨' : '스로틀링 의심', badgeClass: 'badge badge-bad' },
    inconclusive: { badgeText: '판단 보류', badgeClass: 'badge badge-warn' },
    pass: { badgeText: '완료', badgeClass: 'badge badge-good' },
  }[verdict];

  const lines = [
    `실제 걸린 최고 부하: ${maxLoadPercent !== null ? Math.round(maxLoadPercent) + '%' : '측정 불가'}`,
    `최고 온도: ${maxTempSeen !== null ? Math.round(maxTempSeen) + '°C' : '측정 불가'}`,
    first && last ? `최고 부하 구간 클럭 변화: ${Math.round(first.clockMHz)}MHz → ${Math.round(last.clockMHz)}MHz` : '',
    throttleSuspected ? '⚠ 최고 부하 단계에서 온도 상승과 함께 클럭 하락이 감지되었습니다 (열 스로틀링 가능성)' : '',
    abortKind === 'safety-temp' ? `중단 사유: GPU 온도가 안전 한계(${safetyTempC}°C)에 도달` : '',
    abortKind === 'user' ? `사용자가 ${reachedStagePercent}% 강도에서 중단해, 최고 부하 구간은 확인하지 못했습니다.` : '',
    !loadAchieved && abortKind !== 'user'
      ? `⚠ GPU 사용률이 ${GPU_STRESS_MIN_LOAD_PERCENT}%까지 올라가지 않아, 부하가 제대로 걸렸다고 볼 수 없습니다. 테스트 중 창을 최소화했거나 다른 창에 완전히 가려지면 화면 갱신이 멈춥니다. 창을 열어둔 채로 다시 실행해보세요. (GPU가 매우 빨라서 이 부하로는 포화되지 않는 경우일 수도 있습니다)`
      : '',
  ].filter(Boolean);

  return {
    verdict, ...badge, lines,
    record: {
      verdict, throttleSuspected, abortReason: abortKind,
      maxTempC: maxTempSeen,
      maxLoadPercent,
      highLoadStartClockMHz: first ? first.clockMHz : null,
      highLoadEndClockMHz: last ? last.clockMHz : null,
      highLoadStartTempC: first ? first.tempC : null,
      highLoadEndTempC: last ? last.tempC : null,
      reachedStagePercent: reachedStagePercent ?? null,
      safetyTempC: safetyTempC ?? null,
    },
  };
}

function renderGpuStressLastCheck(check) {
  const el = document.getElementById('gpu-stress-last');
  if (!el) return;
  if (!check) { el.textContent = '없음'; return; }
  const when = new Date(check.checkedAt).toLocaleString('ko-KR');
  const label = { pass: '이상 없음', issue: check.throttleSuspected ? '스로틀링 확인' : '안전 한계 도달', inconclusive: '판단 보류' }[check.verdict] || check.verdict;
  const stale = Date.now() - new Date(check.checkedAt).getTime() >= 30 * 24 * 60 * 60 * 1000;
  el.textContent = `${label} (${when})${stale ? ' — 30일이 지나 진단에는 반영되지 않음' : ''}`;
}

window.diagAPI.getGpuStressCheck().then(renderGpuStressLastCheck).catch(() => {});

document.getElementById('gpu-stress-abort').addEventListener('click', () => {
  gpuStressAbort = true;
});

/* ============================================================
   VRAM 압박 · 무결성 테스트
   GPU 부하 테스트와 같은 WebGL 인프라를 쓰지만 목적이 다르다. 부하 테스트는 셰이더
   연산량으로 GPU 코어를 바쁘게 만들고, 이쪽은 "VRAM에 올린 데이터가 그대로 다시
   읽히는가"를 본다. 2048x2048 RGBA8 텍스처(타일당 16MB)를 여유 VRAM의 일정 비율까지
   채워 올린 뒤, 각 타일을 프레임버퍼에 붙여 readPixels로 되읽어 32비트 워드 단위로
   비교한다. 1패스는 원본 패턴, 2패스는 같은 패턴의 비트 반전 — 특정 비트가 0이나 1로
   고착된 경우 두 패스 중 한 번은 반드시 걸리게 하기 위해서다.

   이 검사로 말할 수 있는 것과 없는 것을 결과 문구에도 그대로 적는다:
   - 드라이버가 텍스처 사본을 시스템 메모리에 들고 있으면 실제 VRAM 셀 오류를 놓칠 수
     있다. 그래서 nvidia-smi 기준 VRAM 사용량이 실제로 그만큼 올라갔는지를 함께 확인하고,
     안 올라갔으면 "정상"이 아니라 "판단 보류"로 표시한다.
   - 다른 프로그램이 이미 점유한 VRAM 영역은 할당 자체가 안 되므로 검사 대상이 아니다.
   - RAM 무결성 간이검사와 같은 성격이며 MemTest86 같은 전용 도구를 대체하지 않는다.
============================================================ */
const VRAM_TILE_PX = 2048;                 // 2048 x 2048 x RGBA8 = 16MB
const VRAM_TARGET_FREE_RATIO = 0.6;        // 여유 VRAM을 다 먹으면 화면이 멈출 수 있어 일부만 쓴다
const VRAM_TARGET_MIN_MB = 256;
const VRAM_TARGET_MAX_MB = 4096;
const VRAM_TARGET_FALLBACK_MB = 1024;      // nvidia-smi로 여유량을 못 읽을 때 쓰는 보수적 기본값

let vramTestAbort = false;
let vramTestRunning = false;

// 타일 하나 크기의 기준 패턴. xorshift32라서 값이 0/0xFF로 치우치지 않고,
// 시드가 고정이라 검증할 때 같은 값을 다시 만들어낼 수 있다(CPU 쪽에 사본을 안 들고 있어도 됨).
function makeVramBasePattern(wordCount) {
  const buf = new Uint32Array(wordCount);
  let s = 0x9e3779b9 | 0;
  for (let i = 0; i < wordCount; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    buf[i] = s;
  }
  return buf;
}

async function runVramTest(opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const shouldAbort = opts.shouldAbort || (() => false);
  const yieldTick = () => new Promise((r) => setTimeout(r, 0));

  // 캔버스를 매번 새로 만든다. 화면에 붙일 필요는 없고(렌더링이 목적이 아니라 VRAM에
  // 올렸다 되읽는 게 목적), 테스트가 끝나면 컨텍스트째로 버려서 VRAM을 확실히 반납한다.
  // deleteTexture만으로는 nvidia-smi 기준 사용량이 돌아오지 않는 걸 실측으로 확인했다.
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 4;
  const glOpts = { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
  const gl = canvas.getContext('webgl2', glOpts) || canvas.getContext('webgl', glOpts);
  if (!gl) return { supported: false, reason: 'WebGL 컨텍스트를 만들지 못했습니다.' };

  let contextLost = false;
  const onContextLost = (e) => { e.preventDefault(); contextLost = true; };
  canvas.addEventListener('webglcontextlost', onContextLost);

  const tilePx = Math.min(VRAM_TILE_PX, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const tileBytes = tilePx * tilePx * 4;
  const tileMB = tileBytes / (1024 * 1024);
  const tileWords = tileBytes / 4;
  const tileTarget = Math.max(1, Math.round((opts.targetMB || VRAM_TARGET_FALLBACK_MB) / tileMB));

  const base = makeVramBasePattern(tileWords);
  const scratch = new Uint32Array(tileWords);
  const scratchBytes = new Uint8Array(scratch.buffer);
  const readback = new Uint32Array(tileWords);
  const readbackBytes = new Uint8Array(readback.buffer);

  const result = {
    supported: true,
    tilePx, tileMB,
    requestedMB: tileTarget * tileMB,
    allocatedMB: 0,
    verifiedMB: 0,
    passes: [],            // [{ inverted, mismatchWords, badTiles, firstBadTile }]
    mismatchWords: 0,
    allocStoppedBy: null,  // 'OUT_OF_MEMORY' | 'GL_ERROR:xxxx' | null
    readbackUnsupported: false,
    contextLost: false,
    aborted: false,
  };

  const seedOf = (i) => Math.imul(i + 1, 2654435761) >>> 0;
  const fillTile = (seed, inverted) => {
    if (inverted) for (let w = 0; w < tileWords; w++) scratch[w] = ~(base[w] ^ seed);
    else for (let w = 0; w < tileWords; w++) scratch[w] = base[w] ^ seed;
  };

  const textures = [];
  const fb = gl.createFramebuffer();

  try {
    // --- 1단계: 할당 ---
    for (let i = 0; i < tileTarget; i++) {
      if (shouldAbort()) { result.aborted = true; break; }
      if (contextLost) break;
      fillTile(seedOf(i), false);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tilePx, tilePx, 0, gl.RGBA, gl.UNSIGNED_BYTE, scratchBytes);
      // getError는 여기서 파이프라인을 동기화시키기 때문에, 할당 실패를 나중이 아니라 이 타일에서 잡을 수 있다.
      const err = gl.getError();
      if (err !== gl.NO_ERROR) {
        result.allocStoppedBy = err === gl.OUT_OF_MEMORY ? 'OUT_OF_MEMORY' : `GL_ERROR:0x${err.toString(16)}`;
        gl.deleteTexture(tex);
        break;
      }
      textures.push(tex);
      result.allocatedMB += tileMB;
      onProgress({ phase: 'alloc', done: i + 1, total: tileTarget, allocatedMB: result.allocatedMB });
      await yieldTick();
    }

    // --- 2단계: 되읽어 비교 (pass 0 = 원본, pass 1 = 비트 반전) ---
    for (const inverted of [false, true]) {
      if (result.aborted || contextLost || result.readbackUnsupported) break;
      if (!textures.length) break;

      // 반전 패스는 같은 텍스처에 반대 값을 다시 써 넣는다(새로 할당하지 않음).
      if (inverted) {
        for (let i = 0; i < textures.length; i++) {
          if (shouldAbort()) { result.aborted = true; break; }
          if (contextLost) break;
          fillTile(seedOf(i), true);
          gl.bindTexture(gl.TEXTURE_2D, textures[i]);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, tilePx, tilePx, gl.RGBA, gl.UNSIGNED_BYTE, scratchBytes);
          onProgress({ phase: 'rewrite', done: i + 1, total: textures.length });
          await yieldTick();
        }
        if (result.aborted || contextLost) break;
      }

      const pass = { inverted, mismatchWords: 0, badTiles: 0, firstBadTile: null };
      for (let i = 0; i < textures.length; i++) {
        if (shouldAbort()) { result.aborted = true; break; }
        if (contextLost) break;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textures[i], 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          result.readbackUnsupported = true;
          break;
        }
        gl.readPixels(0, 0, tilePx, tilePx, gl.RGBA, gl.UNSIGNED_BYTE, readbackBytes);
        const err = gl.getError();
        if (err !== gl.NO_ERROR) { result.readbackUnsupported = true; break; }

        const seed = seedOf(i);
        let bad = 0;
        let firstWord = -1;
        for (let w = 0; w < tileWords; w++) {
          const exp = inverted ? (~(base[w] ^ seed)) >>> 0 : (base[w] ^ seed) >>> 0;
          if (readback[w] !== exp) { bad++; if (firstWord < 0) firstWord = w; }
        }
        if (bad > 0) {
          pass.mismatchWords += bad;
          pass.badTiles++;
          if (!pass.firstBadTile) pass.firstBadTile = { tile: i, wordOffset: firstWord, byteOffsetInTile: firstWord * 4 };
        }
        if (!inverted) result.verifiedMB += tileMB;
        onProgress({ phase: inverted ? 'verify2' : 'verify1', done: i + 1, total: textures.length, mismatchWords: result.mismatchWords + pass.mismatchWords });
        await yieldTick();
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      result.passes.push(pass);
      result.mismatchWords += pass.mismatchWords;
    }
  } finally {
    for (const t of textures) gl.deleteTexture(t);
    gl.deleteFramebuffer(fb);
    // 아래 loseContext()가 webglcontextlost를 다시 발생시키기 때문에, 우리가 일부러 버린 것을
    // "드라이버가 컨텍스트를 잃었다"로 오해하지 않도록 리스너를 먼저 떼고 결과를 확정한다.
    canvas.removeEventListener('webglcontextlost', onContextLost);
    result.contextLost = contextLost;
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) loseExt.loseContext();
  }

  return result;
}

// 결과 해석은 실제 GPU 상태를 마음대로 만들어낼 수 없어서(예: 불일치 발생, 컨텍스트 손실)
// 순수 함수로 떼어놨다. 덕분에 모든 분기를 가짜 입력으로 검증할 수 있다.
function buildVramTestSummary({ res, baselineUsedMB, peakUsedMB, totalMB, smiAvailable }) {
  // nvidia-smi 기준으로 VRAM 사용량이 실제로 올라갔는지 대조한다.
  // 안 올라갔다면 "정상"이 아니라 "이 검사로는 판단할 수 없음"이다.
  let residency = { level: 'unknown', text: 'nvidia-smi를 쓸 수 없어 실제 VRAM에 올라갔는지는 확인하지 못했습니다(검사 안 함).' };
  let coveredMB = null;   // VRAM에 올라간 것이 확인된 범위
  let smiText = null;
  if (smiAvailable && peakUsedMB !== null && res.allocatedMB > 0) {
    const deltaMB = peakUsedMB - baselineUsedMB;
    const ratio = deltaMB / res.allocatedMB;
    // 증가량이 할당량보다 클 수 있다(프레임버퍼 등 드라이버 부대 비용). 커버리지는 둘 중 작은 값으로 잡는다.
    coveredMB = Math.max(0, Math.min(res.allocatedMB, deltaMB));
    smiText = `${Math.round(baselineUsedMB)} → ${Math.round(peakUsedMB)} / ${Math.round(totalMB)}MB`;
    if (ratio >= 0.7) {
      residency = { level: 'ok', text: `VRAM 사용량이 ${Math.round(baselineUsedMB)}MB → ${Math.round(peakUsedMB)}MB로 ${Math.round(deltaMB)}MB 증가해, 할당분(${Math.round(res.allocatedMB)}MB)이 실제 VRAM에 올라간 것으로 확인됩니다.` };
    } else if (ratio >= 0.2) {
      residency = { level: 'partial', text: `VRAM 사용량은 ${Math.round(deltaMB)}MB만 증가했습니다(할당분의 ${Math.round(ratio * 100)}%). Windows는 VRAM이 부족하면 초과분을 시스템 메모리에 얹어서 할당을 성공시키기 때문에, 할당에 성공한 ${Math.round(res.allocatedMB)}MB 전부가 VRAM에 있었다고 볼 수 없습니다. 검사 범위는 실제 증가분 기준으로 봐야 합니다.` };
    } else {
      residency = { level: 'unknown', text: `VRAM 사용량 증가가 거의 관측되지 않았습니다(${Math.round(deltaMB)}MB). 이 경우 검사한 데이터가 실제 VRAM에 있었다고 보기 어려워, 무결성 결과를 "이상 없음"으로 해석하면 안 됩니다(판단 보류).` };
    }
  }

  const lines = [];
  lines.push(`요청 ${Math.round(res.requestedMB)}MB 중 ${Math.round(res.allocatedMB)}MB 할당 (${res.tilePx}x${res.tilePx} 타일 ${Math.round(res.allocatedMB / res.tileMB)}장)`);
  if (res.allocStoppedBy === 'OUT_OF_MEMORY') {
    lines.push(`${Math.round(res.allocatedMB)}MB 지점에서 더 이상 할당되지 않았습니다(OUT_OF_MEMORY). 다른 프로그램이 VRAM을 쓰고 있으면 정상적으로 나올 수 있는 결과입니다.`);
  } else if (res.allocStoppedBy) {
    lines.push(`할당 중 그래픽 오류로 중단되었습니다(${res.allocStoppedBy}).`);
  }
  if (res.readbackUnsupported) lines.push('텍스처를 다시 읽어오는 데 실패해 무결성 비교를 완료하지 못했습니다.');
  if (res.passes.length) {
    lines.push(`검증 ${res.passes.length}패스(원본${res.passes.length > 1 ? ' + 비트 반전' : ''}) 수행, 불일치 ${res.mismatchWords.toLocaleString()}워드`);
  }
  const firstBad = res.passes.map((p) => p.firstBadTile).find(Boolean);
  if (firstBad) {
    lines.push(`⚠ 처음 불일치한 위치: ${firstBad.tile}번 타일 + ${firstBad.byteOffsetInTile.toLocaleString()}바이트 지점`);
    lines.push('같은 위치가 반복해서 나오면 VRAM 결함 가능성이 있지만, 드라이버 오류나 전송 과정 문제일 수도 있어 이 결과만으로 단정할 수 없습니다.');
  }
  lines.push(residency.text);
  if (res.contextLost) lines.push('⚠ 테스트 도중 그래픽 컨텍스트가 손실되었습니다(드라이버 리셋/TDR 가능성). Windows 이벤트 로그의 Display 오류와 함께 확인해 보세요.');
  if (res.aborted) lines.push('사용자가 중단했습니다.');
  if (totalMB && coveredMB !== null) {
    lines.push(`이 검사가 실제로 덮은 범위는 전체 VRAM ${Math.round(totalMB)}MB 중 ${Math.round(coveredMB)}MB입니다. 나머지 영역(다른 프로그램이 쓰고 있는 영역 포함)은 검사하지 않았습니다.`);
  } else if (res.allocatedMB > 0) {
    lines.push(`${Math.round(res.allocatedMB)}MB를 할당해 검사했지만, 그중 얼마가 실제 VRAM이었는지는 확인하지 못했습니다.`);
  }

  // verdict는 화면 배지이자 진단 엔진에 넘길 판정값이다(vramChecks.js). 판정 기준이 두 곳에
  // 흩어지지 않도록 여기서만 정하고, 저장 기록도 이 값을 그대로 쓴다.
  let verdict, badgeText, badgeClass;
  if (res.contextLost || res.mismatchWords > 0) {
    verdict = 'issue'; badgeText = '이상 감지'; badgeClass = 'badge badge-bad';
  } else if (res.aborted || res.readbackUnsupported || residency.level === 'unknown') {
    // 중단됐거나, 되읽기에 실패했거나, VRAM에 올라갔는지 확인이 안 된 경우는
    // 불일치가 0이어도 "정상"이라고 말하지 않는다.
    verdict = 'inconclusive'; badgeText = '판단 보류'; badgeClass = 'badge badge-warn';
  } else {
    verdict = 'pass'; badgeText = '완료'; badgeClass = 'badge badge-good';
  }

  return { verdict, badgeText, badgeClass, lines, residency, coveredMB, smiText };
}

document.getElementById('vram-test-start').addEventListener('click', async () => {
  if (vramTestRunning) return;
  const startBtn = document.getElementById('vram-test-start');
  const abortBtn = document.getElementById('vram-test-abort');
  const badge = document.getElementById('vram-test-badge');
  const resultEl = document.getElementById('vram-test-result');
  const targetEl = document.getElementById('vram-test-target');
  const stageEl = document.getElementById('vram-test-stage');
  const allocEl = document.getElementById('vram-test-alloc');
  const smiEl = document.getElementById('vram-test-smi');
  const mismatchEl = document.getElementById('vram-test-mismatch');

  vramTestRunning = true;
  vramTestAbort = false;
  startBtn.disabled = true; abortBtn.disabled = false;
  badge.textContent = '준비 중'; badge.className = 'badge badge-warn';
  resultEl.textContent = '';
  mismatchEl.textContent = '–';
  stageEl.textContent = 'GPU 상태 확인 중…';

  // nvidia-smi 기준 여유 VRAM을 먼저 본다. 못 읽으면 보수적인 기본값으로 진행하되,
  // "실제로 VRAM에 올라갔는지"는 검사 안 함으로 남긴다.
  let baselineUsedMB = null;
  let peakUsedMB = null;
  let totalMB = null;
  const onSample = (sample) => {
    if (!sample.gpu) return;
    const g = sample.gpu;
    if (baselineUsedMB === null) baselineUsedMB = g.vramUsedMB;
    totalMB = g.vramTotalMB;
    peakUsedMB = peakUsedMB === null ? g.vramUsedMB : Math.max(peakUsedMB, g.vramUsedMB);
    smiEl.textContent = `${Math.round(g.vramUsedMB)} / ${Math.round(g.vramTotalMB)}MB`;
  };
  liveSampleListeners.add(onSample);
  window.diagAPI.startLiveMonitor();

  for (let i = 0; i < 40 && baselineUsedMB === null; i++) {
    if (vramTestAbort) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  let targetMB = VRAM_TARGET_FALLBACK_MB;
  const smiAvailable = baselineUsedMB !== null && totalMB;
  if (smiAvailable) {
    const freeMB = Math.max(0, totalMB - baselineUsedMB);
    targetMB = Math.min(VRAM_TARGET_MAX_MB, Math.max(VRAM_TARGET_MIN_MB, Math.round(freeMB * VRAM_TARGET_FREE_RATIO)));
  }
  targetEl.textContent = smiAvailable
    ? `${targetMB}MB (여유 ${Math.round(totalMB - baselineUsedMB)}MB의 ${Math.round(VRAM_TARGET_FREE_RATIO * 100)}%)`
    : `${targetMB}MB (VRAM 용량을 못 읽어 기본값 사용)`;

  badge.textContent = '테스트 중';
  const phaseLabel = { alloc: '할당', rewrite: '반전 패턴 기록', verify1: '검증 1패스', verify2: '검증 2패스(반전)' };
  let allocMB = 0;
  const res = await runVramTest({
    targetMB,
    shouldAbort: () => vramTestAbort,
    onProgress: (p) => {
      if (p.allocatedMB !== undefined) allocMB = p.allocatedMB;
      stageEl.textContent = `${phaseLabel[p.phase]} ${p.done}/${p.total}`;
      allocEl.textContent = `${Math.round(allocMB)}MB 할당`;
      if (typeof p.mismatchWords === 'number') {
        mismatchEl.textContent = p.mismatchWords === 0 ? '없음' : `${p.mismatchWords.toLocaleString()}워드`;
      }
    },
  });

  liveSampleListeners.delete(onSample);
  window.diagAPI.stopLiveMonitor();
  startBtn.disabled = false; abortBtn.disabled = true;
  vramTestRunning = false;

  if (!res.supported) {
    badge.textContent = '지원 안 함'; badge.className = 'badge badge-bad';
    resultEl.textContent = res.reason;
    stageEl.textContent = '–';
    return;
  }

  allocEl.textContent = `${Math.round(res.allocatedMB)}MB 할당 / ${Math.round(res.verifiedMB)}MB 검사`;
  mismatchEl.textContent = res.mismatchWords === 0 ? '없음' : `${res.mismatchWords.toLocaleString()}워드`;
  stageEl.textContent = res.aborted ? '중단됨' : '완료';

  const summary = buildVramTestSummary({ res, baselineUsedMB, peakUsedMB, totalMB, smiAvailable });
  if (summary.smiText) smiEl.textContent = summary.smiText;
  badge.textContent = summary.badgeText;
  badge.className = summary.badgeClass;

  // 결과를 기록해두면 다음 전체 진단/점검 리포트가 GPU 근거로 반영한다(displayChecks와 같은 방식).
  const lines = [...summary.lines];
  try {
    const saved = await window.diagAPI.saveVramCheck({
      verdict: summary.verdict,
      mismatchWords: res.mismatchWords,
      contextLost: res.contextLost,
      aborted: res.aborted,
      allocatedMB: res.allocatedMB,
      coveredMB: summary.coveredMB,
      totalMB,
      residencyLevel: summary.residency.level,
    });
    renderVramLastCheck(saved);
    lines.push(summary.verdict === 'inconclusive'
      ? '이 결과는 기록되며, 전체 진단에서는 "판단 보류"로만 표시되고 정상/이상 어느 쪽으로도 반영되지 않습니다.'
      : '이 결과는 기록되어 다음 전체 진단과 판매용 점검 리포트에 GPU 근거로 반영됩니다.');
  } catch (err) {
    lines.push('결과를 기록하지 못했습니다(진단에는 반영되지 않습니다).');
  }
  resultEl.textContent = lines.join('\n');
});

// 앱을 다시 켰을 때도 마지막 검사 기록을 보여준다 — 진단에 반영되고 있는 값이 뭔지
// 화면에서 확인할 수 있어야 하기 때문.
function renderVramLastCheck(check) {
  const el = document.getElementById('vram-test-last');
  if (!el) return;
  if (!check) { el.textContent = '없음'; return; }
  const when = new Date(check.checkedAt).toLocaleString('ko-KR');
  const label = { pass: '이상 없음', issue: '이상 감지', inconclusive: '판단 보류' }[check.verdict] || check.verdict;
  const stale = Date.now() - new Date(check.checkedAt).getTime() >= 30 * 24 * 60 * 60 * 1000;
  el.textContent = `${label} (${when})${stale ? ' — 30일이 지나 진단에는 반영되지 않음' : ''}`;
}

window.diagAPI.getVramCheck().then(renderVramLastCheck).catch(() => {});

document.getElementById('vram-test-abort').addEventListener('click', () => {
  vramTestAbort = true;
});

/* ============================================================
   DISPLAY TESTS
============================================================ */
const deadBox = document.getElementById('deadpixel-box');
document.querySelectorAll('.swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    deadBox.style.background = sw.dataset.color;
    deadBox.textContent = '';
    if (deadBox.requestFullscreen) deadBox.requestFullscreen().catch(() => {});
  });
});
deadBox.addEventListener('click', () => {
  if (!document.fullscreenElement && deadBox.requestFullscreen) deadBox.requestFullscreen().catch(() => {});
});

const uniformBox = document.getElementById('uniform-box');
const uniformSlider = document.getElementById('uniform-slider');
uniformSlider.addEventListener('input', () => {
  const v = uniformSlider.value;
  uniformBox.style.background = `hsl(0,0%,${v}%)`;
  document.getElementById('uniform-label').textContent = v + '%';
});
uniformBox.addEventListener('click', () => {
  if (!document.fullscreenElement && uniformBox.requestFullscreen) uniformBox.requestFullscreen().catch(() => {});
});

function resizeCanvas(c) { c.width = c.clientWidth * 2; c.height = c.clientHeight * 2; c.getContext('2d').scale(2, 2); }

const ghostCanvas = document.getElementById('ghost-canvas');
resizeCanvas(ghostCanvas);
const gctx = ghostCanvas.getContext('2d');
let ghostX = 0, ghostDir = 1, ghostSpeed = 2;
document.getElementById('ghost-speed').addEventListener('input', (e) => {
  ghostSpeed = +e.target.value;
  const labels = { 1: '느림', 2: '보통', 3: '빠름', 4: '매우 빠름', 5: '최고 속도' };
  document.getElementById('ghost-speed-label').textContent = labels[ghostSpeed];
});
function animateGhost() {
  const w = ghostCanvas.clientWidth, h = ghostCanvas.clientHeight;
  if (document.getElementById('view-display').classList.contains('active')) {
    gctx.fillStyle = '#0E1116'; gctx.fillRect(0, 0, w, h);
    const barW = 18;
    ghostX += ghostDir * (ghostSpeed * 2.2);
    if (ghostX > w - barW || ghostX < 0) ghostDir *= -1;
    gctx.fillStyle = '#5FE38B';
    gctx.fillRect(ghostX, h / 2 - 26, barW, 52);
  }
  requestAnimationFrame(animateGhost);
}
animateGhost();

// 불량화소/잔상/균일도는 사람 눈으로만 판별 가능해서 자동 채점이 불가능하다. 그래서 사용자가
// 본 결과를 직접 기록하면, 그 기록을 전체 진단(DISPLAY 섹션)이 근거로 사용한다.
const checkVerdictKo = { pass: '이상 없음', issue: '이상 발견' };
function renderCheckStatus(el, check) {
  if (!check) { el.textContent = '아직 기록 없음'; el.className = 'check-record-status'; return; }
  const date = new Date(check.checkedAt).toLocaleString('ko-KR');
  el.textContent = `${checkVerdictKo[check.verdict]} · ${date}${check.note ? ` · "${check.note}"` : ''}`;
  el.className = 'check-record-status ' + check.verdict;
}

async function loadDisplayCheckStatuses() {
  const checks = await window.diagAPI.getDisplayChecks();
  document.querySelectorAll('.check-record').forEach((box) => {
    renderCheckStatus(box.querySelector('.check-record-status'), checks[box.dataset.testId]);
  });
}
loadDisplayCheckStatuses();

document.querySelectorAll('.check-record').forEach((box) => {
  const testId = box.dataset.testId;
  const statusEl = box.querySelector('.check-record-status');
  const noteEl = box.querySelector('.check-note');
  box.querySelector('.check-pass-btn').addEventListener('click', async () => {
    const check = await window.diagAPI.saveDisplayCheck({ testId, verdict: 'pass' });
    renderCheckStatus(statusEl, check);
    noteEl.value = '';
  });
  box.querySelector('.check-issue-btn').addEventListener('click', async () => {
    const check = await window.diagAPI.saveDisplayCheck({ testId, verdict: 'issue', note: noteEl.value.trim() });
    renderCheckStatus(statusEl, check);
  });
});

/* ============================================================
   MOUSE TESTS
============================================================ */
const dblCanvas = document.getElementById('dbl-canvas');
resizeCanvas(dblCanvas);
const dctx = dblCanvas.getContext('2d');
let dblIntervals = [], dblLast = null, dblGhosts = 0, dblThreshold = 50;

function drawDbl() {
  const w = dblCanvas.clientWidth, h = dblCanvas.clientHeight;
  dctx.clearRect(0, 0, w, h);
  dctx.fillStyle = '#0E1116'; dctx.fillRect(0, 0, w, h);
  dctx.strokeStyle = '#1E2430'; dctx.lineWidth = 1;
  for (let x = 0; x < w; x += 24) { dctx.beginPath(); dctx.moveTo(x, 0); dctx.lineTo(x, h); dctx.stroke(); }
  const maxMs = 300;
  const thY = h - (dblThreshold / maxMs) * h;
  dctx.strokeStyle = '#F5C356'; dctx.setLineDash([4, 4]);
  dctx.beginPath(); dctx.moveTo(0, thY); dctx.lineTo(w, thY); dctx.stroke();
  dctx.setLineDash([]);
  const items = dblIntervals.slice(-40);
  const bw = w / 40;
  items.forEach((it, i) => {
    const x = i * bw + bw * 0.2;
    const barH = Math.min(it.ms / maxMs, 1) * h;
    dctx.fillStyle = it.ghost ? '#FF6B7F' : '#5FE38B';
    dctx.fillRect(x, h - barH, bw * 0.6, barH);
  });
}
drawDbl();

document.getElementById('dbl-threshold').addEventListener('input', (e) => {
  dblThreshold = +e.target.value;
  document.getElementById('dbl-threshold-label').textContent = dblThreshold + ' ms';
  drawDbl();
});
document.getElementById('dbl-pad').addEventListener('contextmenu', (e) => e.preventDefault());
document.getElementById('dbl-pad').addEventListener('mousedown', (e) => {
  e.preventDefault();
  const now = performance.now();
  if (dblLast !== null) {
    const ms = now - dblLast;
    const ghost = ms < dblThreshold;
    dblIntervals.push({ ms, ghost });
    if (ghost) dblGhosts++;
  }
  dblLast = now;
  document.getElementById('dbl-total').textContent = dblIntervals.length + 1;
  document.getElementById('dbl-ghost').textContent = dblGhosts;
  document.getElementById('dbl-badge').textContent = dblGhosts > 0 ? '고스트 클릭 감지됨' : (dblIntervals.length < 20 ? `측정 중 (${dblIntervals.length}/20)` : '정상');
  document.getElementById('dbl-badge').className = 'badge ' + (dblGhosts > 0 ? 'badge-bad' : 'badge-good');
  drawDbl();
});
document.getElementById('dbl-reset').addEventListener('click', () => {
  dblIntervals = []; dblLast = null; dblGhosts = 0;
  document.getElementById('dbl-total').textContent = '0';
  document.getElementById('dbl-ghost').textContent = '0';
  document.getElementById('dbl-badge').textContent = '대기 중';
  document.getElementById('dbl-badge').className = 'badge badge-good';
  drawDbl();
});

const btnCounts = { 0: 0, 1: 0, 2: 0 };
const btnMap = { 0: 'btn-left', 1: 'btn-mid', 2: 'btn-right' };
const cntMap = { 0: 'cnt-left', 1: 'cnt-mid', 2: 'cnt-right' };
document.querySelectorAll('.click-btn').forEach((el) => {
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (btnCounts[e.button] === undefined) return;
    btnCounts[e.button]++;
    document.getElementById(cntMap[e.button]).textContent = btnCounts[e.button];
    const t = document.getElementById(btnMap[e.button]);
    t.classList.add('flash');
    setTimeout(() => t.classList.remove('flash'), 120);
  });
});

let scrollCount = 0, scrollDoubles = 0, lastScrollTime = null;
document.getElementById('scroll-pad').addEventListener('wheel', (e) => {
  e.preventDefault();
  const now = performance.now();
  scrollCount++;
  document.getElementById('scroll-count').textContent = scrollCount;
  if (lastScrollTime !== null && (now - lastScrollTime) < 10) {
    scrollDoubles++;
    document.getElementById('scroll-double').textContent = scrollDoubles;
  }
  lastScrollTime = now;
}, { passive: false });

/* ============================================================
   KEYBOARD TEST
============================================================ */
const kbLayout = [
  [['`', 'Backquote'], ['1', 'Digit1'], ['2', 'Digit2'], ['3', 'Digit3'], ['4', 'Digit4'], ['5', 'Digit5'], ['6', 'Digit6'], ['7', 'Digit7'], ['8', 'Digit8'], ['9', 'Digit9'], ['0', 'Digit0'], ['-', 'Minus'], ['=', 'Equal'], ['Bksp', 'Backspace', 'wide']],
  [['Tab', 'Tab', 'wide'], ['Q', 'KeyQ'], ['W', 'KeyW'], ['E', 'KeyE'], ['R', 'KeyR'], ['T', 'KeyT'], ['Y', 'KeyY'], ['U', 'KeyU'], ['I', 'KeyI'], ['O', 'KeyO'], ['P', 'KeyP'], ['[', 'BracketLeft'], [']', 'BracketRight']],
  [['Caps', 'CapsLock', 'wide'], ['A', 'KeyA'], ['S', 'KeyS'], ['D', 'KeyD'], ['F', 'KeyF'], ['G', 'KeyG'], ['H', 'KeyH'], ['J', 'KeyJ'], ['K', 'KeyK'], ['L', 'KeyL'], [';', 'Semicolon'], ['Enter', 'Enter', 'wider']],
  [['Shift', 'ShiftLeft', 'wider'], ['Z', 'KeyZ'], ['X', 'KeyX'], ['C', 'KeyC'], ['V', 'KeyV'], ['B', 'KeyB'], ['N', 'KeyN'], ['M', 'KeyM'], [',', 'Comma'], ['.', 'Period'], ['Shift', 'ShiftRight', 'wider']],
  [['Ctrl', 'ControlLeft', 'wide'], ['Alt', 'AltLeft', 'wide'], ['Space', 'Space', 'space'], ['Alt', 'AltRight', 'wide'], ['Ctrl', 'ControlRight', 'wide']],
];
const kbVis = document.getElementById('keyboard-vis');
const keyElByCode = {};
kbLayout.forEach((row) => {
  const rowEl = document.createElement('div'); rowEl.className = 'kb-row';
  row.forEach(([label, code, size]) => {
    const el = document.createElement('div');
    el.className = 'key' + (size ? ' ' + size : '');
    el.textContent = label;
    rowEl.appendChild(el);
    keyElByCode[code] = el;
  });
  kbVis.appendChild(rowEl);
});

let kbTestedSet = new Set(), kbChatterCount = 0;
const kbUpTimestamps = {};
const kbLog = document.getElementById('kb-log');
function addLog(text, isChatter) {
  const row = document.createElement('div');
  row.className = 'log-row' + (isChatter ? ' chatter' : '');
  row.innerHTML = `<span class="t">${new Date().toLocaleTimeString('ko-KR', { hour12: false })}</span><span>${text}</span>`;
  kbLog.prepend(row);
  while (kbLog.children.length > 20) kbLog.removeChild(kbLog.lastChild);
}
window.addEventListener('keydown', (e) => {
  const el = keyElByCode[e.code];
  document.getElementById('kb-last').textContent = e.key === ' ' ? 'Space' : e.key;
  if (!e.repeat) {
    let chatterFlag = false;
    if (kbUpTimestamps[e.code] !== undefined && (performance.now() - kbUpTimestamps[e.code]) < 60) {
      chatterFlag = true; kbChatterCount++;
      document.getElementById('kb-chatter').textContent = kbChatterCount;
    }
    if (el) {
      el.classList.add('active');
      if (chatterFlag) el.classList.add('chatter');
      if (!kbTestedSet.has(e.code)) { kbTestedSet.add(e.code); document.getElementById('kb-tested').textContent = kbTestedSet.size; }
    }
    addLog(`keydown ${e.code}${chatterFlag ? ' ⚠ 채터링 의심' : ''}`, chatterFlag);
  }
});
window.addEventListener('keyup', (e) => {
  const el = keyElByCode[e.code];
  kbUpTimestamps[e.code] = performance.now();
  if (el) { el.classList.remove('active'); el.classList.add('tested'); setTimeout(() => el.classList.remove('chatter'), 600); }
});
document.getElementById('kb-reset').addEventListener('click', () => {
  kbTestedSet = new Set(); kbChatterCount = 0;
  document.getElementById('kb-tested').textContent = '0';
  document.getElementById('kb-chatter').textContent = '0';
  document.getElementById('kb-last').textContent = '–';
  kbLog.innerHTML = '';
  Object.values(keyElByCode).forEach((el) => el.classList.remove('tested', 'active', 'chatter'));
});

/* ============================================================
   NETWORK SPEED TEST
============================================================ */
const NET_HOST = 'https://speed.cloudflare.com';
async function netPing(rounds = 8) {
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    try { await fetch(`${NET_HOST}/__down?bytes=0&cb=${Math.random()}`, { cache: 'no-store' }); times.push(performance.now() - t0); } catch (e) {}
  }
  if (!times.length) throw new Error('ping failed');
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const jitter = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length);
  return { avg, jitter };
}
async function netDownload(durationMs, onProgress) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), durationMs);
  const start = performance.now();
  let loaded = 0;
  try {
    const res = await fetch(`${NET_HOST}/__down?bytes=100000000&cb=${Math.random()}`, { signal: controller.signal, cache: 'no-store' });
    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      onProgress((loaded * 8) / ((performance.now() - start) / 1000) / 1e6);
    }
  } catch (e) {}
  clearTimeout(timer);
  const elapsed = performance.now() - start;
  if (!loaded) throw new Error('download failed');
  return (loaded * 8) / (elapsed / 1000) / 1e6;
}
function netUpload(durationMs, onProgress) {
  return new Promise((resolve, reject) => {
    const size = 20 * 1000 * 1000;
    const blob = new Blob([new Uint8Array(size)]);
    const xhr = new XMLHttpRequest();
    const start = performance.now();
    xhr.open('POST', `${NET_HOST}/__up`);
    xhr.upload.onprogress = (e) => { const el = performance.now() - start; if (el > 0) onProgress((e.loaded * 8) / (el / 1000) / 1e6); };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.onload = () => resolve((size * 8) / ((performance.now() - start) / 1000) / 1e6);
    xhr.timeout = durationMs + 8000;
    xhr.send(blob);
  });
}
document.getElementById('net-start').addEventListener('click', async () => {
  const badge = document.getElementById('net-badge');
  const startBtn = document.getElementById('net-start');
  startBtn.disabled = true; badge.textContent = '측정 중'; badge.className = 'badge badge-warn';
  try {
    const ping = await netPing();
    document.getElementById('net-ping').innerHTML = `${ping.avg.toFixed(0)}<span class="unit">ms</span>`;
    document.getElementById('net-jitter').textContent = `지터 ${ping.jitter.toFixed(1)}ms`;
  } catch (e) { document.getElementById('net-ping').innerHTML = '오류'; }
  try {
    const el = document.getElementById('net-down');
    const mbps = await netDownload(6000, (c) => { el.innerHTML = `${c.toFixed(1)}<span class="unit">Mbps</span>`; });
    el.innerHTML = `${mbps.toFixed(1)}<span class="unit">Mbps</span>`;
    document.getElementById('net-down-sub').textContent = '측정 완료';
  } catch (e) { document.getElementById('net-down-sub').textContent = '측정 실패'; }
  try {
    const el = document.getElementById('net-up');
    const mbps = await netUpload(6000, (c) => { el.innerHTML = `${c.toFixed(1)}<span class="unit">Mbps</span>`; });
    el.innerHTML = `${mbps.toFixed(1)}<span class="unit">Mbps</span>`;
    document.getElementById('net-up-sub').textContent = '측정 완료';
  } catch (e) { document.getElementById('net-up-sub').textContent = '측정 실패'; }
  badge.textContent = '완료'; badge.className = 'badge badge-good';
  startBtn.disabled = false;
});

/* ============================================================
   LIVE MONITORING
   메인 프로세스가 1초 간격으로 보내주는 센서 값을 받아 숫자판/그래프를 갱신한다.
   "기록 시작"을 누른 동안의 샘플은 별도로 모아뒀다가 로그로 보여주고 JSON으로 저장할 수 있다.

   preload.js의 onLiveSample은 리스너를 하나만 유지한다(등록할 때마다 이전 걸 덮어씀).
   실시간 모니터링 화면과 GPU 부하 테스트가 둘 다 같은 live-sample을 필요로 해서,
   여기서 한 번만 등록하고 내부적으로 여러 구독자에게 나눠주는 방식으로 바꾼다.
============================================================ */
const liveSampleListeners = new Set();
window.diagAPI.onLiveSample((sample) => {
  liveSampleListeners.forEach((fn) => fn(sample));
});

const LIVE_BUF_LEN = 60; // 1초 간격 기준 최근 1분
const liveBuf = { cpuUsage: [], cpuTemp: [], gpuUsage: [], gpuTemp: [], ram: [] };
let liveRecording = false;
let liveRecordedSamples = [];

function pushLiveBuf(arr, v) {
  arr.push(v);
  if (arr.length > LIVE_BUF_LEN) arr.shift();
}

// values 안의 null/undefined(센서 미지원)는 0으로 표시하지 않고 이전 값이 이어지는 것처럼
// 보이면 오해를 살 수 있어, 그냥 끊어 그린다(선을 잇지 않음).
function drawLiveChart(canvas, lines) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== w * 2 || canvas.height !== h * 2) { canvas.width = w * 2; canvas.height = h * 2; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(120,120,130,.15)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  lines.forEach(({ values, color }) => {
    if (values.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let started = false;
    values.forEach((v, i) => {
      const x = (i / (values.length - 1)) * w;
      if (v === null || v === undefined) { started = false; return; }
      const y = h - (Math.max(0, Math.min(100, v)) / 100) * h;
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    });
    ctx.stroke();
  });
}

function renderLiveMetric(id, value, unit, digits = 0) {
  document.getElementById(id).innerHTML = value === null || value === undefined
    ? `–<span class="unit">${unit}</span>`
    : `${value.toFixed(digits)}<span class="unit">${unit}</span>`;
}

const liveRecordLog = document.getElementById('live-record-log');
function addLiveRecordLog(sample) {
  const row = document.createElement('div');
  row.className = 'log-row';
  const parts = [`CPU ${sample.cpu.loadPercent}%${sample.cpu.tempC !== null ? ' ' + sample.cpu.tempC + '°C' : ''}`];
  if (sample.gpu) parts.push(`GPU ${Math.round(sample.gpu.loadPercent)}% ${Math.round(sample.gpu.tempC)}°C`);
  parts.push(`RAM ${sample.ram.usedPercent}%`);
  row.innerHTML = `<span class="t">${new Date(sample.t).toLocaleTimeString('ko-KR', { hour12: false })}</span><span>${parts.join(' · ')}</span>`;
  liveRecordLog.prepend(row);
  while (liveRecordLog.children.length > 200) liveRecordLog.removeChild(liveRecordLog.lastChild);
}

liveSampleListeners.add((sample) => {
  // 화면 밖에 있을 때는 DOM 갱신/캔버스 다시 그리기를 건너뛴다(GPU 부하 테스트 중에도
  // 이 리스너는 계속 살아있으므로, 보이지 않을 때 불필요한 작업을 하지 않기 위함).
  if (!document.getElementById('view-live').classList.contains('active')) return;

  renderLiveMetric('live-cpu-usage', sample.cpu.loadPercent, '%');
  renderLiveMetric('live-cpu-temp', sample.cpu.tempC, '°C');
  renderLiveMetric('live-cpu-clock', sample.cpu.clockGHz, 'GHz', 2);
  pushLiveBuf(liveBuf.cpuUsage, sample.cpu.loadPercent);
  pushLiveBuf(liveBuf.cpuTemp, sample.cpu.tempC);
  drawLiveChart(document.getElementById('live-cpu-chart'), [
    { values: liveBuf.cpuUsage, color: '#6E56CF' },
    { values: liveBuf.cpuTemp, color: '#E0173A' },
  ]);

  const gpuUnsupported = document.getElementById('live-gpu-unsupported');
  const gpuBody = document.getElementById('live-gpu-body');
  if (sample.gpu) {
    gpuUnsupported.style.display = 'none';
    gpuBody.style.display = 'block';
    renderLiveMetric('live-gpu-usage', sample.gpu.loadPercent, '%');
    renderLiveMetric('live-gpu-temp', sample.gpu.tempC, '°C');
    renderLiveMetric('live-gpu-clock', sample.gpu.clockMHz, 'MHz');
    pushLiveBuf(liveBuf.gpuUsage, sample.gpu.loadPercent);
    pushLiveBuf(liveBuf.gpuTemp, sample.gpu.tempC);
    drawLiveChart(document.getElementById('live-gpu-chart'), [
      { values: liveBuf.gpuUsage, color: '#6E56CF' },
      { values: liveBuf.gpuTemp, color: '#E0173A' },
    ]);
  } else {
    gpuUnsupported.style.display = 'block';
    gpuBody.style.display = 'none';
  }

  renderLiveMetric('live-ram-usage', sample.ram.usedPercent, '%');
  pushLiveBuf(liveBuf.ram, sample.ram.usedPercent);
  drawLiveChart(document.getElementById('live-ram-chart'), [{ values: liveBuf.ram, color: '#6E56CF' }]);

  if (liveRecording) {
    liveRecordedSamples.push(sample);
    addLiveRecordLog(sample);
  }
});

document.getElementById('live-record-start').addEventListener('click', () => {
  liveRecording = true;
  liveRecordedSamples = [];
  liveRecordLog.innerHTML = '';
  document.getElementById('live-record-start').disabled = true;
  document.getElementById('live-record-stop').disabled = false;
  document.getElementById('live-record-save').disabled = true;
});
document.getElementById('live-record-stop').addEventListener('click', () => {
  liveRecording = false;
  document.getElementById('live-record-start').disabled = false;
  document.getElementById('live-record-stop').disabled = true;
  document.getElementById('live-record-save').disabled = liveRecordedSamples.length === 0;
});
document.getElementById('live-record-save').addEventListener('click', async () => {
  const btn = document.getElementById('live-record-save');
  btn.disabled = true; btn.textContent = '저장 중...';
  const res = await window.diagAPI.saveLiveRecording({ samples: liveRecordedSamples });
  btn.textContent = res.saved ? '저장 완료' : '기록 저장 (JSON)';
  if (res.saved) setTimeout(() => { btn.textContent = '기록 저장 (JSON)'; btn.disabled = false; }, 2000);
  else btn.disabled = false;
});
