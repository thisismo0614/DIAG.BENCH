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
const { knowledge, wizardFor } = require('./issueDb');

const CATALOGS = {
  en: require('../i18n/rules/en'),
};

// 상관관계가 덧붙이는 근거 줄. 두 이슈의 메시지 id 쌍이 키다(rules.js의 crossReference).
const CROSS_REF_CATALOGS = {
  en: require('../i18n/rules/en-crossref'),
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
const sameLen = (a, b) => Array.isArray(b) && (a || []).length === b.length && b.every(filled);

/**
 * 지식 DB에서 문구를 가져온 이슈(ruleId가 있는 것)의 번역본.
 *
 * 이런 이슈는 원인·조치·재검사·Wizard를 issueDb에서 그대로 받아 쓴다(rules.js의
 * `knowledge(id)` 호출부 참고). 그러니 번역도 **issueDb의 번역본을 그대로 써야 한다.**
 * 여기에 다시 적어두면 같은 안내에 대한 원본이 둘이 되고, 언젠가 반드시 어긋난다 —
 * issueDb를 규칙 코드에서 분리한 이유와 정확히 같은 이유다.
 *
 * issueDb 쪽 번역이 없으면 null을 돌려준다. 그 이슈는 원문으로 남는다.
 */
function knowledgeOverlay(issue, locale) {
  if (!issue.ruleId) return null;
  const kb = knowledge(issue.ruleId, locale);
  if (!kb || !kb.translated) return null;
  if (!sameLen(issue.causes, kb.causes)) return null;
  if (!sameLen(issue.actions, (kb.actions || []).map((a) => a.text))) return null;
  if (issue.verification && !filled(kb.verification)) return null;
  return kb;
}

/**
 * 번역 조각을 모아 "이 이슈를 완전히 옮길 수 있는가"를 판단한다.
 *
 * 원문에 있는 항목은 하나도 빠짐없이 번역본이 있어야 한다. 하나라도 없으면 null —
 * 그 이슈는 통째로 원문으로 남는다. 절반만 번역된 화면이 잘못된 근거를 보여주는 것보다,
 * 한국어로 보이되 정확한 편이 낫다.
 */
function buildTranslation(issue, locale) {
  const catalog = CATALOGS[locale];
  const CROSS_REFS = CROSS_REF_CATALOGS[locale] || {};
  const id = issue.msg && issue.msg.id;
  const tr = (id && catalog) ? catalog[id] : null;
  if (!tr) return null;
  const params = (issue.msg && issue.msg.params) || {};

  const kb = knowledgeOverlay(issue, locale);

  // 제목이 지식 DB에서 그대로 온 이슈(배터리 열화 등)는 카탈로그에 제목을 두지 않는다.
  // 두면 같은 문장이 두 곳에 생기고, 한쪽만 고치는 날 어긋난다.
  const title = tr.title !== undefined ? resolve(tr.title, params) : (kb ? kb.title : null);
  const explanation = resolve(tr.explanation, params);
  if (!filled(title) || !filled(explanation)) return null;

  const out = { title, explanation };

  // 원인·조치는 카탈로그가 있으면 카탈로그를, 없으면 지식 DB를 쓴다.
  for (const key of ['causes', 'actions']) {
    if (!(issue[key] || []).length) continue;
    let next = tr[key] !== undefined ? resolve(tr[key], params)
      : (kb ? (key === 'actions' ? kb.actions.map((a) => a.text) : kb.causes) : null);
    if (!sameLen(issue[key], next)) return null;
    out[key] = next;
  }

  // 근거는 측정값이 들어가므로 언제나 카탈로그에서 온다.
  //
  // ⚠ 상관관계 단계(applyCorrelations)가 **이슈를 만든 뒤에** 근거를 덧붙인다.
  //    그 줄은 카탈로그가 알 수 없으므로, 붙은 개수만큼 따로 번역해 뒤에 이어 붙인다.
  //    하나라도 번역이 없으면 이 이슈는 통째로 원문으로 남는다 — 영어 근거 목록 한가운데
  //    한국어 한 줄이 끼는 것보다 낫다.
  if ((issue.evidence || []).length) {
    const extras = issue.msgExtra || [];
    const base = issue.evidence.slice(0, issue.evidence.length - extras.length);
    const next = resolve(tr.evidence, params);
    if (!sameLen(base, next)) return null;

    const extraLines = [];
    for (const x of extras) {
      const entry = CROSS_REFS[x.pair];
      const line = entry ? resolve(entry[x.side], x.params || params) : null;
      if (!filled(line)) return null;
      extraLines.push(line);
    }
    out.evidence = [...next, ...extraLines];
  }

  // 재검사 방법은 "고쳤는지 확인하는 법"이다. 원문에 있는데 번역에서 빠지면
  // 영어 사용자만 확인 절차를 못 받는다.
  if (issue.verification) {
    const next = tr.verification !== undefined ? resolve(tr.verification, params)
      : (kb ? kb.verification : null);
    if (!filled(next)) return null;
    out.verification = next;
  }

  if (kb) {
    if (issue.actionDetails) out.actionDetails = kb.actions;
    if (issue.wizard) {
      const w = wizardFor(issue.ruleId, locale);
      if (!w || !w.translated) return null;
      out.wizard = w;
    }
  }
  return out;
}

function localizeIssue(issue, locale) {
  const tr = buildTranslation(issue, locale);
  if (!tr) return { ...issue, locale: SOURCE_LOCALE, translated: false };
  // ⚠ level·confidence·confidenceLabel·topProcesses는 여기 없다.
  //    번역이 심각도를 바꿀 수 있으면 안 된다.
  return { ...issue, ...tr, locale, translated: true };
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
