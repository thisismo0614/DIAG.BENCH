# DIAG.BENCH 기술 문서

무엇을 어떻게 측정하고, 그 값을 어떤 규칙으로 판정하며, 판정이 화면·리포트·검증 해시까지
어떻게 이어지는지. 그리고 **측정할 수 없는 것을 어떻게 다루는지**.

> 앱 0.26.0 / Diagnostic Engine 2.0 / Rule Set 2026.08.1 기준.
> 사용법은 [USER-GUIDE.md](USER-GUIDE.md), 개발 인수인계는 [../HANDOFF.md](../HANDOFF.md)를 보세요.

| | |
|---|---|
| 엔진 모듈 | 23개 |
| IPC 채널 | 34개 |
| 회귀 테스트 | 251개 |
| 진단 프로필 | 8종 |
| 결과 상태 | 6단계 |
| 외부 전송 | 없음 |

---

## 1. 설계 원칙

이 프로그램에서 가장 위험한 버그는 크래시가 아니라 **"검사에서 문제가 나왔는데 정상이라고
말하는 것"**입니다. 조용히 통과하기 때문에 알아채기 어렵습니다.

| 원칙 | 구현에서 어떻게 강제되는가 |
|---|---|
| 검사하지 않은 것을 정상이라고 하지 않는다 | 섹션마다 `result`를 만들고 `tested:false`면 `NOT_TESTED`. PASS와 구조적으로 다른 값 |
| 가능성을 고장으로 단정하지 않는다 | 신뢰도 4단계를 이슈에 부착. 상관관계는 두 근거가 *모두* 있을 때만 작동 |
| 측정값과 판단을 분리한다 | `raw` → 규칙 엔진 → 이슈. 원본은 리포트에 그대로 보존 |
| 판정 기준은 한 곳에만 둔다 | 렌더러는 판정하지 않음. GPU/VRAM 검사는 렌더러가 verdict를 정하고 엔진은 해석만 |
| 검사 범위를 항상 공개한다 | `notTested[]`가 섹션·리포트·검증 해시까지 전파 |
| 결과에 버전을 기록한다 | app / engine / ruleset 세 값을 리포트와 해시에 포함 |

**이 원칙이 실제로 잡아낸 것** — 개발 중 출하 상태였던 버그 5개가 이 원칙을 코드로
강제하는 과정에서 드러났습니다. 드라이버 검사가 한 번도 실행된 적이 없었고(플랫폼 판정 오류),
핑은 성공했는데 `null`로 읽혔으며(인코딩), 미검사 항목이 초록색 "정상"으로 표시됐고,
점검 리포트는 하지 않은 검사를 했다고 적었으며, 한글 장치 이름이 깨져 나갔습니다.

---

## 2. 아키텍처

| 계층 | 파일 | 할 수 있는 것 / 없는 것 |
|---|---|---|
| **메인 프로세스** | `main.js`, `src/engine/*` | OS 명령 실행, 파일 I/O, 워커 스레드. **WebGL 불가** |
| **preload** | `preload.js` | `contextBridge`로 34개 채널만 노출. 노출한 객체는 동결됨 |
| **렌더러** | `src/renderer/*` | WebGL(GPU·VRAM 검사), 화면. **파일·OS 접근 불가** |

`contextIsolation: true`, `nodeIntegration: false`입니다.

### WebGL이 필요한 검사를 다루는 방식

GPU 부하 테스트와 VRAM 무결성 검사는 WebGL이 필요해 **메인 프로세스에서 실행할 수 없습니다.**
진단 도중에 돌릴 수 없다는 뜻입니다.

```
렌더러에서 실행 → verdict 판정(build*Summary) → IPC로 저장(userData/*.json, 30일 유효)
                                                    ↓
                            다음 진단에서 rules.js가 읽어 GPU 섹션 근거로 반영
```

판정(verdict)은 렌더러의 `buildVramTestSummary` / `buildGpuStressSummary` **한 곳에서만**
정하고, 엔진은 그 값을 해석만 합니다. 양쪽이 각자 판정하면 반드시 어긋납니다.

### 엔진 모듈

