// stress.js
// 기획서 19장 Safety System에 대응하는 실제 부하/성능 테스트.
//
// 구현 범위 (정직하게 밝힘):
// - CPU 부하 테스트: 실제로 모든 논리 코어에 부하를 걸고, 온도를 주기적으로 측정해
//   안전 한계를 넘으면 자동 중단한다. 실제 동작한다.
// - Storage 처리량 테스트: 임시 파일을 실제로 쓰고 읽어서 MB/s를 측정한다. 실제 동작한다.
// - RAM 무결성 간이검사: 버퍼에 패턴을 쓰고 다시 읽어 일치하는지 확인하는 간단한 자가 점검이다.
//   MemTest86 같은 부팅형 도구가 하는 정밀한 물리 메모리 오류 검사와는 다르며, 참고용이다.
// - GPU 부하 테스트 / VRAM 검사: WebGL이 필요해 렌더러에서 실행한다(app.js). 결과는
//   gpuStressChecks.js / vramChecks.js에 기록되어 진단에 반영된다.
//
// ⚠ 이 파일의 모든 테스트는 "실패해도 예외를 던지지 않고 실패를 결과로 반환"한다.
//    예외를 던지면 호출부에서 결과가 통째로 사라져 "검사 안 함"과 "검사했는데 실패"가
//    구분되지 않는다 — 진단 프로그램에서 그 둘을 섞는 건 위험하다.

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const collectors = require('./collectors');

const abortFlags = {}; // testId -> boolean

function requestAbort(testId) {
  abortFlags[testId] = true;
}

// ---------- 파라미터 안전 범위 ----------
// 렌더러에서 온 값은 신뢰하지 않는다(Electron에서 renderer는 신뢰 경계 밖). UI에서 이미
// 제한하더라도 메인 프로세스에서 한 번 더 clamp한다. 상한을 두는 이유는 사용자가 비정상적으로
// 큰 값을 넘겨서 디스크를 가득 채우거나 메모리를 통째로 점유하거나 CPU를 무한정 태우는 걸 막기 위해서다.
const LIMITS = {
  cpuDurationSec: { min: 5, max: 300, def: 15 },
  // 센서가 없어 온도 기반 중단을 못 쓸 때의 시간 상한(아래 runCpuStressTest 참고)
  cpuDurationSecNoSensor: { min: 5, max: 30, def: 15 },
  cpuSafetyTempC: { min: 60, max: 100, def: 95 },
  storageSizeMB: { min: 50, max: 2048, def: 200 },
  ramSizeMB: { min: 64, max: 1024, def: 256 },
};

