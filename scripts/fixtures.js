// fixtures.js
// "이런 상태의 PC를 검사하면 이런 등급이 나와야 한다"를 고정해두는 시나리오 모음.
//
// 이게 있는 이유: 진단 프로그램에서 가장 위험한 회귀는 기능이 죽는 게 아니라
// **문제가 있는데 정상이라고 말하는 것**이다. 그런 회귀는 조용히 통과하기 때문에
// 시나리오를 통째로 고정해두지 않으면 알아채기 어렵다.
//
// 각 fixture는 buildReport()에 그대로 넣을 수 있는 형태다.

function base(overrides = {}) {
  return {
    cpu: { model: 'Test CPU', loadPercent: 10, tempC: 45, clockGHz: 3.5 },
    cpuTrend: null,
    memory: { totalGB: 16, usedGB: 4, availableGB: 12, usedPercent: 25, swapUsedGB: 0, swapTotalGB: 0 },
    gpu: { controllers: [{ model: 'Test GPU' }], supported: true, nvidia: { loadPercent: 5, tempC: 40, clockMHz: 1500, vramUsedMB: 500, vramTotalMB: 8192 } },
    gpuTrend: null,
    storage: {
      volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }],
      disks: [], smart: [{ device: '/dev/sda', healthy: true, type: 'nvme' }],
      smartctlAvailable: true, io: null,
    },
    network: { ping: { avgMs: 20, jitterMs: 3, lossPercent: 0 } },
    display: [{ model: 'Test Monitor', resolutionX: 1920, resolutionY: 1080, refreshRateHz: 144 }],
    system: { platform: 'win32', distro: 'Windows 11', driverErrors: [] },
    symptom: 'full',
    eventLog: { supported: true, events: [], counts: [], totalCount: 0, days: 7, maxEvents: 50, truncated: false, error: null },
    ...overrides,
  };
}

// 이벤트 로그를 provider/개수로 간단히 만들기 위한 헬퍼.
// counts(전체 집계)와 events(표시용 일부)를 함께 채워서 실제 수집 결과와 같은 모양으로 만든다.
function withEvents(spec) {
  const PROVIDERS = {
    // 진짜 비정상 종료는 Kernel-Power ID 41 하나뿐이다.
    kernelPower: { provider: 'Microsoft-Windows-Kernel-Power', id: 41, level: 'Critical', message: 'The system has rebooted without cleanly shutting down first.' },
    // 아래 셋은 provider가 같지만 **정상 동작**이다. 예전에 이걸 비정상 종료로 세던 오탐이 있었다.
    sleepEnter: { provider: 'Microsoft-Windows-Kernel-Power', id: 42, level: 'Information', message: 'The system is entering sleep.' },
    sleepResume: { provider: 'Microsoft-Windows-Kernel-Power', id: 107, level: 'Information', message: 'The system has resumed from sleep.' },
    shutdownNormal: { provider: 'Microsoft-Windows-Kernel-Power', id: 109, level: 'Information', message: 'The kernel power manager has initiated a shutdown transition.' },
    whea: { provider: 'Microsoft-Windows-WHEA-Logger', id: 18, level: 'Error', message: 'A fatal hardware error has occurred.' },
    wheaCorrected: { provider: 'Microsoft-Windows-WHEA-Logger', id: 17, level: 'Warning', message: 'A corrected hardware error has occurred.' },
    bugcheck: { provider: 'BugCheck', id: 1001, level: 'Error', message: 'The computer has rebooted from a bugcheck.' },
    display: { provider: 'Display', id: 4101, level: 'Warning', message: 'Display driver stopped responding and has recovered.' },
    disk: { provider: 'disk', id: 51, level: 'Warning', message: 'An error was detected on device during a paging operation.' },
    appError: { provider: 'Application Error', id: 1000, level: 'Error', message: 'Faulting application name: game.exe' },
  };
  const counts = [];
  const events = [];
  let total = 0;
  Object.entries(spec).forEach(([key, count]) => {
    const p = PROVIDERS[key];
    if (!p || !count) return;
    total += count;
    counts.push({ provider: p.provider, id: p.id, level: p.level, count, latest: '2026-08-10T12:00:00Z' });
    // 표시용 목록은 실제 수집처럼 일부만 담는다(최대 3건) — 진단이 events.length에
    // 의존하면 여기서 바로 드러난다.
    for (let i = 0; i < Math.min(count, 3); i++) {
      events.push({ time: '2026-08-10T12:00:00Z', id: p.id, provider: p.provider, level: p.level, message: p.message });
    }
  });
  return { supported: true, events, counts, totalCount: total, days: 7, maxEvents: 50, truncated: total > events.length, error: null };
}

