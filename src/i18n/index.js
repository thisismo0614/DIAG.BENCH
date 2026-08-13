// src/i18n/index.js
// 언어 계층의 뿌리. 앱(Electron)과 웹사이트 빌드(website/build.js)가 **같은 것**을 쓴다.
//
// 왜 한곳에 두는가 — 사이트의 문제 해결 가이드는 앱의 issueDb에서 생성된다.
// 번역을 두 군데에 따로 두면 같은 문제에 대한 안내가 앱과 웹에서 갈라진다.
// 그건 이 프로젝트가 issueDb를 규칙 코드에서 분리한 이유와 정확히 같은 이유로 막아야 한다.
//
// ⚠ 이 파일과 하위 모듈은 **의존성이 없어야 한다.** website.yml은 `node build.js`만
//    실행하고 npm install을 하지 않는다(build.js 주석 참고). require 대상이 늘어나면
//    사이트 빌드가 깨진다.

// 지원 언어. 여기에 없는 값이 들어오면 조용히 무시하고 기본 언어로 떨어진다.
//
// ⚠ 언어를 추가할 때: 이 배열에 넣는 것만으로는 부족하다. strings/<code>.js와
//    issues/<code>.js가 있어야 하고, 없으면 그 언어는 "번역되지 않은 상태"로
//    표시된다 — 한국어 문장이 영어인 척 나가는 것보다 그게 낫다.
const SUPPORTED_LOCALES = ['ko', 'en'];

// 원본 언어. 번역이 없을 때 여기로 떨어진다.
//
// 이 값이 '영어가 기본'으로 바뀌는 날이 오더라도, **원문이 한국어라는 사실은 남는다.**
// 번역이 원문과 어긋났을 때 무엇이 정답인지 판단할 기준이 필요하기 때문이다.
const SOURCE_LOCALE = 'ko';

// 언어별 표시 이름. 언어 선택 메뉴는 **그 언어로** 이름을 보여줘야 한다
// (한국어를 못 읽는 사람이 "한국어"라고 쓰인 항목을 고를 수는 없다).
const LOCALE_NAMES = {
  ko: '한국어',
  en: 'English',
};

// 'en-US', 'EN_us', 'en' → 'en'. 알 수 없으면 null.
//
// null을 돌려주는 것이 중요하다. 모르는 값을 조용히 기본 언어로 바꿔버리면
// "왜 내 언어 설정이 무시되는가"를 추적할 수 없다. 판단은 호출부가 한다.
function normalizeLocale(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const base = tag.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

/**
 * 실제로 쓸 언어를 정한다.
 * @param {string|null} preferred  사용자가 설정에서 고른 값 (없으면 null)
 * @param {string|null} systemTag  OS/브라우저가 알려준 언어 (예: app.getLocale())
 *
 * 우선순위: 사용자 설정 > 시스템 언어 > 원본 언어.
 * 사용자가 명시적으로 고른 값이 시스템 값보다 항상 우선한다 — 한국어 Windows에서
 * 영어로 쓰고 싶은 사람이 실제로 있다.
 */
function resolveLocale(preferred, systemTag) {
  return normalizeLocale(preferred) || normalizeLocale(systemTag) || SOURCE_LOCALE;
}

module.exports = {
  SUPPORTED_LOCALES, SOURCE_LOCALE, LOCALE_NAMES,
  normalizeLocale, resolveLocale,
};
