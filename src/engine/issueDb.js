// issueDb.js
// 문제 해결 지식 데이터베이스. (기획서 §39, §44 해결 Wizard, §14 조치 위험도, §45 안전 설계)
//
// 왜 규칙 코드에서 분리했는가 — 역할이 다르기 때문이다.
//
//   규칙 모듈(memoryConfig / overclock / baseline …)  "측정하고 판정한다"
//     → 지금 값이 얼마인지, 그게 warning인지 watch인지. 숫자가 들어간 문장은 여기서 만든다.
//
//   이 파일                                            "그 문제가 무엇이고 어떻게 고치는가"
//     → 제목, 증상, 원인 후보, 조치와 그 위험도, 재검사 방법, 단계별 해결 절차.
//       측정값이 안 들어가는 정적 지식이라 한곳에 모아둘 수 있다.
//
// 이렇게 나눠야 같은 문제에 대한 안내가 화면·리포트·Wizard에서 제각각이 되는 일이 없다.
// 판정 기준은 여전히 규칙 모듈 한 곳에만 있다 — 여기에는 임계값이 없다.
//
// ⚠ 새 항목을 추가할 때 지켜야 할 것:
//   1. id는 바꾸지 않는다. 과거 리포트가 이 값으로 문제를 가리키고 있다.
//   2. 판정 로직이나 안내가 실질적으로 바뀌면 version을 올린다(기획서 §60).
//      과거 성적서의 결과를 나중에도 설명할 수 있어야 한다.
//   3. 모든 조치에 위험도를 단다. 위험도가 없는 조치는 사용자가 판단할 근거가 없다.
//   4. 확인만 하는 안전한 조치(SAFE)를 항상 먼저 놓는다. 되돌리기 어려운 것은 뒤로.

const DB_VERSION = '2026.08.1';

// 조치·단계의 위험도 (기획서 §14)
const RISK = {
  SAFE: 'SAFE',                 // 확인만 한다. 시스템을 바꾸지 않는다.
  LOW: 'LOW',                   // 되돌리기 쉽다(청소, 드라이버 재설치 등).
  INTERMEDIATE: 'INTERMEDIATE', // BIOS 설정 변경. 잘못하면 부팅이 안 될 수 있다.
  ADVANCED: 'ADVANCED',         // 전압/클럭 수동 조정.
  EXPERT: 'EXPERT',             // BIOS 플래시 등 실패 시 복구가 어렵다.
};

const RISK_LABEL = {
  SAFE: '안전 — 확인만 합니다',
  LOW: '낮음 — 되돌리기 쉽습니다',
  INTERMEDIATE: '중간 — BIOS 설정을 바꿉니다',
  ADVANCED: '높음 — 전압/클럭을 직접 조정합니다',
  EXPERT: '매우 높음 — 실패 시 복구가 어렵습니다',
};

// 이 위험도부터는 되돌릴 방법을 먼저 마련하라고 안내한다 (기획서 §45).
const RISK_NEEDS_BACKUP = [RISK.INTERMEDIATE, RISK.ADVANCED, RISK.EXPERT];

const act = (text, risk) => ({ text, risk });
// Wizard 단계. screen을 적어두면 화면이 해당 탭으로 안내할 수 있다.
const step = (title, detail, risk, screen = null) => ({ title, detail, risk, screen });

