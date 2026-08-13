// website/scripts/make-og-image.js
// 공유 카드 이미지(og:image)를 만든다. 결과: website/public/og.png (1200×630)
//
// 왜 Electron으로 그리는가:
//   og:image는 PNG/JPG여야 한다 — SVG는 카카오톡·페이스북·트위터 어디서도 렌더링되지 않는다.
//   그런데 사이트 빌드(build.js)는 의존성 없이 돌아야 해서 이미지 라이브러리를 넣을 수 없다.
//   그래서 **이 스크립트는 빌드에 포함되지 않는다.** 로컬에서 한 번 실행해 PNG를 만들고,
//   결과물을 저장소에 커밋한다. 문구나 디자인을 바꿀 때만 다시 돌리면 된다.
//
// 실행:  npx electron website/scripts/make-og-image.js
//        (Electron이 이미 devDependency에 있으므로 추가 설치가 필요 없다)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'og.png');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'site.config.json'), 'utf-8'));

// 사이트와 같은 색을 쓴다(styles.css의 다크 토큰). 공유 카드는 피드에서 작게 보이므로
// 대비가 확실한 어두운 배경을 쓰고, 글자는 크게 넣는다.
const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #131417;
    color: #F2F3F5;
    font-family: "Malgun Gothic", "Segoe UI", sans-serif;
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 84px; position: relative;
  }
  /* 왼쪽 위에서 번지는 은은한 강조색 — 단색 배경보다 덜 밋밋하다 */
  body::before {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(900px 520px at 12% -10%, rgba(77,143,245,.20), transparent 62%);
  }
  .inner { position: relative; }
  .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 40px; }
  .mark {
    width: 38px; height: 38px; border-radius: 10px;
    background: linear-gradient(135deg, #4D8FF5, #3DD68C);
  }
  .name { font-size: 30px; font-weight: 700; letter-spacing: .04em; }
  h1 {
    font-size: 66px; line-height: 1.24; letter-spacing: -0.03em; font-weight: 700;
    margin-bottom: 30px;
  }
  h1 em { font-style: normal; color: #4D8FF5; }
  /* 한글은 기본 규칙에서 글자 단위로 끊겨 "정상/이라고"처럼 어절이 갈라진다.
     keep-all을 줘야 띄어쓰기에서만 줄이 바뀐다. */
  p {
    font-size: 27px; line-height: 1.55; color: #A8ADB6;
    max-width: 30ch; word-break: keep-all;
  }
  .foot {
    position: absolute; left: 84px; right: 84px; bottom: 54px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 20px; color: #7A8089;
    border-top: 1px solid #2A2D33; padding-top: 24px;
  }
  .tags { display: flex; gap: 26px; }
</style></head>
<body>
  <div class="inner">
    <div class="brand">
      <div class="mark"></div>
      <div class="name">${cfg.productName}</div>
    </div>
    <h1>PC가 왜 이상한지,<br><em>근거와 함께</em> 알려줍니다.</h1>
    <p>확인하지 않은 것을 정상이라고 말하지 않는 Windows 진단 도구</p>
  </div>
  <div class="foot">
    <div class="tags"><span>CPU · GPU · 메모리</span><span>저장장치 · 배터리</span><span>네트워크</span></div>
    <div>무료 · 오픈소스</div>
  </div>
</body></html>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 630,
    show: false,
    // 캡처 크기를 정확히 1200×630으로 고정한다. 창 테두리가 끼면 크기가 어긋난다.
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: false },
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // 폰트가 적용되기 전에 캡처하면 글자가 기본 폰트로 찍힌다.
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage();
  const png = image.toPNG();
  fs.writeFileSync(OUT, png);

  const size = image.getSize();
  console.log(`[og] ${OUT}`);
  console.log(`[og] ${size.width}×${size.height}, ${(png.length / 1024).toFixed(0)} KB`);

  if (size.width !== 1200 || size.height !== 630) {
    console.error(`[og] ⚠ 크기가 1200×630이 아닙니다 — og:image 메타와 어긋납니다.`);
    app.exit(1);
    return;
  }
  app.quit();
});
