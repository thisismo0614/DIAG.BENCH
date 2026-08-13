// website/content/strings/ko.js
// 사이트의 "겉옷" 문구 — 내비게이션, 푸터, 가이드 페이지의 고정 제목들.
//
// 앱의 문구(src/i18n/strings)와 나눠 둔 이유: 이건 사이트에만 있는 말이다.
// 반대로 문제 해결 지식(원인·조치·절차)은 앱의 issueDb에서 오고, 사이트는 그것을
// 다시 적지 않는다 — website/lib/guides.js 주석 참고.
//
// ⚠ 한국어 문구를 고치면 **살아 있는 페이지의 글자가 바뀐다.** 지금 값은 배포된
//    사이트와 한 글자까지 같게 맞춰 둔 것이다(다국어 전환 시 회귀를 막기 위해).

module.exports = {
  htmlLang: 'ko',
  ogLocale: 'ko_KR',
  // 이 언어로 볼 수 있는 페이지가 있다는 것을 다른 언어 페이지에서 알릴 때 쓰는 이름
  languageName: '한국어',

  skipLink: '본문으로 건너뛰기',
  navLabel: '주요 메뉴',
  footerNavLabel: '푸터 메뉴',
  languageNavLabel: '언어',

  nav: {
    guides: '문제 해결',
    learn: '기술 해설',
    userGuide: '사용법',
    download: '다운로드',
    faq: 'FAQ',
    github: 'GitHub',
  },

  footer: {
    product: '제품',
    learn: '알아보기',
    useCases: '활용',
    project: '프로젝트',
    legal: '라이선스 · 방침',
    items: {
      download: '다운로드',
      features: '기능',
      faq: 'FAQ',
      guides: '문제 해결 가이드',
      learnHub: '기술 해설',
      userGuide: '사용 설명서',
      technical: '기술 문서',
      usedPc: '중고 PC 점검',
      repairShop: '수리점 입출고',
      preDelivery: '조립 PC 출고 검사',
      verify: '받은 리포트 검증',
      source: '소스 코드',
      releases: '릴리스',
      issues: '버그 신고',
      docs: '문서',
      license: 'MIT License',
      thirdParty: '서드파티 고지',
      privacy: '개인정보처리방침',
    },
  },

  copyright: (year, product) => `© ${year} ${product} · 오픈소스 (MIT)`,

  // ---- 다운로드 버튼과 버전 표기 ----
  // 릴리스 API에서 온 값(버전·크기)을 문장으로 만드는 자리. 이게 언어별로 없으면
  // 영어 페이지의 버튼이 한국어로 나간다(실제로 그렇게 나가던 것을 검사에서 잡았다).
  download: {
    label: 'Windows용 다운로드',
    sub: (version, sizeMB, prerelease) =>
      `${version} · Windows x64 · ${sizeMB} MB${prerelease ? ' · 사전 릴리스' : ''}`,
    subNoRelease: 'GitHub 릴리스 페이지에서 최신 버전을 확인하세요',
    versionLine: (version, date, prerelease) =>
      `최신 버전 <strong>${version}</strong> · ${date} 배포`
      + (prerelease ? ' · <strong>사전 릴리스</strong>(정식판 이전 버전입니다)' : ''),
    versionLineNoRelease: '아직 공개된 릴리스가 없습니다',
    formatDate: (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`,
  },

  // ---- 문제 해결 가이드 페이지 ----
  guide: {
    crumbsLabel: '현재 위치',
    home: '홈',
    guidesHub: '문제 해결 가이드',
    eyebrow: (cat) => `${cat} 문제 해결`,
    detectionHeading: '이 문제가 맞는지 확인하기',
    detectionLead: 'DIAG.BENCH는 다음 조건일 때 이 항목을 표시합니다.',
    symptomsHeading: '이런 증상으로 나타납니다',
    causesHeading: '원인으로 볼 수 있는 것',
    causesHint: '가능성이 높은 순서입니다. 하나로 단정하지 말고 아래 절차로 좁혀 나가세요.',
    actionsHeading: '조치와 위험도',
    actionsHint: '확인만 하는 안전한 조치가 먼저 옵니다. 되돌리기 어려운 것일수록 뒤에 있습니다.',
    riskyNotice: '<strong>시작하기 전에.</strong> 이 절차에는 되돌리기 어려운 단계가 있습니다.\n'
      + '         현재 설정을 사진이나 메모로 먼저 남겨두세요. BIOS 설정을 잘못 바꾸면 부팅이 되지 않을 수\n'
      + '         있으며, 그때는 메인보드의 CMOS 클리어로 복구합니다.',
    wizardHeading: '단계별 해결 절차',
    verificationHeading: '제대로 해결됐는지 확인하기',
    verificationNotice: '고쳤다고 생각한 뒤 <strong>같은 조건에서 다시 측정해 값이 실제로 달라졌는지</strong>\n'
      + '         확인하는 것까지가 한 세트입니다. 바뀌지 않았다면 원인이 다른 곳에 있습니다.',
    relatedHeading: '더 읽어보기',
    ctaHeading: '이 항목을 내 PC에서 직접 확인해 보세요',
    ctaLead: 'DIAG.BENCH는 위 조건을 자동으로 검사하고, 해당하면 이 절차를 화면에서 단계별로 안내합니다.',
    // 앵커 id. 한국어 페이지는 이미 배포돼 있어 바꾸면 외부 링크가 깨진다.
    anchors: {
      detection: '확인', symptoms: '증상', causes: '원인', actions: '조치',
      wizard: '절차', verification: '재검사', related: '관련',
    },
  },

  // ---- 문제 해결 가이드 허브 ----
  guidesHub: {
    eyebrow: '문제 해결 가이드',
    h1: '증상별로 원인을 좁혀 나가는 방법',
    lead: (n) => `DIAG.BENCH가 실제로 판정하는 항목 ${n}가지입니다.\n`
      + '      각 문서는 <strong>이 문제가 맞는지 확인하는 조건</strong>, 원인 후보, 위험도를 표시한 조치,\n'
      + '      그리고 되돌릴 수 있는 순서로 배열한 단계별 절차로 이루어집니다.\n'
      + '      프로그램 없이 읽기만 해도 도움이 되도록 썼습니다.',
    ctaHeading: '내 PC는 어디에 해당하는지 확인해 보세요',
    ctaLead: '위 항목을 전부 자동으로 검사하고, 해당하는 것만 근거와 함께 알려줍니다.',
    title: '문제 해결 가이드 — DIAG.BENCH',
    desc: (n) => `메모리 속도, 듀얼 채널, 오버클럭 흔적, 배터리 열화, 유휴 온도 상승 등 PC에서 자주 나타나는 ${n}가지 문제의 원인과 단계별 해결 절차를 위험도와 함께 안내합니다.`,
    listName: 'DIAG.BENCH 문제 해결 가이드',
  },

  categories: {
    RAM: '메모리', CPU: 'CPU', GPU: '그래픽카드', BATTERY: '배터리',
    EVENTS: '시스템 이벤트', STORAGE: '저장장치', NETWORK: '네트워크',
  },

  risk: {
    SAFE: { text: '안전', hint: '확인만 합니다. 시스템을 바꾸지 않습니다.' },
    LOW: { text: '낮음', hint: '되돌리기 쉽습니다.' },
    INTERMEDIATE: { text: '중간', hint: 'BIOS 설정을 바꿉니다. 잘못하면 부팅이 안 될 수 있습니다.' },
    ADVANCED: { text: '높음', hint: '전압/클럭을 직접 조정합니다.' },
    EXPERT: { text: '매우 높음', hint: '실패 시 복구가 어렵습니다.' },
  },

  // 이 언어로 아직 번역되지 않은 영역을 안내할 때. 한국어는 원본이라 필요 없다.
  partialNotice: null,
};
