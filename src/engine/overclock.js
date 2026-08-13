// overclock.js
// "이 PC가 정품 설정 그대로인가, 누가 손댔는가"를 판정한다. (기획서 §8)
//
// ⚠ 이 진단의 원칙: **오버클럭을 흑백으로 판단하지 않는다.**
//    설정을 바꾼 것 자체는 고장도 결함도 아니다. XMP를 켠 것과 불안정한 오버클럭은
//    전혀 다른 얘기다. 그래서 여기서는 "정상/비정상"이 아니라 **상태(state)** 를 말한다.
//
//      stock            정품 설정 그대로
//      profile-active   제조사가 제공한 프로파일이 적용됨 (예: 메모리 XMP/EXPO)
//      modified         설정이 변경된 상태 (전력 제한 변경, 기본 클럭 상승 등)
//      unknown          판단에 필요한 값을 읽지 못함 — 정품이라는 뜻이 아니다
//
//    "불안정하다"는 판정은 여기서 하지 않는다. 설정 변경 + 실제 오류 이벤트(WHEA 등)가
//    **둘 다** 있을 때만 rules.js의 상관관계 단계가 조사 대상으로 올린다(기획서 §12).
//
// ⚠ 판정에 쓰지 않는 값들 (근거가 안 되기 때문):
//    - GPU 최대 부스트 클럭: 공장 OC 모델은 원래 레퍼런스보다 높다. 레퍼런스 DB 없이는
//      비교 자체가 불가능하므로 참고 수치로만 남긴다.
//    - CPU 전압: 대부분의 보드에서 OS로 읽을 수 없다(collectors.js 주석 참고).

const RULESET_VERSION = '2026.08.1';

const STATUS = {
  STOCK: 'stock',
  PROFILE_ACTIVE: 'profile-active',
  MODIFIED: 'modified',
  UNKNOWN: 'unknown',
};

const RISK = {
  SAFE: 'SAFE', LOW: 'LOW', INTERMEDIATE: 'INTERMEDIATE', ADVANCED: 'ADVANCED', EXPERT: 'EXPERT',
};
const act = (text, risk) => ({ text, risk });

// 기본 클럭이 이 비율을 넘게 올라가 있으면 설정 변경으로 본다.
// 3401MHz ↔ 표기 3.40GHz처럼 반올림 오차가 있으므로 여유를 둔다.
const CPU_BASE_CLOCK_TOLERANCE = 1.02;

// 대부분의 최신 플랫폼에서 BCLK 기본값. 다르다고 바로 판정하지 않고 근거로만 쓴다.
const TYPICAL_BCLK_MHZ = 100;

