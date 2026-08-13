// baselineStore.js
// 기준선(baseline.js가 만든 record)을 userData에 저장/조회한다.
// vramChecks.js / gpuStressChecks.js와 같은 latestCheckStore 패턴이다 — 누적 이력이 아니라
// "현재 유효한 기준선 1건"만 유지한다.
//
// 다만 유효기간 처리가 다르다. VRAM/GPU 검사는 30일이 지나면 없는 것으로 취급하지만,
// 기준선은 **시간이 지나도 버리지 않는다.** 기준선의 존재 이유가 "몇 달에 걸쳐 서서히
// 나빠지는 변화를 잡는 것"인데 오래됐다고 버리면 정작 잡아야 할 것을 못 잡는다.
// 대신 baseline.js의 compareToBaseline이 나이(ageDays)를 함께 돌려주고,
// 오래된 기준선은 근거 줄에 "N일 전 측정"이라고 명시한다.

const { createLatestCheckStore } = require('./latestCheckStore');

// 숫자 아니면 null. 렌더러/외부에서 이상한 값이 들어와도 파일에 그대로 굳지 않게 한다.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const store = createLatestCheckStore({
  fileName: 'baseline.json',
  staleMs: Number.POSITIVE_INFINITY, // 시간으로는 만료시키지 않는다 (위 주석 참고)
  normalize(record) {
    return {
      cpuModel: record.cpuModel || null,
      gpuModel: record.gpuModel || null,
      sampleCount: num(record.sampleCount),
      idleSampleCount: num(record.idleSampleCount),
      durationSec: num(record.durationSec),
      cpuIdleTempC: num(record.cpuIdleTempC),
      cpuIdleLoadPercent: num(record.cpuIdleLoadPercent),
      cpuIdleClockGHz: num(record.cpuIdleClockGHz),
      cpuIdleTempSpreadC: num(record.cpuIdleTempSpreadC),
      gpuIdleTempC: num(record.gpuIdleTempC),
      gpuIdleLoadPercent: num(record.gpuIdleLoadPercent),
      memIdleUsedPercent: num(record.memIdleUsedPercent),
      gpuNote: record.gpuNote || null,
    };
  },
});

module.exports = {
  loadBaseline: store.load,
  saveBaseline: store.save,
  activeBaseline: store.active,
  clearBaseline: store.clear,
  baselineFilePath: store.filePath,
};