| 모듈 | 줄 | 역할 |
|---|---:|---|
| `rules.js` | 1,287 | 규칙 엔진 — 판정·상관관계·리포트 조립 |
| `collectors.js` | 864 | 원시 데이터 수집 + OS 출력 파서 |
| `inspectionReportHtml.js` | 362 | 점검 리포트 HTML 렌더링(화면·저장 공용) |
| `inspectionReport.js` | 327 | 등급·검사 범위·canonical payload·해시 |
| `stress.js` | 309 | CPU·저장장치·RAM 부하 테스트 |
| `issueDb.js` | 302 | 문제 해결 지식 DB(원인·조치·Wizard) |
| `baseline.js` | 207 | 평소 상태 생성·비교(순수) |
| `profiles.js` | 178 | 진단 프로필 정의 |
| `memoryConfig.js` | 171 | 메모리 구성 분석 규칙 |
| `overclock.js` | 155 | 설정 변경 상태 판정 |
| `sessionCompare.js` | 148 | 전후 비교·하드웨어 대조(순수) |
| `sessions.js` | 128 | 검사 세션 기록·지표 추출 |
| `resultStatus.js` | 76 | 결과 상태 6단계 판정 |
| 그 외 10개 | ~450 | 저장소·설정·버전·비교·리포트 |

---

## 3. 데이터 흐름

측정에서 검증 해시까지 **한 줄로 이어져야 합니다.** 중간에 "표시만 되고 판정에는 안 들어가는"
지점이 생기면 안 됩니다.

```
수집(collectors) → raw → 규칙 엔진(buildReport) → 이슈·결과 상태
                                                      ↓
                    검증 해시 ← 화면·PDF(같은 HTML) ← 등급(inspectionReport)
```

**이 연결이 끊겼던 실제 사례** — v0.15까지 `deepTests`(CPU·저장장치·RAM 부하 결과)가
`buildReport`에 전달되지 않아, **RAM 검사에서 오류가 나도 최종 등급이 "정상"**으로
나올 수 있었습니다. 지금은 회귀 테스트가 이 연결이 끊기면 즉시 실패합니다.

### 리포트가 들고 다니는 것

```js
report = {
  headline, sections[],          // 판정 결과
  resultSummary, notTested[],    // 결과 상태 집계 · 검사 범위
  profile,                       // 어떤 목적의 검사였나
  baseline,                      // 평소 대비 비교 (표시용 사본)
  configuration,                 // 설정 변경 상태
  comparison,                    // 직전 진단 대비 변화
  versions,                      // app / engine / ruleset
  symptom, timestamp
}
```

`baseline`은 **표시용 사본**입니다. 판정은 이미 섹션 이슈에 반영돼 있고,
화면이 이 값으로 다시 판정하면 두 곳이 어긋납니다.

---

## 4. 수집 계층

| 경로 | 읽는 것 | 주의 |
|---|---|---|
| `systeminformation` | CPU 부하·클럭, 메모리, 디스크, 네트워크, OS | `platform`이 `'Windows'`를 반환(`'win32'` 아님) |
| PowerShell + CIM | 메모리 모듈(DIMM), CPU 클럭·BCLK, 드라이버 오류, 이벤트 로그 | 한국어 Windows는 CP949 출력 — UTF-8 지정 필수 |
| `nvidia-smi` | GPU 온도·부하·클럭·VRAM·전력 제한 | NVIDIA 전용. 일부 필드는 지포스에서 `[N/A]` |
| `smartctl`(동봉) | 저장장치 SMART 상태·속성 | 종료 코드가 비트마스크 — 0이 아니어도 출력은 유효 |

### OS 출력 파싱의 두 가지 함정

**언어에 의존하지 말 것.** 한국어 Windows의 `ping` 출력은 CP949라 Node가 읽으면 깨집니다.
`시간=` 또는 `time=`을 찾던 파서가 매칭에 실패해 **핑이 3ms로 성공했는데도 `avgMs=null`**이
됐고, 네트워크는 "정상"으로 표시됐습니다. 숫자와 `ms`·`%`는 인코딩이 깨져도 살아남으므로
라벨과 무관하게 `[=<]\s*([\d.]+)\s*ms`로 읽습니다. PowerShell 호출에는
`[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;`을 앞에 붙입니다.

