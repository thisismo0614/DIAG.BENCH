#!/usr/bin/env node
// website/scripts/check-site.js
// 빌드된 사이트가 실제로 성립하는지 검사한다. `node build.js` 다음에 돌린다.
//
// 왜 필요한가 — 언어가 둘이 되는 순간 **조용히 썩는 지점**이 생긴다.
//   · /en/ 페이지가 없는 파일을 가리켜도 빌드는 성공한다(404는 배포 후에야 드러난다)
//   · 번역을 빠뜨린 문장이 영어 페이지에 한국어로 실려도 빌드는 성공한다
//   · hreflang 짝이 깨져도 빌드는 성공한다
// 전부 "검사하지 않으면 정상으로 보이는" 종류라, 검사를 코드로 남긴다.
//
// 아직 website.yml에는 연결하지 않았다 — 배포 워크플로를 바꾸는 일은 따로 판단할 것.
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const SITE = 'https://thisismo0614.github.io/DIAG.BENCH';
let fail = 0;
const bad = (m) => { console.log(`✗ ${m}`); fail++; };
const ok = (m) => console.log(`✓ ${m}`);

// 검색엔진 소유권 확인 파일은 템플릿이 아니다(한 줄짜리). 레이아웃 검사 대상에서 뺀다.
const NOT_A_PAGE = /^(google|naver)[a-z0-9]+\.html$/;
const listHtml = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !NOT_A_PAGE.test(f));
const koFiles = listHtml(DIST);
const enFiles = fs.existsSync(path.join(DIST, 'en')) ? listHtml(path.join(DIST, 'en')) : [];
const read = (loc, f) => fs.readFileSync(path.join(DIST, loc, f), 'utf-8');

console.log(`페이지: 한국어 ${koFiles.length}개 / 영어 ${enFiles.length}개\n`);

// ---------- 1. 내부 링크가 실제 파일을 가리키는가 ----------
const POOL = { '': new Set(koFiles), en: new Set(enFiles) };

// 상대 경로를 (어느 폴더, 어느 파일)로 푼다. 언어 전환 링크는 폴더를 넘나든다.
function resolveHref(fromDir, href) {
  if (href.startsWith('../')) return { dir: '', name: href.slice(3) };
  if (href.startsWith('en/')) return { dir: 'en', name: href.slice(3) };
  return { dir: fromDir, name: href };
}

