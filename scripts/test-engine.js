// Electron GUI 없이 진단 엔진만 빠르게 확인하고 싶을 때 사용.
// 실행: npm run test-engine
const collectors = require('../src/engine/collectors');
const { buildReport } = require('../src/engine/rules');

(async () => {
  console.log('진단 수집 중... (GPU 트렌드 측정 때문에 몇 초 걸립니다)\n');

  const cpu = await collectors.collectCpu();
  const memory = await collectors.collectMemory();
  const gpu = await collectors.collectGpu();
  const gpuTrend = gpu.supported ? await collectors.sampleGpuTrend(4, 700) : null;
  const storage = await collectors.collectStorage();
  const network = await collectors.collectNetwork();
  const display = await collectors.collectDisplay();
  const system = await collectors.collectSystem();

  const report = buildReport({ cpu, memory, gpu, gpuTrend, storage, network, display, system });

  console.log('========== RAW DATA ==========');
  console.log(JSON.stringify({ cpu, memory, gpu, storage, network, display, system }, null, 2));
  console.log('\n========== REPORT ==========');
  console.log(JSON.stringify(report, null, 2));
})();