**정규식은 실제 판정 줄에만 앵커링할 것.** smartctl 출력에서 `/FAILED/i`로 아무 데나
매칭하면, 장치를 못 연 에러 메시지(`open device: ... failed`)의 소문자 `failed`에 걸려
**멀쩡한 디스크를 SMART 이상(critical)으로 오판**합니다.

### 파서를 따로 내보내는 이유

SMART·ping 파서는 `module.exports`로 분리합니다. 실제 장비나 네트워크 없이도 샘플 출력으로
테스트하기 위해서입니다.

---

## 5. 판정 계층

### 결과 상태 6단계

`resultStatus.js`가 섹션마다 하나의 `result`를 만듭니다. 순서가 핵심입니다 —
**이슈가 없을 때만 "검사를 했는가"가 결과를 가릅니다.**

```
critical 이슈 있음                  → CRITICAL
warning 이슈 + confidence 확정      → ERROR
warning / watch 이슈 있음           → WARNING
이슈 없음 && tested === false      → NOT_TESTED   ← PASS가 아니다
이슈 없음 && unknown === true      → UNKNOWN
그 외                               → PASS
```

> ⚠ `finalize()`의 `tested` 기본값은 `true`입니다(기존 호출부 호환). 새 검사를 추가하면서
> `tested`를 넘기지 않으면 **측정 실패가 다시 PASS로 둔갑합니다.**

### 이슈의 구조

```js
issue = {
  level,              // critical | warning | watch
  title, explanation, // 측정값이 들어간 문장 — 규칙 모듈이 생성
  causes[],           // 원인 후보        ┐
  actions[],          // 조치(문자열)      │ 지식 DB에서 온다
  actionDetails[],    // 조치 + 위험도     │ (issueDb.js)
  verification,       // 재검사 방법       ┘
  wizard,             // 단계별 해결 절차
  confidence,         // 숫자 (기존 호환)
  confidenceLevel,    // CONFIRMED | STRONG_INDICATION | POSSIBLE_CAUSE | NEEDS_VERIFICATION
  evidence[],         // 판정 근거
  ruleId, ruleVersion // 어떤 규칙의 몇 번째 판이 낸 판정인가
}
```

### 측정과 지식의 분리

규칙 모듈(`memoryConfig`·`overclock`·`baseline`)은 **측정하고 판정**합니다.
제목·원인·조치·재검사·Wizard 같은 정적 지식은 `issueDb.js`에 Issue ID로 색인돼 있습니다.
**판정 기준(임계값)은 issueDb에 없습니다.**

### 현재 규칙 ID

| Issue ID | 조건 | 등급 |
|---|---|---|
| `MEMORY-MIXED-DIMM-BELOW-RATED` | 혼합 구성 + 정격 미달 동작 | warning |
| `MEMORY-BELOW-RATED-SPEED` | 동일 구성인데 정격 미달 | watch |
| `MEMORY-ABOVE-RATED-SPEED` | 정격 초과(프로파일·수동 설정) | watch |
| `MEMORY-SINGLE-CHANNEL` | 모듈 2개 이상이 한 채널에만 | watch |
| `CPU-BASE-CLOCK-MODIFIED` | 기본 클럭 > 정품 사양 × 1.02 | watch |
| `GPU-POWER-LIMIT-MODIFIED` | 전력 제한 ≠ 기본값 | watch |
| `CONFIG-STABILITY-INVESTIGATION` | 설정 변경 *그리고* 하드웨어 오류 이벤트 | warning |
| `BASELINE-IDLE-TEMP-RISE` | 유휴 온도 ≥ 기준선 +10 / +15°C | watch / warning |
| `BASELINE-IDLE-MEMORY-RISE` | 유휴 메모리 ≥ 기준선 +20%p | watch |

이 목록 밖의 판정(CPU·GPU 온도 임계값, SMART 속성, 이벤트 로그 등)은 아직 `rules.js` 안에
인라인으로 있습니다. Issue ID 체계로 옮기는 것은 남은 작업입니다.

---

## 6. 상관관계 엔진

핵심 규칙은 하나 — **둘 다 있을 때만 작동합니다.**

