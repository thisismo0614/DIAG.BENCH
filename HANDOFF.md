# DIAG.BENCH — 개발 인수인계 문서 (HANDOFF)

이 문서는 이 프로젝트를 처음 보는 AI/개발자가 맥락 없이도 이어서 작업할 수 있도록 쓴
인수인계 문서다. 기능 설명은 `README.md`에 있으니 중복하지 않고, 여기서는 **작업 환경의
함정**, **지금까지의 판단 근거**, **실측으로 확인된 기술적 사실**, **다음 우선순위**를 정리한다.

---

## 1. 이 프로젝트가 뭔지 (한 줄)

Windows PC의 하드웨어/시스템 상태를 진단하는 Electron 데스크톱 앱. 단순히 수치를 보여주는
게 아니라 **측정 → 이상 감지 → 상관관계 분석 → 원인 후보 → 근거 → 해결 방법 → 재검사**
흐름을 목표로 한다. 규칙 기반 진단 엔진(`src/engine/rules.js`)이 핵심이며, "확실하지 않은
건 확실하다고 말하지 않는다", "정상 판정도 근거를 남긴다"는 원칙을 코드 전반에서 지킨다.

원본 기획서(전체 62장)와, 그걸 실제로 구현 가능한 것/아닌 것으로 걸러내며 진행한 개발
지시서가 있다. 이 프로젝트는 그 지시서의 **Priority 1 전체 + Priority 2 일부**를 구현한
상태다 (아래 8장 참고).

---

## 2. ⚠️ 작업 환경에 대해 반드시 알아야 할 것

### 🔴 다음 세션에서 가장 먼저 확인할 것 (2026-08-13 갱신)

**배포 파이프라인은 실제로 끝까지 동작했다.** 이전 판(v0.17.0 시점)에 "미완료"로 적혀 있던
것들은 그 뒤 전부 완료됐다 — 그 기록을 보고 다시 하려 들지 말 것.

| 항목 | 상태 | 확인 방법 |
|---|---|---|
| `git push` | ✅ 완료 | `6ed8762`가 origin/main에 있음 |
| 첫 릴리스 태그 | ✅ `v0.17.0` push됨 | `git ls-remote --tags origin` |
| 릴리스 발행 | ✅ 성공 | exe 74.1MB + SHA256SUMS + GPL tarball 첨부됨 |
| GitHub Pages | ✅ 라이브 | `https://thisismo0614.github.io/DIAG.BENCH/` HTTP 200 |
| `OWNER` placeholder | ✅ 교체 완료 | 9장 참고 |

**릴리스는 `prerelease`로 발행된다** — `release.yml`이 `startsWith(version, '0.')`일 때
사전 릴리스로 표시하기 때문이다(의도된 동작). 0.x를 벗어나면 자동으로 정식 릴리스가 된다.

그 부작용으로 사이트가 "아직 공개된 릴리스가 없습니다"라고 표시하던 문제가 있었는데
`website/build.js`에서 해결했다(**5장 23번**).

작업 전에는 항상 `git log --oneline origin/main..HEAD` 로 push 상태를 먼저 확인할 것.

### 작업 방식이 바뀌었다 — 이제 git 저장소다

**예전에는 zip을 주고받았지만, 2026-08-13부터 정식 git 저장소로 전환했다.**

| 항목 | 값 |
|---|---|
| 로컬 경로 | `C:\Users\gwonm\Documents\diag-bench\diag-bench-desktop` |
| 원격 | `https://github.com/thisismo0614/DIAG.BENCH.git` |
| 브랜치 | `main` |

`Downloads`의 zip은 **전환 시점의 백업일 뿐 더 이상 정본이 아니다.** 거기에 대고 작업하면
git 이력과 어긋난다. 반드시 위 로컬 경로에서 작업할 것.

> `package.json`과 `website/site.config.json`의 `OWNER/diag-bench` placeholder는
> 실제 값(`thisismo0614/DIAG.BENCH`)으로 교체 완료했다. 저장소를 옮기거나 이름을 바꾸면
> **`site.config.json`의 `siteUrl`을 반드시 같이 고칠 것** — 이 값이 틀리면 링크는
> 멀쩡해 보여도 canonical·og:url·sitemap·robots가 없는 주소를 가리켜 검색엔진이 사이트를
> 색인하지 못한다(실제로 그 상태로 배포돼 있었다).

### Node.js

**이 PC에는 Node.js/npm이 기본 설치되어 있지 않다.** 포터블 Node를 PATH 앞에 붙여 쓴다.

```
$env:PATH="C:\Users\gwonm\AppData\Local\Temp\claude\...\node-portable\node-v22.23.2-win-x64;$env:PATH"
```

⚠ 이 포터블 Node는 **임시 폴더에 있어서 지워졌을 수 있다.** 없으면
`https://nodejs.org/dist/latest-v22.x/` 에서 `node-vX.X.X-win-x64.zip`(설치 불필요)을
다시 받거나, 사용자가 정식 설치했는지 먼저 확인할 것(`node -v`).

기본 명령:
1. `npm ci` — 의존성 설치. electron이 ~106MB를 받으므로 느릴 수 있다(5장 18번 참고).
2. `npm run test-rules` — 회귀 테스트 130개. **작업 전후로 반드시 돌린다.**
3. `npm run build:win` — NSIS 인스톨러 생성 → `dist/DIAG.BENCH-Setup-<버전>-win-x64.exe`
4. `package.json`의 `version`은 기능 추가마다 올린다(0.1.0 → 0.17.0). 릴리스 태그와
   **반드시 일치해야 한다**(release.yml이 다르면 실패시킨다).

**GUI 자동화 도구가 없다.** `claude-in-chrome`류의 브라우저 자동화는 있지만, **네이티브
Electron 창을 클릭하는 도구는 없다.** 그래서 이 세션에서 쓴 검증 방법은:
- **UI 없이 로직만 검증**: `scripts/test-rules.js` (Node 표준 assert, 130개 테스트, `npm run test-rules`)
- **실제 Electron 파이프라인을 헤드리스로 검증**: 별도 테스트 스크립트에서
  `require('./main.js')`로 실제 앱을 그대로 띄우고 (`app.on('browser-window-created', ...)`로
  실제 창을 잡아서) `webContents.executeJavaScript(...)`로 버튼 클릭·DOM 상태 확인을 자동화.
  main.js를 안 띄우고 렌더러만 따로 띄우면 `ipcMain` 핸들러가 하나도 등록 안 돼서 IPC가
  전부 조용히 실패한다 — 이 세션에서 실제로 겪은 실수다.
