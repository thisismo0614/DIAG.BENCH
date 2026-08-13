# 서드파티 고지 (Third-Party Notices)

DIAG.BENCH 본체는 MIT 라이선스입니다(`LICENSE` 참고). 아래는 함께 배포되거나 사용되는
서드파티 구성요소의 라이선스 고지입니다.

---

## 1. smartmontools (smartctl.exe) — GPL v2 ⚠ 중요

Windows 설치 파일에는 저장장치 SMART 정보를 읽기 위해 **smartmontools의 `smartctl.exe`가
그대로 동봉**됩니다(`resources/smartmontools/`).

- 프로젝트: https://www.smartmontools.org/
- 라이선스: **GNU General Public License, version 2 or later**
- 라이선스 전문: 설치 폴더의 `resources/smartmontools/COPYING.txt`

### 왜 DIAG.BENCH 본체는 MIT일 수 있는가

DIAG.BENCH는 `smartctl.exe`를 **별도의 프로세스로 실행하고 표준 출력을 파싱**할 뿐,
GPL 코드를 링크하거나 소스에 포함하지 않습니다. 설치 파일은 두 프로그램을 한 패키지에
담은 형태(aggregation)입니다.

### 배포자가 지켜야 하는 것 (GPL v2 §3)

GPL v2 바이너리를 배포할 때는 다음 중 하나를 반드시 함께 제공해야 합니다.

1. 대응하는 전체 소스 코드를 함께 배포, **또는**
2. 최소 3년간 유효한 **서면 소스 제공 제안**을 동봉, **또는**
3. (비상업적 배포에 한해) 받은 제안을 그대로 전달

**DIAG.BENCH가 택한 방법 — 1번(소스 동봉)**: 릴리스 워크플로가 대응 버전의 소스 tarball을
내려받아 **같은 GitHub Release에 함께 업로드**합니다. 문서에 링크만 걸어두는 방식보다 확실합니다
(외부 링크는 나중에 깨질 수 있고, GPL은 "함께 배포"를 요구하기 때문).

| 항목 | 값 |
|---|---|
| 동봉 바이너리 | `resources/smartmontools/smartctl.exe` (1,165,312 바이트) |
| 버전 배너 | `smartctl 7.5 2025-04-30 r5714 [x86_64-w64-mingw32-w10-22H2] (AppVeyor)` |
| **바이너리 SHA-256** | `b5db94e5082c042be44994b7a4fa8f7b5c8e713b2ab1c9a560d8f7a7995ea27d` |
| 상위 배포판 | `smartmontools-7.5.win32-setup.exe` (공식 Windows 패키지) |
| 상위 배포판 MD5 | `bb1e199ad6a3db3e1c27ae54b835cbd5` (SourceForge 게시 `.md5`) |
| 수정 여부 | **없음** — 상위 빌드를 그대로 동봉 |
| 대응 소스 | `smartmontools-7.5.tar.gz` — **각 릴리스에 함께 업로드됨** |
| 소스 SHA-256 | `690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e` |
| 공식 소스 저장소 | https://www.smartmontools.org/browser |
| 릴리스 아카이브 | https://sourceforge.net/projects/smartmontools/files/smartmontools/ |
| 라이선스 전문 | `resources/smartmontools/COPYING.txt` (설치 파일에 동봉됨) |

소스 tarball은 릴리스 시점에 SourceForge에서 내려받되, **gzip 매직 바이트와 위 SHA-256을
검증**합니다. 하나라도 어긋나면 릴리스를 만들지 않습니다(`.github/workflows/release.yml`).

### 동봉 바이너리를 직접 검증하는 방법

이 저장소에는 빌드된 실행 파일이 커밋되어 있습니다. 그것이 정말 상위 배포판에서 온 것인지
확인하려면:

```
# 1. 저장소의 바이너리 해시
certutil -hashfile resources\smartmontools\smartctl.exe SHA256

# 2. 공식 Windows 패키지를 받아 위 MD5와 대조한 뒤, 7-Zip으로 풀어
#    bin\smartctl.exe의 SHA-256이 1번과 같은지 확인
```

> ⚠ **아직 검증되지 않은 부분**: 위 1번과 2번의 바이트 일치는 **이 저장소의 CI가 자동으로
> 확인하지 않습니다.** 표의 SHA-256과 MD5는 각각 실측·공식 게시값이지만, 둘을 이어주는
> 압축 해제 대조는 사람이 위 절차로 해야 합니다. 상위 배포판이 NSIS 설치 파일이라
> 추출기가 필요하고, 그것을 릴리스 워크플로에 넣으면 서명 파이프라인을 건드리게 되어
> 미뤄두었습니다.

### ⚠ smartctl.exe를 새 버전으로 교체할 때 반드시 함께 바꿔야 하는 것

바이너리만 바꾸고 소스를 그대로 두면 **GPL 요건을 위반**하게 됩니다(대응하지 않는 소스를 제공).

