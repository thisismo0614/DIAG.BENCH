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

const { esc } = require('./markdown');

// 카테고리 → 사람이 읽는 이름
const CATEGORY_LABEL = {
  RAM: '메모리',
  CPU: 'CPU',
  GPU: '그래픽카드',
  BATTERY: '배터리',
  EVENTS: '시스템 이벤트',
  STORAGE: '저장장치',
  NETWORK: '네트워크',
};

// 위험도 → 배지 문구와 클래스. issueDb의 RISK_LABEL보다 짧게(배지에 들어가야 한다).
const RISK_BADGE = {
  SAFE: { text: '안전', cls: 'risk-safe', hint: '확인만 합니다. 시스템을 바꾸지 않습니다.' },
  LOW: { text: '낮음', cls: 'risk-low', hint: '되돌리기 쉽습니다.' },
  INTERMEDIATE: { text: '중간', cls: 'risk-intermediate', hint: 'BIOS 설정을 바꿉니다. 잘못하면 부팅이 안 될 수 있습니다.' },
  ADVANCED: { text: '높음', cls: 'risk-advanced', hint: '전압/클럭을 직접 조정합니다.' },
  EXPERT: { text: '매우 높음', cls: 'risk-expert', hint: '실패 시 복구가 어렵습니다.' },
};

function badge(risk) {
  const b = RISK_BADGE[risk] || RISK_BADGE.SAFE;
  return `<span class="risk ${b.cls}" title="${esc(b.hint)}">${b.text}</span>`;
}

// 이슈 id → 파일명. SEO 겉옷에 slug가 있으면 그것을 쓴다(검색어에 가까운 말이 낫다).
function slugFor(id, seo) {
  const s = (seo && seo.slug) || String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `guide-${s}.html`;
}

/**
 * 가이드 페이지 하나를 만든다.
 * @param {object} issue  issueDb의 listIssues() 항목 (id 포함)
 * @param {object} seo    guide-seo.js의 해당 항목 (없어도 동작한다)
 * @param {Map}    learnSlugs  관련 글 id → { file, title }
 */
function renderGuide(issue, seo = {}, learnSlugs = new Map()) {
  const h1 = seo.pageTitle || issue.title;
  const cat = CATEGORY_LABEL[issue.category] || issue.category;
  const wizard = issue.wizard || [];

  // 되돌리기 어려운 단계가 있으면 시작 전에 경고한다 (기획서 §45와 같은 규칙).
  const risky = wizard.some((s) => ['INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(s.risk))
    || (issue.actions || []).some((a) => ['INTERMEDIATE', 'ADVANCED', 'EXPERT'].includes(a.risk));

  const parts = [];

  parts.push(`
<nav class="crumbs" aria-label="현재 위치">
  <a href="index.html">홈</a> <span aria-hidden="true">›</span>
  <a href="guides.html">문제 해결 가이드</a> <span aria-hidden="true">›</span>
  <span aria-current="page">${esc(cat)}</span>
</nav>

<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${esc(cat)} 문제 해결</p>
    <h1>${esc(h1)}</h1>
    ${seo.intro ? `<p class="lead">${seo.intro}</p>` : `<p class="lead">${esc(issue.title)}</p>`}
  </div>
</section>

<section class="article">
  <div class="wrap article-body">`);

  // --- 이 문제가 맞는지 ---
  parts.push(`
    <h2 id="확인">이 문제가 맞는지 확인하기</h2>
    <p>DIAG.BENCH는 다음 조건일 때 이 항목을 표시합니다.</p>
    <div class="detect">${esc(issue.detection)}</div>`);

  if ((issue.symptoms || []).length) {
    parts.push(`
    <h3 id="증상">이런 증상으로 나타납니다</h3>
    <ul class="tick">${issue.symptoms.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`);
  }

  // --- 원인 ---
  if ((issue.causes || []).length) {
    parts.push(`
    <h2 id="원인">원인으로 볼 수 있는 것</h2>
    <p class="hint">가능성이 높은 순서입니다. 하나로 단정하지 말고 아래 절차로 좁혀 나가세요.</p>
    <ol class="causes">${issue.causes.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`);
  }

  // --- 조치 ---
  if ((issue.actions || []).length) {
    parts.push(`
    <h2 id="조치">조치와 위험도</h2>
    <p class="hint">확인만 하는 안전한 조치가 먼저 옵니다. 되돌리기 어려운 것일수록 뒤에 있습니다.</p>
    <ul class="actions">${issue.actions.map((a) => `
      <li>${badge(a.risk)}<span>${esc(a.text)}</span></li>`).join('')}
    </ul>`);
  }

  // --- 단계별 절차 ---
  if (wizard.length) {
    if (risky) {
      parts.push(`
    <div class="notice notice-warn">
      <p><strong>시작하기 전에.</strong> 이 절차에는 되돌리기 어려운 단계가 있습니다.
         현재 설정을 사진이나 메모로 먼저 남겨두세요. BIOS 설정을 잘못 바꾸면 부팅이 되지 않을 수
         있으며, 그때는 메인보드의 CMOS 클리어로 복구합니다.</p>
    </div>`);
    }

    parts.push(`
    <h2 id="절차">단계별 해결 절차</h2>
    <ol class="wizard">${wizard.map((s) => `
      <li>
        <h3>${esc(s.title)} ${badge(s.risk)}</h3>
        <p>${esc(s.detail)}</p>
      </li>`).join('')}
    </ol>`);
  }

  // --- 재검사 ---
  if (issue.verification) {
    parts.push(`
    <h2 id="재검사">제대로 해결됐는지 확인하기</h2>
    <p>${esc(issue.verification)}</p>
    <div class="notice">
      <p>고쳤다고 생각한 뒤 <strong>같은 조건에서 다시 측정해 값이 실제로 달라졌는지</strong>
         확인하는 것까지가 한 세트입니다. 바뀌지 않았다면 원인이 다른 곳에 있습니다.</p>
    </div>`);
  }

  // --- 관련 글 ---
  const rel = (seo.related || []).map((k) => learnSlugs.get(k)).filter(Boolean);
  if (rel.length) {
    parts.push(`
    <h2 id="관련">더 읽어보기</h2>
    <ul class="plain-list">${rel.map((r) => `<li><a href="${r.file}">${esc(r.title)}</a></li>`).join('')}</ul>`);
  }

  parts.push(`
  </div>
</section>

<section class="final-cta">
  <div class="wrap">
    <h2>이 항목을 내 PC에서 직접 확인해 보세요</h2>
    <p>DIAG.BENCH는 위 조건을 자동으로 검사하고, 해당하면 이 절차를 화면에서 단계별로 안내합니다.</p>
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

  jsonld.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '홈', item: '{{SITE_URL}}/' },
      { '@type': 'ListItem', position: 2, name: '문제 해결 가이드', item: '{{SITE_URL}}/guides.html' },
      { '@type': 'ListItem', position: 3, name: h1 },
    ],
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

module.exports = { renderGuide, slugFor, CATEGORY_LABEL, RISK_BADGE, badge };