const ENTRIES = {
  // ================= 메모리 구성 =================
  'MEMORY-MIXED-DIMM-BELOW-RATED': {
    version: '2026.08.1',
    category: 'RAM',
    title: '서로 다른 메모리 모듈이 섞여 있고, 보수적인 속도로 동작 중입니다',
    detection: '모듈별 사양(모델/제조사/용량/정격)이 서로 다르고, 현재 동작 속도가 가장 높은 정격보다 낮음',
    symptoms: ['메모리 대역폭이 낮아 게임/작업에서 성능이 덜 나올 수 있음', '드물게 혼합 구성이 안정성 문제로 이어질 수 있음'],
    causes: [
      '서로 다른 사양의 모듈이 섞여 있어 가장 낮은 공통 설정으로 동작',
      'BIOS에서 메모리 프로파일(XMP/EXPO)이 꺼져 있음',
      '메인보드/CPU 메모리 컨트롤러가 해당 속도를 이 슬롯 구성으로는 지원하지 않음',
    ],
    actions: [
      act('BIOS에서 현재 메모리 설정과 사용 가능한 프로파일(XMP/EXPO)을 확인하세요', RISK.SAFE),
      act('메인보드 설명서에서 이 슬롯 구성으로 지원되는 최대 속도를 확인하세요', RISK.SAFE),
      act('프로파일을 켜기 전에 현재 BIOS 설정을 먼저 기록해두세요', RISK.SAFE),
      act('BIOS에서 메모리 프로파일을 활성화합니다 (잘못 설정하면 부팅이 안 될 수 있습니다)', RISK.INTERMEDIATE),
      act('가능하면 동일 모델 모듈로 통일하는 것이 가장 확실합니다', RISK.LOW),
    ],
    verification: 'BIOS 설정을 바꾼 뒤 전체 진단을 다시 실행해 현재 동작 속도가 올라갔는지 확인하고, 안정성 테스트 탭에서 RAM 검사를 돌려 오류가 없는지 확인하세요.',
    // 기획서 §44의 5단계 흐름
    wizard: [
      step('현재 메모리 구성 확인', '진단 결과의 RAM 항목에서 어떤 모듈이 어느 슬롯에 꽂혀 있는지, 현재 속도와 정격 속도가 각각 얼마인지 확인합니다.', RISK.SAFE),
      step('현재 BIOS 설정 기록', '설정을 바꾸기 전에 지금 값을 사진으로 남기거나 적어둡니다. 문제가 생겼을 때 되돌릴 수 있어야 합니다.', RISK.SAFE),
      step('현재 구성에서 안정성 먼저 확인', '설정을 바꾸기 전에 지금 상태에서 RAM 검사를 돌려 기준점을 만듭니다.', RISK.SAFE, 'view-stability'),
      step('BIOS에서 메모리 프로파일 활성화', '재부팅 후 BIOS로 들어가 XMP/EXPO를 켭니다. 부팅이 안 되면 CMOS 클리어로 되돌립니다.', RISK.INTERMEDIATE),
      step('재검사', '부팅되면 전체 진단을 다시 실행해 동작 속도가 올라갔는지, RAM 검사에 오류가 없는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  'MEMORY-BELOW-RATED-SPEED': {
    version: '2026.08.1',
    category: 'RAM',
    title: '메모리가 모듈 정격보다 낮은 속도로 동작 중입니다',
    detection: '모든 모듈이 동일 사양인데 현재 동작 속도가 정격보다 낮음',
    symptoms: ['메모리 대역폭이 낮아 성능이 덜 나올 수 있음'],
    causes: [
      'BIOS에서 메모리 프로파일(XMP/EXPO)이 꺼져 있어 JEDEC 기본값으로 동작',
      '메인보드/CPU가 지원하는 상한에 걸림',
      '슬롯을 모두 채우면 속도 상한이 내려가는 보드 특성',
    ],
    actions: [
      act('BIOS에서 현재 메모리 설정과 사용 가능한 프로파일(XMP/EXPO)을 확인하세요', RISK.SAFE),
      act('메인보드 설명서에서 이 슬롯 구성으로 지원되는 최대 속도를 확인하세요', RISK.SAFE),
      act('프로파일을 켜기 전에 현재 BIOS 설정을 먼저 기록해두세요', RISK.SAFE),
      act('BIOS에서 메모리 프로파일을 활성화합니다 (잘못 설정하면 부팅이 안 될 수 있습니다)', RISK.INTERMEDIATE),
    ],
    verification: 'BIOS 설정을 바꾼 뒤 전체 진단을 다시 실행해 현재 동작 속도가 올라갔는지 확인하고, 안정성 테스트 탭에서 RAM 검사를 돌려 오류가 없는지 확인하세요.',
    wizard: [
      step('현재 메모리 구성 확인', '진단 결과의 RAM 항목에서 현재 속도와 정격 속도를 확인합니다.', RISK.SAFE),
      step('현재 BIOS 설정 기록', '바꾸기 전 지금 값을 남겨둡니다. 되돌릴 수 있어야 합니다.', RISK.SAFE),
      step('BIOS에서 메모리 프로파일 활성화', 'XMP/EXPO를 켭니다. 부팅이 안 되면 CMOS 클리어로 되돌립니다.', RISK.INTERMEDIATE),
      step('안정성 확인', 'RAM 검사를 돌려 새 설정에서 오류가 없는지 확인합니다.', RISK.SAFE, 'view-stability'),
      step('재검사', '전체 진단을 다시 실행해 속도가 반영됐는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  'MEMORY-ABOVE-RATED-SPEED': {
    version: '2026.08.1',
    category: 'RAM',
    title: '메모리가 모듈 정격보다 높은 속도로 동작 중입니다 (설정 변경됨)',
    detection: '현재 동작 속도가 모듈이 보고한 정격보다 높음',
    symptoms: ['그 자체로는 증상이 없음', '설정이 과하면 간헐적 재부팅·블루스크린으로 이어질 수 있음'],
    causes: ['XMP/EXPO 등 메모리 프로파일 적용', 'BIOS에서 수동으로 메모리 속도를 올림'],
    actions: [
      act('의도한 설정인지 확인하세요 (중고로 받은 PC라면 이전 사용자가 바꿔뒀을 수 있습니다)', RISK.SAFE),
      act('안정성 테스트 탭에서 RAM 검사를 실행해 현재 설정에서 오류가 없는지 확인하세요', RISK.SAFE),
      act('불안정하다면 BIOS에서 프로파일을 끄고 기본값으로 되돌리세요', RISK.INTERMEDIATE),
    ],
    verification: '안정성 테스트 탭에서 RAM 무결성 검사를 실행해 오류가 0인지 확인하고, Windows 이벤트 로그에 WHEA 오류가 늘지 않는지 확인하세요.',
    wizard: [
      step('의도한 설정인지 확인', '직접 바꾼 적이 없다면 중고 PC의 이전 사용자 설정일 수 있습니다.', RISK.SAFE),
      step('현재 설정에서 안정성 검사', 'RAM 무결성 검사를 돌려 오류가 나오는지 봅니다. 오류가 없다면 굳이 바꿀 필요는 없습니다.', RISK.SAFE, 'view-stability'),
      step('이벤트 로그 확인', '최근 WHEA 오류나 예기치 않은 재부팅이 있었는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
      step('불안정하면 기본값으로 되돌리기', 'BIOS에서 프로파일을 끕니다. 안정성이 성능보다 우선입니다.', RISK.INTERMEDIATE),
      step('재검사', '전체 진단을 다시 실행해 메모리 속도가 의도한 값인지, RAM 검사에 오류가 없는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  'MEMORY-SINGLE-CHANNEL': {
    version: '2026.08.1',
    category: 'RAM',
    title: '메모리가 한 채널에만 꽂혀 있습니다',
    detection: '모듈이 2개 이상인데 모두 같은 채널에 장착됨',
    symptoms: ['메모리 대역폭이 절반이라 내장 그래픽·게임에서 성능 차이가 날 수 있음'],
    causes: ['조립 시 슬롯 배치를 맞추지 않음'],
    actions: [
      act('메인보드 설명서에서 듀얼 채널 슬롯 배치(보통 A2/B2)를 확인하세요', RISK.SAFE),
      act('전원을 완전히 끄고 모듈을 권장 슬롯으로 옮겨 꽂으세요', RISK.LOW),
    ],
    verification: '슬롯을 옮긴 뒤 전체 진단을 다시 실행해 채널 구성이 둘로 나뉘었는지 확인하세요.',
    wizard: [
      step('권장 슬롯 배치 확인', '메인보드 설명서에서 듀얼 채널 슬롯을 확인합니다(보통 A2/B2).', RISK.SAFE),
      step('전원 차단', '전원을 끄고 코드를 뽑은 뒤 잔류 전원을 뺍니다.', RISK.LOW),
      step('모듈 재배치', '권장 슬롯으로 옮겨 꽂습니다. 딸깍 소리가 날 때까지 확실히 눌러 넣습니다.', RISK.LOW),
      step('재검사', '전체 진단을 다시 실행해 채널이 둘로 나뉘었는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  // ================= 설정 변경 =================
  'CPU-BASE-CLOCK-MODIFIED': {
    version: '2026.08.1',
    category: 'CPU',
    title: 'CPU 기본 클럭이 정품 사양보다 높습니다 (설정 변경됨)',
    detection: '시스템이 보고한 기본 클럭이 모델명에 표기된 정품 클럭보다 높음',
    symptoms: ['그 자체로는 증상이 없음', '설정이 과하면 발열 증가·간헐적 재부팅으로 이어질 수 있음'],
    causes: ['BIOS에서 BCLK 또는 배수를 수동으로 올림', '메인보드의 자동 오버클럭 기능이 켜져 있음'],
    actions: [
      act('의도한 설정인지 확인하세요 (중고 PC라면 이전 사용자 설정일 수 있습니다)', RISK.SAFE),
      act('안정성 테스트 탭에서 CPU 부하 테스트를 실행해 현재 설정에서 문제가 없는지 확인하세요', RISK.SAFE),
      act('불안정하다면 BIOS에서 기본값(Load Optimized Defaults)으로 되돌리세요', RISK.INTERMEDIATE),
    ],
    verification: 'BIOS 설정을 확인/변경한 뒤 전체 진단을 다시 실행해 기본 클럭 표기가 달라졌는지 확인하세요.',
    wizard: [
      step('의도한 설정인지 확인', '직접 바꾼 적이 없다면 이전 사용자나 보드의 자동 오버클럭 기능일 수 있습니다.', RISK.SAFE),
      step('현재 설정에서 부하 테스트', 'CPU 부하 테스트로 온도와 안정성을 확인합니다. 문제가 없다면 그대로 둬도 됩니다.', RISK.SAFE, 'view-stability'),
      step('현재 BIOS 설정 기록', '되돌릴 계획이라면 지금 값을 먼저 남겨둡니다.', RISK.SAFE),
      step('기본값으로 되돌리기', 'BIOS에서 Load Optimized Defaults를 적용합니다.', RISK.INTERMEDIATE),
      step('재검사', '전체 진단을 다시 실행해 기본 클럭이 정품 값으로 돌아왔는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  'GPU-POWER-LIMIT-MODIFIED': {
    version: '2026.08.1',
    category: 'GPU',
    title: 'GPU 전력 제한이 기본값과 다릅니다',
    detection: 'nvidia-smi가 보고한 현재 전력 제한이 기본 전력 제한과 다름',
    symptoms: ['상향: 성능이 오르지만 발열·소비 전력 증가', '하향: 발열이 줄지만 성능 제한'],
    causes: ['오버클럭 유틸리티로 전력 제한 변경', '이전 사용자가 설정한 프로파일이 남아 있음'],
    actions: [
      act('의도한 설정인지 확인하세요 (중고 PC라면 이전 사용자 설정일 수 있습니다)', RISK.SAFE),
      act('안정성 테스트 탭에서 GPU 부하 테스트를 실행해 현재 설정에서 문제가 없는지 확인하세요', RISK.SAFE),
      act('기본값으로 되돌리려면 nvidia-smi -pl <기본값> (관리자 권한 필요)', RISK.INTERMEDIATE),
    ],
    verification: '설정을 되돌린 뒤 전체 진단을 다시 실행해 전력 제한이 기본값과 같아졌는지 확인하세요.',
    wizard: [
      step('의도한 설정인지 확인', 'MSI Afterburner 같은 유틸리티가 시작 프로그램에 있는지 확인합니다.', RISK.SAFE),
      step('현재 설정에서 GPU 부하 테스트', '온도와 안정성을 확인합니다.', RISK.SAFE, 'view-stability'),
      step('되돌릴 값 확인', '진단 결과에 적힌 기본 전력 제한 값을 확인합니다.', RISK.SAFE),
      step('전력 제한 되돌리기', '관리자 권한 명령 프롬프트에서 nvidia-smi -pl <기본값>을 실행합니다.', RISK.INTERMEDIATE),
      step('재검사', '전체 진단을 다시 실행해 기본값과 같아졌는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  'CONFIG-STABILITY-INVESTIGATION': {
    version: '2026.08.1',
    category: 'EVENTS',
    title: '설정이 변경된 상태에서 하드웨어 오류 이벤트가 함께 확인됩니다',
    detection: '설정 변경(오버클럭/프로파일)이 확인되고, 최근 이벤트 로그에 WHEA·블루스크린·예기치 않은 종료가 있음',
    symptoms: ['간헐적 재부팅', '블루스크린', '특정 작업에서만 발생하는 멈춤'],
    causes: ['변경된 설정에서 시스템이 완전히 안정적이지 않을 가능성', '설정과 무관한 별개의 하드웨어 문제', '전원 공급(파워서플라이) 용량 부족'],
    actions: [
      act('변경된 설정을 일시적으로 기본값으로 되돌린 뒤 며칠 사용하며 같은 오류가 다시 나는지 확인하세요', RISK.SAFE),
      act('안정성 테스트 탭에서 CPU·RAM·GPU 부하 테스트를 실행해 현재 설정에서 오류가 재현되는지 확인하세요', RISK.SAFE),
      act('오류가 사라지면 설정을 한 단계씩만 다시 올리며 어느 지점에서 재발하는지 좁히세요', RISK.SAFE),
    ],
    verification: '설정을 기본값으로 되돌린 뒤 며칠 사용하고 전체 진단을 다시 실행해 오류 이벤트가 늘지 않는지 확인하세요.',
    wizard: [
      step('현재 설정 기록', '되돌리기 전에 지금 설정을 남겨둡니다. 원인이 아니었다면 다시 올려야 합니다.', RISK.SAFE),
      step('부하 테스트로 재현 시도', '지금 설정에서 오류가 재현되는지 봅니다. 재현되면 원인을 좁히기 쉬워집니다.', RISK.SAFE, 'view-stability'),
      step('기본값으로 되돌리기', '변경된 항목을 기본값으로 돌립니다.', RISK.INTERMEDIATE),
      step('며칠 사용하며 관찰', '평소처럼 사용하면서 같은 오류가 다시 나는지 봅니다. 이 단계는 시간이 필요합니다.', RISK.SAFE),
      step('재검사 후 판단', '전체 진단을 다시 실행합니다. 오류가 멈췄다면 설정이 원인이었을 가능성이 높습니다.', RISK.SAFE, 'view-dashboard'),
    ],
  },

  // ================= 기준선 =================
  'BASELINE-IDLE-TEMP-RISE': {
    version: '2026.08.1',
    category: 'CPU',
    title: '유휴 온도가 평소보다 높습니다',
    detection: '같은 유휴 상태에서 기록해둔 기준선보다 온도가 크게 높음',
    symptoms: ['팬 소음 증가', '고부하 시 더 빨리 스로틀링'],
    causes: [
      '기준선 측정 때보다 실내 온도가 높음(계절·냉방 여부)',
      '직전까지 고부하 작업을 해서 잔열이 남아 있음',
      '방열판·팬에 먼지가 쌓여 냉각 성능이 떨어짐',
      '서멀 그리스 열화 또는 쿨러 장착 상태 변화',
    ],
    actions: [
      act('몇 분간 아무 작업도 하지 않은 뒤 다시 진단해 잔열 영향을 배제하세요', RISK.SAFE),
      act('케이스를 열어 방열판·팬 먼지를 제거한 뒤 다시 진단하세요', RISK.LOW),
      act('실내 온도가 기준선 측정 때와 크게 다르다면 기준선을 다시 측정하세요', RISK.SAFE),
    ],
    verification: '먼지 제거 후 PC를 몇 분 유휴 상태로 둔 다음 전체 진단을 다시 실행해 평소 대비 차이가 줄었는지 확인하세요.',
    wizard: [
      step('잔열 영향 배제', 'PC를 5분 이상 그대로 두고 다시 진단합니다. 직전 작업의 잔열이면 이 단계에서 사라집니다.', RISK.SAFE, 'view-dashboard'),
      step('실내 온도 확인', '기준선을 측정한 때와 계절·냉방 상태가 크게 다르면 그것만으로 10°C 안팎 차이가 납니다.', RISK.SAFE),
      step('먼지 제거', '전원을 끄고 케이스를 열어 방열판과 팬의 먼지를 제거합니다.', RISK.LOW),
      step('재검사', '전체 진단을 다시 실행해 평소 대비 차이가 줄었는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
      step('그래도 높으면 기준선 재측정', '실내 환경 자체가 달라졌다면 지금 상태를 새 기준선으로 잡습니다.', RISK.SAFE, 'view-baseline'),
    ],
  },

  'BASELINE-IDLE-MEMORY-RISE': {
    version: '2026.08.1',
    category: 'RAM',
    title: '유휴 메모리 사용률이 평소보다 높습니다',
    detection: '같은 유휴 상태에서 기록해둔 기준선보다 메모리 사용률이 크게 높음',
    symptoms: ['프로그램 전환이 느려짐', '가용 메모리 부족으로 인한 디스크 스왑 증가'],
    causes: ['시작 프로그램·백그라운드 상주 프로그램이 늘어남', '메모리를 반환하지 않는 프로그램이 실행 중', '기준선 측정 이후 설치한 프로그램의 상주 서비스'],
    actions: [
      act('작업 관리자에서 메모리를 많이 쓰는 프로그램이 무엇인지 먼저 확인하세요', RISK.SAFE),
      act('작업 관리자 → 시작 프로그램에서 불필요한 항목 비활성화', RISK.LOW),
      act('메모리 점유가 큰 상주 프로그램 확인 후 종료', RISK.LOW),
      act('정리 후 기준선을 다시 측정해 새 평소 상태를 기록', RISK.SAFE),
    ],
    verification: '상주 프로그램을 정리하고 재부팅한 뒤 전체 진단을 다시 실행해 유휴 사용률이 기준선에 가까워졌는지 확인하세요.',
    wizard: [
      step('메모리를 많이 쓰는 프로그램 확인', '작업 관리자에서 메모리 점유 상위 프로세스를 봅니다.', RISK.SAFE),
      step('시작 프로그램 정리', '작업 관리자 → 시작 프로그램에서 쓰지 않는 항목을 끕니다.', RISK.LOW),
      step('재부팅', '변경 사항을 적용합니다.', RISK.LOW),
      step('재검사', '전체 진단을 다시 실행해 유휴 사용률이 내려갔는지 확인합니다.', RISK.SAFE, 'view-dashboard'),
      step('필요하면 기준선 재측정', '정리한 상태를 새 평소 상태로 기록합니다.', RISK.SAFE, 'view-baseline'),
    ],
  },
};

function getIssue(id) {
  return ENTRIES[id] || null;
}

// 이슈에 붙일 지식(원인·조치·재검사·Wizard)을 꺼낸다.
// 규칙 모듈은 여기서 받은 값을 그대로 쓰고, 측정값이 들어가는 문장만 직접 만든다.
function knowledge(id) {
  const e = ENTRIES[id];
  if (!e) return null;
  return {
    id,
    version: e.version,
    category: e.category,
    title: e.title,
    causes: e.causes,
    actions: e.actions,
    verification: e.verification,
    symptoms: e.symptoms,
    detection: e.detection,
    wizard: e.wizard || [],
  };
}

// Wizard에 안전 안내를 붙인다 (기획서 §45).
// 되돌리기 어려운 단계가 있으면, 시작 전에 현재 설정을 남기라고 먼저 알린다.
function wizardFor(id) {
  const e = ENTRIES[id];
  if (!e || !e.wizard || !e.wizard.length) return null;
  const highest = e.wizard.reduce((max, s) => (riskRank(s.risk) > riskRank(max) ? s.risk : max), RISK.SAFE);
  return {
    issueId: id,
    title: e.title,
    steps: e.wizard.map((s, i) => ({ ...s, index: i + 1, riskLabel: RISK_LABEL[s.risk] })),
    highestRisk: highest,
    highestRiskLabel: RISK_LABEL[highest],
    warning: RISK_NEEDS_BACKUP.includes(highest)
      ? '이 절차에는 되돌리기 어려운 단계가 있습니다. 시작하기 전에 현재 설정을 사진이나 메모로 남겨두세요. BIOS 설정을 잘못 바꾸면 부팅이 되지 않을 수 있으며, 그때는 CMOS 클리어로 복구합니다.'
      : null,
  };
}

const RISK_ORDER = [RISK.SAFE, RISK.LOW, RISK.INTERMEDIATE, RISK.ADVANCED, RISK.EXPERT];
function riskRank(r) {
  const i = RISK_ORDER.indexOf(r);
  return i === -1 ? 0 : i;
}

function listIssues() {
  return Object.keys(ENTRIES).map((id) => ({ id, ...ENTRIES[id] }));
}

module.exports = {
  ENTRIES, DB_VERSION, RISK, RISK_LABEL, RISK_ORDER, RISK_NEEDS_BACKUP,
  getIssue, knowledge, wizardFor, listIssues, riskRank,
};
