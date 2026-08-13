// website/scripts/check-font-coverage.js
// 사이트 본문에 쓰인 글자가 자체 호스팅 글꼴(Pretendard Std)에 전부 들어 있는지 확인한다.
//
// 왜 필요한가:
//   Std 판은 상용 2350자만 담는다. 그 범위를 벗어나는 희귀 음절(예: 옛말·전문용어)이
//   본문에 있으면 그 글자만 맑은 고딕으로 대체된다. **한 문장 안에서 글꼴이 섞이면**
//   폰트를 얹은 의미가 없어질 만큼 눈에 띈다.
//   글을 추가한 뒤 이 스크립트를 돌려 커버리지가 깨지지 않았는지 확인할 것.
//
// 방법:
//   Electron에 글꼴을 실제로 로드하고, 글자를 캔버스에 두 번 그려 **픽셀을 비교**한다.
//   글꼴에 글자가 없으면 브라우저가 대체 글꼴로 그리므로 두 그림이 완전히 같아진다.
//
//   ⚠ 폭(measureText) 비교로는 안 된다. 한글 음절은 어느 글꼴에서든 전각이라 폭이
//     항상 같아서, 처음 시도했을 때 708자 전부가 "없음"으로 잡히는 오탐이 났다.
//
// 실행:  npx electron website/scripts/check-font-coverage.js

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const FONT = path.join(__dirname, '..', 'public', 'fonts', 'diagbench-sans.woff2');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

// dist의 모든 HTML에서 태그를 걷어내고 실제로 화면에 보이는 글자만 모은다.
function usedChars() {
  const set = new Set();
  for (const f of fs.readdirSync(DIST).filter((x) => x.endsWith('.html'))) {
    const text = fs.readFileSync(path.join(DIST, f), 'utf-8')
      .replace(/<script[\s\S]*?<\/script>/g, ' ')   // 구조화 데이터는 화면에 안 보인다
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/g, ' ');
    for (const ch of text) set.add(ch);
  }
  return [...set].filter((c) => c.charCodeAt(0) > 32);
}

app.whenReady().then(async () => {
  const chars = usedChars();
  const fontData = fs.readFileSync(FONT).toString('base64');

  const win = new BrowserWindow({ width: 600, height: 400, show: false });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html><body></body></html>'));

  const result = await win.webContents.executeJavaScript(`(async () => {
    const face = new FontFace('PStd', 'url(data:font/woff2;base64,${fontData}) format("woff2-variations")');
    await face.load();
    document.fonts.add(face);

    const S = 48;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true });

    // 같은 글자를 지정한 글꼴 스택으로 그린 뒤 픽셀을 문자열로 뽑는다.
    const draw = (ch, font) => {
      ctx.clearRect(0, 0, S, S);
      ctx.font = \`36px \${font}\`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.fillText(ch, 4, S / 2);
      return ctx.getImageData(0, 0, S, S).data.join(',');
    };

    const chars = ${JSON.stringify(chars)};
    const missing = [];
    // 대체 글꼴은 한글을 가진 것으로 고른다. 대체가 한글을 못 그리면 두 그림이
    // "둘 다 두부(□)"로 같아져서 역시 오탐이 난다.
    const FALLBACK = '"Malgun Gothic"';

    for (const ch of chars) {
      const withFont = draw(ch, \`"PStd", \${FALLBACK}\`);
      const fallbackOnly = draw(ch, FALLBACK);
      if (withFont === fallbackOnly) missing.push(ch);
    }
    return { total: chars.length, missing };
  })()`);

  const hangul = (c) => c >= '가' && c <= '힣';
  const missHangul = result.missing.filter(hangul);
  const missOther = result.missing.filter((c) => !hangul(c));

  console.log(`검사한 글자 ${result.total}자`);
  console.log(`글꼴에 없는 것으로 보이는 글자 ${result.missing.length}자`);
  if (missHangul.length) {
    console.log(`  한글 ${missHangul.length}자: ${missHangul.join(' ')}`);
    console.log('  → 이 글자들은 다른 글꼴로 그려진다. 본문 표현을 바꾸거나 글꼴 판을 올릴 것.');
  }
  if (missOther.length) {
    console.log(`  한글 외 ${missOther.length}자: ${missOther.join(' ')}`);
    console.log('  → 기호는 폭이 우연히 같을 수 있으니 화면으로 확인할 것.');
  }
  if (!result.missing.length) console.log('  없음 — 본문 전체가 이 글꼴로 그려진다.');

  // 한글이 빠지면 문장 안에서 글꼴이 섞이므로 실패로 본다.
  app.exit(missHangul.length ? 1 : 0);
});
