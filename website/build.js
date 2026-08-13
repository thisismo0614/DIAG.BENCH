#!/usr/bin/env node
// website/build.js
// 정적 사이트 생성기. 템플릿(templates/*.html)에 값을 채워 dist/로 내보낸다.
//
// 왜 런타임 JS로 GitHub API를 부르지 않는가:
//  - 인증 없는 GitHub API는 IP당 시간당 60회 제한이 있다. 방문자가 몰리면 다운로드 버튼이
//    깨진다(요구사항 24).
//  - 그래서 **빌드 시점에 한 번만** 조회해서 HTML에 값을 박아 넣는다. 방문자 브라우저는
//    API를 전혀 호출하지 않으므로 rate limit도, 네트워크 실패도 없다.
//  - 새 릴리스가 나오면 release.yml이 이 빌드를 다시 트리거한다(요구사항 23).
//  - 조회에 실패해도 사이트는 깨지지 않는다. "GitHub에서 최신 릴리스 보기" 링크로 대체된다.

const fs = require('fs');
const path = require('path');

// 앱의 지식 DB를 사이트가 직접 읽는다. 같은 내용을 사이트에 옮겨 적으면 반드시 어긋나므로,
// 문제 해결 가이드는 issueDb 한 곳에서 생성한다(website/lib/guides.js 주석 참고).
// issueDb.js는 의존성이 없는 순수 모듈이라 npm install 없이 require할 수 있다 —
// website.yml은 `node build.js`만 실행하므로 이 성질이 유지되어야 한다.
const issueDb = require('../src/engine/issueDb');
const guideSeo = require('./content/guide-seo');
const learnArticles = require('./content/learn');
const md = require('./lib/markdown');
const { renderGuide, slugFor } = require('./lib/guides');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const DOCS = path.join(ROOT, '..', 'docs');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf-8'));

// 환경변수가 있으면 설정 파일보다 우선한다(배포 환경마다 도메인이 다를 수 있으므로).
const owner = process.env.GITHUB_OWNER || cfg.owner;
const repo = process.env.GITHUB_REPOSITORY_NAME || cfg.repo;
const siteUrl = (process.env.SITE_URL || cfg.siteUrl).replace(/\/$/, '');
const analyticsId = process.env.ANALYTICS_ID || cfg.analyticsId || '';

const repoUrl = `https://github.com/${owner}/${repo}`;
const releasesUrl = `${repoUrl}/releases`;
const latestReleaseUrl = `${releasesUrl}/latest`;