```
CPU 열 스로틀링  ×  예기치 않은 종료   → 과열로 인한 보호 종료 가능성
GPU 열 스로틀링  ×  드라이버 TDR       → 냉각 문제로 인한 드라이버 리셋 가능성
VRAM 불일치      ×  WHEA               → 그래픽 메모리 관련 하드웨어 오류 가능성
설정 변경        ×  WHEA/블루스크린    → 조사 대상 (인과 단정 안 함)
```

한쪽만 있으면 **아무것도 하지 않습니다.** `confidence`가 `null`인 이슈(근거 부족을
명시적으로 남긴 판정)는 상호 보강 대상에서 제외합니다.

### 이벤트 로그 분류

**provider 이름만으로 분류하면 오탐이 납니다.** `Microsoft-Windows-Kernel-Power`에는
진짜 비정상 종료(ID 41)뿐 아니라 **정상적인 절전 진입(42)·복귀(107)·정상 종료 전환(109)**이
전부 들어옵니다. provider만 보고 세는 바람에 멀쩡한 개발 PC가 "최근 7일 비정상 종료 19건"으로
표시되고 등급이 C까지 내려갔던 적이 있습니다.

WHEA도 정정된 오류(17·47)와 정정 불가 오류(18·19·20·23·24·25·46)를 구분합니다.

---

## 7. 기준선

`baseline.js`는 순수 함수이며 파일 I/O는 `baselineStore.js`가 담당합니다.

### 생성 조건

```
샘플 10개 × 3초 간격 (+ 버리는 프라이밍 샘플 1개) ≈ 33초
유휴 판정: CPU 부하 ≤ 20%
인정 조건: 유휴 샘플 비율 ≥ 75%  AND  유휴 샘플 수 ≥ 5
값: 유휴 샘플만의 중앙값 (부하 샘플은 제외)
```

### 두 개의 가드

**① 측정 중 부하가 걸리면 저장하지 않습니다.** 게임 중에 기준선을 뜨면 "평소 온도 78°C"가
되어 진짜 문제가 생겨도 정상으로 보입니다.

**② 진단 시점이 유휴가 아니면 비교하지 않습니다.** 게임 중 78°C를 유휴 기준선 44°C와
비교하면 "+34°C 이상"이 되는데, 이건 고장이 아니라 부하입니다. CPU 계열은 CPU 부하로,
GPU 항목은 GPU 부하로 각각 게이팅합니다.

### 진단 시점 스냅샷

진단 본작업이 시작되면 **앱 자신이** PowerShell·nvidia-smi·SMART 조회를 돌리느라
CPU를 크게 씁니다.

```
진단 본작업 중 CPU 부하    37~45%   ← 앱 자신의 부하가 섞인 값
본작업 전 스냅샷           5~9%     ← 기준선 비교에 쓰는 값
```

그래서 `collectIdleSnapshot()`을 본작업 **전에** 떠서 비교에 씁니다.

> ⚠ `si.currentLoad()`의 첫 호출은 "직전 호출 이후"의 평균이라, 호출 간격이 길면 그 공백이
> 통째로 평균에 들어갑니다. 같은 조건의 연속 샘플이 **#0=46%, #1~#9=11~16%**로 측정됐고,
> 이 한 샘플 때문에 멀쩡한 유휴 PC에서도 측정이 절반쯤 거부됐습니다.

### 무효화 조건

- **CPU 모델이 다르면** 비교 자체를 하지 않습니다(다른 PC의 값).
- **GPU만 다르면** GPU 항목만 건너뛰고 CPU 비교는 유지합니다.
- **시간으로는 만료시키지 않습니다.** 오래된 기준선을 버리면 정작 몇 달에 걸친 변화를
  못 잡습니다. 대신 나이를 함께 돌려주고 180일 이상이면 신뢰도를 낮춰 잡습니다.

---

## 8. 부하 테스트

### 안전 설계

- 렌더러에서 온 값은 신뢰하지 않고 `stress.clampNumber`가 범위 밖·NaN을 전부 접습니다.
- 테스트 파일 경로는 렌더러가 정하지 못합니다 — 항상 앱 임시 폴더에만 씁니다.
- CPU 부하는 온도 안전 한계 도달 시 자동 중단합니다. **센서가 없으면** 시간 제한 모드로
  바꾸고 그 사실을 결과에 남깁니다.