- **HTML 결과물 시각 확인**: `file://`는 `claude-in-chrome` 확장이 막아서, `node -e`로 임시
  `http.createServer`를 띄우고(`localhost:포트`) 브라우저로 열어서 스크린샷으로 확인했다.
- **UAC(관리자 권한 승인)는 어떤 도구로도 자동 클릭할 수 없다.** SMART 관리자 권한 재검사
  기능을 테스트할 때 실제로 UAC 창을 띄우고 **사용자에게 직접 "예"를 눌러달라고 요청**해서
  검증했다. 앞으로도 이런 기능을 테스트하려면 같은 방식이 필요하다.
- 테스트 스크립트는 항상 `test-*.js`로 스크래치 폴더에 만들고, 검증 끝나면 **바로 삭제**해서
  최종 zip/exe에 안 들어가게 했다.

---

## 3. 폴더 구조

```
diag-bench-desktop/
  main.js                    Electron 메인 프로세스, 모든 ipcMain 핸들러
  preload.js                  contextBridge로 렌더러에 window.diagAPI 노출
  src/
    engine/
      collectors.js           원시 데이터 수집 (systeminformation + PowerShell/nvidia-smi/smartctl)
      rules.js                 규칙 기반 진단 엔진 + 신뢰도 시스템 + Correlation Engine (핵심 로직)
      stress.js                CPU/저장장치/RAM 부하 테스트 (메인 프로세스, 워커 스레드)
      history.js               진단 기록(JSON) 저장/조회
      compare.js                진단 전/후 비교
      report.js                 대시보드 진단 리포트 HTML 생성
      inspectionReport.js       판매용 점검 리포트 데이터 모델(등급/점수/등급 근거/canonical 검증 payload)
      inspectionReportHtml.js   점검 리포트 HTML 렌더링 (화면/HTML저장/PDF저장이 전부 이 함수 하나를 공유)
      displayChecks.js          불량화소/잔상/균일도 셀프체크 결과 저장(JSON) — 사람 눈 판정 결과를 진단에 반영
      latestCheckStore.js       "따로 실행한 검사의 최신 결과 1건" 저장 공통 구현(유효기간 30일)
      baseline.js               평소(유휴) 상태 기준선 — 만들기/비교 순수 로직, 판정도 여기서만
      baselineStore.js          기준선 저장(userData의 baseline.json) — 시간으로는 만료시키지 않음
      vramChecks.js             VRAM 검사 결과 저장 — latestCheckStore 사용
      gpuStressChecks.js        GPU 부하 테스트 결과 저장 — latestCheckStore 사용
    renderer/
      index.html / styles.css / app.js   전체 UI(대시보드/기록/점검리포트/안정성/실시간모니터링/디스플레이/마우스/키보드/네트워크)
  scripts/
    test-engine.js             GUI 없이 엔진만 테스트하는 CLI
    test-rules.js               자동 회귀 테스트 130개 (npm run test-rules)
    fixtures.js                 "이 상태면 이 등급" 시나리오 16종 — 회귀 방지의 핵심
  resources/
    smartmontools/              smartctl.exe + drivedb.h + COPYING.txt 동봉본 (electron-builder extraResources)
```

---

## 4. 지금까지 구현된 것 (Priority 1 — 전부 완료)

지시서 기준 Priority 1(GPU/CPU/RAM/Storage/Network Stress Test, Temperature Monitoring,
Sensor Recording, Event Log Analysis, Detailed Result, Diagnosis Engine)은 **전부 구현
완료**다. 기능 목록/사용법은 `README.md`의 "이번 버전에서 새로 생긴 것"과 "지금 실제로
되는 것/안 되는 것" 표를 참고. 요약만 하면:

- **진단 엔진**: CPU/GPU/RAM/저장장치/네트워크/디스플레이/드라이버/Windows이벤트 8개 카테고리,
  각 이슈에 level/confidence/evidence/causes/actions/verification. 정상 판정도 근거(측정값)를 남김.
- **Correlation Engine** (`applyCorrelations` in rules.js): 오늘의 라이브 측정(CPU/GPU 스로틀링,
  저장장치/메모리 이상)과 최근 며칠 Windows 이벤트 로그를 대조해서, **둘 다 있을 때만** 서로
  근거로 추가하고 신뢰도를 높임. 한쪽만 있으면 아무것도 안 함.
- **VRAM 압박·무결성 테스트** (`runVramTest` / `buildVramTestSummary` in app.js): 텍스처를 VRAM에
  올렸다 `readPixels`로 되읽어 비교. 결과 해석은 순수 함수로 분리해서(실제 GPU 고장을 만들어낼 수
  없으므로) 가짜 입력으로 9개 분기를 전부 검증했다. 자세한 함정은 5장 8~10번 참고.
  **진단 엔진 연동**: WebGL이 필요해서 메인 프로세스에서는 못 돌린다 → displayChecks와 같은
  "따로 실행하고 결과만 기록" 방식(`vramChecks.js`, userData의 `vram-check.json`, 30일 유효).
  판정(verdict: pass/issue/inconclusive)은 `buildVramTestSummary` 한 곳에서만 정하고 기록에는
  그 값을 그대로 저장한다 — 렌더러와 엔진이 각자 판정하면 어긋나기 때문. 엔진 쪽은
  `vramCheckFindings()`(rules.js)가 해석만 한다: 불일치/컨텍스트 손실은 GPU warning,
  **판단 보류는 이슈로 올리지도 정상으로 묻지도 않고 근거 줄로만 남긴다.**
- **Stress Test 5종**: CPU(워커스레드+온도 안전중단), 저장장치(순차 읽기/쓰기), RAM(패턴 무결성),
  GPU(WebGL 렌더링 부하), VRAM(무결성).
