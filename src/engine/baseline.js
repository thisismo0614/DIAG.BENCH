// baseline.js
// "이 PC의 평소 상태(기준선)"를 만들고, 지금 측정값과 비교하는 순수 로직.
//
// 왜 필요한가: 절대 임계값만으로는 "이 PC에서 지금 뭔가 달라졌다"를 못 잡는다.
// 유휴 CPU 온도 58°C는 어떤 PC에서는 정상이고 어떤 PC에서는 이상인데, 절대 임계값(85°C)은
// 둘 다 통과시킨다. 반면 "이 PC는 평소 44°C였는데 지금 58°C"는 먼지 누적·쿨러 열화처럼
// 서서히 나빠지는 문제의 유일한 신호다.
//
// ⚠ 이 기능이 거짓말하기 가장 쉬운 지점 두 가지 — 둘 다 여기서 막는다.
//
//   1. **기준선 자체가 유휴 상태가 아니었으면 이후 모든 비교가 틀린다.**
//      게임 중에 기준선을 뜨면 "평소 온도 78°C"가 되어, 진짜 문제가 생겨도 정상으로 보인다.
//      → 샘플의 대부분이 유휴 범위 안일 때만 기준선으로 인정한다(verdict: 'ok').
//      "측정을 실행했다"와 "측정이 유효했다"는 다르다(GPU 부하 테스트에서 겪은 것과 같은 함정).
//
//   2. **지금이 유휴가 아닌데 유휴 기준선과 비교하면 100% 오탐이다.**
//      게임 중 CPU 온도 75°C를 유휴 기준선 44°C와 비교하면 "+31°C 이상"이 되는데,
//      이건 고장이 아니라 그냥 부하가 걸린 것이다.
//      → 지금 부하가 유휴 범위 밖이면 비교하지 않고 '판단 보류'로 남긴다.
//
// 판정(level)은 여기 한 곳에서만 정한다. rules.js는 그 결과를 문장으로 옮기기만 한다.
// 두 곳에서 각자 임계값을 구현하면 반드시 어긋난다(VRAM/GPU 부하 검사와 같은 원칙).

// ---------- 유휴로 인정하는 범위 ----------
// 이 값을 올리면 기준선을 뜨기는 쉬워지지만 기준선이 "유휴"가 아니게 되어 비교가 무의미해진다.
const IDLE_CPU_LOAD_MAX = 20;   // %
const IDLE_GPU_LOAD_MAX = 20;   // %
const MIN_SAMPLES = 5;          // 이보다 적으면 중앙값이 노이즈에 휘둘린다
const MIN_IDLE_RATIO = 0.75;    // 샘플 중 유휴여야 하는 최소 비율

// 기준선이 이만큼 오래되면 "그동안 계절이 바뀌었을 수 있다"고 명시한다.
// 무효로 만들지는 않는다 — 오래된 기준선을 버리면 정작 서서히 나빠지는 변화를 못 잡는다.
const STALE_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

// 비교 대상 지표. watchAt/warnAt은 "기준선보다 이만큼 나빠졌을 때" 올릴 등급이다.
// null이면 그 등급으로는 올리지 않는다(근거로만 남긴다).
//
// 온도 임계값을 10/15°C로 잡은 근거: 실내 온도는 계절에 따라 10°C 안팎 변한다. 그보다 작은
// 차이를 경고로 올리면 여름마다 멀쩡한 PC가 경고를 받는다. 그래서 10°C는 watch(지켜보기),
// 실내 온도만으로는 설명하기 어려운 15°C부터 warning으로 올린다.
//
// 유휴 CPU 사용률은 단일 스냅샷이라 순간 스파이크에 쉽게 휘둘린다. 그래서 이슈로는 올리지
// 않고 근거 줄로만 남긴다 — 확실하지 않은 것을 확실하다고 말하지 않기 위해서다.
const METRIC_DEFS = [
  { key: 'cpuIdleTempC', label: '유휴 CPU 온도', unit: '°C', section: 'CPU', gate: 'cpu', watchAt: 10, warnAt: 15 },
  { key: 'cpuIdleLoadPercent', label: '유휴 CPU 사용률', unit: '%', section: 'CPU', gate: 'cpu', watchAt: null, warnAt: null },
  { key: 'gpuIdleTempC', label: '유휴 GPU 온도', unit: '°C', section: 'GPU', gate: 'gpu', watchAt: 10, warnAt: 15 },
  { key: 'memIdleUsedPercent', label: '유휴 메모리 사용률', unit: '%', section: 'RAM', gate: 'cpu', watchAt: 20, warnAt: null },
];

