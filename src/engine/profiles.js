// profiles.js
// 진단 프로필 — "무엇을 위해 검사하는가"에 따라 검사 범위와 깊이를 바꾼다. (기획서 §19)
//
// 모든 검사를 매번 다 돌리면 너무 오래 걸리고, 반대로 항상 얕게만 돌리면 중고 거래나
// 수리점 출고 검사에는 못 쓴다. 그래서 목적별로 묶어둔다.
//
// ⚠ 이 파일에서 가장 중요한 규칙:
//    **프로필이 건너뛴 검사는 "정상"이 아니라 "검사 안 함(NOT_TESTED)"으로 남아야 한다.**
//    빠른 점검이 3초 만에 끝나고 전부 초록색이면 사용자는 "이 PC는 멀쩡하다"고 읽는다.
//    실제로는 이벤트 로그도, SMART도, 부하 테스트도 안 본 것이다. 그래서 프로필은
//    "무엇을 건너뛰는지"를 스스로 선언하고(skips), 그 사유가 리포트의 검사 범위에 그대로 실린다.
//    (resultStatus.js / inspectionReport.js의 검사 범위 참고)
//
// 프로필을 새로 추가할 때 반드시 채울 것:
//   collect  각 수집 단계를 실행할지 — false면 그 카테고리는 NOT_TESTED가 된다
//   skips    건너뛴 이유(사용자가 읽을 문장). collect가 false인 항목은 반드시 여기에도 적는다
//   deep     부하 테스트 설정. null이면 안 돌린다

const RULESET_VERSION = '2026.08.1';

// 부하 테스트 기본 강도. 프로필마다 다르게 쓴다.
const DEEP_LIGHT = { cpuStressSec: 15, cpuSafetyTempC: 95, storageMB: 150, ramMB: 256 };
const DEEP_STANDARD = { cpuStressSec: 30, cpuSafetyTempC: 95, storageMB: 300, ramMB: 512 };
const DEEP_LONG = { cpuStressSec: 180, cpuSafetyTempC: 95, storageMB: 500, ramMB: 1024 };

// 모든 수집 단계를 켠 기본값. 프로필은 여기서 끌 것만 끈다
// (새 수집 단계가 생겼을 때 프로필마다 빠뜨리는 일이 없도록 기본은 항상 true).
const ALL_ON = {
  cpu: true, cpuTrend: true, memory: true, memoryModules: true, overclock: true,
  gpu: true, gpuTrend: true, storage: true, network: true, display: true,
  system: true, processes: true, events: true, identity: false,
};

function profile(def) {
  const collect = { ...ALL_ON, ...(def.collect || {}) };
  return { ...def, collect, rulesetVersion: RULESET_VERSION };
}

