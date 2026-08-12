# 릴리스 노트를 생성한다.
#
# 왜 워크플로 안에 인라인으로 두지 않았는가:
# PowerShell here-string(@"..."@)은 닫는 "@가 반드시 0열에 있어야 하는데,
# YAML 블록 스칼라(run: |)는 모든 줄이 일정 이상 들여쓰기되어야 한다. 두 규칙이 충돌해서
# 워크플로 YAML이 파싱되지 않는다. 그래서 별도 스크립트로 분리했다(로컬 테스트도 쉬워진다).

[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Version,      # 예: 0.18.0
  [Parameter(Mandatory)][string]$ExeName,      # 예: DIAG.BENCH-Setup-0.18.0-win-x64.exe
  [Parameter(Mandatory)][string]$Sha256,
  [Parameter(Mandatory)][ValidateSet('true','false')][string]$Signed,
  [string]$Signer = '',
  [string]$GplSourceName = '',                 # 예: smartmontools-7.5.tar.gz (GPL 소스 동봉본)
  [string]$OutFile = 'RELEASE_NOTES.md'
)

$nl = [Environment]::NewLine
$lines = [System.Collections.Generic.List[string]]::new()
function Add-Line([string]$s = '') { $lines.Add($s) }

Add-Line "## DIAG.BENCH v$Version"
Add-Line
Add-Line "Windows PC의 하드웨어·시스템 상태를 진단하는 데스크톱 앱입니다."
Add-Line
Add-Line "### 다운로드"
Add-Line
Add-Line "| 파일 | 설명 |"
Add-Line "|---|---|"
Add-Line "| ``$ExeName`` | Windows x64 설치 파일 |"
Add-Line "| ``SHA256SUMS.txt`` | 무결성 확인용 체크섬 |"
if ($GplSourceName) {
  Add-Line "| ``$GplSourceName`` | 동봉된 smartmontools의 대응 소스 (GPL v2 요건) |"
}
Add-Line
Add-Line "**SHA-256**"
Add-Line '```'
Add-Line $Sha256
Add-Line '```'
Add-Line
Add-Line "내려받은 파일이 위 값과 같은지 직접 확인하실 수 있습니다."
Add-Line
Add-Line '```powershell'
Add-Line "Get-FileHash `".\$ExeName`" -Algorithm SHA256"
Add-Line '```'
Add-Line

if ($Signed -eq 'true') {
  Add-Line "### 코드 서명"
  Add-Line
  Add-Line "이 파일은 Authenticode 코드 서명이 적용되어 있습니다."
  if ($Signer) { Add-Line "서명자: ``$Signer``" }
  Add-Line
  Add-Line '```powershell'
  Add-Line "Get-AuthenticodeSignature `".\$ExeName`" | Format-List Status, SignerCertificate"
  Add-Line '```'
  Add-Line
  Add-Line "> 코드 서명과 Windows SmartScreen 평판은 **별개의 시스템**입니다."
  Add-Line "> 코드 서명은 배포자 확인과 변조 여부 검증에 쓰이고, SmartScreen 평판은 다운로드·실행"
  Add-Line "> 이력이 쌓이면서 따로 형성됩니다. 따라서 서명이 있어도 새로 배포된 버전에는 한동안"
  Add-Line "> 경고가 표시될 수 있습니다. 경고가 뜨면 '추가 정보' → '실행'으로 진행할 수 있으며,"
  Add-Line "> 위 SHA-256 값으로 파일이 변조되지 않았는지 직접 확인하실 수 있습니다."
} else {
  Add-Line "### ⚠ 이 빌드는 코드 서명되지 않았습니다"
  Add-Line
  Add-Line "코드 서명 인증서가 아직 준비되지 않아 서명 없이 배포된 빌드입니다."
  Add-Line "Windows에서 SmartScreen 경고가 표시됩니다."
  Add-Line "위 SHA-256 값으로 파일이 변조되지 않았는지 반드시 확인하신 뒤 실행하세요."
}

Add-Line
Add-Line "### 라이선스"
Add-Line
Add-Line "DIAG.BENCH 본체는 MIT 라이선스입니다."
Add-Line "설치 파일에는 **smartmontools(smartctl.exe, GPL v2)** 가 동봉되어 있습니다."
if ($GplSourceName) {
  Add-Line "GPL v2 요건에 따라 대응 소스 ``$GplSourceName`` 를 이 릴리스에 함께 올렸습니다."
}
Add-Line "라이선스 전문과 상세 고지는 저장소의 THIRD-PARTY-NOTICES.md를 참고하세요."

$content = $lines -join $nl
# GitHub 릴리스 본문은 UTF-8(BOM 없이)이어야 한다
[System.IO.File]::WriteAllText(
  (Join-Path (Get-Location) $OutFile),
  $content,
  (New-Object System.Text.UTF8Encoding($false))
)
Write-Host $content
