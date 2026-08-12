#!/usr/bin/env node
// scripts/retry.js
// 명령을 실패 시 지수 백오프로 재시도하는 래퍼. 의존성 없음(Node 표준 모듈만).
//
// 왜 필요한가:
// electron 패키지는 설치 시 postinstall(`node install.js`)에서 ~106MB짜리 바이너리 zip을
// 내려받는다. 이 다운로드를 담당하는 @electron/get 에는 **자체 재시도 로직이 없어서**,
// 네트워크가 순간 끊기면(`socket hang up`) 그대로 `npm ci` 전체가 실패한다.
// GitHub Actions 러너에서 실제로 이 현상이 두 번 연속 발생했다.
//
// 설계 원칙:
//  - 다운로드를 건너뛰거나(ELECTRON_SKIP_BINARY_DOWNLOAD), 스크립트를 끄거나
//    (--ignore-scripts), 실패를 무시하지 않는다. **재시도만** 한다.
//  - 마지막 시도까지 실패하면 원래 종료 코드를 그대로 돌려주고 실패로 끝낸다.
//  - Windows/Linux, 로컬/CI 어디서나 같은 방식으로 동작한다.
//
// 사용법:
//   node scripts/retry.js npm ci
//   node scripts/retry.js npm run build:win
//
// 환경변수:
//   RETRY_ATTEMPTS  최대 시도 횟수 (기본 3)
//   RETRY_DELAY_MS  첫 대기 시간 ms (기본 15000, 시도마다 2배)

const { spawn } = require('child_process');

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('사용법: node scripts/retry.js <명령> [인자...]');
  process.exit(2);
}

const attempts = Number(process.env.RETRY_ATTEMPTS || 3);
const baseDelay = Number(process.env.RETRY_DELAY_MS || 15000);
const [command, ...args] = argv;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// shell: true 로 실행하면 셸이 인자를 **한 번 더** 파싱한다. 공백이나 특수문자가 들어간
// 인자가 쪼개지지 않도록 미리 인용해 둔다. (지금 쓰는 `npm ci` 같은 명령엔 특수문자가
// 없지만, 나중에 다른 명령을 넘겼을 때 조용히 깨지는 걸 막는다)
function quoteArg(a) {
  if (a === '') return '""';
  if (!/[\s"'^&|<>()%!]/.test(a)) return a;
  if (process.platform === 'win32') return `"${a.replace(/"/g, '""')}"`;
  return `'${a.replace(/'/g, `'\\''`)}'`;
}

function run() {
  return new Promise((resolve) => {
    // shell: true — Windows에서 npm은 npm.cmd라 셸을 거쳐야 실행된다.
    // (Node 20+ 는 보안상 shell 없이 .cmd/.bat 실행을 막는다)
    const child = spawn(command, args.map(quoteArg), { stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve(code === null ? 1 : code));
    child.on('error', (err) => {
      console.error(`[retry] 실행 실패: ${err.message}`);
      resolve(1);
    });
  });
}

(async () => {
  const label = [command, ...args].join(' ');
  for (let i = 1; i <= attempts; i++) {
    if (i > 1) console.log(`\n[retry] ${i}/${attempts}번째 시도: ${label}`);
    const code = await run();
    if (code === 0) {
      if (i > 1) console.log(`[retry] ${i}번째 시도에서 성공했습니다.`);
      process.exit(0);
    }
    if (i === attempts) {
      console.error(`\n[retry] ${attempts}번 모두 실패했습니다(마지막 종료 코드 ${code}). 실패로 종료합니다.`);
      process.exit(code);
    }
    const wait = baseDelay * Math.pow(2, i - 1);
    console.error(`[retry] 실패(종료 코드 ${code}). ${Math.round(wait / 1000)}초 후 다시 시도합니다.`);
    await sleep(wait);
  }
})();
