// vramChecks.js
// VRAM 압박·무결성 테스트는 WebGL이 필요해서 렌더러에서만 돌릴 수 있다(메인 프로세스에는 GPU
// 컨텍스트가 없다). 그래서 CPU/저장장치/RAM 부하 테스트처럼 진단 중에 바로 실행할 수가 없고,
// displayChecks와 같은 방식 — "따로 실행한 결과를 기록해두고 다음 진단에서 근거로 반영" — 을 쓴다.
//
// 저장하는 값은 렌더러가 이미 판정한 결과(verdict)와 그 근거 수치다. 판정 로직을 여기서 다시
// 구현하면 두 곳이 어긋날 수 있어서, 판정은 렌더러의 buildVramTestSummary 한 곳에만 둔다.

const { createLatestCheckStore, DEFAULT_STALE_MS } = require('./latestCheckStore');

// pass         = 불일치 없음 + 실제로 VRAM에 올라간 것까지 확인됨
// issue        = 불일치가 나왔거나 테스트 도중 그래픽 컨텍스트가 손실됨
// inconclusive = 중단됐거나, 되읽기 실패, 또는 VRAM에 올라갔는지 확인이 안 됨(판단 보류)
const VERDICTS = ['pass', 'issue', 'inconclusive'];

const store = createLatestCheckStore({
  fileName: 'vram-check.json',
  normalize(result) {
    if (!VERDICTS.includes(result.verdict)) throw new Error(`unknown verdict: ${result.verdict}`);
    return {
      verdict: result.verdict,
      mismatchWords: Number(result.mismatchWords) || 0,
      contextLost: !!result.contextLost,
      aborted: !!result.aborted,
      allocatedMB: Number(result.allocatedMB) || 0,
      // coveredMB = nvidia-smi 사용량 증가로 "실제 VRAM이었다"고 확인된 범위. 확인 못 했으면 null.
      coveredMB: result.coveredMB === null || result.coveredMB === undefined ? null : Number(result.coveredMB),
      totalMB: result.totalMB === null || result.totalMB === undefined ? null : Number(result.totalMB),
      residencyLevel: result.residencyLevel || 'unknown',
      gpuModel: result.gpuModel || null,
    };
  },
});

module.exports = {
  loadVramCheck: store.load,
  saveVramCheck: store.save,
  activeVramCheck: store.active,
  VERDICTS,
  STALE_MS: DEFAULT_STALE_MS,
};
