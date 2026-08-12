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

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.config.json'), 'utf-8'));

// 환경변수가 있으면 설정 파일보다 우선한다(배포 환경마다 도메인이 다를 수 있으므로).
const owner = process.env.GITHUB_OWNER || cfg.owner;
const repo = process.env.GITHUB_REPOSITORY_NAME || cfg.repo;
const siteUrl = (process.env.SITE_URL || cfg.siteUrl).replace(/\/$/, '');
const analyticsId = process.env.ANALYTICS_ID || cfg.analyticsId || '';

const repoUrl = `https://github.com/${owner}/${repo}`;
const releasesUrl = `${repoUrl}/releases`;
const latestReleaseUrl = `${releasesUrl}/latest`;

async function fetchLatestRelease() {
  // 인증 토큰이 있으면 쓴다(Actions에서는 GITHUB_TOKEN으로 시간당 1000회).
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': `${repo}-website-build`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
    if (!res.ok) {
      console.warn(`[build] 최신 릴리스 조회 실패 (HTTP ${res.status}). 릴리스가 아직 없거나 저장소가 비공개일 수 있습니다.`);
      return null;
    }
    const json = await res.json();
    // .exe 자산을 찾는다(체크섬 파일 등은 제외).
    const asset = (json.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe'));
    if (!asset) {
      console.warn('[build] 릴리스는 있으나 .exe 자산이 없습니다.');
      return null;
    }
    return {
      version: json.tag_name,
      publishedAt: json.published_at,
      htmlUrl: json.html_url,
      assetName: asset.name,
      downloadUrl: asset.browser_download_url,
      sizeMB: (asset.size / 1024 / 1024).toFixed(1),
    };
  } catch (err) {
    console.warn(`[build] 최신 릴리스 조회 중 오류: ${err.message}`);
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
  const downloadSub = hasRelease
    ? `${esc(rel.version)} · Windows x64 · ${rel.sizeMB} MB`
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
      : '아직 공개된 릴리스가 없습니다',
    RELEASE_NOTES_URL: hasRelease ? rel.htmlUrl : releasesUrl,
    ASSET_NAME: hasRelease ? esc(rel.assetName) : '',
    MIN_WINDOWS: cfg.minWindows,
    YEAR: String(new Date().getFullYear()),
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

  for (const file of pages) {
    const raw = fs.readFileSync(path.join(tplDir, file), 'utf-8');
    const titleMatch = raw.match(/<!--TITLE:(.*?)-->/);
    const descMatch = raw.match(/<!--DESC:(.*?)-->/);
    const body = raw.replace(/<!--TITLE:.*?-->\n?/, '').replace(/<!--DESC:.*?-->\n?/, '');
    const pageUrl = file === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${file}`;
    // 본문을 먼저 끼운 뒤 전체를 한 번에 치환한다(본문 안의 변수도 함께 처리되도록).
    const html = render(layout.replace('{{CONTENT}}', body), {
      PAGE_TITLE: titleMatch ? titleMatch[1].trim() : cfg.productName,
      PAGE_DESC: descMatch ? descMatch[1].trim() : cfg.description,
      CANONICAL: pageUrl,
    });

    // 치환되지 않고 남은 변수가 있으면 조용히 배포하지 않고 즉시 실패시킨다.
    const leftover = [...new Set((html.match(/\{\{[A-Z_]+\}\}/g) || []))];
    if (leftover.length) {
      throw new Error(`[build] ${file}: 치환되지 않은 템플릿 변수가 있습니다 → ${leftover.join(', ')}`);
    }
    fs.writeFileSync(path.join(OUT, file), html, 'utf-8');
    console.log(`[build] ${file}`);
  }

  // 정적 파일 복사 (public/ 안의 모든 것)
  const pub = path.join(ROOT, 'public');
  if (fs.existsSync(pub)) {
    fs.cpSync(pub, OUT, { recursive: true });
    console.log('[build] public/ 복사 완료');
  }

  // robots.txt / sitemap.xml — 실제 사이트 주소 기준으로 생성
  fs.writeFileSync(path.join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`, 'utf-8');

  const urls = pages
    .filter((f) => f !== '404.html')
    .map((f) => (f === 'index.html' ? `${siteUrl}/` : `${siteUrl}/${f}`));
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')
    + `\n</urlset>\n`, 'utf-8');

  // GitHub Pages가 _로 시작하는 경로를 Jekyll로 처리하지 않게 한다
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf-8');

  console.log(`[build] 완료 → ${OUT}`);
  console.log(`[build] 최신 릴리스: ${hasRelease ? rel.version + ' (' + rel.assetName + ')' : '없음 — 릴리스 페이지 링크로 대체'}`);
})();