function analyzeConfiguration({ overclockState, memorySummary } = {}) {
  const oc = overclockState || {};
  const cpuState = oc.cpu || {};
  const gpuState = oc.gpu || {};

  const cpu = { status: STATUS.UNKNOWN, evidence: [], findings: [] };
  const gpu = { status: STATUS.UNKNOWN, evidence: [], findings: [] };
  const memory = { status: STATUS.UNKNOWN, evidence: [] };
  const notTested = [];

  // ---------- CPU ----------
  if (!cpuState.readable) {
    notTested.push('CPU 설정 상태 — 프로세서 정보를 읽지 못함');
  } else {
    if (cpuState.maxClockGHz) cpu.evidence.push(`기본 클럭 ${cpuState.maxClockGHz}GHz`);
    if (cpuState.bclkMHz) cpu.evidence.push(`BCLK ${cpuState.bclkMHz}MHz`);

    if (!cpuState.stockBaseGHz) {
      // 모델명에 정품 클럭이 안 박혀 있는 CPU가 많다(특히 AMD). 비교 기준이 없으면 판정하지 않는다.
      cpu.status = STATUS.UNKNOWN;
      cpu.evidence.push('CPU 모델명에 정품 기본 클럭 표기가 없어 설정 변경 여부를 비교하지 못했습니다');
      notTested.push('CPU 기본 클럭 변경 여부 — 비교할 정품 값을 알 수 없음');
    } else if (cpuState.maxClockGHz && cpuState.maxClockGHz > cpuState.stockBaseGHz * CPU_BASE_CLOCK_TOLERANCE) {
      cpu.status = STATUS.MODIFIED;
      const pct = Math.round(((cpuState.maxClockGHz / cpuState.stockBaseGHz) - 1) * 100);
      cpu.findings.push({
        ruleId: 'CPU_BASE_CLOCK_MODIFIED',
        ruleVersion: RULESET_VERSION,
        level: 'watch',
        title: 'CPU 기본 클럭이 정품 사양보다 높습니다 (설정 변경됨)',
        explanation: `이 CPU의 정품 기본 클럭은 ${cpuState.stockBaseGHz}GHz인데 시스템은 ${cpuState.maxClockGHz}GHz로 보고합니다(약 ${pct}% 높음). `
          + 'BIOS에서 베이스 클럭(BCLK)이나 배수가 조정된 상태로 보입니다. 그 자체가 고장은 아니지만, '
          + '중고로 받은 PC라면 이전 사용자가 바꿔둔 설정일 수 있어 알려드립니다.',
        causes: ['BIOS에서 BCLK 또는 배수를 수동으로 올림', '메인보드의 자동 오버클럭 기능이 켜져 있음'],
        actions: [
          act('의도한 설정인지 확인하세요 (중고 PC라면 이전 사용자 설정일 수 있습니다)', RISK.SAFE),
          act('안정성 테스트 탭에서 CPU 부하 테스트를 실행해 현재 설정에서 문제가 없는지 확인하세요', RISK.SAFE),
          act('불안정하다면 BIOS에서 기본값(Load Optimized Defaults)으로 되돌리세요', RISK.INTERMEDIATE),
        ],
        confidence: 'STRONG_INDICATION',
        evidence: [
          `정품 기본 클럭 ${cpuState.stockBaseGHz}GHz (모델명 표기) / 시스템 보고 ${cpuState.maxClockGHz}GHz`,
          ...(cpuState.bclkMHz && cpuState.bclkMHz !== TYPICAL_BCLK_MHZ ? [`BCLK ${cpuState.bclkMHz}MHz (일반적인 기본값 ${TYPICAL_BCLK_MHZ}MHz와 다름)`] : []),
          '설정이 변경됐다는 사실만 확인한 것이며, 불안정하다는 뜻은 아닙니다',
        ],
        verification: 'BIOS 설정을 확인/변경한 뒤 전체 진단을 다시 실행해 기본 클럭 표기가 달라졌는지 확인하세요.',
      });
    } else {
      cpu.status = STATUS.STOCK;
      cpu.evidence.push(`정품 기본 클럭 ${cpuState.stockBaseGHz}GHz와 일치 — 기본 클럭 변경 없음`);
    }
  }
  if (!cpuState.voltageReadable) {
    notTested.push('CPU 전압 — OS에서 읽을 수 없음(언더볼팅 여부 확인 불가)');
  }

  // ---------- GPU ----------
  if (!gpuState.supported) {
    notTested.push('GPU 설정 상태 — NVIDIA GPU가 아니거나 nvidia-smi를 찾을 수 없음');
  } else {
    if (gpuState.maxClockMHz) gpu.evidence.push(`최대 부스트 클럭 ${gpuState.maxClockMHz}MHz (참고값 — 공장 OC 모델은 원래 높으므로 판정에 쓰지 않음)`);
    const pl = gpuState.powerLimitW;
    const dflt = gpuState.defaultPowerLimitW;
    if (pl === null || dflt === null) {
      gpu.status = STATUS.UNKNOWN;
      notTested.push('GPU 전력 제한 변경 여부 — 기본값을 읽지 못함');
    } else if (pl !== dflt) {
      gpu.status = STATUS.MODIFIED;
      const raised = pl > dflt;
      gpu.findings.push({
        ruleId: 'GPU_POWER_LIMIT_MODIFIED',
        ruleVersion: RULESET_VERSION,
        level: 'watch',
        title: `GPU 전력 제한이 기본값과 다릅니다 (${raised ? '상향' : '하향'}됨)`,
        explanation: `이 GPU의 기본 전력 제한은 ${dflt}W인데 현재 ${pl}W로 설정되어 있습니다. `
          + (raised
            ? '전력 제한을 올리면 성능이 오를 수 있지만 발열과 소비 전력도 함께 늘어납니다. '
            : '전력 제한을 내리면 발열과 소비 전력이 줄지만 성능이 제한됩니다. ')
          + '고장이 아니라 설정 상태입니다.',
        causes: [raised ? '오버클럭 유틸리티로 전력 제한 상향' : '언더볼팅/저소음 목적의 전력 제한 하향', '이전 사용자가 설정한 프로파일이 남아 있음'],
        actions: [
          act('의도한 설정인지 확인하세요 (중고 PC라면 이전 사용자 설정일 수 있습니다)', RISK.SAFE),
          act('안정성 테스트 탭에서 GPU 부하 테스트를 실행해 현재 설정에서 문제가 없는지 확인하세요', RISK.SAFE),
          act(`기본값으로 되돌리려면 nvidia-smi -pl ${dflt} (관리자 권한 필요)`, RISK.INTERMEDIATE),
        ],
        confidence: 'CONFIRMED',
        evidence: [
          `현재 전력 제한 ${pl}W / 기본값 ${dflt}W`,
          ...(gpuState.minPowerLimitW !== null && gpuState.maxPowerLimitW !== null
            ? [`이 GPU가 허용하는 범위 ${gpuState.minPowerLimitW}~${gpuState.maxPowerLimitW}W`] : []),
          '드라이버가 보고한 값을 그대로 비교한 것이라 확실합니다',
        ],
        verification: '설정을 되돌린 뒤 전체 진단을 다시 실행해 전력 제한이 기본값과 같아졌는지 확인하세요.',
      });
    } else {
      gpu.status = STATUS.STOCK;
      gpu.evidence.push(`전력 제한 ${pl}W — 기본값과 동일`);
    }
  }

  // ---------- Memory ----------
  // 메모리는 memoryConfig.js가 이미 판정을 끝냈다. 여기서 다시 판정하지 않고 상태만 옮긴다.
  if (!memorySummary) {
    notTested.push('메모리 설정 상태 — 모듈 구성을 읽지 못함');
  } else {
    const cur = memorySummary.currentMTs;
    const rated = memorySummary.highestRatedMTs;
    if (cur === null || cur === undefined || !rated) {
      memory.status = STATUS.UNKNOWN;
    } else if (cur > rated) {
      memory.status = STATUS.PROFILE_ACTIVE;
      memory.evidence.push(`현재 ${cur} MT/s — 모듈 정격 ${rated} MT/s보다 높음(프로파일 적용 또는 수동 설정)`);
    } else if (cur < rated) {
      memory.status = STATUS.STOCK;
      memory.evidence.push(`현재 ${cur} MT/s — 모듈 정격 ${rated} MT/s보다 낮음(프로파일 미적용으로 보임)`);
    } else {
      memory.status = STATUS.STOCK;
      memory.evidence.push(`현재 ${cur} MT/s — 모듈 정격과 동일`);
    }
  }

  const statuses = [cpu.status, gpu.status, memory.status];
  const modified = statuses.includes(STATUS.MODIFIED) || statuses.includes(STATUS.PROFILE_ACTIVE);

  return {
    cpu, gpu, memory,
    modified,
    // 하나라도 판정 못 한 항목이 있으면 "전부 정품"이라고 말할 수 없다.
    complete: !statuses.includes(STATUS.UNKNOWN),
    notTested,
    rulesetVersion: RULESET_VERSION,
  };
}

module.exports = { analyzeConfiguration, STATUS, RULESET_VERSION };
