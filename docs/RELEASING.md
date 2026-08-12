# 배포 가이드 (Releasing)

태그 하나로 빌드 → 코드 서명 → GitHub Release → 웹사이트 갱신까지 자동 진행됩니다.
이 문서는 **자동화되지 않는 부분(사람이 한 번 해야 하는 설정)** 을 정리합니다.

---

## 0. 전체 흐름

```
git tag v0.18.0  →  GitHub Actions (release.yml)
                        ├─ 태그 ↔ package.json 버전 대조
                        ├─ 회귀 테스트 130개
                        ├─ electron-builder 빌드
                        ├─ 산출물 검증 (크기·smartctl 동봉 여부)
                        ├─ SignPath 코드 서명          ← 설정된 경우에만
                        ├─ Authenticode 서명 검증      ← 실패하면 여기서 중단
                        ├─ SHA-256 체크섬 생성
                        ├─ GitHub Release 생성
                        └─ 웹사이트 재배포 트리거 (website.yml)
```

**서명에 실패하면 릴리스가 생성되지 않습니다.** 반대로 SignPath를 아직 설정하지 않았다면
릴리스는 생성되되 릴리스 노트와 사이트에 "서명되지 않음"이라고 명시됩니다.

---

## 1. 최초 1회 — GitHub 저장소 준비

```bash
# 프로젝트 폴더에서
git init
git add .
git commit -m "DIAG.BENCH v0.17.0"
git branch -M main
git remote add origin https://github.com/<계정>/diag-bench.git
git push -u origin main
```

그다음 **저장소를 Public으로** 설정합니다(SignPath 무료 프로그램의 전제 조건).

### 코드에서 바꿔야 하는 곳

`OWNER`를 실제 GitHub 계정으로 바꿉니다.

| 파일 | 항목 |
|---|---|
| `package.json` | `homepage`, `repository.url`, `bugs.url` |
| `website/site.config.json` | `owner`, `siteUrl` |

> `website/site.config.json`의 `owner`는 GitHub Actions에서 자동으로 덮어써지므로
> (workflow가 `github.repository_owner`를 넘김) 로컬 미리보기용입니다.
> 다만 `siteUrl`은 직접 맞춰야 합니다.

---

## 2. GitHub Pages 켜기

저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions**

이후 `main`에 push하면 `website.yml`이 사이트를 배포합니다.
주소는 `https://<계정>.github.io/diag-bench/` 입니다.

`website/site.config.json`의 `siteUrl`을 이 주소로 맞추세요(canonical/sitemap에 쓰입니다).

---

## 3. SignPath 무료 코드 서명 신청

> 승인까지 시간이 걸립니다. 승인 전에도 릴리스는 정상 동작하며, 단지 "미서명"으로 표시됩니다.

1. https://signpath.org/ 에서 **Open Source 프로그램** 신청
   - 공개 GitHub 저장소, OSS 라이선스(이 프로젝트는 MIT), 빌드가 GitHub Actions에서
     재현 가능해야 합니다. 이 저장소는 세 조건을 이미 충족합니다.
2. 승인되면 SignPath 콘솔에서 **Project**를 만들고 **Signing Policy**를 설정합니다.
3. 아래 값을 확인해 GitHub에 등록합니다.

### GitHub에 등록할 값

저장소 → **Settings → Secrets and variables → Actions**

**Variables 탭** (비밀이 아닌 값 — 워크플로에서 조건 판단에도 씀):

| 이름 | 값 | 필수 |
|---|---|---|
| `SIGNPATH_ORGANIZATION_ID` | SignPath 조직 ID (GUID) | 서명하려면 필수 |
| `SIGNPATH_PROJECT_SLUG` | SignPath 프로젝트 slug | 서명하려면 필수 |
| `SIGNPATH_SIGNING_POLICY_SLUG` | 서명 정책 slug | 선택 (기본값 `release-signing`) |
| `SITE_URL` | 사이트 주소 (도메인 연결 시) | 선택 |
| `ANALYTICS_ID` | 분석 도구 측정 ID | 선택 |

**Secrets 탭** (비밀 값):

| 이름 | 값 |
|---|---|
| `SIGNPATH_API_TOKEN` | SignPath API 토큰 |

> ⚠ API 토큰은 **반드시 Secrets에만** 넣으세요. 소스 코드·워크플로 파일·웹사이트 코드에
> 직접 적으면 안 됩니다. 워크플로는 `${{ secrets.SIGNPATH_API_TOKEN }}` 형태로만 참조합니다.

`SIGNPATH_ORGANIZATION_ID`와 `SIGNPATH_PROJECT_SLUG`가 **둘 다 비어 있으면** 서명 단계를
건너뛰고 "미서명"으로 릴리스합니다. 하나라도 설정하면 서명을 시도하고, 실패 시 릴리스를
만들지 않습니다.

---

## 4. 릴리스 만들기

