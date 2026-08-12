// history.js
// 진단 리포트를 사용자 데이터 폴더에 JSON으로 누적 저장해서
// "시간에 따른 시스템 악화"를 나중에 비교할 수 있도록 한다. (기획서 21장)

const fs = require('fs');
const path = require('path');

function historyFilePath(userDataDir) {
  return path.join(userDataDir, 'diagnosis-history.json');
}

function loadHistory(userDataDir) {
  const file = historyFilePath(userDataDir);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return [];
  }
}

// 리포트 전체를 다 저장하면 파일이 금방 커지므로, 기록에는 핵심 요약값만 남긴다.
function appendHistory(userDataDir, report, raw) {
  const history = loadHistory(userDataDir);
  const entry = {
    timestamp: report.timestamp,
    headline: report.headline,
    totalWarnings: report.totalWarnings,
    totalCritical: report.totalCritical,
    sectionStatus: Object.fromEntries(report.sections.map((s) => [s.category, s.status])),
    metrics: {
      cpuTempC: raw.cpu?.tempC ?? null,
      cpuLoadPercent: raw.cpu?.loadPercent ?? null,
      gpuTempC: raw.gpu?.nvidia?.tempC ?? null,
      gpuLoadPercent: raw.gpu?.nvidia?.loadPercent ?? null,
      memUsedPercent: raw.memory?.usedPercent ?? null,
      pingAvgMs: raw.network?.ping?.avgMs ?? null,
    },
  };
  history.push(entry);
  // 최근 200회까지만 보관
  const trimmed = history.slice(-200);
  fs.writeFileSync(historyFilePath(userDataDir), JSON.stringify(trimmed, null, 2), 'utf-8');
  return entry;
}

function clearHistory(userDataDir) {
  const file = historyFilePath(userDataDir);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

module.exports = { loadHistory, appendHistory, clearHistory };
