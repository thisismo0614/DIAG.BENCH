// website/content/learn.js
// 기술 해설 글 목록.
//
// 글 본문은 templates/learn-*.html에 있고, 여기에는 **목록에 필요한 정보만** 둔다.
// 이 파일이 원본이 되어 learn.html(허브)이 생성되고, 문제 해결 가이드의 "더 읽어보기"도
// 여기를 참조한다. 목록을 두 군데 적지 않기 위해서다.
//
// build.js가 file에 해당하는 템플릿이 실제로 있는지 검사하고, 없으면 빌드를 실패시킨다
// (링크만 있고 페이지가 없는 상태로 배포되는 것을 막는다).

module.exports = [
  {
    id: 'cpu-temperature',
    file: 'learn-cpu-temperature.html',
    title: 'CPU 온도가 표시되지 않는 이유',
    blurb: '"이 시스템에는 온도 센서가 없습니다"는 대부분 사실이 아닙니다. 센서는 있고, 읽을 권한이 없는 것입니다. 우리가 이 차이를 어떻게 확인했는지와 해결 방법.',
    topic: 'CPU',
  },
  {
    id: 'battery-health',
    file: 'learn-battery-health.html',
    title: '노트북 배터리 실제 용량 확인하는 법',
    blurb: 'Windows가 알려주는 배터리 정보는 자리가 비어 있는 경우가 많습니다. 설계 용량을 실제로 얻을 수 있는 경로는 하나뿐이며, 그 이유를 실측으로 확인했습니다.',
    topic: '배터리',
  },
  {
    id: 'smart',
    file: 'learn-smart.html',
    title: 'SMART 값 읽는 법 — 어떤 항목이 실제로 위험한가',
    blurb: 'SMART 항목은 수십 개지만 실제로 교체를 결정할 근거가 되는 것은 몇 개뿐입니다. 재할당 섹터·대기 섹터·수명을 어떻게 봐야 하는지.',
    topic: '저장장치',
  },
  {
    id: 'memory-profile',
    file: 'learn-memory-profile.html',
    title: 'XMP·EXPO란 무엇인가 — 산 대로 안 나오는 메모리 속도',
    blurb: '메모리는 기본적으로 표준 속도로 동작하고, 상자에 적힌 속도는 따로 켜야 나옵니다. 왜 이런 구조인지와, 켜기 전에 알아둘 것.',
    topic: '메모리',
  },
  {
    id: 'dual-channel',
    file: 'learn-dual-channel.html',
    title: '듀얼 채널 확인하는 법과 슬롯 위치가 중요한 이유',
    blurb: '메모리를 두 개 꽂아도 슬롯 위치가 틀리면 대역폭이 절반입니다. 확인 방법과 올바른 배치.',
    topic: '메모리',
  },
  {
    id: 'vram',
    file: 'learn-vram.html',
    title: 'VRAM 용량이 프로그램마다 다르게 보이는 이유',
    blurb: '같은 그래픽카드인데 8GB로도, 16GB로도, 0.5GB로도 표시됩니다. 전용·공유·할당은 서로 다른 값이며, 무엇을 봐야 하는지.',
    topic: '그래픽카드',
  },
  {
    id: 'event-log',
    file: 'learn-event-log.html',
    title: 'Windows 이벤트 로그로 하드웨어 문제 찾기',
    blurb: '갑자기 꺼지거나 블루스크린이 났을 때 흔적은 이벤트 로그에 남습니다. WHEA와 Kernel-Power 41을 어떻게 읽어야 하는지.',
    topic: '시스템',
  },
  {
    id: 'result-states',
    file: 'learn-result-states.html',
    title: '"검사하지 않음"은 "정상"이 아닙니다',
    blurb: '많은 진단 도구가 측정하지 못한 항목을 초록색으로 표시합니다. 우리가 결과를 여섯 단계로 나눈 이유와, 그 차이가 왜 중요한지.',
    topic: '설계',
  },
];