- **GPU 부하 테스트 진단 연동** (`buildGpuStressSummary` in app.js → `gpuStressChecks.js` →
  `gpuStressFindings()` in rules.js): VRAM 검사와 완전히 같은 구조. 스로틀링/안전 한계 중단은
  GPU warning, 사용자 중단이나 **부하가 실제로 안 걸린 경우는 판단 보류**(5장 11번).
  기록에 `maxLoadPercent`를 남겨서 "얼마나 세게 돌렸는지"를 진단 근거와 점검 리포트에 함께 적는다.
- **실시간 모니터링(Live Monitoring)**: CPU/GPU/RAM 1초 간격 갱신 + 그래프, **센서 기록(Start/Stop
  + JSON 저장)**.
- **판매용 점검 리포트**: 등급(A+~D)/영역별 점수(전부 "상세설명" 토글로 근거 확인 가능)/QR/
  위변조 감지 해시/HTML·PDF 선택 저장. 화면에 보이는 것과 저장 파일이 완전히 같은 HTML.
- **SMART**: smartctl 동봉(설치 불필요), `--scan` 기반 장치 조회, 관리자 권한 재검사 버튼.
- **Display 셀프체크 연동**: 불량화소/잔상/균일도 사람 판정 결과를 진단에 반영.
- **평소 상태 기준선(Baseline)** (v0.18.0): 유휴 상태를 33초간 재서 기록하고(`baseline.js`)
  다음 진단부터 "평소 44°C → 지금 60°C"로 비교한다. 절대 임계값으로는 안 잡히는 냉각 성능
  저하를 잡는 유일한 경로다. 오탐을 막는 두 개의 가드가 이 기능의 핵심이다 —
  **① 측정 중 부하가 걸려 있으면 저장하지 않는다**(부하 상태가 "평소"로 굳으면 이후 모든
  진단이 조용히 틀린다), **② 진단 시점이 유휴가 아니면 비교하지 않는다**(부하 중 온도를
  유휴 기준선과 비교하면 100% 오탐). 판정은 `compareToBaseline` 한 곳에서만 하고
  `rules.js`의 `baselineFindings()`는 문장으로 옮기기만 한다.
  온도 차이의 원인은 실내 온도·잔열일 수 있으므로 원인 후보 맨 앞에 그것을 적고
  confidence를 60 이상으로 올리지 않는다. 5장 19~21번이 이 기능을 만들며 실측으로 찾은 함정이다.

---

## 5. 이 세션에서 실측으로 발견한 기술적 함정 (매우 중요 — 다시 조사하지 말 것)

새 기능을 만들기 전에 "혹시 이미 확인된 문제인가"를 먼저 이 목록에서 확인할 것.

1. **`\\.\PhysicalDriveN` 경로로는 이 계열 NVMe 컨트롤러에서 smartctl이 열리지 않는다.**
   `-d nvme`를 붙여도 관리자 권한과 무관하게 `Invalid argument`. 반면 `smartctl --scan`이
   자체적으로 알려주는 이름(`/dev/sda`)과 타입을 쓰면 **관리자 권한 없이도** 정상 동작.
   → `collectStorage()`는 diskLayout이 아니라 `--scan` 결과를 기준으로 SMART를 조회한다.

2. **`Start-Process -Verb RunAs`는 `-RedirectStandardOutput`과 함께 못 쓴다** (파라미터 세트
   충돌, 실측 확인). 관리자 권한으로 실행한 프로세스의 출력을 받으려면, 승격 대상을
   `cmd.exe`로 하고 그 안에서 `smartctl ... > 임시파일 2>&1` 형태로 리다이렉션한 뒤 파일을
   읽어야 한다. cmd.exe의 "따옴표 벗기기" 동작 때문에 전체 명령을 한 번 더 큰따옴표로
   감싸야 하고, 여러 레이어 이스케이프를 피하려면 `powershell.exe -EncodedCommand`
   (UTF-16LE→Base64)로 스크립트를 전달하는 게 안전하다. → `collectors.js`의
   `runElevatedSmartHealth()` 참고.

3. **smartctl 출력에서 `/FAILED/i` 같은 정규식으로 아무데서나 매칭하면 오탐이 난다.**
   `"Smartctl open device: ... failed: Invalid argument"`(장치를 못 연 것뿐인 에러 메시지)의
   소문자 "failed"에 걸려서 "SMART 이상(critical)"로 잘못 판정한 걸 실측으로 발견. 반드시
   `overall-health self-assessment test result:` 같은 실제 판정 줄에만 앵커링해야 한다.
   → `parseSmartHealthOutput()` 참고.

4. **이 개발 PC에서는 저수준 디스플레이 API가 안 먹는다.** `WmiMonitorListedSupportedSourceModes`는
   EDID의 구식 표준 타이밍 목록만 반환해서(1024x768@75Hz처럼 최신 모니터에 안 맞는 값) 신뢰
   불가. Win32 `EnumDisplayDevices`/`EnumDisplaySettingsEx`는 `Screen.AllScreens`로는 실제
   디스플레이(1920x1080)가 잡히는데도 P/Invoke로는 계속 `false` 반환 — 이유는 못 밝혔지만
   재현됨. "실제 지원 주사율 대비 진단"은 이 문제 때문에 보류했다. 다른 PC에서는 될 수도
   있으니, 시도한다면 반드시 실측 검증부터 할 것.

5. **Electron의 WebGL은 진짜 GPU 부하를 만든다 (CUDA 불필요).** Chromium 렌더러의 WebGL은
   실제 GPU 하드웨어 가속을 쓴다 — 무거운 프래그먼트 셰이더로 `nvidia-smi` 기준 유휴
   28%→렌더링 중 51~58%까지 실측 확인. "GPU 부하 테스트는 CUDA/DirectX 없이는 불가능"이라는
   예전 판단은 **틀렸었다.** GPU Stress Test는 이 원리로 구현됨 (`gpu-stress-canvas` in
   app.js). 비슷하게 "네이티브 그래픽 API가 필요해서 불가능"이라고 적힌 다른 항목(Frame
   Skip 등)도 WebGL/Canvas로 우회 가능한지 재검토해볼 가치가 있다.

6. **`printToPDF`는 `-Verb RunAs`와 무관하게, 그냥 숨긴 `BrowserWindow`에 HTML을 `data:` URL로
   로드해서 쓰면 된다.** 별도 PDF 라이브러리 불필요.