const PROFILES = {
  // ---------- 개인 사용자 ----------
  quick: profile({
    id: 'quick',
    label: '빠른 점검',
    purpose: '지금 당장 눈에 띄는 문제가 있는지 30초 안에 확인합니다.',
    audience: '개인',
    estimatedSec: 25,
    report: 'diagnosis',
    deep: null,
    collect: { cpuTrend: false, gpuTrend: false, processes: false, events: false, memoryModules: false, overclock: false },
    skips: {
      EVENTS: '빠른 점검에서는 Windows 이벤트 로그(최근 7일)를 조회하지 않습니다. 재부팅·블루스크린 이력을 확인하려면 전체 진단을 실행하세요.',
    },
    skipNotes: [
      '메모리 모듈 구성(혼합 DIMM·정격 속도) — 빠른 점검에서는 조회하지 않음',
      '설정 변경(오버클럭/언더볼팅) 상태 — 빠른 점검에서는 조회하지 않음',
      'CPU·저장장치·RAM 부하 테스트 — 빠른 점검에서는 실행하지 않음',
    ],
  }),

  full: profile({
    id: 'full',
    label: '전체 진단',
    purpose: '수집할 수 있는 모든 항목을 검사합니다. 부하 테스트는 포함하지 않습니다.',
    audience: '개인',
    estimatedSec: 60,
    report: 'diagnosis',
    deep: null,
    collect: {},
    skips: {},
    skipNotes: ['CPU·저장장치·RAM 부하 테스트 — 전체 진단에는 포함되지 않음(안정성 검사 프로필을 사용하세요)'],
  }),

  gaming: profile({
    id: 'gaming',
    label: '게임 성능 진단',
    purpose: '게임 중 버벅거림·끊김의 원인을 GPU·CPU·메모리·저장장치·발열·드라이버 순으로 좁힙니다.',
    audience: '개인',
    estimatedSec: 70,
    report: 'diagnosis',
    // 게임 문제는 부하가 걸렸을 때만 드러나는 경우가 많아 짧게라도 실제로 밀어붙인다.
    deep: DEEP_LIGHT,
    collect: {},
    focus: ['GPU', 'CPU', 'RAM', 'STORAGE', 'DRIVERS', 'EVENTS'],
    skips: {},
    skipNotes: ['VRAM 무결성 검사·GPU 부하 테스트 — 안정성 화면에서 따로 실행해야 반영됩니다'],
  }),

  stability: profile({
    id: 'stability',
    label: '안정성 검사 (장시간)',
    purpose: '부하를 오래 걸어 온도·클럭·오류를 관찰합니다. 간헐적으로만 나타나는 문제를 재현하는 용도입니다.',
    audience: '개인 · 전문가',
    estimatedSec: 300,
    report: 'diagnosis',
    deep: DEEP_LONG,
    collect: {},
    skips: {},
    skipNotes: [],
    warning: '이 검사는 CPU와 저장장치를 오래 밀어붙입니다. 온도 안전 한계에 도달하면 자동으로 중단되지만, 냉각이 부실한 PC에서는 실행 전에 먼지 상태를 먼저 확인하세요.',
  }),

  // ---------- 거래 ----------
  usedPc: profile({
    id: 'usedPc',
    label: '중고 PC 점검',
    purpose: '중고 거래에서 구매자에게 보여줄 점검 리포트를 만듭니다. 하드웨어 구성과 시리얼을 함께 기록합니다.',
    audience: '판매자 · 구매자',
    estimatedSec: 120,
    report: 'inspection',
    deep: DEEP_STANDARD,
    collect: { identity: true },
    skips: {},
    skipNotes: [],
  }),

  // ---------- 업체 ----------
  preDelivery: profile({
    id: 'preDelivery',
    label: '출고 전 검사',
    purpose: '조립·정비를 마친 PC를 고객에게 보내기 전에 확인하고 기록으로 남깁니다.',
    audience: 'PC 업체',
    estimatedSec: 150,
    report: 'inspection',
    deep: DEEP_STANDARD,
    collect: { identity: true },
    skips: {},
    skipNotes: [],
  }),

  // ---------- 수리점 ----------
  // 입고/출고는 같은 항목을 재야 비교가 성립한다. 그래서 검사 범위를 의도적으로 동일하게 둔다.
  repairIntake: profile({
    id: 'repairIntake',
    label: '수리 입고 검사',
    purpose: '수리 전 상태를 기록합니다. 출고 검사와 같은 항목을 재서 나중에 전후 비교가 가능하게 합니다.',
    audience: '수리점',
    estimatedSec: 150,
    report: 'inspection',
    deep: DEEP_STANDARD,
    collect: { identity: true },
    sessionRole: 'intake',
    skips: {},
    skipNotes: [],
  }),

  repairExit: profile({
    id: 'repairExit',
    label: '수리 출고 검사',
    purpose: '수리 후 상태를 기록하고 입고 검사와 비교합니다.',
    audience: '수리점',
    estimatedSec: 150,
    report: 'inspection',
    deep: DEEP_STANDARD,
    collect: { identity: true },
    sessionRole: 'exit',
    // 비교 대상이 없으면 "개선됐다"고 말할 수 없다 — 그 사실을 리포트에 남긴다.
    requiresPair: 'repairIntake',
    skips: {},
    skipNotes: [],
  }),
};

const DEFAULT_PROFILE = 'full';

function resolveProfile(id) {
  return PROFILES[id] || PROFILES[DEFAULT_PROFILE];
}

function listProfiles() {
  return Object.values(PROFILES).map((p) => ({
    id: p.id, label: p.label, purpose: p.purpose, audience: p.audience,
    estimatedSec: p.estimatedSec, report: p.report,
    runsDeepTests: !!p.deep, warning: p.warning || null,
  }));
}

// 이 프로필이 "무엇을 검사하지 않는지"를 리포트에 실을 수 있는 형태로 만든다.
// collect가 false인 항목은 반드시 사유가 있어야 한다 — 없으면 개발 중에 바로 드러나도록
// 일반 문구를 넣되, skips에 적어두는 것이 원칙이다.
const COLLECT_TO_CATEGORY = {
  events: 'EVENTS', network: 'NETWORK', display: 'DISPLAY', storage: 'STORAGE',
  gpu: 'GPU', system: 'DRIVERS',
};

function profileSkips(p) {
  const skips = { ...(p.skips || {}) };
  Object.entries(COLLECT_TO_CATEGORY).forEach(([step, category]) => {
    if (p.collect[step] === false && !skips[category]) {
      skips[category] = `${p.label}에서는 이 항목을 검사하지 않습니다.`;
    }
  });
  return skips;
}

module.exports = {
  PROFILES, DEFAULT_PROFILE, resolveProfile, listProfiles, profileSkips,
  RULESET_VERSION, DEEP_LIGHT, DEEP_STANDARD, DEEP_LONG,
};