function clampNumber(value, { min, max, def }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cpuBusyWorkerSrc() {
  return `
    const { parentPort } = require('worker_threads');
    let running = true;
    parentPort.on('message', (msg) => { if (msg === 'stop') running = false; });
    function busy() {
      const end = Date.now() + 150;
      while (Date.now() < end && running) { Math.sqrt(Math.random() * 123456.789); }
      if (running) setImmediate(busy);
    }
    busy();
  `;
}

// ---------- CPU STRESS TEST ----------
// 온도 센서를 못 읽는 환경이 실제로 있다(가상머신, 일부 메인보드). 그때는 온도 기반 자동
// 중단이 불가능하므로 "안전장치가 동작한다"고 말하면 안 된다. 대신 테스트 시간을 짧게 제한하는
// 시간 기반 안전 모드로 돌리고, 그 사실을 결과에 남겨서 리포트가 정직하게 표시하도록 한다.
async function runCpuStressTest({ testId, durationSec, safetyTempC, onProgress }) {
  abortFlags[testId] = false;
  const requestedDurationSec = clampNumber(durationSec, LIMITS.cpuDurationSec);
  const safetyTemp = clampNumber(safetyTempC, LIMITS.cpuSafetyTempC);

  // 시작 전에 센서를 한 번 읽어 온도 기반 중단이 가능한지 판단한다.
  let probe = null;
  try { probe = await collectors.collectCpu(); } catch { probe = null; }
  const tempSensorAvailable = !!(probe && probe.tempC !== null && probe.tempC !== undefined);

  // 센서가 없으면 시간 상한을 더 짧게 잡는다(온도를 못 보므로 오래 태우지 않는다).
  const effectiveDurationSec = tempSensorAvailable
    ? requestedDurationSec
    : Math.min(requestedDurationSec, LIMITS.cpuDurationSecNoSensor.max);
  const safetyMode = tempSensorAvailable ? 'temperature' : 'time-limited';

  const coreCount = os.cpus().length;
  const workers = [];
  let workerError = null;
  try {
    for (let i = 0; i < coreCount; i++) {
      const w = new Worker(cpuBusyWorkerSrc(), { eval: true });
      w.on('error', (err) => { workerError = workerError || String(err && err.message ? err.message : err); });
      workers.push(w);
    }
  } catch (err) {
    workerError = String(err && err.message ? err.message : err);
  }
  const stopWorkers = () => workers.forEach((w) => { try { w.postMessage('stop'); w.terminate(); } catch (e) {} });

  const start = Date.now();
  let maxTemp = null;
  let startTempC = probe && probe.tempC !== null ? probe.tempC : null;
  let minClock = null;
  let maxClock = null;
  let maxLoadPercent = null;
  let aborted = false;
  let abortReason = null;
  let abortKind = null;   // 'safety-temp' | 'user' | 'worker-error'
  let samples = 0;

  if (workers.length === 0) {
    // 워커를 하나도 못 띄웠으면 부하 자체가 없었던 것 — 결과를 정상으로 쓰면 안 된다.
    stopWorkers();
    delete abortFlags[testId];
    return {
      completed: false, aborted: true, abortReason: '부하 워커를 생성하지 못했습니다', abortKind: 'worker-error',
      workerError: workerError || 'no workers started',
      durationSec: 0, requestedDurationSec, coreCount, workerCount: 0,
      tempSensorAvailable, safetyMode, safetyTempC: safetyTemp,
      startTempC, maxTempC: null, minClockGHz: null, maxClockGHz: null, maxLoadPercent: null,
      clockDroppedUnderLoad: null, loadAchieved: false, samples: 0,
    };
  }

  while (true) {
    const elapsed = (Date.now() - start) / 1000;
    let cpu = null;
    try { cpu = await collectors.collectCpu(); } catch { cpu = null; }
    if (cpu) {
      samples++;
      if (cpu.tempC !== null && cpu.tempC !== undefined) {
        if (startTempC === null) startTempC = cpu.tempC;
        maxTemp = maxTemp === null ? cpu.tempC : Math.max(maxTemp, cpu.tempC);
        if (cpu.tempC >= safetyTemp) {
          aborted = true;
          abortReason = `안전 한계(${safetyTemp}°C) 초과로 자동 중단`;
          abortKind = 'safety-temp';
        }
      }
      if (cpu.clockGHz !== null && cpu.clockGHz > 0) {
        minClock = minClock === null ? cpu.clockGHz : Math.min(minClock, cpu.clockGHz);
        maxClock = maxClock === null ? cpu.clockGHz : Math.max(maxClock, cpu.clockGHz);
      }
      if (cpu.loadPercent !== null && cpu.loadPercent !== undefined) {
        maxLoadPercent = maxLoadPercent === null ? cpu.loadPercent : Math.max(maxLoadPercent, cpu.loadPercent);
      }
      if (onProgress) onProgress({ elapsed, loadPercent: cpu.loadPercent, tempC: cpu.tempC, clockGHz: cpu.clockGHz, maxTemp, safetyMode });
    }

    if (workerError) {
      aborted = true;
      abortReason = `부하 워커 오류: ${workerError}`;
      abortKind = 'worker-error';
    }
    if (abortFlags[testId]) {
      aborted = true;
      abortReason = '사용자가 중단함';
      abortKind = 'user';
    }
    if (aborted || elapsed >= effectiveDurationSec) break;
    await sleep(1000);
  }

  stopWorkers();
  delete abortFlags[testId];

  // 부하가 실제로 걸렸는지 — GPU 부하 테스트와 같은 원칙("실행했다" ≠ "밀어붙였다").
  const loadAchieved = maxLoadPercent !== null ? maxLoadPercent >= 60 : null;

  return {
    completed: !aborted,
    aborted,
    abortReason,
    abortKind,
    workerError,
    durationSec: Math.round((Date.now() - start) / 1000),
    requestedDurationSec,
    effectiveDurationSec,
    coreCount,
    workerCount: workers.length,
    tempSensorAvailable,
    safetyMode,
    safetyTempC: safetyTemp,
    startTempC,
    maxTempC: maxTemp,
    minClockGHz: minClock,
    maxClockGHz: maxClock,
    maxLoadPercent,
    loadAchieved,
    samples,
    clockDroppedUnderLoad: minClock !== null && maxClock !== null ? (maxClock - minClock) >= 0.3 : null,
  };
}

// ---------- STORAGE THROUGHPUT TEST ----------
// 처리량만 재는 게 아니라 "쓰고 읽는 것 자체가 되는가"도 본다. I/O 오류나 되읽기 불일치는
// 속도가 느린 것과는 전혀 다른 문제(장치 이상 신호)라 따로 구분해서 돌려준다.
async function runStorageThroughputTest({ testDir, sizeMB, onProgress }) {
  const size = clampNumber(sizeMB, LIMITS.storageSizeMB);
  const filePath = path.join(testDir, `diagbench-storage-test-${Date.now()}.tmp`);
  const chunkSize = 1024 * 1024; // 1MB
  const chunk = crypto.randomBytes(chunkSize);

  const result = {
    sizeMB: size, writeMBps: null, readMBps: null,
    completed: false, error: null, errorStage: null,
    ioErrors: 0, verifyMismatch: false, bytesRead: 0, freeSpaceChecked: false,
  };

  // 디스크에 자리가 없는데 쓰기를 시작하면 남의 디스크를 채우게 된다. 미리 확인한다.
  try {
    const stat = fs.statfsSync ? fs.statfsSync(testDir) : null;
    if (stat) {
      result.freeSpaceChecked = true;
      const freeMB = (stat.bsize * stat.bavail) / (1024 * 1024);
      if (freeMB < size * 1.5) {
        result.error = `여유 공간 부족(약 ${Math.round(freeMB)}MB 남음, ${size}MB 테스트 필요)`;
        result.errorStage = 'precheck';
        return result;
      }
    }
  } catch { /* statfs를 못 쓰는 환경이면 사전 확인 없이 진행한다 */ }

  let fd = null;
  try {
    const writeStart = Date.now();
    fd = fs.openSync(filePath, 'w');
    for (let i = 0; i < size; i++) {
      fs.writeSync(fd, chunk);
      if (onProgress) onProgress({ stage: 'write', percent: Math.round(((i + 1) / size) * 100) });
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    const writeElapsed = (Date.now() - writeStart) / 1000;
    result.writeMBps = writeElapsed > 0 ? round(size / writeElapsed, 1) : null;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    result.errorStage = 'write';
    result.ioErrors++;
    try { if (fd !== null) fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(filePath); } catch {}
    return result;
  }

  let fdr = null;
  try {
    const readStart = Date.now();
    fdr = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(chunkSize);
    let readBytes = 0;
    while (true) {
      const bytesRead = fs.readSync(fdr, buf, 0, chunkSize, null);
      if (bytesRead === 0) break;
      // 쓴 것과 같은 내용이 읽히는지도 확인한다(전체 청크가 온전히 읽힌 경우만 비교).
      if (bytesRead === chunkSize && !buf.equals(chunk)) result.verifyMismatch = true;
      readBytes += bytesRead;
      if (onProgress) onProgress({ stage: 'read', percent: Math.round((readBytes / (size * 1024 * 1024)) * 100) });
    }
    fs.closeSync(fdr);
    fdr = null;
    result.bytesRead = readBytes;
    const readElapsed = (Date.now() - readStart) / 1000;
    result.readMBps = readElapsed > 0 ? round((readBytes / 1024 / 1024) / readElapsed, 1) : null;
    // 쓴 만큼 다 읽히지 않았다면 파일이 잘렸다는 뜻 — 처리량과 무관한 이상 신호다.
    if (readBytes !== size * 1024 * 1024) {
      result.error = `쓴 크기(${size}MB)와 읽은 크기(${round(readBytes / 1024 / 1024, 1)}MB)가 다릅니다`;
      result.errorStage = 'verify';
      result.ioErrors++;
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    result.errorStage = 'read';
    result.ioErrors++;
    try { if (fdr !== null) fs.closeSync(fdr); } catch {}
    try { fs.unlinkSync(filePath); } catch {}
    return result;
  }

  try { fs.unlinkSync(filePath); } catch { /* 임시 파일 삭제 실패는 검사 결과와 무관 */ }

  result.completed = !result.error && !result.verifyMismatch;
  return result;
}

// ---------- RAM INTEGRITY QUICK CHECK ----------
// 패턴을 하나만 쓰면 특정 비트가 고착돼 있어도 우연히 통과할 수 있어서, 서로 보완되는
// 패턴 3종(주소 기반 / 전부 0 / 전부 1의 변형)으로 검사한다.
async function runRamIntegrityTest({ sizeMB, onProgress }) {
  const size = clampNumber(sizeMB, LIMITS.ramSizeMB);
  const bytes = size * 1024 * 1024;

  const result = {
    sizeMB: size, errors: 0, passed: false, completed: false,
    error: null, patternsRun: 0, firstErrorOffset: null,
  };

  let buf;
  try {
    buf = Buffer.alloc(bytes);
  } catch (err) {
    // 메모리를 못 잡으면 "이상 없음"이 아니라 "검사 못 함"이다.
    result.error = `검사용 메모리(${size}MB)를 확보하지 못했습니다: ${String(err && err.message ? err.message : err)}`;
    return result;
  }

  const PATTERNS = [
    { name: 'address', of: (i) => (i ^ 0xa5a5a5a5) >>> 0 },
    { name: 'zeros', of: () => 0x00000000 },
    { name: 'ones', of: () => 0xffffffff },
  ];

  try {
    for (let p = 0; p < PATTERNS.length; p++) {
      const pat = PATTERNS[p];
      if (onProgress) onProgress({ stage: 'write', pattern: pat.name, percent: Math.round((p / PATTERNS.length) * 100) });
      for (let i = 0; i + 4 <= bytes; i += 4) buf.writeUInt32LE(pat.of(i), i);
      if (onProgress) onProgress({ stage: 'verify', pattern: pat.name, percent: Math.round(((p + 0.5) / PATTERNS.length) * 100) });
      for (let i = 0; i + 4 <= bytes; i += 4) {
        if (buf.readUInt32LE(i) !== pat.of(i)) {
          result.errors++;
          if (result.firstErrorOffset === null) result.firstErrorOffset = i;
        }
      }
      result.patternsRun++;
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return result;
  }

  if (onProgress) onProgress({ stage: 'done', percent: 100 });
  result.completed = true;
  result.passed = result.errors === 0;
  return result;
}

function round(n, d = 0) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { runCpuStressTest, runStorageThroughputTest, runRamIntegrityTest, requestAbort, LIMITS, clampNumber };