- **부하 테스트는 실패해도 예외를 던지지 않습니다.** 던지면 호출부에서 결과가 통째로 사라져
  "검사 안 함"과 "검사했는데 실패"가 구분되지 않습니다.

### "실행했다"와 "실제로 밀어붙였다"는 다르다

창을 최소화하거나 완전히 가리면 렌더링이 멈춰 GPU 부하가 걸리지 않습니다. 실제로 자동화
테스트에서 **최고 부하 15%, 클럭 607MHz(유휴)인데 "완주, 이상 없음"으로 기록**된 것을
발견했습니다. 그래서 관측된 최고 사용률이 50% 미만이면 정상이 아니라 **판단 보류**로
처리합니다. **부하를 거는 검사를 새로 만들면 반드시 같은 검증을 넣어야 합니다.**

### WebGL로 실제 GPU 부하를 만드는 법

프레임당 드로우 콜이 하나뿐이면 vsync 때문에 GPU가 프레임 사이에 놉니다.

| 드로우 콜(K) | GPU 사용률 | 비고 |
|---:|---:|---|
| 1 | 29% | 프레임 사이에 GPU가 논다 |
| 4 | 58% | |
| 16 | 99% | 포화 — 채택값 |
| 48 | 99% | 더 늘려도 같음 |

전 구간에서 65fps를 유지했고, 프레임마다 `gl.finish()`로 동기화합니다.

### VRAM 검사가 믿지 않는 것

**WebGL 텍스처 할당은 여유 VRAM을 넘어도 그냥 성공합니다.** 여유 1.8GB인 GPU에 2.6GB를
요청했는데 `OUT_OF_MEMORY` 없이 전부 할당됐습니다 — Windows(WDDM)가 넘치는 만큼을
시스템 메모리에 얹기 때문입니다.

그래서 "할당에 성공한 양"을 검사 범위로 쓰지 않고, `nvidia-smi`의 VRAM 사용량 증가분과
대조합니다. 위 사례에서 실제 증가분은 1,510MB(할당량의 58%)뿐이었습니다.
증가가 확인되지 않으면 불일치가 0이어도 **정상이 아니라 판단 보류**입니다.

또한 `deleteTexture`만으로는 VRAM이 반납되지 않습니다. 테스트마다 캔버스를 새로 만들고
끝날 때 `WEBGL_lose_context`로 컨텍스트째 버립니다.

---

## 9. 프로필

수집 단계를 켜고 끄는 선언적 정의입니다. 기본값은 **전부 켜짐**이고 프로필은 끌 것만 끕니다.

```js
profile = {
  id, label, purpose, audience, estimatedSec,
  report: 'diagnosis' | 'inspection',
  collect: { cpu, cpuTrend, memory, memoryModules, overclock, gpu, gpuTrend,
             storage, network, display, system, processes, events, identity },
  deep: { cpuStressSec, cpuSafetyTempC, storageMB, ramMB } | null,
  skips: { EVENTS: '왜 건너뛰는지 사용자에게 보여줄 문장' },
  focus: ['GPU', 'CPU', ...],        // 섹션 정렬 우선순위
  sessionRole: 'intake' | 'exit',    // 전후 비교 짝
  requiresPair: 'repairIntake'
}
```

**끈 수집 단계는 값을 지어내지 않습니다.** `main.js`의 `SKIPPED`가 **비어 있는 모양**을
그대로 넘깁니다(예: `ping: {avgMs:null}`, `display: []`). 그래야 규칙 엔진이 그 카테고리를
`NOT_TESTED`로 판정합니다. 여기서 임의로 "정상값"을 채워 넣으면 리포트 전체가 거짓이 됩니다.

`buildReport`는 프로필이 건너뛴 섹션의 사유를 **"이 프로필에서는 안 함"**으로 덮어씁니다.
"이 환경에서 못 함"과 구분해야 사용자가 취할 행동이 달라지기 때문입니다.

---

## 10. 세션과 비교

### 비교 전제를 함께 저장한다

같은 숫자라도 **"부하 테스트 중 최고 온도"와 "유휴 온도"는 전혀 다른 값**입니다.
그래서 세션에 `deepTestsIncluded`를 함께 남기고, 한쪽만 부하 테스트를 했다면 부하가 필요한
항목을 비교에서 뺍니다.

