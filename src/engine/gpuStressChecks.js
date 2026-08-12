// gpuStressChecks.js
// GPU 부하 테스트도 WebGL 렌더링으로 부하를 만들기 때문에 렌더러에서만 실행할 수 있다.
// vramChecks와 똑같이 "따로 실행한 결과를 기록해두고 다음 진단에서 근거로 반영"하는 방식.
//
// 부하 테스트는 진단 화면의 수동 관찰(gpuTrend)과 성격이 다르다: 부하를 우리가 직접 걸었기
// 때문에 "고부하 상태에서 무슨 일이 일어났는지"를 통제된 조건에서 본 값이다. 그래서 같은
// 스로틀링이라도 근거로서의 무게가 다르고, 진단에서도 따로 서술한다.

const { createLatestCheckStore, DEFAULT_STALE_MS } = require('./latestCheckStore');

// pass         = 마지막 단계까지 완주했고 스로틀링 근거 없음
// issue        = 스로틀링이 확인됐거나 안전 한계 온도에 도달해 자동 중단됨
// inconclusive = GPU 센서 값을 못 읽었거나(비 NVIDIA 등) 사용자가 중간에 멈춤
const VERDICTS = ['pass', 'issue', 'inconclusive'];

const store = createLatestCheckStore({
  fileName: 'gpu-stress-check.json',
  normalize(result) {
    if (!VERDICTS.includes(result.verdict)) throw new Error(`unknown verdict: ${result.verdict}`);
    const num = (v) => (v === null || v === undefined ? null : Number(v));
    return {
      verdict: result.verdict,
      throttleSuspected: !!result.throttleSuspected,
      // 'safety-temp'(안전 한계 도달로 자동 중단) | 'user'(사용자가 중단) | null
      abortReason: result.abortReason || null,
      maxTempC: num(result.maxTempC),
      maxLoadPercent: num(result.maxLoadPercent),
      // 최고 부하 구간(90% 이상)에서의 클럭 변화 — 스로틀링 판정의 실제 근거값
      highLoadStartClockMHz: num(result.highLoadStartClockMHz),
      highLoadEndClockMHz: num(result.highLoadEndClockMHz),
      highLoadStartTempC: num(result.highLoadStartTempC),
      highLoadEndTempC: num(result.highLoadEndTempC),
      reachedStagePercent: num(result.reachedStagePercent),
      safetyTempC: num(result.safetyTempC),
      gpuModel: result.gpuModel || null,
    };
  },
});

module.exports = {
  loadGpuStressCheck: store.load,
  saveGpuStressCheck: store.save,
  activeGpuStressCheck: store.active,
  VERDICTS,
  STALE_MS: DEFAULT_STALE_MS,
};