function round(n, d = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

function median(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function spread(nums) {
  const xs = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (xs.length < 2) return null;
  return Math.max(...xs) - Math.min(...xs);
}

// ---------- 기준선 만들기 ----------
// samples: collectors.collectLiveSample() 이 반환하는 모양의 배열
//   { t, cpu: { loadPercent, tempC, clockGHz }, gpu: { loadPercent, tempC, ... } | null, ram: { usedPercent } }
//
// 반환값의 verdict가 'ok'일 때만 record가 채워진다. 나머지는 저장하면 안 된다.
function summarizeBaselineSamples(samples, hardware = {}) {
  const list = Array.isArray(samples) ? samples.filter(Boolean) : [];

  if (list.length < MIN_SAMPLES) {
    return {
      verdict: 'insufficient-samples',
      reason: `유효한 샘플이 ${list.length}개뿐입니다. 기준선을 만들려면 최소 ${MIN_SAMPLES}개가 필요합니다.`,
      sampleCount: list.length,
      idleSampleCount: 0,
      record: null,
    };
  }

  const idle = list.filter((s) => s.cpu && typeof s.cpu.loadPercent === 'number' && s.cpu.loadPercent <= IDLE_CPU_LOAD_MAX);
  const idleRatio = idle.length / list.length;

  if (idleRatio < MIN_IDLE_RATIO || idle.length < MIN_SAMPLES) {
    // 여기서 막지 않으면 "평소 온도"가 부하 중 온도로 굳어져, 이후 진단이 전부 조용히 틀린다.
    const busiest = Math.max(...list.map((s) => (s.cpu && s.cpu.loadPercent) || 0));
    return {
      verdict: 'not-idle',
      reason: `측정 중 CPU 부하가 유휴 범위(${IDLE_CPU_LOAD_MAX}% 이하)를 벗어났습니다. `
        + `샘플 ${list.length}개 중 ${idle.length}개만 유휴였고, 최고 부하는 ${round(busiest)}%였습니다. `
        + `실행 중인 프로그램을 정리하고 다시 측정하세요.`,
      sampleCount: list.length,
      idleSampleCount: idle.length,
      maxLoadPercent: round(busiest),
      record: null,
    };
  }

  // GPU는 없을 수도 있고(비NVIDIA), 있어도 유휴가 아닐 수 있다.
  // 그럴 때 CPU 기준선까지 통째로 버리지 않는다 — GPU 항목만 비워두고 나머지는 살린다.
  const gpuSamples = idle.filter((s) => s.gpu && typeof s.gpu.loadPercent === 'number');
  const gpuIdle = gpuSamples.filter((s) => s.gpu.loadPercent <= IDLE_GPU_LOAD_MAX);
  const gpuUsable = gpuIdle.length >= MIN_SAMPLES && gpuIdle.length / Math.max(gpuSamples.length, 1) >= MIN_IDLE_RATIO;

  let gpuNote = null;
  if (!gpuSamples.length) gpuNote = 'GPU 실시간 값을 읽을 수 없어(비NVIDIA 또는 nvidia-smi 없음) GPU 기준선은 만들지 않았습니다.';
  else if (!gpuUsable) gpuNote = `측정 중 GPU 부하가 유휴 범위(${IDLE_GPU_LOAD_MAX}% 이하)를 벗어나 GPU 기준선은 만들지 않았습니다.`;

  const cpuIdleTempC = round(median(idle.map((s) => s.cpu.tempC)));
  // 온도를 못 읽었으면 사유를 남긴다. "센서가 없다"와 "권한이 없다"는 다르고,
  // 후자면 관리자 권한으로 실행해 다시 재면 온도 기준선을 만들 수 있다.
  const tempBlockedByPermission = idle.some((s) => s.cpu && s.cpu.tempReason === 'permission');

  const record = {
    cpuModel: hardware.cpuModel || null,
    gpuModel: hardware.gpuModel || null,
    sampleCount: list.length,
    idleSampleCount: idle.length,
    durationSec: list.length >= 2 && list[0].t && list[list.length - 1].t
      ? round((list[list.length - 1].t - list[0].t) / 1000)
      : null,
    cpuIdleTempC,
    cpuIdleLoadPercent: round(median(idle.map((s) => s.cpu.loadPercent))),
    cpuIdleClockGHz: round(median(idle.map((s) => s.cpu.clockGHz)), 2),
    // 편차가 크면 기준선 자체가 흔들린다는 뜻이라 함께 저장해서 근거에 적는다.
    cpuIdleTempSpreadC: round(spread(idle.map((s) => s.cpu.tempC))),
    gpuIdleTempC: gpuUsable ? round(median(gpuIdle.map((s) => s.gpu.tempC))) : null,
    gpuIdleLoadPercent: gpuUsable ? round(median(gpuIdle.map((s) => s.gpu.loadPercent))) : null,
    memIdleUsedPercent: round(median(idle.map((s) => (s.ram ? s.ram.usedPercent : null)))),
    gpuNote,
    cpuTempNote: cpuIdleTempC !== null ? null
      : (tempBlockedByPermission
        ? '관리자 권한이 없어 CPU 온도를 읽지 못해 온도 기준선은 만들지 못했습니다. 관리자 권한으로 실행하면 온도까지 기록됩니다.'
        : 'CPU 온도를 읽을 수 없어 온도 기준선은 만들지 못했습니다.'),
  };

  return {
    verdict: 'ok',
    reason: null,
    sampleCount: list.length,
    idleSampleCount: idle.length,
    record,
  };
}

// ---------- 지금 값과 비교하기 ----------
// current: { cpuModel, gpuModel, cpu: {loadPercent, tempC}, gpu: {loadPercent, tempC}|null, memUsedPercent }
function compareToBaseline(baseline, current = {}) {
  const empty = (reason, extra = {}) => ({ available: false, reason, deltas: [], ...extra });

  if (!baseline || !baseline.checkedAt) return empty('no-baseline');

  const ageMs = Date.now() - new Date(baseline.checkedAt).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / DAY_MS));
  const stale = ageDays >= STALE_DAYS;
  const meta = { capturedAt: baseline.checkedAt, ageDays, stale, sampleCount: baseline.sampleCount || null };

  // CPU가 바뀌었으면 기준선 전체가 다른 PC의 값이나 마찬가지다.
  if (baseline.cpuModel && current.cpuModel && baseline.cpuModel !== current.cpuModel) {
    return empty('hardware-changed', { ...meta, changedFrom: baseline.cpuModel, changedTo: current.cpuModel });
  }

  const cpuLoad = current.cpu ? current.cpu.loadPercent : null;
  const gpuLoad = current.gpu ? current.gpu.loadPercent : null;
  const cpuIdleNow = typeof cpuLoad === 'number' && cpuLoad <= IDLE_CPU_LOAD_MAX;
  const gpuIdleNow = typeof gpuLoad === 'number' && gpuLoad <= IDLE_GPU_LOAD_MAX;

  // GPU만 바뀐 경우는 CPU 비교까지 버릴 이유가 없다 — GPU 항목만 건너뛴다.
  const gpuChanged = !!(baseline.gpuModel && current.gpuModel && baseline.gpuModel !== current.gpuModel);

  const currentOf = {
    cpuIdleTempC: current.cpu ? current.cpu.tempC : null,
    cpuIdleLoadPercent: cpuLoad,
    gpuIdleTempC: current.gpu ? current.gpu.tempC : null,
    memIdleUsedPercent: current.memUsedPercent ?? null,
  };

  const deltas = [];
  METRIC_DEFS.forEach((def) => {
    const baseVal = baseline[def.key];
    const curVal = currentOf[def.key];
    if (baseVal === null || baseVal === undefined) return;          // 기준선에 없는 항목
    if (curVal === null || curVal === undefined) return;            // 지금 못 읽은 항목

    if (def.gate === 'gpu' && gpuChanged) {
      deltas.push({ ...defShape(def), baselineVal: baseVal, currentVal: curVal, diff: null, level: 'normal', skipped: 'gpu-changed' });
      return;
    }
    const idleNow = def.gate === 'gpu' ? gpuIdleNow : cpuIdleNow;
    if (!idleNow) {
      // 부하가 걸린 상태와 유휴 기준선을 비교하면 무조건 "이상"이 나온다. 비교하지 않는다.
      deltas.push({ ...defShape(def), baselineVal: baseVal, currentVal: curVal, diff: null, level: 'normal', skipped: 'not-idle' });
      return;
    }

    const diff = round(curVal - baseVal);
    let level = 'normal';
    // 기준선보다 좋아진 쪽(음수)은 등급을 올리지 않는다. 근거로만 남긴다.
    if (diff > 0) {
      if (def.warnAt !== null && diff >= def.warnAt) level = 'warning';
      else if (def.watchAt !== null && diff >= def.watchAt) level = 'watch';
    }
    deltas.push({ ...defShape(def), baselineVal: baseVal, currentVal: curVal, diff, level, skipped: null });
  });

  return {
    available: deltas.length > 0,
    reason: deltas.length ? null : 'no-comparable-metric',
    ...meta,
    gpuChanged,
    gpuNote: baseline.gpuNote || null,
    deltas,
  };
}

function defShape(def) {
  return { key: def.key, label: def.label, unit: def.unit, section: def.section };
}

// 특정 섹션(CPU/GPU/RAM)에 해당하는 비교 결과만 골라낸다. rules.js가 쓴다.
function deltasForSection(comparison, section) {
  if (!comparison || !comparison.deltas) return [];
  return comparison.deltas.filter((d) => d.section === section);
}

module.exports = {
  summarizeBaselineSamples,
  compareToBaseline,
  deltasForSection,
  IDLE_CPU_LOAD_MAX,
  IDLE_GPU_LOAD_MAX,
  MIN_SAMPLES,
  MIN_IDLE_RATIO,
  STALE_DAYS,
  METRIC_DEFS,
};