### 범위 지문

비교 가능성은 프로필 **이름**이 아니라 실제 검사 **범위**로 판단합니다.
`scopeKey = SHA-256(collect + deep)`입니다.

수리 입고/출고는 이름이 다르지만 비교가 성립하도록 범위를 *일부러* 같게 맞춰둔 짝입니다.
이름으로 비교하면 정상적인 입고→출고 비교마다 "프로필이 다릅니다" 경고가 떠서,
정작 진짜 경고를 흘려보게 됩니다.

### 비교 규칙

- 한쪽이라도 `null`이면 **not-comparable** — 개선/악화를 말하지 않습니다.
- 온도·건수는 절대 임계값(2°C, 1건), **처리량은 비율(10%)**로 판단합니다.
  NVMe 1,200MB/s에서 20MB/s 차이는 노이즈입니다.
- 하드웨어 대조는 "인증"이 아니라 **OS에서 읽을 수 있는 식별값의 일치 여부**이며,
  이 한계를 결과 객체가 문자열로 들고 다닙니다. 못 읽은 항목은 *일치*라고 하지 않습니다.

---

## 11. 리포트와 무결성

### 화면 = 저장 파일

점검 리포트는 화면과 저장 파일이 **완전히 같은 HTML**(`inspectionReportHtml.js`)입니다.
PDF는 같은 HTML을 숨긴 `BrowserWindow`에 `data:` URL로 띄워 `printToPDF`로 인쇄합니다.
별도 PDF 라이브러리가 필요 없습니다.

PDF는 정적 문서라 `<details>`가 접힌 채면 내용을 다시 볼 수 없으므로,
PDF로 저장할 때만 상세를 강제로 펼친 버전을 만듭니다.

### 검증 해시가 덮는 것

canonical payload(키 순서에 흔들리지 않도록 정규화)를 SHA-256으로 해시합니다.
현재 **페이로드 버전 4**입니다.

```
v1  하드웨어 식별값 + 카테고리 status
v2  + 각 이슈의 실제 내용(근거·조치·측정값)
v3  + 섹션 result / notTested        ← 검사 안 함을 이상 없음으로 못 바꾸게
v4  + 프로필 / 버전 정보              ← 빠른 점검을 중고 PC 점검이라 못 하게
```

각 확장은 실제 우회 경로를 막기 위한 것입니다. v2 이전에는 status만 같으면 근거 문구를
통째로 바꿔도 검증을 통과했습니다.

### Report ID와 해시의 역할 분리

- **Report ID**(`DB-20260813-6FC7151E`) — 이 문서를 가리키는 *이름*. 발급 시각 +
  하드웨어 식별값에서만 뽑습니다. 내용이 정정돼도 같은 이름을 유지합니다.
- **verificationHash** — 내용이 안 바뀌었다는 *증거*. 값 하나만 바뀌어도 달라집니다.

### 검사 범위는 실제 결과에서 뽑는다

예전에는 `testScope.completed`가 하드코딩이라 GPU를 못 읽은 PC에서도 "GPU 기본 상태 —
검사 완료"라고 적혔습니다. 지금은 섹션 `result`에서 파생하고, 일부를 검사하지 못했으면
**A+ 등급을 주지 않고** 등급 문구에 "(일부 항목 미검사)"를 명시합니다.

---

## 12. 저장 데이터

모두 `app.getPath('userData')` 아래에 JSON으로 저장됩니다. **외부로 전송하지 않습니다.**

| 파일 | 내용 | 보관 정책 |
|---|---|---|
| `diagnosis-history.json` | 전체 진단 요약(등급·핵심 수치) | 최근 200회 |
| `inspection-sessions.json` | 점검 세션(프로필·지표·하드웨어 구성) | 최근 200회 |
| `baseline.json` | 평소 상태 기준선 1건 | 시간 만료 없음 |
| `vram-check.json` | VRAM 검사 최신 결과 1건 | 30일 |
| `gpu-stress-check.json` | GPU 부하 테스트 최신 결과 1건 | 30일 |
| `display-checks.json` | 디스플레이 셀프체크 결과(사람 판정) | 30일 |
| `settings.json` | 표시 모드 | — |