7. **`onLiveSample` 같은 단일 리스너 IPC 패턴은 여러 화면이 동시에 구독하려 하면 서로
   덮어쓴다.** (`ipcRenderer.removeAllListeners` 후 재등록하는 구조라서) → 렌더러 쪽에
   `Set` 기반 pub-sub을 만들어서 `window.diagAPI.onLiveSample`은 한 번만 등록하고 내부에서
   여러 구독자에게 나눠주는 방식으로 우회했다. 새 화면이 실시간 데이터를 또 구독해야 하면
   이 패턴을 그대로 쓸 것 (`liveSampleListeners` in app.js).

8. **WebGL 텍스처 할당은 여유 VRAM을 넘어도 그냥 성공한다.** 여유 1.8GB인 GPU에 2.6GB를
   요청했는데 `OUT_OF_MEMORY` 없이 2608MB가 전부 할당됐다(실측). Windows(WDDM)가 넘치는 만큼을
   시스템 메모리에 얹기 때문이다. 그래서 **"할당에 성공한 양"을 VRAM 용량이나 검사 범위로 쓰면
   안 된다.** 반드시 `nvidia-smi`의 VRAM 사용량 증가분과 대조해야 한다 — 위 사례에서 증가분은
   1510MB(할당량의 58%)뿐이었다. `buildVramTestSummary`가 이 비율로 ok/partial/unknown을 나눈다.

9. **`deleteTexture`만으로는 VRAM이 반납되지 않는다.** 텍스처를 전부 지우고 5초를 기다려도
   `nvidia-smi` 사용량이 그대로였다(2634MB 유지, 실측). 테스트마다 캔버스를 새로 만들고 끝날 때
   `WEBGL_lose_context`의 `loseContext()`로 컨텍스트째 버리니 즉시 복귀했다(1277→2619→1248MB).
   주의: `loseContext()`는 `webglcontextlost` 이벤트를 발생시키므로, 우리가 일부러 버린 것을
   "드라이버가 컨텍스트를 잃었다"로 오해하지 않도록 **리스너를 먼저 떼고 결과를 확정한 뒤** 호출한다.

10. **WebGL 텍스처 왕복(`texImage2D` → FBO 붙여서 `readPixels`)은 바이트 단위로 정확하다.**
    1GB × 2패스에서 불일치 0(실측). 색공간 변환/프리멀티플라이 알파 같은 게 끼어들어 멀쩡한
    GPU를 고장으로 오판할 위험이 있어 기능을 넣기 전에 이것부터 확인했다. `UNPACK_*` 옵션을
    건드리거나 부동소수점 포맷으로 바꾸면 이 전제가 깨질 수 있으니 그때는 다시 실측할 것.

11. **프레임당 한 번만 그리면 GPU 부하가 제대로 안 걸린다 (5번 항목의 수정·보강).**
    화면 주사율(vsync) 때문에 rAF는 초당 60프레임으로 묶이는데, 프레임당 드로우 콜이 하나뿐이면
    GPU가 프레임 사이에 놀아버린다. 이 PC에서 프레임당 드로우 콜 수(K)를 바꿔가며 실측:
    **K=1 → 평균 29% / K=4 → 58% / K=16 → 99% / K=48 → 99%** (전부 65fps 유지).
    K=16에서 포화되므로 `GPU_STRESS_DRAWS_PER_FRAME = 16`으로 정했고, 프레임마다 `gl.finish()`로
    동기화해서 명령이 무한정 쌓이지 않게 한다(프레임률이 유지되니 TDR 위험도 없음).
    5번에 적힌 "51~58%"는 이 문제가 있던 시절의 값이다.

12. **창을 최소화하거나 완전히 가리면 렌더링이 멈춰서 "부하 테스트는 돌았는데 GPU는 논" 상태가 된다.**
    실제로 자동화 테스트에서 최고 부하 15%, 클럭 607MHz(유휴)인데 "완주, 이상 없음"으로 기록된 걸
    발견했다. 그래서 관측된 최고 사용률이 `GPU_STRESS_MIN_LOAD_PERCENT`(50%) 미만이면 정상이 아니라
    **판단 보류**로 처리한다. 부하를 거는 종류의 검사를 새로 만들면 반드시 같은 검증을 넣을 것 —
    "검사를 실행했다"는 것과 "검사가 실제로 대상을 밀어붙였다"는 다른 얘기다.

13. **Windows 이벤트 로그는 provider 이름만으로 분류하면 안 된다 — 실제 오탐이 났다.**
    `Microsoft-Windows-Kernel-Power` provider에는 진짜 비정상 종료(ID 41)뿐 아니라 **정상적인
    절전 진입(42), 절전 복귀(107), 정상 종료 전환(109), 최신 대기모드 관련(131/172/187)** 이
    전부 들어온다. provider만 보고 세는 바람에 이 개발 PC(멀쩡함)가 "최근 7일 비정상 종료 19건"
    으로 표시되고 등급이 C까지 내려갔었다. ID로 필터링하도록 고친 뒤 같은 PC가 A+로 바뀌었다.
    → `evaluateEventLogs`의 `catOf(provider, id)`와 ID 집합 상수 참고. **새 provider를 추가할 때는
    반드시 그 provider의 어떤 ID가 실제 문제인지 확인하고 화이트리스트에 넣을 것.**
    같은 맥락으로 WHEA도 정정된 오류(17/47)와 정정 불가 오류(18/19/20/23/24/25/46)를 구분한다 —
    정정된 오류는 하드웨어가 스스로 복구한 것이라 흔하고, critical로 올리면 과잉 경고가 된다.

14. **`Group-Object -Property A,B`의 `$_.Name`은 "값1, 값2" 문자열이다.** 콤마로 split해서
    각각 `.Trim()` 해야 한다. provider별 전체 집계를 만들 때 이 방식을 썼다
    (`collectEventLogs`). 이렇게 전체 건수를 따로 세지 않으면, 표시용 목록의 개수 제한
    (`-First 50`) 때문에 이벤트가 많은 provider가 다른 provider를 밀어내서 "WHEA 0건" 같은
    잘못된 판정이 나온다.

15. **`fs.statfsSync`는 Node 18.15+에서만 있다.** 저장장치 테스트 전에 여유 공간을 확인할 때
    썼는데, 없는 환경을 대비해 try/catch로 감싸고 실패하면 사전 확인 없이 진행한다.