// 릴리스 하나를 사이트가 쓰는 모양으로 정리한다. .exe 자산이 없으면 쓸 수 없다.
function toRelease(json) {
  if (!json) return null;
  // .exe 자산을 찾는다(체크섬 파일 등은 제외).
  const asset = (json.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe'));
  if (!asset) return null;
  return {
    version: json.tag_name,
    publishedAt: json.published_at,
    htmlUrl: json.html_url,
    assetName: asset.name,
    downloadUrl: asset.browser_download_url,
    sizeMB: (asset.size / 1024 / 1024).toFixed(1),
    prerelease: !!json.prerelease,
  };
}

async function fetchLatestRelease() {
  // 인증 토큰이 있으면 쓴다(Actions에서는 GITHUB_TOKEN으로 시간당 1000회).
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': `${repo}-website-build`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const api = (p) => fetch(`https://api.github.com/repos/${owner}/${repo}${p}`, { headers });

  try {
    const res = await api('/releases/latest');
    if (res.ok) {
      const rel = toRelease(await res.json());
      if (rel) return rel;
      console.warn('[build] 최신 릴리스는 있으나 .exe 자산이 없습니다. 전체 목록에서 다시 찾습니다.');
    } else if (res.status !== 404) {
      console.warn(`[build] 최신 릴리스 조회 실패 (HTTP ${res.status}). 저장소가 비공개일 수 있습니다.`);
      return null;
    }

    // ⚠ `/releases/latest`는 **사전 릴리스(prerelease)를 제외한다.** release.yml이 0.x 버전을
    //    prerelease로 발행하기 때문에, 이 API만 보면 실제로 릴리스가 있는데도 404가 나서
    //    사이트가 "아직 공개된 릴리스가 없습니다"라고 **사실과 다른 안내**를 하게 된다
    //    (v0.17.0이 발행된 상태에서 실제로 그랬다).
    //    그래서 전체 목록에서 draft가 아닌 최신 릴리스를 다시 찾는다. 대신 사전 릴리스면
    //    그 사실을 숨기지 않고 화면에 명시한다(아래 VERSION_LINE / DOWNLOAD_SUB).
    const listRes = await api('/releases?per_page=20');
    if (!listRes.ok) {
      console.warn(`[build] 릴리스 목록 조회 실패 (HTTP ${listRes.status}).`);
      return null;
    }
    const list = await listRes.json();
    // GitHub는 목록을 생성일 내림차순으로 준다. 첫 번째로 쓸 수 있는 것을 고른다.
    for (const json of list) {
      if (json.draft) continue;
      const rel = toRelease(json);
      if (rel) {
        if (rel.prerelease) console.warn(`[build] 정식 릴리스가 없어 사전 릴리스 ${rel.version}을 사용합니다.`);
        return rel;
      }
    }
    console.warn('[build] 사용할 수 있는 릴리스가 없습니다(.exe 자산을 가진 릴리스 없음).');
    return null;
  } catch (err) {
    console.warn(`[build] 릴리스 조회 중 오류: ${err.message}`);
    return null;
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

(async () => {
  const rel = await fetchLatestRelease();

  // 릴리스를 못 가져왔을 때의 대체 동작: 다운로드 버튼이 릴리스 목록 페이지로 간다.
  // 버튼이 사라지거나 404로 가는 일이 없도록 한다.
  const hasRelease = !!rel;
  const downloadUrl = hasRelease ? rel.downloadUrl : latestReleaseUrl;
  const versionLabel = hasRelease ? rel.version : '';
  const downloadLabel = 'Windows용 다운로드';
  // 사전 릴리스라는 사실을 숨기지 않는다 — 받는 사람이 안정판인지 아닌지 알아야 한다.
  const preTag = hasRelease && rel.prerelease ? ' · 사전 릴리스' : '';
  const downloadSub = hasRelease
    ? `${esc(rel.version)} · Windows x64 · ${rel.sizeMB} MB${preTag}`
    : 'GitHub 릴리스 페이지에서 최신 버전을 확인하세요';

  const vars = {
    PRODUCT_NAME: cfg.productName,
    TAGLINE: cfg.tagline,
    DESCRIPTION: cfg.description,
    SITE_URL: siteUrl,
    REPO_URL: repoUrl,
    RELEASES_URL: releasesUrl,
    ISSUES_URL: `${repoUrl}/issues`,
    LICENSE_URL: `${repoUrl}/blob/main/LICENSE`,
    THIRD_PARTY_URL: `${repoUrl}/blob/main/THIRD-PARTY-NOTICES.md`,
    README_URL: `${repoUrl}#readme`,
    DOWNLOAD_URL: downloadUrl,
    DOWNLOAD_LABEL: downloadLabel,
    DOWNLOAD_SUB: downloadSub,
    VERSION: versionLabel,
    VERSION_LINE: hasRelease
      ? `최신 버전 <strong>${esc(rel.version)}</strong> · ${fmtDate(rel.publishedAt)} 배포`
        + (rel.prerelease ? ' · <strong>사전 릴리스</strong>(정식판 이전 버전입니다)' : '')
      : '아직 공개된 릴리스가 없습니다',
    RELEASE_NOTES_URL: hasRelease ? rel.htmlUrl : releasesUrl,
    ASSET_NAME: hasRelease ? esc(rel.assetName) : '',
    MIN_WINDOWS: cfg.minWindows,
    YEAR: String(new Date().getFullYear()),
    // 페이지별로 덮어쓴다. 기본값을 둬야 치환 누락 검사에 걸리지 않는다.
    OG_TYPE: 'website',
    PAGE_JSONLD: '',
    // 분석 도구는 ID가 설정된 경우에만 삽입된다. 없으면 스크립트가 아예 안 들어간다.
    ANALYTICS: analyticsId
      ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(analyticsId)}"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(analyticsId)}')</script>`
      : '<!-- 분석 도구 미설정 -->',
  };

  // 릴리스 유무에 따라 보여줄 블록을 전환한다.
  const conditional = (html) => html
    .replace(/<!--IF_RELEASE-->([\s\S]*?)<!--\/IF_RELEASE-->/g, hasRelease ? '$1' : '')
    .replace(/<!--IF_NO_RELEASE-->([\s\S]*?)<!--\/IF_NO_RELEASE-->/g, hasRelease ? '' : '$1');

  // 페이지별 값까지 vars에 합쳐서 **한 번의 전역 치환**으로 처리한다.
  // (String.replace에 문자열을 넘기면 첫 번째 항목만 바뀐다 — {{PAGE_TITLE}}은 og:title,
  //  twitter:title에도 반복 등장하므로 전역 정규식으로 처리해야 한다.)
  const render = (tpl, pageVars = {}) => {
    const all = { ...vars, ...pageVars };
    return conditional(tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in all ? all[k] : m)));
  };

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // 템플릿 렌더링
  const tplDir = path.join(ROOT, 'templates');
  const layout = fs.readFileSync(path.join(tplDir, '_layout.html'), 'utf-8');
  const pages = fs.readdirSync(tplDir).filter((f) => f.endsWith('.html') && !f.startsWith('_'));

  // 사이트맵에 들어갈 목록. priority는 "사이트 안에서 얼마나 중심인 페이지인가"를 나타낸다.
  const sitemap = [];

  /**
   * 페이지 하나를 레이아웃에 끼워 dist에 쓴다.
   * 템플릿에서 온 것이든 생성된 것이든 이 함수를 지나게 해서, 헤더·구조화 데이터·치환 검사가
   * 한 곳에서만 처리되도록 한다.
   *
   * ⚠ 본문과 JSON-LD는 render() **이전에** 끼워 넣는다. String.replace의 치환 결과는 다시
   *    스캔되지 않으므로, 변수로 넘기면 그 안의 {{SITE_URL}} 같은 값이 치환되지 않고 남는다.
   *    치환 함수를 쓰는 것도 같은 이유다 — 문자열을 그대로 넘기면 본문의 `$&`, `$1`이
   *    특수 문자로 해석되어 내용이 조용히 망가진다.
   */
  const emit = (file, opts) => {
    const { title, desc, body, jsonld = [], ogType = 'website', priority = 0.6, index = true } = opts;
    const pageUrl = file === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${file}`;
    const ld = jsonld
      .map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`)
      .join('\n');

    const withBody = layout
      .replace('{{CONTENT}}', () => body)
      .replace('{{PAGE_JSONLD}}', () => ld);

    // ⚠ 제목·설명은 반드시 이스케이프한다. 이 값들은 content="…" 속성 안에 들어가므로,
    //    큰따옴표가 하나라도 있으면 거기서 속성이 끝나버려 설명이 잘린 채 배포된다.
    //    실제로 본문에 따옴표를 쓴 글의 description이 7자로 잘려 나간 적이 있다.
    //    &quot;는 <title> 안에서도 따옴표로 정상 표시되므로 두 자리 모두에 안전하다.
    const html = render(withBody, {
      PAGE_TITLE: esc(title),
      PAGE_DESC: esc(desc),
      CANONICAL: pageUrl,
      OG_TYPE: ogType,
    });

    // 치환되지 않고 남은 변수가 있으면 조용히 배포하지 않고 즉시 실패시킨다.
    const leftover = [...new Set((html.match(/\{\{[A-Z_]+\}\}/g) || []))];
    if (leftover.length) {
      throw new Error(`[build] ${file}: 치환되지 않은 템플릿 변수가 있습니다 → ${leftover.join(', ')}`);
    }
    fs.writeFileSync(path.join(OUT, file), html, 'utf-8');
    if (index) sitemap.push({ url: pageUrl, priority });
    console.log(`[build] ${file}`);
  };

  // 페이지별 우선순위. 적지 않은 페이지는 기본값을 쓴다.
  const PRIORITY = {
    'index.html': 1.0,
    'download.html': 0.9,
    'guides.html': 0.8,
    'learn.html': 0.8,
    'faq.html': 0.7,
    'user-guide.html': 0.7,
    'technical.html': 0.6,
  };

  // FAQ 페이지의 <details>를 읽어 FAQPage 구조화 데이터를 만든다.
  // 질문 목록을 JSON에 다시 적지 않는다 — 템플릿을 고치면 구조화 데이터도 같이 바뀐다.
  function faqJsonLd(body) {
    const items = [];
    const re = /<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const q = m[1].replace(/<[^>]+>/g, '').trim();
      const a = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (q && a) items.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } });
    }
    if (!items.length) return null;
    return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items };
  }

  // ---------- 1. 손으로 쓴 템플릿 ----------
  for (const file of pages) {
    const raw = fs.readFileSync(path.join(tplDir, file), 'utf-8');
    const titleMatch = raw.match(/<!--TITLE:(.*?)-->/);
    const descMatch = raw.match(/<!--DESC:(.*?)-->/);
    const body = raw.replace(/<!--TITLE:.*?-->\n?/, '').replace(/<!--DESC:.*?-->\n?/, '');

    const jsonld = [];
    if (file === 'faq.html') {
      const faq = faqJsonLd(body);
      if (faq) jsonld.push(faq);
    }
    // 해설·활용 글은 문서(article)로 표시하고 빵부스러기를 붙인다.
    const isArticle = /^(learn|use)-/.test(file);
    if (isArticle) {
      const hubFile = file.startsWith('learn-') ? 'learn.html' : 'index.html';
      const hubName = file.startsWith('learn-') ? '기술 해설' : '홈';
      jsonld.push({
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: `${siteUrl}/` },
          { '@type': 'ListItem', position: 2, name: hubName, item: `${siteUrl}/${hubFile}` },
          { '@type': 'ListItem', position: 3, name: titleMatch ? titleMatch[1].trim() : file },
        ],
      });
    }

    emit(file, {
      title: titleMatch ? titleMatch[1].trim() : cfg.productName,
      desc: descMatch ? descMatch[1].trim() : cfg.description,
      body,
      jsonld,
      ogType: isArticle ? 'article' : 'website',
      priority: PRIORITY[file] || (isArticle ? 0.7 : 0.6),
      index: file !== '404.html',
    });
  }

  // ---------- 2. 문제 해결 가이드 (앱의 지식 DB에서 생성) ----------
  const learnById = new Map(learnArticles.map((a) => [a.id, { file: a.file, title: a.title }]));

  // 링크만 있고 페이지가 없는 상태로 배포되지 않도록 검사한다.
  for (const a of learnArticles) {
    if (!pages.includes(a.file)) {
      throw new Error(`[build] content/learn.js가 ${a.file}을 가리키는데 templates/에 그 파일이 없습니다.`);
    }
  }

  const guides = issueDb.listIssues().map((it) => renderGuide(it, guideSeo[it.id] || {}, learnById));
  for (const g of guides) {
    emit(g.file, {
      title: g.title, desc: g.desc, body: g.body, jsonld: g.jsonld,
      ogType: 'article', priority: 0.8,
    });
  }

  // ---------- 3. 허브 페이지 (목록을 두 번 적지 않기 위해 생성한다) ----------
  const byCategory = new Map();
  for (const g of guides) {
    if (!byCategory.has(g.category)) byCategory.set(g.category, []);
    byCategory.get(g.category).push(g);
  }

  const guidesBody = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">문제 해결 가이드</p>
    <h1>증상별로 원인을 좁혀 나가는 방법</h1>
    <p class="lead">DIAG.BENCH가 실제로 판정하는 항목 ${guides.length}가지입니다.
      각 문서는 <strong>이 문제가 맞는지 확인하는 조건</strong>, 원인 후보, 위험도를 표시한 조치,
      그리고 되돌릴 수 있는 순서로 배열한 단계별 절차로 이루어집니다.
      프로그램 없이 읽기만 해도 도움이 되도록 썼습니다.</p>
  </div>
