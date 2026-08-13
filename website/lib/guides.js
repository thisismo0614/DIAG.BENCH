// website/lib/guides.js
// src/engine/issueDb.js 한 항목 → 문제 해결 가이드 페이지 하나.
//
// 왜 앱의 지식 DB를 사이트가 직접 읽는가:
//   같은 내용을 사이트에 다시 적으면 반드시 어긋난다. 규칙이 바뀌어 앱의 안내가 달라져도
//   사이트는 옛 안내를 계속 보여주고, 그걸 알아채는 사람이 없다. 원본을 하나로 두면
//   issueDb를 고치는 순간 사이트도 같이 바뀐다.
//
// 위저드 5단계는 그대로 schema.org의 HowTo가 된다 — 우리가 SEO를 위해 절차를 지어낸 것이
// 아니라, 앱이 실제로 안내하는 절차가 구조화 데이터로 나가는 것이다.
//
// 다국어: 본문(원인·조치·절차)은 issueDb가 언어별로 주고, 이 파일의 고정 제목은
// website/content/strings/<lang>.js에서 온다. 이 파일에는 어느 언어의 문장도 없다.

const { esc } = require('./markdown');

function badge(risk, t) {
  const b = t.risk[risk] || t.risk.SAFE;
  const cls = `risk-${String(risk || 'SAFE').toLowerCase()}`;
  return `<span class="risk ${cls}" title="${esc(b.hint)}">${b.text}</span>`;
}

// 이슈 id → 파일명. SEO 겉옷에 slug가 있으면 그것을 쓴다(검색어에 가까운 말이 낫다).
//
// ⚠ slug는 **언어와 무관하게 같아야 한다.** hreflang은 두 언어 페이지를 URL로 짝짓기
//    때문에, 언어마다 파일명이 다르면 짝이 깨진다. (guide-seo.en.js에 slug가 없는 이유)
function slugFor(id, seo) {
  const s = (seo && seo.slug) || String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `guide-${s}.html`;
}

/**
 * 가이드 페이지 하나를 만든다.
 * @param {object} issue  issueDb의 listIssues(locale) 항목 (id 포함)
 * @param {object} seo    guide-seo(.en).js의 해당 항목 (없어도 동작한다)
 * @param {Map}    learnSlugs  관련 글 id → { file, title }. 비어 있으면 "더 읽어보기"를 생략한다
 *                            (그 언어로 번역된 해설 글이 없다는 뜻이다)
 * @param {object} t      website/content/strings/<lang>.js
 * @param {string} homeHref  그 언어의 첫 화면 파일명. 영어에는 index.html이 없으므로
 *                           가이드 허브가 그 역할을 한다 — 없는 페이지를 가리키면 404가 된다
 */