16. **smartctl의 종료 코드는 비트마스크다 — 0이 아니라고 실패가 아니다.**
    bit0(1) 명령행 오류 / bit1(2) 장치 열기 실패 / bit2(4) SMART 명령 실패 /
    **bit3(8) SMART 판정이 "DISK FAILING"** / bit4(16) prefail 속성이 임계값 이하 /
    bit5(32) 과거에 임계값 이하였음 / bit6(64) 오류 로그에 기록 있음 / bit7(128) 자가테스트 오류.
    즉 bit3~7은 "출력은 멀쩡한데 디스크에 문제가 있다"는 뜻이다. 범용 `runFile()`은 종료 코드가
    0이 아니면 stdout을 버리기 때문에 그대로 쓰면 **정작 고장난 디스크에서 결과를 못 읽고
    "판독 불가"로 표시하게 된다.** → `runSmartctl()`을 따로 두고 종료 코드와 무관하게 출력을 살린다.

17. **SMART 전체 판정(-H)만으로는 "곧 죽을 디스크"를 못 잡는다.** PASSED/FAILED는 거의 죽어야
    바뀐다. 실제 판단 근거는 개별 속성(-A)이다. 특히 **Current_Pending_Sector(197)가 가장 강한
    조기 신호**(읽기에 실패해 재할당 대기 중). 반대로 **UDMA_CRC_Error_Count(199)는 디스크가
    아니라 케이블 문제인 경우가 대부분**이라 같은 심각도로 다루면 멀쩡한 디스크를 교체하게 만든다.
    → `smartAttributeFindings()` in rules.js. 임계값과 그 근거는 함수 주석에 적어뒀다.
    ⚠ NVMe 형식은 이 PC 실제 디스크로 검증했지만 **ATA/SATA 표 형식은 장비가 없어 샘플 출력으로만
    검증**했다(`scripts/test-rules.js`의 ATA_SAMPLE). 실제 SATA/HDD가 있는 PC에서 반드시 확인할 것.


---

18. **electron 설치는 CI에서 자주 깨진다 — 원인은 두 가지이고 둘 다 이미 처리했다.**

    (a) **다운로드 실패**: `npm ci`는 electron postinstall에서 ~106MB 바이너리를 받는데,
    `@electron/get`에 **재시도 로직이 전혀 없어서**(`retry` 검색 0건) 순간 끊기면
    (`socket hang up`) 그대로 실패한다. GitHub Actions에서 2회 연속 발생했다.
    → `scripts/retry.js`(지수 백오프 래퍼) + electron 바이너리 캐시로 해결.
    캐시 경로 변수는 **`electron_config_cache`** 다(`ELECTRON_CACHE`가 아니다 —
    `install.js`의 `cacheRoot: process.env.electron_config_cache` 로 확인).
    프록시로 외부 다운로드를 완전히 차단한 상태에서 캐시만으로 2.9초에 성공하는 것을 실측했다.
    참고: `setup-node`의 `cache: 'npm'`은 `~/.npm`만 덮어서 이 106MB를 캐싱하지 못한다.

    (b) **암묵적 publish**: electron-builder는 `CI=true`만 감지해도(태그가 없어도!)
    GitHub Release publish를 시도하고, `GH_TOKEN`이 없어 실패한다
    ("Implicit publishing triggered by CI detection"). `CI=true`로 로컬 재현 확인.
    → 워크플로에서 `npm run build:win -- --publish never` 로 해결.
    **`package.json`은 건드리지 않았다** — 로컬 빌드 동작을 그대로 두기 위해서다.
    release.yml에도 같은 조치를 했는데, 이유가 하나 더 있다: electron-builder가 먼저
    publish하면 **서명 검증을 거치지 않은 파일이 릴리스에 올라갈 수 있다.**

    ⚠ 새 워크플로에서 electron-builder를 부를 때는 **항상 `--publish never`를 붙일 것.**
    릴리스 생성은 release.yml의 `action-gh-release` 단계가 단독으로 책임진다.

19. **`si.currentLoad()`의 첫 호출 값은 쓰면 안 된다 — "직전 호출 이후"의 평균이기 때문이다.**
    호출 간격이 길면 그 긴 공백이 통째로 평균에 들어가 값이 크게 부풀려진다. 기준선 측정에서
    같은 조건의 연속 샘플이 **#0=46%, #1~#9=11~16%** 로 나온 것을 실측으로 확인했다. 이 한 샘플
    때문에 유휴 비율이 무너져 멀쩡한 유휴 PC에서도 측정이 절반쯤 거부됐다.
    → 기준점만 잡고 버리는 프라이밍 샘플을 먼저 한 번 읽는다(`capture-baseline` 핸들러,
    `collectIdleSnapshot()`). **CPU 부하를 순간값으로 읽어야 하는 곳은 전부 같은 처리가 필요하다.**

20. **진단 중에 잰 CPU 부하로 "지금 유휴인가"를 판단하면 안 된다 — 그 값에는 이 앱 자신의
    부하가 섞여 있다.** 전체 진단이 PowerShell·nvidia-smi·SMART 조회를 돌리는 동안 이 PC
    (4코어 Xeon E3-1230 v5)에서 CPU 부하가 **37~45%** 로 측정됐다. 같은 순간 본작업 전에 뜬
    스냅샷은 **5~9%** 였다. 이 차이를 모르고 진단 시점 값을 쓰면 유휴 판정이 항상 실패해서
    기준선 비교 기능이 통째로 죽는다(실제로 그 상태였고, E2E 계측으로 발견했다).
    → `run-full-diagnostic` / `run-inspection-scan`은 본작업 **전에**
    `collectors.collectIdleSnapshot()`을 떠서 `baselineSnapshot`으로 넘긴다.
    참고로 맨 node로 잰 이 PC의 유휴 부하는 중앙값 6.4%(최대 10.7%)인데, 앱 안에서 재면
    중앙값 13~15%다 — 차이가 앱 자신의 몫이다. 기준선과 비교 시점 **둘 다** 앱이 떠 있는
    같은 조건이라 비교는 공정하다.