for (const [loc, files] of [['', koFiles], ['en', enFiles]]) {
  for (const f of files) {
    const html = read(loc, f);
    for (const m of html.matchAll(/href="([^"#?:]+\.html)(#[^"]*)?"/g)) {
      const r = resolveHref(loc, m[1]);
      if (!POOL[r.dir] || !POOL[r.dir].has(r.name)) {
        bad(`${loc || '/'}/${f} → ${m[1]} (없는 파일)`);
      }
    }
    // 정적 파일 경로
    const needsPrefix = loc === 'en' ? '../' : '';
    for (const asset of ['styles.css', 'favicon.svg', 'fonts/diagbench-sans.woff2']) {
      if (!html.includes(`"${needsPrefix}${asset}"`)) {
        bad(`${loc || '/'}/${f}: ${needsPrefix}${asset} 참조 없음`);
      }
    }
  }
}
if (!fail) ok('내부 링크와 정적 파일 경로가 전부 해결된다');

// ---------- 2. hreflang ----------
const shared = enFiles.filter((f) => koFiles.includes(f));
let hrefOk = true;
for (const f of shared) {
  for (const [loc, other] of [['', 'en'], ['en', '']]) {
    const html = read(loc, f);
    const koUrl = `${SITE}/${f}`;
    const enUrl = `${SITE}/en/${f}`;
    if (!html.includes(`hreflang="ko" href="${koUrl}"`)) { bad(`${loc || '/'}/${f}: ko hreflang 없음`); hrefOk = false; }
    if (!html.includes(`hreflang="en" href="${enUrl}"`)) { bad(`${loc || '/'}/${f}: en hreflang 없음`); hrefOk = false; }
    if (!html.includes(`hreflang="x-default" href="${koUrl}"`)) { bad(`${loc || '/'}/${f}: x-default가 원문이 아님`); hrefOk = false; }
    void other;
  }
}
// 짝이 없는 페이지에는 hreflang을 붙이지 않는다
const koOnly = koFiles.filter((f) => !enFiles.includes(f));
for (const f of koOnly) {
  // 언어 전환 링크(<a hreflang=...>)가 아니라 <link rel="alternate">만 본다.
  if (read('', f).includes('rel="alternate"')) { bad(`/${f}: 짝이 없는데 hreflang이 붙음`); hrefOk = false; }
}
if (hrefOk) ok(`hreflang 짝 ${shared.length}쌍 + 단독 페이지 ${koOnly.length}개 모두 올바름`);

// ---------- 3. 영어 페이지에 한글이 남아 있지 않은가 ----------
let clean = true;
for (const f of enFiles) {
  const html = read('en', f);
  // 걸러낼 것 두 가지:
  //  1) 언어 전환 링크의 "한국어" — 의도된 것이다(가려는 언어로 적는다).
  //  2) HTML 주석 — 독자에게도 검색엔진에게도 보이지 않는 개발 메모다.
  const stripped = html
    .replace(/<a[^>]*lang="ko"[^>]*>[^<]*<\/a>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const ko = stripped.match(/[가-힣]+/g);
  if (ko) { bad(`en/${f}: 한글 잔류 → ${[...new Set(ko)].slice(0, 5).join(', ')}`); clean = false; }
  if (!/<html lang="en">/.test(html)) { bad(`en/${f}: html lang이 en이 아님`); clean = false; }
  if (!html.includes('og:locale" content="en_US"')) { bad(`en/${f}: og:locale이 en_US가 아님`); clean = false; }
}
if (clean) ok('영어 페이지에 한글 잔류 없음 · lang/og:locale 올바름');

// ---------- 4. 한국어 페이지 회귀 ----------
const idx = read('', 'index.html');
const koChecks = [
  ['<html lang="ko">', 'lang="ko" 유지'],
  ['본문으로 건너뛰기', '건너뛰기 링크 유지'],
  ['오픈소스 (MIT)', '저작권 문구 유지'],
  ['>문제 해결<', '메뉴 "문제 해결" 유지'],
  ['>받은 리포트 검증<', '푸터 검증 링크 유지'],
  ['개인정보처리방침', '개인정보처리방침 링크 유지'],
];
let koOk = true;
for (const [needle, label] of koChecks) {
  if (!idx.includes(needle)) { bad(`index.html: ${label} 실패`); koOk = false; }
}
// 한국어 페이지에는 "아직 번역 안 됨" 안내가 붙으면 안 된다(원문이다)
if (idx.includes('footer-partial')) { bad('index.html: 원문 언어에 번역 안내가 붙음'); koOk = false; }
// 영어 페이지에는 붙어야 한다
if (!read('en', 'guides.html').includes('footer-partial')) { bad('en/guides.html: 번역 안내 없음'); koOk = false; }
if (koOk) ok('한국어 페이지 회귀 없음 · 영어 페이지에 번역 범위 안내 있음');

// ---------- 5. 사이트맵 ----------
const sm = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf-8');
const urls = [...sm.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
const enInMap = urls.filter((u) => u.includes('/en/')).length;
if (enInMap !== enFiles.length) bad(`사이트맵의 영어 URL ${enInMap}개 ≠ 영어 페이지 ${enFiles.length}개`);
else ok(`사이트맵에 영어 페이지 ${enInMap}개 포함 (전체 ${urls.length}개)`);
// 404는 색인하지 않는다
if (urls.some((u) => u.endsWith('404.html'))) bad('사이트맵에 404가 들어감');

// ---------- 6. 위험도 배지가 언어를 따라가는가 ----------
const enGuide = read('en', 'guide-ram-mixed-modules-slow.html');
const koGuide = read('', 'guide-ram-mixed-modules-slow.html');
if (!enGuide.includes('>Safe<') || !enGuide.includes('>Moderate<')) bad('영어 가이드의 위험도 배지가 번역되지 않음');
else if (!koGuide.includes('>안전<') || !koGuide.includes('>중간<')) bad('한국어 가이드의 위험도 배지가 바뀜');
else ok('위험도 배지가 언어를 따라간다 (안전/중간 ↔ Safe/Moderate)');

// 배지 개수가 언어별로 같아야 한다 — 다르면 조치가 빠진 것이다
const count = (h, re) => (h.match(re) || []).length;
if (count(enGuide, /class="risk /g) !== count(koGuide, /class="risk /g)) {
  bad('영어판의 위험도 배지 개수가 원문과 다름 — 조치나 단계가 누락됨');
} else ok('영어판의 조치·단계 개수가 원문과 일치');

console.log(`\n${fail ? `실패 ${fail}건` : '전부 통과'}`);
process.exit(fail ? 1 : 0);
