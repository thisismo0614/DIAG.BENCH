// compare.js
// 직전 진단 기록(history.js가 저장한 요약)과 이번 진단의 핵심 수치를 비교해서
// "GPU 최고 온도 87°C → 76°C (11°C 개선)" 같은 전/후 비교를 만든다.
// (기획서 "문제 → 조치 → 재검사" 철학을 완성하는 기능)

function round(n, d = 1) {
  if (n === null || n === undefined) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// lowerIsBetter: 이 지표는 낮을수록 좋은지(온도, 핑 등) 여부.
// neutral: true인 지표는 "낮을수록 좋다/높을수록 좋다"를 단정할 수 없는 지표다.
// 예: GPU 부하 98%는 게임 중이면 정상(GPU를 잘 쓰고 있음)이고, 유휴 상태면 이상일 수 있다.
// 맥락 없이 "낮아졌으니 개선"이라고 말하면 오히려 잘못된 정보를 주므로,
// neutral 지표는 개선/악화 판정 없이 "변화"로만 보여준다.
const METRIC_DEFS = [
  { key: 'cpuTempC', label: 'CPU 최고 온도', unit: '°C', lowerIsBetter: true },
  { key: 'cpuLoadPercent', label: 'CPU 부하', unit: '%', neutral: true },
  { key: 'gpuTempC', label: 'GPU 최고 온도', unit: '°C', lowerIsBetter: true },
  { key: 'gpuLoadPercent', label: 'GPU 부하', unit: '%', neutral: true },
  { key: 'memUsedPercent', label: '메모리 사용률', unit: '%', lowerIsBetter: true },
  { key: 'pingAvgMs', label: '평균 핑', unit: 'ms', lowerIsBetter: true },
];

// 의미 없는 미세한 변화까지 "개선/악화"로 보여주면 신뢰도가 떨어지므로,
// 지표별로 최소 변화폭(무시 임계값)을 둔다.
const IGNORE_THRESHOLD = {
  cpuTempC: 2, gpuTempC: 2, cpuLoadPercent: 5, gpuLoadPercent: 5, memUsedPercent: 3, pingAvgMs: 5,
};

function buildComparison(prevEntry, currentMetrics) {
  if (!prevEntry || !prevEntry.metrics) return null;

  const deltas = [];
  METRIC_DEFS.forEach(({ key, label, unit, lowerIsBetter, neutral }) => {
    const prevVal = prevEntry.metrics[key];
    const curVal = currentMetrics[key];
    if (prevVal === null || prevVal === undefined || curVal === null || curVal === undefined) return;
    const diff = curVal - prevVal;
    if (Math.abs(diff) < (IGNORE_THRESHOLD[key] || 1)) return;
    const improved = neutral ? null : (lowerIsBetter ? diff < 0 : diff > 0);
    deltas.push({
      key, label, unit,
      prevVal: round(prevVal),
      curVal: round(curVal),
      diff: round(diff),
      improved, // true=개선, false=악화, null=중립(맥락에 따라 다름, 판단하지 않음)
      neutral: !!neutral,
    });
  });

  return {
    previousTimestamp: prevEntry.timestamp,
    hasChanges: deltas.length > 0,
    deltas,
  };
}

module.exports = { buildComparison };