21. **이 개발 PC(Xeon E3-1230 v5)는 CPU 온도 센서를 읽지 못한다 (`cpu.tempC === null`).**
    CPU 온도가 관련된 기능은 이 PC에서 **끝까지 검증할 수 없다.** 기준선의 CPU 온도 비교도
    실제 하드웨어로는 확인 못 했고, 규칙 테스트(가짜 입력)로만 검증했다. GPU 온도(nvidia-smi)는
    정상적으로 읽히므로 GPU 쪽 경로는 실측 검증됐다(기준선 43°C 기록 확인).
    → 온도 관련 기능을 만들 때는 **센서가 없는 경우를 항상 먼저 처리할 것.** 값을 지어내지 말고
    `null`로 남기고 해당 항목을 비교 대상에서 빼야 한다.

22. **`contextBridge.exposeInMainWorld`로 노출한 객체는 얼려져 있어 렌더러에서 함수를 가로챌 수 없다.**
    E2E 테스트에서 `window.diagAPI.captureBaseline`을 몽키패치해 반환값을 가로채려 했는데
    조용히 실패했다(에러 없이 원래 함수가 그대로 호출됨). → 렌더러 동작을 검증할 때는 API를
    가로채지 말고 **버튼을 실제로 클릭하고 DOM과 저장 파일에서 결과를 읽을 것.** 어차피
    사용자가 보는 것도 그 둘이다.

23. **`GET /releases/latest`는 사전 릴리스(prerelease)를 제외한다 — 이것 때문에 사이트가
    "아직 공개된 릴리스가 없습니다"라고 사실과 다른 안내를 하고 있었다.**
    각각은 의도된 동작인데 맞물려서 생긴 문제였다.
    - `release.yml`은 0.x 버전을 `prerelease: true`로 발행한다(의도된 동작, 그대로 둔다).
    - `website/build.js`가 `/releases/latest`만 조회 → HTTP 404 → "릴리스 없음" 대체 동작.
    결과적으로 v0.17.0이 발행돼 있는데도 다운로드 버튼이 `.exe` 직링크를 잃었다(링크가 깨지지는
    않았다 — GitHub 웹 `/releases/latest`는 목록으로 리다이렉트, HTTP 200 확인).
    → **해결**: `/releases/latest`가 404면 `/releases` 목록에서 draft가 아닌 최신 릴리스를
    다시 찾고, 사전 릴리스면 화면에 **"사전 릴리스"라고 명시**한다(숨기지 않는다).
    ⚠ `release.yml`은 건드리지 않았다 — SignPath 연동이 걸려 있는 파일이다.

24. **`si.osInfo().platform`은 Windows에서 `'win32'`가 아니라 `'Windows'`를 반환한다.**
    `collectSystem()`이 `osInfo.platform === 'win32'`로 분기하고 있어서 **드라이버 오류 조회
    (`Get-PnpDevice -Status Error`)가 Windows에서도 한 번도 실행된 적이 없었다.** 그런데도
    DRIVERS 섹션은 늘 "오류 장치 0개 · 정상"으로 표시됐다. 고치고 나니 이 개발 PC에서
    **오류 장치가 실제로 3개** 잡혔다(등급도 A → C로 바뀌었다).
    → **플랫폼 판정은 항상 Node의 `process.platform`을 쓸 것.** 값이 규격으로 고정돼 있다.
    systeminformation의 `platform`은 사람이 읽는 이름이라 버전에 따라 달라질 수 있다.

25. **한국어 Windows의 `ping` 출력은 CP949라서 Node가 읽으면 한글이 깨진다.**
    실제 출력: `1.1.1.1�� ����: ����Ʈ=32 �ð�=3ms TTL=56`
    예전 파서는 `시간=` 또는 `time=`을 찾았는데 둘 다 매칭되지 않아, **핑이 3ms로 멀쩡히
    성공했는데도 `avgMs=null`** 이 됐다. 그런데도 NETWORK 섹션은 "정상"으로 표시됐다.
    → **OS 명령 출력을 파싱할 때 언어에 의존하지 말 것.** 숫자와 `ms`·`%` 같은 기호는
    인코딩이 깨져도 살아남는다. `parsePingOutput()`은 `[=<]\s*([\d.]+)\s*ms`로 라벨과
    무관하게 읽는다. 파서는 실제 네트워크 없이 테스트할 수 있도록 따로 내보냈다.

26. **위 두 가지는 "검사 안 한 것을 정상이라고 말하던" 구조 때문에 오래 숨어 있었다.**
    섹션 상태가 critical/warning/watch/normal 네 가지뿐이라, 아무것도 측정하지 못한
    카테고리가 `normal`(정상)으로 표시됐다. 그래서 수집이 통째로 실패해도 화면은 초록색이었다.
    → 이제 섹션마다 `result`(기획서 §10의 6단계)를 함께 만든다:
    `PASS / WARNING / ERROR / CRITICAL / NOT_TESTED / UNKNOWN` (`src/engine/resultStatus.js`).
    **새 검사를 추가하면 `finalize()`에 `tested`를 반드시 넘길 것.** 안 넘기면 기본값이
    `tested: true`라 측정 실패가 다시 PASS로 둔갑한다. 못 한 검사는 `notTested`에 적는다.

27. **PowerShell 호출에는 반드시 `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;`을 앞에 붙일 것.**
    한국어 Windows에서 PowerShell은 CP949로 출력하는데 Node는 UTF-8로 읽어서 한글이 깨진다.
    실측: 드라이버 이름이 `SM 버스 컨트롤러` → `SM ���� ��Ʈ�ѷ�`로 **화면과 리포트에 그대로 나갔다.**
    `chcp 65001`도 되지만 콘솔 전역 설정을 바꾸므로 호출별 지정을 쓴다. 25번(ping)과 같은
    부류의 문제이며, **OS 명령 출력을 다루는 코드는 전부 이 둘을 함께 의심할 것.**

28. **엔진을 고쳐도 표시 계층이 옛 필드를 보고 있으면 버그는 그대로 남는다.**
    26번에서 섹션에 `result`(NOT_TESTED 포함)를 도입했는데, 대시보드의 상태 뱃지는 계속
    `status`를 읽고 있었다. `status`는 네 단계뿐이라 측정도 못 한 카테고리가 `normal`로
    내려오고, 화면에는 **초록색 "정상"** 으로 표시됐다 — 엔진만 고쳤을 때와 사용자가 보는
    결과가 똑같았던 셈이다. E2E로 화면 문자열을 실제로 읽어보고서야 발견했다.
    → 판정 관련 필드를 바꾸면 **렌더러·리포트 HTML까지 같이 훑을 것.**
    표시 계층에서 판정을 감추는 버그는 엔진 버그와 똑같이 위험하다.