1. `resources/smartmontools/smartctl.exe` 교체
2. `resources/smartmontools/COPYING.txt`가 새 버전 것과 같은지 확인
3. `.github/workflows/release.yml`의 `$ver`와 `$expected`(체크섬)를 새 버전 값으로 수정
4. 이 문서의 표를 **전부** 수정 — 버전 배너, **바이너리 SHA-256**, 상위 배포판 이름과 MD5,
   대응 소스 이름과 SHA-256. 바이너리 해시를 옛날 값으로 두면 검증하려는 사람을 헛돌게 한다

> ⚠ **이 문서는 법률 자문이 아닙니다.** 위 조치는 GPL v2 §3(a)에 대응하는 기술적 조치이지만,
> 상업적 배포를 하거나 배포 규모가 커진다면 법률 전문가에게 확인하시기 바랍니다.

### smartmontools를 빼고 싶다면

`package.json`의 `build.extraResources`에서 smartmontools 항목을 제거하면 됩니다.
그 경우 SMART 진단은 "smartctl을 찾을 수 없음(미지원)"으로 표시되며, 앱의 다른 기능은
그대로 동작합니다. 사용자가 smartmontools를 직접 설치하면 PATH에서 찾아 사용합니다.

---

## 2. npm 의존성 — 전부 MIT

| 패키지 | 용도 | 라이선스 |
|---|---|---|
| electron | 데스크톱 런타임 | MIT |
| electron-builder | Windows 설치 파일 생성 | MIT |
| systeminformation | 하드웨어 정보 수집 | MIT |
| qrcode | 점검 리포트 QR 생성 | MIT |
| pngjs | qrcode 의존성 | MIT |
| dijkstrajs | qrcode 의존성 | MIT |

MIT 라이선스끼리는 충돌이 없으며, MIT 프로젝트에 포함해 재배포할 수 있습니다.

---

## 3. Electron / Chromium

Electron은 MIT이지만 내부에 Chromium과 Node.js를 포함하며, 이들은 각각 BSD 계열 등
자체 라이선스를 가집니다. Electron이 빌드 산출물에 포함하는 `LICENSES.chromium.html`
파일이 설치 폴더에 함께 배포됩니다.

---

## 3-1. Pretendard (웹사이트 글꼴) — SIL Open Font License 1.1

공식 웹사이트(`website/`)가 본문 글꼴로 **Pretendard**를 자체 호스팅합니다.
**앱 설치 파일에는 포함되지 않습니다** — 웹사이트에만 해당합니다.

- 프로젝트: https://github.com/orioncactus/pretendard
- 저작권: Copyright (c) 2021 Kil Hyung-jin, with Reserved Font Name Pretendard
- 라이선스: **SIL Open Font License, Version 1.1** — https://scripts.sil.org/OFL
- 라이선스 전문: https://github.com/orioncactus/pretendard/blob/main/LICENSE

### 원본 그대로가 아니라 서브셋해서 씁니다

배포 파일은 `website/public/fonts/diagbench-sans.woff2`이며,
원본 `PretendardVariable.woff2`(2,009 KB)에서 다음을 추려 만든 것입니다(294 KB).

| 항목 | 내용 |
|---|---|
| 원본 | Pretendard v1.3.9 Variable |
| 담은 글자 | KS X 1001 상용 한글 2,350자 + 사이트 본문에 쓰인 글자 + 라틴·문장부호 (총 2,499자) |
| 가변 축 | `wght` 45–930 → **400–700으로 축소** (사이트가 쓰는 범위) |
| 생성 방법 | `website/scripts/build-font-subset.py` (fontTools) |

OFL 1.1은 서브셋·개조를 허용하며, 조건은 다음과 같고 모두 지키고 있습니다.

1. **저작권 고지와 라이선스를 함께 배포** — 이 문서가 그 고지입니다.
2. **예약 글꼴 이름(Reserved Font Name) "Pretendard"를 개조본 이름에 쓰지 않을 것**
   — 서브셋도 개조본으로 보아, 글꼴 내부 `name` 테이블(nameID 1·4·6·16)과 CSS의
   `font-family`를 모두 **`DIAGBENCH Sans`** 로 바꿨습니다. 파일명도 `diagbench-sans.woff2`입니다.
   이름을 바꿨다고 고지 의무가 없어지지는 않으므로, 원본과 저작권자는 위에 그대로 밝힙니다.
3. **글꼴 자체를 유료로 판매하지 않을 것** — 웹사이트에서 무료로 제공됩니다.

---

## 4. 이 앱이 사용하는 외부 명령 (동봉하지 않음)

아래는 Windows에 이미 있거나 사용자가 별도로 설치한 것을 호출만 합니다. 배포하지 않습니다.

- `powershell.exe` — 이벤트 로그, 드라이버 상태, 하드웨어 식별값 조회
- `nvidia-smi` — NVIDIA GPU 실시간 상태 (NVIDIA 드라이버에 포함)