"최신 결과 1건" 계열은 `latestCheckStore.js` 팩토리를 공유합니다.
기준선도 같은 팩토리를 쓰되 `staleMs: Infinity`로 시간 만료를 끕니다.

JSON 파싱에 실패하면 예외를 던지지 않고 `null`을 반환합니다 —
잘못된 값으로 진단하는 것보다 낫기 때문입니다.

---

## 13. 테스트 전략

### 규칙 엔진 회귀 테스트 — 251개

Node 표준 `assert`만 씁니다. `npm run test-rules`로 실행하며 CI에서는 Linux에서 돕니다 —
규칙 엔진이 순수 JS라 OS와 무관하기 때문입니다.

### fixture — "이 상태면 이 등급"

`scripts/fixtures.js`는 시나리오를 통째로 고정합니다. 가장 위험한 회귀는 기능이 죽는 게
아니라 **문제가 있는데 정상이라고 말하는 것**이고, 그런 회귀는 조용히 통과합니다.

```
ram-error                            → 등급 D
storage-io-error                     → 등급 C
sleep-events-only                    → 등급 A   (절전 이벤트를 비정상 종료로 세던 오탐)
whea-corrected-only                  → critical 아님
slow-but-healthy-storage             → 등급 A+  (속도만으로 고장 판정 금지)
baseline-idle-temp-rise              → 등급 C   (절대 임계값으로는 안 잡히는 케이스)
baseline-under-load-no-false-alarm   → 등급 A   (부하 중에는 기준선 비교 안 함)
```

### 불변식 테스트

개별 값이 아니라 **지켜야 할 성질**을 검사합니다. 실제로 지식 DB의 내용 결함 2개를
이 방식으로 잡았습니다.

- 모든 조치에 위험도가 있다 / 첫 조치는 항상 `SAFE`다
- Wizard의 마지막 단계는 항상 재검사다
- 규칙이 만든 이슈의 안내가 지식 DB와 정확히 일치한다
- Issue ID는 중복되지 않는다

### E2E — 실제 앱을 헤드리스로 띄운다

GUI 자동화 도구가 없어, `require('./main.js')`로 **실제 앱을 그대로 띄우고**
`app.on('browser-window-created')`로 창을 잡아 `webContents.executeJavaScript()`로
버튼 클릭과 DOM 상태를 확인합니다.

> ⚠ **main.js를 안 띄우면 IPC가 조용히 전부 실패합니다.** 렌더러만 따로 띄우면 `ipcMain`
> 핸들러가 하나도 등록되지 않습니다. 에러도 나지 않고 그냥 아무것도 안 됩니다.
>
> 또 `contextBridge`로 노출한 객체는 **동결되어 있어 함수를 가로챌 수 없습니다.**
> 렌더러 동작을 검증할 때는 버튼을 실제로 클릭하고 DOM과 저장 파일에서 결과를 읽어야 합니다.

화면 자체를 확인할 때는 `webContents.capturePage()`로 PNG를 떠서 눈으로 대조합니다.

### 검증할 수 없는 것은 명시한다

- ATA/SATA SMART 파서 — 장비가 없어 샘플 출력으로만 검증
- CPU 온도 기준선 비교 — 개발 PC에 센서가 없어 가짜 입력으로만 검증
- 혼합 DIMM·오버클럭 판정 — 해당 하드웨어가 없어 가짜 입력으로만 검증
- UAC 승인이 필요한 경로 — 자동 클릭이 불가능해 사람이 직접 눌러 검증

---

## 14. 측정 한계

읽을 수 없는 것과 그 기술적 이유입니다. "아직 안 만든 기능"이 아니라
**현재 접근 방식으로는 불가능한 것**입니다.