29. **표시 모드(기본/전문가)는 보여줄 양만 바꾼다 — 판정은 절대 바꾸지 않는다.**
    `body[data-view-mode="basic"] .expert-only { display:none }` 한 줄로 동작한다.
    감추는 것은 상세 근거(측정 원시값·판단 근거 강도·Rule ID·버전)뿐이고,
    **"검사 안 함"과 등급·경고는 두 모드에서 동일하게 보인다.** 화면 설정에 따라 같은 PC가
    다른 상태로 보이면 이 프로그램의 존재 이유가 사라진다. E2E가 두 모드의 판정이
    완전히 같은지 매번 확인한다.

---

## 5-2. 배포 인프라 (2026-08-13 구축)

```
git tag vX.Y.Z  →  release.yml
                     ├ 태그 ↔ package.json 버전 대조 (다르면 즉시 실패)
                     ├ 회귀 테스트 130개
                     ├ 빌드 (--publish never)
                     ├ 산출물 검증 (크기·smartctl 동봉)
                     ├ SignPath 서명        ← 저장소 변수가 있을 때만
                     ├ Authenticode 검증    ← Valid 아니면 릴리스 안 만듦
                     ├ GPL 소스 tarball 첨부 (체크섬 고정 검증)
                     ├ SHA256SUMS
                     ├ action-gh-release
                     └ website.yml 트리거
```

| 파일 | 역할 |
|---|---|
| `.github/workflows/build.yml` | 평소 push/PR CI (태그 제외). 테스트(ubuntu) → 빌드(windows) |
| `.github/workflows/release.yml` | 태그 기반 릴리스 전 과정 |
| `.github/workflows/website.yml` | GitHub Pages 배포 |
| `.github/scripts/release-notes.ps1` | 릴리스 노트 생성 (**UTF-8 BOM 필수** — 5장 참고) |
| `scripts/retry.js` | 네트워크 재시도 래퍼 (의존성 없음, Windows/Linux 공용) |
| `website/` | 정적 공식 사이트. `node build.js` → `dist/` |

**설계 원칙 두 가지 (반드시 유지)**
1. **서명됐다고 거짓말하지 않는다.** 서명 시도 후 실패 → 릴리스 없음.
   SignPath 미설정 → 릴리스는 만들되 "미서명"이라고 명시.
2. **사이트는 런타임에 GitHub API를 호출하지 않는다.** 빌드 시점에 한 번만 조회해
   HTML에 값을 박는다(rate limit·API 장애로 다운로드가 깨지지 않게).

---

## 5-1. 진단 결과의 신뢰성을 지키는 구조 (반드시 유지할 것)

이 프로젝트에서 가장 위험한 버그는 크래시가 아니라 **"검사에서 문제가 나왔는데 정상이라고
말하는 것"** 이다. 조용히 통과하기 때문에 알아채기 어렵다. 그래서 다음 구조를 지킨다.

- **데이터 흐름은 한 줄로 이어져야 한다**:
  `측정/부하 테스트 → raw → buildReport(규칙 엔진) → 이슈/심각도 → 카테고리 → 최종 등급 → 화면·PDF → 검증 해시`
  중간에서 값이 "표시만 되고 판정에는 안 들어가는" 지점이 생기면 안 된다.
  실제로 v0.15까지 `deepTests`(CPU/저장장치/RAM 부하 결과)가 `buildReport`에 전달되지 않아
  **RAM 검사에서 오류가 나도 등급이 정상**으로 나올 수 있었다. `scripts/test-rules.js`의
  "[회귀 방지] 정밀 검사 결과가 buildReport에 전달되지 않으면 즉시 드러난다" 테스트가 이걸 막는다.
- **판정 기준은 한 곳에만 둔다.** 렌더러와 엔진이 각자 판정하면 반드시 어긋난다
  (GPU/VRAM 검사는 렌더러의 `build*Summary`가 verdict를 정하고 엔진은 해석만 한다.
  점검 리포트의 Stability도 임계값을 다시 구현하지 않고 엔진이 만든 이슈를 읽는다).
- **부하 테스트는 실패해도 예외를 던지지 않는다.** 던지면 호출부에서 결과가 통째로 사라져
  "검사 안 함"과 "검사했는데 실패"가 구분되지 않는다. 항상 실패를 결과 객체로 반환한다.
- **속도만으로 고장이라고 하지 않는다.** 저장장치 처리량은 HDD/SATA SSD/NVMe에 따라 수십 배
  차이라 임계값 판정이 불가능하다. I/O 실패·데이터 불일치처럼 장치 종류와 무관한 것만 이슈로 올린다.
- **새 시나리오를 만들면 `scripts/fixtures.js`에 추가한다.** "이 상태면 이 등급"을 고정해두는
  파일이고, 회귀가 조용히 통과하는 걸 막는 유일한 장치다.

---

## 6. 검증 방법론 요약 (재사용할 것)

- 새 IPC 흐름을 만들면, `require('./main.js')` + `app.on('browser-window-created', ...)` +
  `webContents.executeJavaScript()`로 실제 파이프라인을 헤드리스로 끝까지 돌려보고 DOM
  상태를 assert한다. main.js를 직접 안 띄우면 아무 IPC도 안 먹는다는 걸 잊지 말 것.
- 생성된 HTML(리포트 등)은 로컬 `http.createServer`로 띄운 뒤 브라우저로 열어 스크린샷으로
  검증한다(`file://`는 막혀 있음).
- 저수준 Windows API(WMI, P/Invoke)를 쓰기 전에는 반드시 이 PC에서 먼저 실측하고, 안 되면
  대안(다른 API, 다른 접근법)을 찾거나 정직하게 README에 한계로 남긴다 — 검증 안 된 코드를
  "될 것 같으니까" 넣지 않는다(SMART 오탐 사건이 이 원칙이 왜 중요한지 보여주는 실제 사례).
- 관리자 권한(UAC)이 필요한 기능은 사용자에게 직접 클릭을 요청해서 검증한다.
- 테스트가 끝나면 스크래치 스크립트(`test-*.js`, 생성된 임시 HTML/PDF 등)는 반드시 지운다.