```bash
# 1. 버전 올리기 (package.json의 version)
#    태그와 다르면 워크플로가 즉시 실패합니다.
# 2. 커밋
git add package.json
git commit -m "v0.18.0"
git push

# 3. 태그 push → 자동 릴리스 시작
git tag v0.18.0
git push origin v0.18.0
```

버전 규칙: `v` + `package.json`의 version. `0.x`는 자동으로 **사전 릴리스(prerelease)** 로
표시됩니다(1.0.0부터 정식 릴리스).

### 릴리스가 잘못됐을 때 되돌리기

```bash
git tag -d v0.18.0
git push origin :refs/tags/v0.18.0   # 원격 태그 삭제
```

그다음 GitHub의 Releases 페이지에서 해당 릴리스를 수동 삭제합니다.

---

## 4-1. 나중에 Vercel 등으로 사이트를 옮기려면

사이트는 **일반 정적 HTML**이고 링크가 전부 상대경로라 호스팅에 묶여 있지 않습니다.

| 호스팅 | 설정 |
|---|---|
| Vercel / Netlify / Cloudflare Pages | Root Directory `website`, Build Command `node build.js`, Output Directory `dist` |
| 환경변수 | `SITE_URL`, `GITHUB_OWNER`, `GITHUB_REPOSITORY_NAME` (선택: `ANALYTICS_ID`, `GITHUB_TOKEN`) |

**GitHub Pages 전용인 부분은 `.github/workflows/website.yml` 하나뿐입니다**
(`configure-pages` / `upload-pages-artifact` / `deploy-pages`). 다른 호스팅으로 옮기면
이 워크플로만 비활성화하거나 지우면 되고, `website/` 안의 파일은 그대로 씁니다.

`build.js`가 만드는 `.nojekyll`은 GitHub Pages용이지만 다른 호스팅에서는 무시되므로
남아 있어도 문제 없습니다.

> ⚠ 옮긴 뒤에는 **릴리스 후 자동 갱신 경로가 끊깁니다.** `release.yml`의 마지막 단계가
> `website.yml`을 트리거하는 구조이기 때문입니다. Vercel이라면 Deploy Hook을 만들어
> 그 URL을 호출하도록 마지막 단계를 바꾸세요(그 URL은 Secret으로 관리).

---

## 5. 도메인 연결 (선택)

도메인을 구입한 뒤:

1. DNS에 `CNAME` 레코드 추가 → `<계정>.github.io`
   (apex 도메인이면 GitHub Pages의 A 레코드 4개를 등록)
2. 저장소 → Settings → Pages → **Custom domain** 에 도메인 입력
3. **Enforce HTTPS** 체크 (인증서는 GitHub이 자동 발급)
4. 저장소 Variables에 `SITE_URL`을 새 도메인으로 등록
   (canonical URL과 sitemap이 새 주소로 생성됩니다)

---

## 6. 로컬에서 사이트 미리보기

```bash
cd website
node build.js                 # dist/ 생성
npx serve dist                # 또는 아무 정적 서버
```

환경변수로 다른 저장소를 가리켜 테스트할 수도 있습니다.

```bash
GITHUB_OWNER=<계정> GITHUB_REPOSITORY_NAME=diag-bench node build.js
```

---

## 7. 자주 겪는 문제

| 증상 | 원인과 해결 |
|---|---|
| 워크플로가 "태그와 package.json 버전이 다릅니다"로 실패 | `package.json`의 version을 올리고 커밋한 뒤 태그를 다시 만드세요. |
| SignPath 단계에서 멈춤 | 서명 정책에 수동 승인이 걸려 있으면 SignPath 콘솔에서 승인해야 진행됩니다. |
| 서명 검증에서 `UnknownError` | 인증서 체인을 검증하지 못한 경우입니다. SignPath 정책과 인증서 유효기간을 확인하세요. |
| 사이트에 최신 버전이 안 보임 | `website.yml`을 수동 실행(Actions → Website → Run workflow)하면 최신 릴리스를 다시 조회합니다. |
| 사이트 빌드가 "치환되지 않은 템플릿 변수" 로 실패 | 템플릿에 `{{새변수}}`를 추가했다면 `build.js`의 `vars`에도 넣어야 합니다. |

---

## 8. SmartScreen에 대해

코드 서명을 붙여도 **Windows SmartScreen 경고가 즉시 사라지지는 않습니다.**

- **Authenticode 코드 서명** = "이 파일을 누가 배포했고, 배포 이후 변조되지 않았다"
- **SmartScreen 평판** = "이 파일이 얼마나 많이·안전하게 다운로드·실행됐는가"

둘은 별개의 시스템입니다. 서명된 파일이라도 새 버전은 평판이 쌓일 때까지 경고가 뜰 수 있고,
평판은 배포가 일정하게 반복될수록(같은 인증서, 같은 배포 경로) 축적됩니다.

**하지 말아야 할 것**: SmartScreen 우회, Defender 예외 강제, 서명 검증 비활성화 안내.
사용자에게는 SHA-256 체크섬으로 직접 확인하는 방법을 안내하는 것이 정직하고 효과적입니다.
