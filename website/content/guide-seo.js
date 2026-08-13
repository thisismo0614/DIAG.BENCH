// website/content/guide-seo.js
// 문제 해결 가이드 페이지의 "검색용 겉옷".
//
// 역할 분리 — 이 파일에 판정 지식을 적지 않는다:
//
//   src/engine/issueDb.js   무엇이 문제이고 어떻게 고치는가 (원인·조치·위험도·절차)
//                           → 앱과 사이트가 같은 원본을 쓴다. 여기가 유일한 진실이다.
//
//   이 파일                  그 문제를 사람들이 어떤 말로 검색하는가
//                           → 페이지 제목, 메타 설명, 도입 문단, 관련 글 링크.
//
// 이렇게 나누는 이유: 안내 내용을 여기에 복사해두면 issueDb가 바뀔 때 사이트만 옛말을
// 하게 된다. 겉옷만 여기 두면 본문은 항상 앱과 일치한다.
//
// ⚠ 항목이 없어도 페이지는 생성된다(issueDb의 title로 대체). 새 규칙을 추가한 뒤
//    이 파일을 잊어도 사이트가 깨지지는 않되, 검색 유입은 약해진다.

module.exports = {
  'MEMORY-MIXED-DIMM-BELOW-RATED': {
    slug: 'ram-mixed-modules-slow',
    pageTitle: '램을 섞어 꽂으면 속도가 낮아지는 이유',
    metaDesc: '제조사나 용량이 다른 메모리를 함께 꽂으면 가장 낮은 공통 설정으로 동작합니다. 현재 속도와 정격 속도를 확인하는 방법, XMP/EXPO로 되돌리는 절차를 단계별로 안내합니다.',
    intro: '메모리를 증설했는데 체감 성능이 오르지 않거나, 진단 도구가 정격보다 낮은 속도를 표시하는 경우가 있습니다. 서로 다른 사양의 모듈이 함께 꽂혀 있으면 메인보드는 <strong>모든 모듈이 함께 안정적으로 동작할 수 있는 가장 낮은 설정</strong>을 고릅니다. 고장이 아니라 호환을 위한 정상 동작이지만, 성능은 손해입니다.',
    related: ['memory-profile', 'dual-channel'],
  },

  'MEMORY-BELOW-RATED-SPEED': {
    slug: 'ram-below-rated-speed',
    pageTitle: '램이 정격 속도로 동작하지 않을 때 (2666MHz 고정 등)',
    metaDesc: '3200MHz 메모리가 2666MHz로만 잡히는 것은 대부분 고장이 아니라 BIOS에서 XMP/EXPO가 꺼져 있기 때문입니다. 원인 구분과 활성화 절차, 되돌리는 방법을 안내합니다.',
    intro: '분명 3200MHz짜리 메모리를 샀는데 2133이나 2666으로 표시된다면, 십중팔구 고장이 아닙니다. 메모리는 <strong>기본적으로 JEDEC 표준 속도로 동작</strong>하고, 상자에 적힌 속도는 BIOS에서 프로파일(XMP/EXPO)을 켜야 나옵니다. 즉 사야 할 것을 잘못 산 것이 아니라, 켜야 할 것을 아직 안 켠 상태입니다.',
    related: ['memory-profile', 'dual-channel'],
  },

  'MEMORY-ABOVE-RATED-SPEED': {
    slug: 'ram-above-rated-speed',
    pageTitle: '메모리가 정격보다 빠르게 동작할 때 — 확인해야 할 것',
    metaDesc: '메모리가 표기 정격보다 높은 속도로 동작 중이라면 XMP/EXPO가 적용됐거나 수동 설정이 남아 있는 상태입니다. 그 자체는 고장이 아니지만 안정성 확인이 필요한 이유를 설명합니다.',
    intro: '정격보다 빠른 것은 <strong>그 자체로 문제가 아닙니다</strong>. 대부분 XMP/EXPO를 켠 결과이거나, 누군가 BIOS에서 수동으로 올려둔 상태입니다. 다만 직접 설정한 기억이 없다면 — 특히 중고로 받은 PC라면 — 이전 사용자의 설정이 그대로 남아 있는 것이므로, 그 설정에서 실제로 안정적인지 한 번은 확인해두는 편이 좋습니다.',
    related: ['memory-profile', 'event-log'],
  },

  'MEMORY-SINGLE-CHANNEL': {
    slug: 'ram-single-channel',
    pageTitle: '듀얼 채널이 안 잡힐 때 — 램 슬롯 위치 확인하기',
    metaDesc: '메모리를 두 개 꽂았는데 싱글 채널로 동작하면 대역폭이 절반입니다. 메인보드 권장 슬롯(보통 A2/B2) 확인과 재장착 절차를 안내합니다.',
    intro: '메모리를 두 개 꽂았다고 자동으로 듀얼 채널이 되지는 않습니다. <strong>같은 채널의 두 슬롯에 나란히 꽂으면 싱글 채널로 동작</strong>하고, 대역폭은 절반이 됩니다. 특히 내장 그래픽을 쓰는 시스템에서는 체감 차이가 큽니다. 슬롯 위치만 바꿔 꽂으면 해결되는, 비용이 들지 않는 문제입니다.',
    related: ['dual-channel', 'memory-profile'],
  },

  'CPU-BASE-CLOCK-MODIFIED': {
    slug: 'cpu-overclock-detected',
    pageTitle: 'CPU가 오버클럭되어 있는지 확인하는 법 (중고 PC 점검)',
    metaDesc: '시스템이 보고한 기본 클럭이 정품 사양보다 높다면 BIOS에서 설정이 변경된 상태입니다. 중고 PC를 받았을 때 확인하는 방법과 기본값으로 되돌리는 절차를 안내합니다.',
    intro: '중고로 PC를 받았을 때 확인해두면 좋은 항목입니다. 이전 사용자가 오버클럭을 해뒀다면 그 설정은 <strong>초기화하지 않는 한 그대로 남아 있습니다</strong>. 오버클럭 자체가 고장은 아니지만, 어떤 상태로 받았는지 모른 채 쓰다가 나중에 원인 모를 재부팅을 겪는 것보다는 지금 확인해두는 편이 낫습니다.',
    related: ['event-log', 'result-states'],
  },

  'GPU-POWER-LIMIT-MODIFIED': {
    slug: 'gpu-power-limit-changed',
    pageTitle: '그래픽카드 전력 제한이 기본값과 다를 때',
    metaDesc: 'nvidia-smi가 보고한 전력 제한이 기본값과 다르면 오버클럭 유틸리티나 이전 사용자의 프로파일이 남아 있는 상태입니다. 확인과 복구 방법을 안내합니다.',
    intro: 'MSI Afterburner 같은 유틸리티로 전력 제한을 바꾸면 그 값은 프로그램을 지운 뒤에도 <strong>프로파일이 남아 시작할 때마다 다시 적용</strong>되는 경우가 있습니다. 전력 제한을 낮춰두면 발열은 줄지만 성능이 묶이고, 높여두면 반대입니다. 성능이 기대보다 낮은데 이유를 모르겠다면 여기부터 보는 것이 빠릅니다.',
    related: ['vram', 'result-states'],
  },

  'CONFIG-STABILITY-INVESTIGATION': {
    slug: 'overclock-bluescreen',
    pageTitle: '오버클럭 상태에서 블루스크린·재부팅이 날 때 원인 좁히기',
    metaDesc: '설정이 변경된 상태에서 WHEA 오류나 예기치 않은 종료가 함께 확인되면 두 가지를 나눠서 봐야 합니다. 설정을 되돌려 원인을 좁히는 순서를 안내합니다.',
    intro: '설정이 변경돼 있고 하드웨어 오류 이벤트도 있다면, <strong>둘이 연결돼 있다고 단정할 수 없습니다</strong>. 오버클럭이 원인일 수도 있고, 전혀 무관한 부품 문제일 수도 있으며, 파워서플라이 용량이 모자란 것일 수도 있습니다. 추측으로 부품을 사기 전에, 되돌릴 수 있는 것부터 하나씩 빼면서 범위를 좁히는 것이 순서입니다.',
    related: ['event-log', 'result-states'],
  },

  'BATTERY-CAPACITY-DEGRADED': {
    slug: 'laptop-battery-degraded',
    pageTitle: '노트북 배터리 수명이 줄었을 때 — 용량 확인과 판단 기준',
    metaDesc: '완충 용량이 설계 용량의 80% 아래로 내려가면 체감 사용 시간이 뚜렷하게 줄어듭니다. 실제 용량을 확인하는 방법과 교체를 판단하는 기준을 안내합니다.',
    intro: '배터리는 소모품이라 시간이 지나면 반드시 줄어듭니다. 문제는 <strong>얼마나 줄어든 것이 정상인지</strong>를 알기 어렵다는 점입니다. 사이클 수가 적은데 용량이 많이 줄었다면 사용량이 아니라 보관 환경이 원인일 수 있고, 반대라면 자연스러운 열화입니다. 두 값을 함께 봐야 판단이 됩니다.',
    related: ['battery-health', 'result-states'],
  },

  'BASELINE-IDLE-TEMP-RISE': {
    slug: 'cpu-idle-temp-higher',
    pageTitle: 'CPU 온도가 평소보다 높아졌을 때',
    metaDesc: '같은 유휴 상태인데 온도가 평소보다 높다면 잔열, 실내 온도, 먼지 중 하나입니다. 순서대로 배제하는 방법을 안내합니다.',
    intro: '"CPU 온도 60도면 높은 건가요"라는 질문에는 답하기 어렵습니다. 정상 범위는 부품과 환경에 따라 다르기 때문입니다. 대신 답할 수 있는 질문이 있습니다 — <strong>"이 PC의 평소보다 높은가"</strong>. 같은 조건에서 잰 평소 값이 있으면 비교가 되고, 그때부터는 원인을 좁힐 수 있습니다.',
    related: ['cpu-temperature', 'result-states'],
  },

  'BASELINE-IDLE-MEMORY-RISE': {
    slug: 'idle-memory-usage-higher',
    pageTitle: '아무것도 안 켰는데 메모리 사용량이 높을 때',
    metaDesc: '유휴 상태의 메모리 사용률이 평소보다 높다면 시작 프로그램이나 상주 서비스가 늘어난 것입니다. 원인을 찾아 정리하는 순서를 안내합니다.',
    intro: '프로그램을 아무것도 켜지 않았는데 메모리가 절반 넘게 차 있다면, 대개 <strong>그동안 설치한 프로그램들이 백그라운드에 남아 있는 것</strong>입니다. 하나하나는 작지만 쌓이면 체감됩니다. 어떤 프로그램이 언제부터 늘었는지는 평소 값과 비교해야 알 수 있습니다.',
    related: ['result-states', 'cpu-temperature'],
  },
};