| 항목 | 기술적 이유 | 대신 하는 것 |
|---|---|---|
| 메모리 타이밍(CL·tRCD·tRP) | WMI에 속성 자체가 없음. SPD를 SMBus로 읽으려면 커널 드라이버 필요 | "검사 안 함"으로 명시 |
| XMP·EXPO 프로파일 목록 | 같은 이유(SPD 접근 불가) | `Speed`(정격) vs `ConfiguredClockSpeed`(현재) 차이만 말함 |
| CPU 전압 | `Win32_Processor.CurrentVoltage`는 8번째 비트가 켜져야 실제 전압. 대부분 보드가 채우지 않음 | 언더볼팅 여부 "확인 불가" |
| GPU 실시간 상태 | `nvidia-smi` 의존 — AMD·Intel 대응 도구가 다름 | 모델·VRAM 용량만 읽고 나머지는 NOT_TESTED |
| GPU 오버클럭 여부 | 공장 OC 모델은 `clocks.max.sm`이 원래 높음. 레퍼런스 DB 없이는 비교 불가 | 전력 제한만 판정에 사용 |
| 실제 지원 주사율 | `WmiMonitorListedSupportedSourceModes`는 EDID 구식 타이밍만 반환. P/Invoke `EnumDisplaySettingsEx`는 재현 가능하게 `false` 반환 | OS 보고값만 표시 |
| NVMe가 아닌 장치의 SMART | `\\.\PhysicalDriveN` 경로로는 일부 컨트롤러에서 열리지 않음 | `smartctl --scan`이 알려주는 이름·타입 사용 |

**뒤집힌 판단도 있습니다.** 초기에는 "CUDA/DirectX 없이는 실제 GPU 부하를 만들 수 없다"고
판단해 GPU 부하 테스트를 제외했습니다. 실측으로 뒤집혔습니다 — Electron은 곧 Chromium이라
WebGL이 실제 GPU 하드웨어 가속을 씁니다. **"불가능하다"고 적힌 항목도 주기적으로 재검토할
가치가 있습니다.**

---

## 15. 확장 가이드

대부분 실제로 사고가 났던 자리입니다.

### 새 수집 항목을 추가할 때

- 읽지 못한 값은 **`null`로 남깁니다.** `0`으로 채우면 "오류 0건" 같은 없는 사실을 만듭니다.
- PowerShell 호출에는 `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;`을 반드시 붙입니다.
- 플랫폼 판정은 `process.platform`을 씁니다. `si.osInfo().platform`은 사람이 읽는 이름입니다.
- OS 출력 파서는 **따로 내보내** 샘플 출력으로 테스트할 수 있게 합니다.

### 새 섹션·검사를 추가할 때

- `finalize()`에 **`tested`를 반드시 넘깁니다.** 안 넘기면 기본값이 `true`라 측정 실패가
  PASS로 둔갑합니다.
- 부분적으로 못 한 검사는 `notTested[]`에 적습니다 — 리포트 검사 범위까지 자동 전파됩니다.
- 부하를 거는 검사라면 **"실제로 밀어붙였는가"를 검증**하고, 아니면 판단 보류로 처리합니다.

### 새 규칙을 추가할 때

- Issue ID를 `issueDb.js`에 등록하고 원인·조치·재검사·Wizard를 거기에 둡니다.
- 모든 조치에 위험도를 달고 **확인만 하는 안전한 조치를 맨 앞에** 놓습니다.
- Wizard의 마지막 단계는 항상 **재검사**입니다.
- 판정 로직이 바뀌면 `version.js`의 `RULESET_VERSION`을 올립니다.
- `scripts/fixtures.js`에 시나리오를 추가합니다.

### 판정 관련 필드를 바꿀 때

**엔진만 고치면 버그가 그대로 남습니다.** 섹션에 `result`를 도입했는데 대시보드 뱃지는
계속 `status`를 읽고 있었습니다. `status`는 네 단계뿐이라 측정도 못 한 카테고리가 `normal`로
내려오고, 화면에는 **초록색 "정상"**으로 표시됐습니다 — 엔진을 고치기 전과 사용자가 보는
결과가 똑같았던 셈입니다.

판정 관련 필드를 바꾸면 **렌더러와 리포트 HTML까지 함께 훑어야 합니다.**

### 표시 모드를 다룰 때

기본/전문가 모드는 `body[data-view-mode="basic"] .expert-only { display:none }` 한 줄로
동작합니다. 감출 수 있는 것은 **상세 근거**뿐입니다. 판정 결과·등급·경고·"검사 안 함"은
두 모드에서 동일해야 하며, E2E가 매번 확인합니다.