</section>

<section class="article">
  <div class="wrap">
    ${[...byCategory.entries()].map(([cat, list]) => `
    <h2 class="hub-cat">${cat}</h2>
    <div class="hub-grid">
      ${list.map((g) => `
      <a class="hub-card" href="${g.file}">
        <h3>${md.esc(g.h1)}</h3>
        <p>${md.esc(g.desc)}</p>
      </a>`).join('')}
    </div>`).join('\n')}
  </div>
</section>

<section class="final-cta">
  <div class="wrap">
    <h2>내 PC는 어디에 해당하는지 확인해 보세요</h2>
    <p>위 항목을 전부 자동으로 검사하고, 해당하는 것만 근거와 함께 알려줍니다.</p>
    <div class="cta">
      <a class="btn btn-primary" href="{{DOWNLOAD_URL}}">
        <span class="btn-main">{{DOWNLOAD_LABEL}}</span>
        <span class="btn-sub">{{DOWNLOAD_SUB}}</span>
      </a>
    </div>
  </div>
</section>`;

  emit('guides.html', {
    title: '문제 해결 가이드 — DIAG.BENCH',
    desc: `메모리 속도, 듀얼 채널, 오버클럭 흔적, 배터리 열화, 유휴 온도 상승 등 PC에서 자주 나타나는 ${guides.length}가지 문제의 원인과 단계별 해결 절차를 위험도와 함께 안내합니다.`,
    body: guidesBody,
    priority: 0.8,
    jsonld: [{
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'DIAG.BENCH 문제 해결 가이드',
      itemListElement: guides.map((g, i) => ({
        '@type': 'ListItem', position: i + 1, name: g.h1, url: `${siteUrl}/${g.file}`,
      })),
    }],
  });

  const learnBody = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">기술 해설</p>
    <h1>왜 그렇게 나오는지 알고 보면 다르게 보입니다</h1>
    <p class="lead">진단 결과를 읽다 보면 "왜 이 값은 안 나오지", "이 숫자는 믿어도 되나" 하는 의문이 생깁니다.
      대부분은 도구의 버그가 아니라 <strong>Windows가 그 값을 어떻게 다루는가</strong>의 문제입니다.
      직접 측정해 확인한 것만 적었습니다.</p>
  </div>
</section>

<section class="article">
  <div class="wrap">
    <div class="hub-grid">
      ${learnArticles.map((a) => `
      <a class="hub-card" href="${a.file}">
        <span class="hub-topic">${md.esc(a.topic)}</span>
        <h3>${md.esc(a.title)}</h3>
        <p>${md.esc(a.blurb)}</p>
      </a>`).join('')}
    </div>
  </div>
</section>`;

  emit('learn.html', {
    title: '기술 해설 — DIAG.BENCH',
    desc: 'CPU 온도가 안 보이는 이유, 배터리 설계 용량을 얻는 방법, SMART에서 실제로 봐야 할 항목, VRAM 표기가 제각각인 이유 등 PC 진단에서 자주 막히는 지점을 실측으로 설명합니다.',
    body: learnBody,
    priority: 0.8,
    jsonld: [{
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'DIAG.BENCH 기술 해설',
      itemListElement: learnArticles.map((a, i) => ({
        '@type': 'ListItem', position: i + 1, name: a.title, url: `${siteUrl}/${a.file}`,
      })),
    }],
  });

  // ---------- 4. 저장소 문서를 페이지로 ----------
  // 문서는 저장소에서 읽히는 것을 전제로 쓰였기 때문에 서로를 `USER-GUIDE.md`처럼 가리킨다.
  // 그대로 두면 사이트에서 404가 된다. 사이트에 대응 페이지가 있으면 그쪽으로,
  // 없으면 GitHub의 실제 파일로 보낸다.
  const DOC_LINKS = {
    'USER-GUIDE.md': 'user-guide.html',
    'TECHNICAL.md': 'technical.html',
  };
  const rewriteDocLinks = (html) => html.replace(/href="([^"]*\.md)"/g, (m, href) => {
    const base = href.replace(/^.*\//, '');
    if (DOC_LINKS[base]) return `href="${DOC_LINKS[base]}"`;
    // 사이트에 없는 문서(HANDOFF.md 등)는 저장소의 실제 파일로 보낸다.
    const repoPath = href.startsWith('../') ? href.slice(3) : `docs/${base}`;
    return `href="${repoUrl}/blob/main/${repoPath}" target="_blank" rel="noopener"`;
  });

  const emitDoc = (mdFile, outFile, meta) => {
    const src = fs.readFileSync(path.join(DOCS, mdFile), 'utf-8');
    const r = md.render(src);
    const html = rewriteDocLinks(r.html);
    const { headings, title: h1 } = r;
    const toc = headings.filter((h) => h.level === 2);

    const body = `
<section class="page-head">
  <div class="wrap">
    <p class="eyebrow">${meta.eyebrow}</p>
    <h1>${md.esc(h1 || meta.title)}</h1>
    <p class="lead">${meta.lead}</p>
  </div>
</section>

<section class="article">
  <div class="wrap doc-layout">
    <nav class="toc" aria-label="목차">
      <h2>목차</h2>
      <ol>${toc.map((t) => `<li><a href="#${t.id}">${md.esc(t.text)}</a></li>`).join('')}</ol>
    </nav>
    <div class="article-body doc-body">
      ${html}
    </div>
  </div>
</section>`;

    emit(outFile, {
      title: `${meta.title} — DIAG.BENCH`,
      desc: meta.desc,
      body,
      ogType: 'article',
      priority: PRIORITY[outFile] || 0.7,
      jsonld: [{
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: meta.title,
        description: meta.desc,
        inLanguage: 'ko',
        author: { '@type': 'Organization', name: cfg.productName },
        publisher: { '@type': 'Organization', name: cfg.productName },
        mainEntityOfPage: `${siteUrl}/${outFile}`,
      }],
    });
  };

  emitDoc('USER-GUIDE.md', 'user-guide.html', {
    title: 'DIAG.BENCH 사용 설명서',
    eyebrow: '사용 설명서',
    lead: '설치부터 결과를 읽는 법, 기준선 측정, 안정성 테스트, 점검 리포트 발급까지 전 기능을 순서대로 설명합니다.',
    desc: 'DIAG.BENCH 전체 사용법. 설치와 첫 실행, 결과 읽는 법, 목적별 검사, 평소 상태 기준선, 안정성 테스트, 점검 리포트, 전후 비교, 해결 Wizard를 단계별로 안내합니다.',
  });

  emitDoc('TECHNICAL.md', 'technical.html', {
    title: 'DIAG.BENCH 기술 문서',
    eyebrow: '기술 문서',
    lead: '어떤 데이터를 어디서 수집하고, 어떤 규칙으로 판정하며, 무엇을 측정할 수 없는지를 밝힙니다.',
    desc: 'DIAG.BENCH의 아키텍처와 판정 방식. 수집 계층, 규칙 엔진, 상관관계 분석, 기준선, 부하 테스트, 리포트 무결성 검증, 그리고 측정 한계를 문서화했습니다.',
  });

  // 정적 파일 복사 (public/ 안의 모든 것)
  const pub = path.join(ROOT, 'public');
  if (fs.existsSync(pub)) {
    fs.cpSync(pub, OUT, { recursive: true });
    console.log('[build] public/ 복사 완료');
  }

  // robots.txt / sitemap.xml — 실제 사이트 주소 기준으로 생성
  fs.writeFileSync(path.join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`, 'utf-8');

  // lastmod는 빌드 날짜를 쓴다. 릴리스가 나오면 website.yml이 다시 빌드하므로
  // 실제로 내용이 갱신된 시점과 크게 어긋나지 않는다.
  const today = new Date().toISOString().slice(0, 10);
  sitemap.sort((a, b) => b.priority - a.priority || a.url.localeCompare(b.url));

  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + sitemap.map((e) => `  <url><loc>${e.url}</loc><lastmod>${today}</lastmod>`
      + `<priority>${e.priority.toFixed(1)}</priority></url>`).join('\n')
    + `\n</urlset>\n`, 'utf-8');

  // GitHub Pages가 _로 시작하는 경로를 Jekyll로 처리하지 않게 한다
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf-8');

  console.log(`[build] 완료 → ${OUT}`);
  console.log(`[build] 최신 릴리스: ${hasRelease ? rel.version + ' (' + rel.assetName + ')' : '없음 — 릴리스 페이지 링크로 대체'}`);
})();