const passingCpuStress = {
  completed: true, aborted: false, abortReason: null, abortKind: null, workerError: null,
  durationSec: 15, requestedDurationSec: 15, effectiveDurationSec: 15, coreCount: 8, workerCount: 8,
  tempSensorAvailable: true, safetyMode: 'temperature', safetyTempC: 95,
  startTempC: 42, maxTempC: 68, minClockGHz: 3.4, maxClockGHz: 3.6, maxLoadPercent: 99,
  loadAchieved: true, samples: 15, clockDroppedUnderLoad: false,
};
const passingStorageTest = {
  sizeMB: 150, writeMBps: 480, readMBps: 1200, completed: true, error: null, errorStage: null,
  ioErrors: 0, verifyMismatch: false, bytesRead: 150 * 1024 * 1024, freeSpaceChecked: true,
};
const passingRamTest = { sizeMB: 256, errors: 0, passed: true, completed: true, error: null, patternsRun: 3, firstErrorOffset: null };

const passingDeepTests = {
  included: true, cpuStress: passingCpuStress, storageTest: passingStorageTest, ramTest: passingRamTest,
};

const FIXTURES = {
  // 완전 정상 — 기본 검사만
  'normal-pc': {
    description: '아무 문제 없는 PC, 기본 검사만 수행',
    input: base(),
    expect: { grade: 'A', stability: null },
  },

  // 완전 정상 — 정밀 검사까지 통과
  'normal-pc-deep': {
    description: '정밀 검사까지 전부 통과한 정상 PC',
    input: base({ deepTests: passingDeepTests }),
    expect: { grade: 'A+', stability: 'normal' },
  },

  // RAM 검사 오류 — 가장 중요한 회귀 방지 케이스
  'ram-error': {
    description: '정밀 검사의 RAM 무결성 검사에서 실제 오류 발생',
    input: base({
      deepTests: { ...passingDeepTests, ramTest: { sizeMB: 256, errors: 137, passed: false, completed: true, error: null, patternsRun: 3, firstErrorOffset: 4096 } },
    }),
    expect: { grade: 'D', stability: 'critical', categoryWithIssue: 'RAM' },
  },

  // 저장장치 데이터 불일치
  'storage-failure': {
    description: '저장장치 테스트에서 쓴 데이터와 읽은 데이터가 다름',
    input: base({
      deepTests: { ...passingDeepTests, storageTest: { ...passingStorageTest, completed: false, verifyMismatch: true } },
    }),
    expect: { grade: 'D', stability: 'critical', categoryWithIssue: 'STORAGE' },
  },

  // 저장장치 I/O 오류
  'storage-io-error': {
    description: '저장장치 테스트 중 쓰기 실패',
    input: base({
      deepTests: { ...passingDeepTests, storageTest: { ...passingStorageTest, completed: false, error: 'EIO: i/o error', errorStage: 'write', ioErrors: 1, writeMBps: null, readMBps: null } },
    }),
    expect: { grade: 'C', stability: 'warning', categoryWithIssue: 'STORAGE' },
  },

  // 느리지만 정상인 저장장치(HDD) — 속도만으로 고장 판정하면 안 됨
  'slow-but-healthy-storage': {
    description: 'HDD처럼 느린 저장장치. 속도가 낮아도 오류가 없으면 정상이어야 한다',
    input: base({
      deepTests: { ...passingDeepTests, storageTest: { ...passingStorageTest, writeMBps: 85, readMBps: 110 } },
    }),
    expect: { grade: 'A+', stability: 'normal' },
  },

  // CPU 부하 테스트 중 안전 온도 도달
  'cpu-thermal-cutoff': {
    description: 'CPU 부하 테스트가 안전 한계 온도에서 자동 중단됨',
    input: base({
      deepTests: {
        ...passingDeepTests,
        cpuStress: { ...passingCpuStress, completed: false, aborted: true, abortKind: 'safety-temp', abortReason: '안전 한계(95°C) 초과로 자동 중단', maxTempC: 96 },
      },
    }),
    expect: { grade: 'C', stability: 'warning', categoryWithIssue: 'CPU' },
  },

  // CPU 온도 센서 없는 환경 — 검사는 하되 안전장치가 없다는 걸 밝혀야 함
  'cpu-no-temp-sensor': {
    description: '온도 센서를 못 읽는 환경에서의 CPU 부하 테스트',
    input: base({
      cpu: { model: 'Test CPU', loadPercent: 10, tempC: null, clockGHz: 3.5 },
      deepTests: {
        ...passingDeepTests,
        cpuStress: { ...passingCpuStress, tempSensorAvailable: false, safetyMode: 'time-limited', effectiveDurationSec: 30, startTempC: null, maxTempC: null },
      },
    }),
    expect: { grade: 'A+', stability: 'normal', cpuEvidenceIncludes: '온도 기반 자동 중단 없이' },
  },

  // GPU 부하 테스트에서 스로틀링
  'gpu-throttling': {
    description: 'GPU 부하 테스트에서 열 스로틀링 확인',
    input: base({
      gpuStressCheck: {
        verdict: 'issue', throttleSuspected: true, abortReason: null,
        maxTempC: 86, maxLoadPercent: 99,
        highLoadStartClockMHz: 1850, highLoadEndClockMHz: 1480,
        highLoadStartTempC: 79, highLoadEndTempC: 86,
        reachedStagePercent: 100, safetyTempC: 90, checkedAt: '2026-08-12T10:00:00Z',
      },
    }),
    expect: { grade: 'C', categoryWithIssue: 'GPU' },
  },

  // GPU TDR 이벤트 + VRAM 불일치 (상관관계 확인용)
  'gpu-tdr': {
    description: '그래픽 드라이버 TDR 이벤트와 VRAM 무결성 불일치가 함께 발생',
    input: base({
      eventLog: withEvents({ display: 6 }),
      vramCheck: {
        verdict: 'issue', mismatchWords: 42, contextLost: false, aborted: false,
        allocatedMB: 2048, coveredMB: 2048, totalMB: 8192, residencyLevel: 'ok',
        gpuModel: null, checkedAt: '2026-08-12T10:00:00Z',
      },
    }),
    expect: { grade: 'C', categoryWithIssue: 'GPU', correlated: true },
  },

  // SMART 실패
  'bad-smart': {
    description: 'SMART 자가진단이 FAILED',
    input: base({
      storage: {
        volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }],
        disks: [], smart: [{ device: '/dev/sda', healthy: false, type: 'sat' }],
        smartctlAvailable: true, io: null,
      },
    }),
    expect: { grade: 'D', categoryWithIssue: 'STORAGE' },
  },

  // SMART 판독 불가 — 정상으로 처리하면 안 됨
  'smart-unknown': {
    description: 'SMART를 읽지 못함. 정상도 이상도 아닌 판단 보류여야 한다',
    input: base({
      storage: {
        volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 100, usePercent: 20 }],
        disks: [], smart: [{ device: '/dev/sda', healthy: null, type: 'nvme' }],
        smartctlAvailable: true, io: null,
      },
    }),
    expect: { grade: 'B', categoryWithIssue: 'STORAGE' },
  },

  // 비정상 종료 반복 — 하드웨어는 정상인데 이벤트 때문에 등급이 내려가는 케이스
  'abnormal-shutdown': {
    description: '하드웨어는 정상인데 진짜 비정상 종료(ID 41)가 19회',
    input: base({ eventLog: withEvents({ kernelPower: 19 }) }),
    expect: { grade: 'C', categoryWithIssue: 'EVENTS', normalAreasInclude: ['CPU', 'GPU', 'RAM', 'STORAGE'] },
  },

  // ⚠ 실제 사용자 PC에서 발견된 오탐 케이스.
  // Kernel-Power provider에는 절전 진입/복귀/정상 종료 이벤트가 섞여 들어오는데,
  // 이걸 전부 "비정상 종료"로 세는 바람에 멀쩡한 PC가 C등급을 받고 있었다.
  'sleep-events-only': {
    description: '절전 진입/복귀 등 정상 전원 이벤트만 19건. 비정상 종료는 0건이므로 정상이어야 한다',
    input: base({ eventLog: withEvents({ sleepEnter: 5, sleepResume: 5, shutdownNormal: 2, wheaCorrected: 0, sleepExtra: 0 }) }),
    expect: { grade: 'A', eventStatus: 'normal' },
  },

  // 정정된 WHEA 오류만 — 하드웨어가 스스로 복구했으므로 critical이 아니어야 한다
  'whea-corrected-only': {
    description: '정정된 WHEA 오류만 3건. 정정 불가 오류는 없으므로 critical이 아니어야 한다',
    input: base({ eventLog: withEvents({ wheaCorrected: 3 }) }),
    expect: { grade: 'B', categoryWithIssue: 'EVENTS' },
  },

  // 과열 PC
  'overheating-pc': {
    description: 'CPU/GPU 모두 고온',
    input: base({
      cpu: { model: 'Test CPU', loadPercent: 92, tempC: 96, clockGHz: 3.1 },
      gpu: { controllers: [{ model: 'Test GPU' }], supported: true, nvidia: { loadPercent: 95, tempC: 91, clockMHz: 1400, vramUsedMB: 3000, vramTotalMB: 8192 } },
    }),
    expect: { grade: 'D', categoryWithIssue: 'CPU' },
  },

  // 여러 문제 동시 발생
  'multi-problem': {
    description: 'RAM 오류 + WHEA + 블루스크린 + SMART 실패가 동시에',
    input: base({
      eventLog: withEvents({ whea: 4, bugcheck: 2, kernelPower: 5 }),
      storage: {
        volumes: [{ mount: 'C:', sizeGB: 500, usedGB: 480, usePercent: 96 }],
        disks: [], smart: [{ device: '/dev/sda', healthy: false, type: 'sat' }],
        smartctlAvailable: true, io: null,
      },
      deepTests: { ...passingDeepTests, ramTest: { sizeMB: 256, errors: 9, passed: false, completed: true, error: null, patternsRun: 3, firstErrorOffset: 128 } },
    }),
    expect: { grade: 'D', stability: 'critical', correlated: true },
  },
};

module.exports = { FIXTURES, base, withEvents, passingDeepTests, passingCpuStress, passingStorageTest, passingRamTest };
