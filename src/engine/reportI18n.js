// src/engine/reportI18n.js
// 완성된 진단 리포트를 다른 언어로 옮긴다.
//
// 왜 규칙 코드가 아니라 여기서 하는가 — 판정과 번역은 시점이 다르다.
// 규칙은 "지금 이 값이 위험한가"를 정하고(rules.js), 번역은 "그 결론을 어느 언어로
// 읽을 것인가"를 정한다. 섞어두면 언어를 하나 추가할 때마다 판정 코드를 건드리게 되고,
// 그건 이 프로젝트에서 가장 만지면 안 되는 코드다.
//
// ⚠ 이 파일은 **판정을 바꾸지 않는다.** level·confidence·evidence의 개수·순서는 그대로다.
//    번역이 심각도를 바꿀 수 있으면, 영어 화면에서 critical이 watch로 보일 수 있다.

const { SOURCE_LOCALE } = require('../i18n');

const CATALOGS = {
  en: require('../i18n/rules/en'),
};

// 번역문을 실제 문자열로 만든다. 함수면 측정값(params)을 넣어 부르고, 문자열이면 그대로.
function resolve(v, params) {
  return typeof v === 'function' ? v(params || {}) : v;
}

const filled = (s) => typeof s === 'string' && s.trim().length > 0;

/**
 * 번역문이 원문과 **같은 모양**인지 검사한다.
 *
 * 원인·조치·근거는 화면에서 목록으로 나란히 놓이고, 근거는 그 이슈를 왜 그렇게 판정했는지
 * 보여주는 자리다. 번역에서 한 줄이 빠지면 "근거 3개 중 2개만 보이는" 상태가 되는데,
 * 이 프로젝트에서 근거가 조용히 사라지는 것은 판정을 조용히 바꾸는 것과 같다.
 *
 * 어긋나면 그 이슈만 통째로 원문으로 남긴다 — 절반만 번역된 것보다 낫다.
 */
function matches(issue, tr, params) {
  if (!tr) return false;

  const title = resolve(tr.title, params);
  const explanation = resolve(tr.explanation, params);
  if (!filled(title) || !filled(explanation)) return false;

  // 원문에 있는 항목은 번역에도 같은 개수로 있어야 한다.
  const pairs = [
    [issue.causes, resolve(tr.causes, params)],
    [issue.actions, resolve(tr.actions, params)],
    [issue.evidence, resolve(tr.evidence, params)],
  ];
  for (const [orig, next] of pairs) {
    const o = orig || [];
    if (!o.length) continue;                       // 원문에 없으면 번역도 없어도 된다
    if (!Array.isArray(next) || next.length !== o.length) return false;
    if (!next.every(filled)) return false;
  }

  // 재검사 방법은 "고쳤는지 확인하는 법"이다. 원문에 있는데 번역에서 빠지면
  // 영어 사용자만 확인 절차를 못 받는다.
  if (issue.verification && !filled(resolve(tr.verification, params))) return false;
  return true;
}

function localizeIssue(issue, locale) {
  const catalog = CATALOGS[locale];
  const id = issue.msg && issue.msg.id;
  const tr = id && catalog ? catalog[id] : null;
  const params = (issue.msg && issue.msg.params) || {};

  if (!matches(issue, tr, params)) {
    return { ...issue, locale: SOURCE_LOCALE, translated: false };
  }

  const pick = (key) => (tr[key] === undefined ? issue[key] : resolve(tr[key], params));
  return {
    ...issue,
    title: resolve(tr.title, params),
    explanation: resolve(tr.explanation, params),
    causes: (issue.causes || []).length ? resolve(tr.causes, params) : issue.causes,
    actions: (issue.actions || []).length ? resolve(tr.actions, params) : issue.actions,
    evidence: (issue.evidence || []).length ? resolve(tr.evidence, params) : issue.evidence,
    verification: issue.verification ? pick('verification') : issue.verification,
    // ⚠ level·confidence·confidenceLabel·topProcesses·wizard는 손대지 않는다.
    //    번역이 심각도를 바꿀 수 있으면 안 된다.
    locale,
    translated: true,
  };
}

/**
 * 리포트 전체를 옮긴다. 원본은 바꾸지 않고 새 객체를 돌려준다.
 *
 * 돌려주는 리포트에는 `i18n`이 붙는다 — 몇 개 중 몇 개가 번역됐고 무엇이 빠졌는지.
 * "영어판입니다"라고 해놓고 절반이 한국어면, 그 사실을 화면이 알 수 있어야 한다.
 */
function localizeReport(report, locale) {
  if (!report || locale === SOURCE_LOCALE || !CATALOGS[locale]) {
    return { ...report, i18n: { locale: SOURCE_LOCALE, total: 0, translated: 0, missing: [] } };
  }

  const missing = [];
  let total = 0;
  let done = 0;

  const sections = (report.sections || []).map((s) => ({
    ...s,
    issues: (s.issues || []).map((i) => {
      total++;
      const out = localizeIssue(i, locale);
      if (out.translated) done++;
      else missing.push((i.msg && i.msg.id) || i.title);
      return out;
    }),
  }));

  return {
    ...report,
    sections,
    i18n: { locale, total, translated: done, missing, complete: total > 0 && done === total },
  };
}

module.exports = { localizeReport, localizeIssue };