function renderGuide(issue, seo = {}, learnSlugs = new Map(), t, homeHref = 'index.html') {
  const h1 = seo.pageTitle || issue.title;
  const cat = t.categories[issue.category] || issue.category;
  const wizard = issue.wizard || [];
  const g = t.guide;
  const a = g.anchors;

  // 되돌리기 어려운 단계가 있으면 시작 전에 경고한다 (기획서 §45와 같은 규칙).
  const risky = wizard.some((s) => ['INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(s.risk))
    || (issue.actions || []).some((x) => ['INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(x.risk));

  const parts = [];

  // 첫 화면이 곧 가이드 허브인 언어(영어)에서는 같은 주소를 두 번 적지 않는다.
  const homeIsHub = homeHref === 'guides.html';
  const homeCrumb = homeIsHub
    ? ''
    : `\n  <a href="${homeHref}">${esc(g.home)}</a> <span aria-hidden="true">›</span>`;

  parts.push(`
<nav class="crumbs" aria-label="${esc(g.crumbsLabel)}">${homeCrumb}
  <a href="guides.html">${esc(g.guidesHub)}</a> <span aria-hidden="true">›</span>
  <span aria-current="page">${esc(cat)}</span>
</nav>

<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${esc(g.eyebrow(cat))}</p>
    <h1>${esc(h1)}</h1>
    ${seo.intro ? `<p class="lead">${seo.intro}</p>` : `<p class="lead">${esc(issue.title)}</p>`}
  </div>
</section>

<section class="article">
  <div class="wrap article-body">`);

  // --- 이 문제가 맞는지 ---
  parts.push(`
    <h2 id="${a.detection}">${esc(g.detectionHeading)}</h2>
    <p>${esc(g.detectionLead)}</p>
    <div class="detect">${esc(issue.detection)}</div>`);

  if ((issue.symptoms || []).length) {
    parts.push(`
    <h3 id="${a.symptoms}">${esc(g.symptomsHeading)}</h3>
    <ul class="tick">${issue.symptoms.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`);
  }

  // --- 원인 ---
  if ((issue.causes || []).length) {
    parts.push(`
    <h2 id="${a.causes}">${esc(g.causesHeading)}</h2>
    <p class="hint">${esc(g.causesHint)}</p>
    <ol class="causes">${issue.causes.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`);
  }

  // --- 조치 ---
  if ((issue.actions || []).length) {
    parts.push(`
    <h2 id="${a.actions}">${esc(g.actionsHeading)}</h2>
    <p class="hint">${esc(g.actionsHint)}</p>
    <ul class="actions">${issue.actions.map((x) => `
      <li>${badge(x.risk, t)}<span>${esc(x.text)}</span></li>`).join('')}
    </ul>`);
  }

  // --- 단계별 절차 ---
  if (wizard.length) {
    if (risky) {
      parts.push(`
    <div class="notice notice-warn">
      <p>${g.riskyNotice}</p>
    </div>`);
    }

    parts.push(`
    <h2 id="${a.wizard}">${esc(g.wizardHeading)}</h2>
    <ol class="wizard">${wizard.map((s) => `
      <li>
        <h3>${esc(s.title)} ${badge(s.risk, t)}</h3>
        <p>${esc(s.detail)}</p>
      </li>`).join('')}
    </ol>`);
  }

  // --- 재검사 ---
  if (issue.verification) {
    parts.push(`
    <h2 id="${a.verification}">${esc(g.verificationHeading)}</h2>
    <p>${esc(issue.verification)}</p>
    <div class="notice">
      <p>${g.verificationNotice}</p>
    </div>`);
  }

  // --- 관련 글 ---
  const rel = (seo.related || []).map((k) => learnSlugs.get(k)).filter(Boolean);
  if (rel.length) {
    parts.push(`
    <h2 id="${a.related}">${esc(g.relatedHeading)}</h2>
    <ul class="plain-list">${rel.map((r) => `<li><a href="${r.file}">${esc(r.title)}</a></li>`).join('')}</ul>`);
  }

  parts.push(`
  </div>
</section>

<section class="final-cta">
  <div class="wrap">
    <h2>${esc(g.ctaHeading)}</h2>
    <p>${esc(g.ctaLead)}</p>
    <div class="cta">
      <a class="btn btn-primary" href="{{DOWNLOAD_URL}}">
        <span class="btn-main">{{DOWNLOAD_LABEL}}</span>
        <span class="btn-sub">{{DOWNLOAD_SUB}}</span>
      </a>
    </div>
  </div>
</section>`);

  // --- 구조화 데이터: HowTo + BreadcrumbList ---
  const jsonld = [];

  if (wizard.length) {
    jsonld.push({
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: h1,
      description: seo.metaDesc || issue.title,
      totalTime: 'PT30M',
      step: wizard.map((s, i) => ({
        '@type': 'HowToStep',
        position: i + 1,
        name: s.title,
        text: s.detail,
      })),
    });
  }

  // 구조화 데이터의 빵부스러기도 화면과 같아야 한다. 화면에는 없는 단계를 여기에만
  // 넣으면 검색 결과가 실제 페이지와 다른 경로를 보여주게 된다.
  const crumbItems = homeIsHub
    ? [
      { '@type': 'ListItem', position: 1, name: g.guidesHub, item: '{{PAGE_BASE}}/guides.html' },
      { '@type': 'ListItem', position: 2, name: h1 },
    ]
    : [
      { '@type': 'ListItem', position: 1, name: g.home, item: '{{PAGE_BASE}}/' },
      { '@type': 'ListItem', position: 2, name: g.guidesHub, item: '{{PAGE_BASE}}/guides.html' },
      { '@type': 'ListItem', position: 3, name: h1 },
    ];

  jsonld.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbItems,
  });

  return {
    file: slugFor(issue.id, seo),
    title: `${h1} — DIAG.BENCH`,
    desc: seo.metaDesc || issue.detection,
    h1,
    category: cat,
    body: parts.join('\n'),
    jsonld,
  };
}

module.exports = { renderGuide, slugFor, badge };