---

## 7. 아직 안 된 것 / 다음 우선순위

### Priority 2 (남은 것)
- ~~**Baseline**~~ — v0.18.0 완료(4장 참고). 남은 여지 두 가지:
  - **CPU 온도 비교는 실제 하드웨어로 검증하지 못했다** — 이 개발 PC에 CPU 온도 센서가
    없기 때문이다(5장 21번). 온도 센서가 있는 PC에서 반드시 확인할 것.
  - 지금은 유휴 상태만 기준선으로 삼는다. "부하 상태 기준선"(예: CPU 부하 테스트 중 최고
    온도를 기록해두고 다음번과 비교)도 같은 구조로 붙일 수 있다 — 이쪽이 냉각 성능 저하에는
    더 민감하다. 다만 부하 조건을 매번 똑같이 재현해야 비교가 성립한다는 전제가 붙는다.
- ~~**VRAM Test**~~ — v0.14.0 완료. ~~**GPU 부하 테스트 연동**~~ — v0.15.0 완료.
  둘 다 진단 엔진 연동(GPU 이슈 승격), 이벤트 로그 TDR/WHEA·예기치 않은 종료와의 상관관계,
  점검 리포트 검사 범위 표기까지 붙었다(4장 참고).
  남은 여지: 점검 리포트의 Stability 점수는 여전히 CPU 부하 테스트만 반영한다. GPU/VRAM
  결과까지 넣을지는 판단 필요 — 이 둘은 스캔 중이 아니라 "따로 실행해둔 기록"이라
  Stability에 섞으면 "언제 측정한 안정성인지"가 흐려진다는 문제가 있다.
- **Display HDR/VRR/Frame Skip** — 5장 4번 항목 때문에 보류 중. WebGL 우회 가능성(5장 5번)을
  먼저 검토해볼 것.
- **Gaming Diagnostics (FPS/Frame Time 분석)** — 실행 중인 게임 프로세스에 후킹해야 해서
  아키텍처가 완전히 다르다. 시작하기 전에 범위를 사용자와 먼저 좁힐 것.

### Priority 3
- Audio Diagnostics, USB/Peripheral(웹캠/블루투스), 고급 드라이버 분석, Background
  Monitoring(앱이 꺼져 있어도 기록 — 트레이 상주 프로세스 필요, 구조 변경 큼),
  Technician Mode(다중 PC 고객 관리 — 사실상 별도 미니 CRM, 지금까지의 "1회성 진단 도구"
  성격과 다름).

### Priority 4 (장기, 사실상 별도 프로젝트)
- DIAG.BENCH Boot(부팅 진단 환경, USB 이미지 제작), 원격 진단, 자동 복구 가이드.

### 그 외 알려진 미구현/제한 (README에 상세 기재)
- Sensor Recording → 진단 엔진 자동 반영(기록된 시계열에서 스파이크 자동 탐지)은 아직 안 함
  — 지금은 기록·저장까지만.
- Confidence 점수는 사람이 정한 가중치이지 통계적으로 검증된 확률이 아님.
- 코드 서명 없음(SmartScreen 경고 뜸), 자동 업데이트 없음, 크래시 리포팅 없음 — 전부 인증서
  구매/서버 운영 등 인프라·비용이 드는 영역이라 코드만으로 해결 불가.

---

## 8. 시작하기 전 체크리스트

```powershell
cd C:\Users\gwonm\Documents\diag-bench\diag-bench-desktop
git log --oneline -3                      # 어디까지 커밋됐나
git log --oneline origin/main..HEAD       # push 안 된 커밋
git status --short                        # 작업 중이던 변경이 있나
node -v                                   # 없으면 포터블 Node 준비 (2장)
npm run test-rules                        # 기준선: 158/158 통과해야 함
```

1. **위 명령으로 현재 상태를 먼저 확인한다.** 특히 push 여부 — 사용자가 그 사이에
   직접 push했을 수 있다.
2. 5장의 함정 목록을 훑어 같은 삽질을 반복하지 않는다.
3. 작업 후에는 반드시 `npm run test-rules` 재확인 → 필요시 `npm run build:win`.
4. 커밋은 하되 **push는 사용자 확인을 받고 한다**(지금까지 그렇게 진행해왔다).
5. 기능을 추가했으면 `package.json`의 version을 올린다. 릴리스 태그와 반드시 일치해야 한다.

---

## 9. 사용자가 직접 해야 하는 일 (2026-08-13 갱신)

코드로 해결할 수 없고 사용자 계정·결정이 필요한 항목들이다.

| # | 항목 | 상태 | 비고 |
|---|---|---|---|
| 1 | `git push` | ✅ 완료 | `6ed8762`까지 origin/main에 있음 |
| 2 | `OWNER` placeholder 교체 | ✅ 완료 | `site.config.json` + `package.json` 둘 다 |
| 3 | GitHub Pages 활성화 | ✅ 완료 | 사이트 라이브(HTTP 200) 확인 |
| 4 | SignPath Open Source 신청 | **신청함 · 승인 대기** | 2026-08-13 신청. 승인 전까지는 "미서명" 릴리스로 배포됨 |
| 5 | SignPath 변수·시크릿 등록 | **승인 후 진행** | Variables 2개 + Secret 1개 (`docs/RELEASING.md` 3절) |
| 6 | 첫 릴리스 태그 | ✅ 완료 | `v0.17.0` 발행됨(prerelease) |
| 7 | 도메인 연결 | 선택 | `docs/RELEASING.md` 5절 |

> 🔴 **SignPath 연동 파일은 건드리지 말 것** (사용자 요청, 2026-08-13):
> `.github/workflows/release.yml`의 서명·검증 단계, `SIGNPATH_ORGANIZATION_ID` /
> `SIGNPATH_PROJECT_SLUG` / `SIGNPATH_SIGNING_POLICY_SLUG` / `SIGNPATH_API_TOKEN` 이름,
> `docs/RELEASING.md` 3절. 신청이 진행 중이라 이름이나 단계가 바뀌면 연동이 깨진다.

> 참고: 저장소 변수 `SITE_URL`을 설정하면 `site.config.json`보다 우선한다.
> 파일을 이미 실제 값으로 고쳐뒀으므로 변수는 설정하지 않아도 된다.
