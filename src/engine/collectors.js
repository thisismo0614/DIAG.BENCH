// collectors.js
// 각 하드웨어 영역의 원시(raw) 데이터를 수집하는 모듈.
// systeminformation으로 얻을 수 없는 항목(NVIDIA GPU 상세, ping, 드라이버 오류, SMART)은
// OS 명령어를 직접 실행해서 보완한다.

const si = require('systeminformation');
const { exec, execFile } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

// ⚠ PowerShell 호출에는 반드시 `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;`을
//   앞에 붙일 것. 한국어 Windows에서는 PowerShell이 CP949로 출력해서 Node가 읽으면 깨진다.
//   실측: 드라이버 이름이 "SM 버스 컨트롤러" → "SM ���� ��Ʈ�ѷ�"로 화면과 리포트에 그대로 나갔다.
//   chcp 65001도 되지만 콘솔 전역 설정을 바꾸므로 호출별로 지정하는 위 방식을 쓴다.
function run(cmd, timeoutMs = 4000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.toString());
    });
  });
}

function runFile(file, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.toString());
    });
  });
}

// smartmontools는 별도 설치가 필요한 도구라, 앱 설치 파일에 smartctl.exe를 동봉해서
// 사용자가 따로 설치하지 않아도 SMART 검사가 되도록 한다. 동봉본이 없으면(개발 환경,
// 손상 등) PATH의 smartctl로 조용히 폴백한다.
function resolveSmartctlPath() {
  const fallback = 'smartctl';
  if (os.platform() !== 'win32') return fallback;
  let resourcesBase;
  try {
    const { app } = require('electron');
    resourcesBase = app.isPackaged
      ? process.resourcesPath
      : path.join(__dirname, '..', '..', 'resources');
  } catch {
    resourcesBase = path.join(__dirname, '..', '..', 'resources');
  }
  const bundled = path.join(resourcesBase, 'smartmontools', 'smartctl.exe');
  return fs.existsSync(bundled) ? bundled : fallback;
}

// 앱 전체를 관리자 권한으로 띄우면(requireAdministrator) 실행할 때마다 UAC가 떠서
// 부담이 크다. 대신 SMART 조회가 권한 문제로 막혔을 때만, 그 조회 명령 하나만
// 사용자 승인을 받아 승격 실행한다.
//
// Start-Process는 -Verb RunAs와 -RedirectStandardOutput을 함께 쓸 수 없다(파라미터
// 세트 충돌, 실측 확인됨). 그래서 승격 대상을 smartctl.exe가 아니라 cmd.exe로 두고,
// "smartctl ... > 임시파일 2>&1" 형태의 리다이렉션을 cmd.exe 안에서 처리한 뒤 그 결과
// 파일을 읽어온다. cmd.exe의 "따옴표 벗기기" 동작 때문에 전체 명령을 한 번 더 큰따옴표로
// 감싸야 한다. 여러 레이어의 이스케이프 문제를 피하려고 powershell.exe에는
// -EncodedCommand(UTF-16LE→Base64)로 스크립트를 전달한다.
function psSingleQuote(str) {
  return `'${String(str).replace(/'/g, "''")}'`;
}

function runElevatedSmartHealth(smartctlPath, device, type, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const tmpOut = path.join(os.tmpdir(), `diagbench-smart-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    // device/type이 smartctl --scan으로 얻은 값이면 -H 하나로 충분하다(실측 확인: -d를
    // 명시해도 안 해도 결과는 같다). type을 모르는 경우(구버전 diskLayout 폴백 등)에는
    // 자동 인식이 실패할 수 있는 NVMe 대비로 -d nvme를 한 번 더 시도한다.
    const attempts = type
      ? [`${q(smartctlPath)} -d ${type} -H ${q(device)}`]
      : [`${q(smartctlPath)} -H ${q(device)}`, `${q(smartctlPath)} -d nvme -H ${q(device)}`];
    const innerReal = attempts.map((a) => `${a} > ${q(tmpOut)} 2>&1`).join(' || ');
    const cmdArgString = `/c "${innerReal}"`;
    const psScript = `Start-Process -FilePath 'cmd.exe' -ArgumentList ${psSingleQuote(cmdArgString)} -Verb RunAs -WindowStyle Hidden -Wait`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true },
      () => {
        // UAC를 취소하면 cmd.exe가 아예 안 떠서 임시파일이 생기지 않는다 → null로 처리.
        let out = null;
        try {
          out = fs.readFileSync(tmpOut, 'utf-8');
        } catch {
          out = null;
        }
        try { fs.unlinkSync(tmpOut); } catch {}
        resolve(out);
      }
    );
  });
}

// ⚠ smartctl은 종료 코드를 **비트마스크**로 쓴다. 0이 아니라고 실패가 아니다:
//    bit0(1) 명령행 오류 / bit1(2) 장치 열기 실패 / bit2(4) SMART 명령 실패
//    bit3(8) **SMART 판정이 "DISK FAILING"** / bit4(16) prefail 속성이 임계값 이하
//    bit5(32) 과거에 임계값 이하였음 / bit6(64) 오류 로그에 기록 있음 / bit7(128) 자가테스트 오류
//    즉 bit3~7은 "출력은 정상인데 디스크에 문제가 있다"는 뜻이다.
//    범용 runFile()은 종료 코드가 0이 아니면 stdout을 통째로 버리기 때문에, 그대로 쓰면
//    **정작 고장난 디스크에서 결과를 못 읽고 "판독 불가"로 표시하게 된다.** 그래서 smartctl은
//    종료 코드와 무관하게 출력을 살리는 전용 실행 함수를 쓴다.
function runSmartctl(file, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      const out = stdout ? stdout.toString() : '';
      // 프로세스를 아예 못 띄웠거나(ENOENT) 타임아웃이면 출력이 없다 → 진짜 실패.
      if (!out && err) return resolve({ out: null, code: err.code ?? null });
      resolve({ out, code: err && typeof err.code === 'number' ? err.code : 0 });
    });
  });
}

// smartctl -H 출력에서 실제 판정 줄만 읽는다. 출력 어디에서든 PASSED/FAILED 단어를
// 찾는 식으로 하면, "Smartctl open device: ... failed: Invalid argument" 같은 전혀
// 무관한 오류 메시지의 "failed"에 걸려 "SMART 이상(데이터 손실 위험)"으로 오판하게 된다
// (관리자 권한 재시도 기능을 실제로 붙여서 테스트하다가 실측으로 발견한 문제).
function parseSmartHealthOutput(out) {
  if (out === null) return { healthy: null, status: 'unknown' };
  const m = out.match(/(?:overall-health self-assessment test result|Health Status)\s*:\s*(\S+)/i);
  if (!m) return { healthy: null, status: 'unknown' };
  const verdict = m[1].toUpperCase();
  if (verdict === 'PASSED' || verdict === 'OK') return { healthy: true, status: 'passed' };
  if (verdict === 'FAILED' || verdict === 'FAILING') return { healthy: false, status: 'failed' };
  return { healthy: null, status: 'unknown' };
}

// ---------- SMART 속성(-A) 파싱 ----------
// 전체 판정(-H)의 PASSED/FAILED는 디스크가 거의 죽어야 FAILED로 바뀐다. 실제로 수리 현장에서
// "곧 죽을 디스크"를 알아보는 근거는 개별 속성값이다(재할당 섹터, 대기 중 섹터, 수명 등).
// 그래서 -H만 보지 않고 -A까지 읽어 정규화한다.
//
// 두 가지 출력 형식을 다뤄야 한다:
//  - NVMe: "Available Spare: 100%" 같은 key: value 목록
//  - ATA/SATA: "ID# ATTRIBUTE_NAME FLAG VALUE WORST THRESH TYPE UPDATED WHEN_FAILED RAW_VALUE" 표

// "24,187,796", "1,948", "48 Celsius", "100%" 같은 값에서 숫자만 뽑는다.
function smartNum(v) {
  if (v === undefined || v === null) return null;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function parseSmartIdentity(out) {
  if (!out) return {};
  const get = (re) => { const m = out.match(re); return m ? m[1].trim() : null; };
  const rotation = get(/Rotation Rate:\s*(.+)/i);
  return {
    model: get(/(?:Device Model|Model Number|Product):\s*(.+)/i),
    serial: get(/Serial Number:\s*(.+)/i),
    firmware: get(/(?:Firmware Version|Revision):\s*(.+)/i),
    // "Solid State Device"면 SSD, "7200 rpm"이면 HDD. NVMe는 이 줄 자체가 없다.
    rotationRate: rotation,
    isSsd: rotation ? /solid state/i.test(rotation) : null,
  };
}

// NVMe: "SMART/Health Information (NVMe Log 0x02)" 섹션의 key: value 목록
function parseNvmeSmart(out) {
  if (!out || !/NVMe Log 0x02|Percentage Used|Available Spare/i.test(out)) return null;
  const get = (label) => {
    const m = out.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im'));
    return m ? m[1].trim() : null;
  };
  const criticalWarningRaw = get('Critical Warning');
  // Data Units Written는 512바이트 * 1000 단위 → TB 환산
  const duw = smartNum(get('Data Units Written'));
  return {
    kind: 'nvme',
    criticalWarning: criticalWarningRaw,                       // "0x00"이면 경고 없음
    criticalWarningValue: criticalWarningRaw ? Number(criticalWarningRaw) : null,
    temperatureC: smartNum(get('Temperature')),
    availableSparePercent: smartNum(get('Available Spare')),
    availableSpareThreshold: smartNum(get('Available Spare Threshold')),
    wearPercentUsed: smartNum(get('Percentage Used')),
    mediaErrors: smartNum(get('Media and Data Integrity Errors')),
    errorLogEntries: smartNum(get('Error Information Log Entries')),
    powerOnHours: smartNum(get('Power On Hours')),
    powerCycles: smartNum(get('Power Cycles')),
    unsafeShutdowns: smartNum(get('Unsafe Shutdowns')),
    totalHostWritesTB: duw !== null ? round((duw * 512 * 1000) / 1e12, 2) : null,
    // ATA 전용 항목은 NVMe에 개념이 없다 → null(= "모름"이 아니라 "해당 없음"으로 다룬다)
    reallocatedSectors: null, pendingSectors: null, uncorrectableSectors: null,
    crcErrors: null, reportedUncorrect: null, commandTimeouts: null,
  };
}

// ATA/SATA 속성 표.
// ⚠ 이 개발 PC에는 NVMe 디스크밖에 없어서 **실제 SATA 장비로는 검증하지 못했다.**
//    smartctl의 표준 출력 형식에 맞춰 작성하고 샘플 출력으로 단위 테스트만 해뒀다.
//    실제 SATA/HDD가 있는 PC에서 반드시 한 번 확인할 것.
const ATA_ATTR_IDS = {
  5: 'reallocatedSectors',        // 재할당된 섹터 — 이미 불량 판정되어 예비 영역으로 옮겨진 수
  9: 'powerOnHours',
  12: 'powerCycles',
  177: 'wearLevelingCount',       // SSD 수명 지표(제조사마다 의미 상이)
  187: 'reportedUncorrect',       // 정정 불가 오류 보고 수
  188: 'commandTimeouts',
  194: 'temperatureC',
  196: 'reallocationEvents',
  197: 'pendingSectors',          // 읽기 실패해 재할당 대기 중 — 가장 강한 조기 경고
  198: 'uncorrectableSectors',    // 오프라인에서도 정정 불가 — 이미 데이터 손실
  199: 'crcErrors',               // 전송 오류 — 대개 디스크가 아니라 케이블 문제
  231: 'sslLifeLeft',
  233: 'mediaWearoutIndicator',
  241: 'totalLbaWritten',
};

function parseAtaSmart(out) {
  if (!out) return null;
  const lines = out.split('\n');
  const headerIdx = lines.findIndex((l) => /ID#\s+ATTRIBUTE_NAME/.test(l));
  if (headerIdx < 0) return null;

  const attrs = { kind: 'ata' };
  const rows = [];
  // ⚠ 해석하지 못한 줄을 세어둔다. 표에 있는데 우리가 못 읽은 속성이 있으면
  //   "속성 전부를 확인했다"고 말할 수 없다. 조용히 빠뜨리면 정작 고장 신호(대기 중 섹터 등)를
  //   놓치고도 "이상 없음"이라고 하게 된다. 이 값은 진단 근거에 그대로 실린다.
  const unparsed = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;                    // 표는 빈 줄에서 끝난다
    // 예: "197 Current_Pending_Sector  0x0012   100   100   000    Old_age   Always       -       8"
    //
    // VALUE/WORST/THRESH가 항상 숫자인 것은 아니다. 일부 장치·smartmontools 버전은
    // 임계값이 없을 때 "---"를 찍는다. 숫자만 받으면 그 줄이 통째로 버려지므로
    // 숫자 아닌 값도 받아들이고 값만 null로 둔다.
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/);
    if (!m) {
      unparsed.push(line.trim());
      continue;
    }
    const num = (v) => (/^\d+$/.test(v) ? Number(v) : null);
    const id = Number(m[1]);
    const row = {
      id, name: m[2], value: num(m[4]), worst: num(m[5]), threshold: num(m[6]),
      type: m[7], whenFailed: m[9], raw: m[10].trim(),
    };
    rows.push(row);
    const key = ATA_ATTR_IDS[id];
    // RAW_VALUE는 "36523" 또는 "30 (Min/Max 24/45)" 같은 형태 → 앞의 숫자만 쓴다.
    if (key) attrs[key] = smartNum(row.raw);
  }
  if (!rows.length) return null;
  attrs.unparsedRowCount = unparsed.length;
  attrs.unparsedRows = unparsed.slice(0, 3); // 진단이 아니라 원인 파악용이라 몇 줄만 남긴다

  attrs.rows = rows;
  // prefail 속성이 임계값 이하로 떨어졌는지 = 제조사 기준 "고장 임박" 신호
  attrs.failingNow = rows.filter((r) => r.whenFailed && r.whenFailed !== '-' && r.whenFailed !== '')
    .map((r) => ({ id: r.id, name: r.name, whenFailed: r.whenFailed }));
  // NVMe 전용 항목은 ATA에 없다
  attrs.availableSparePercent = null; attrs.availableSpareThreshold = null;
  attrs.mediaErrors = null; attrs.unsafeShutdowns = null; attrs.errorLogEntries = null;
  attrs.criticalWarning = null; attrs.criticalWarningValue = null;
  // SSD 수명: 제조사마다 다른 지표를 쓴다. 231/233은 "남은 수명 %"인 경우가 많아 100에서 뺀다.
  const lifeLeft = attrs.sslLifeLeft ?? attrs.mediaWearoutIndicator ?? null;
  attrs.wearPercentUsed = lifeLeft !== null && lifeLeft >= 0 && lifeLeft <= 100 ? 100 - lifeLeft : null;
  return attrs;
}

function parseSmartAttributes(out) {
  return parseNvmeSmart(out) || parseAtaSmart(out);
}

// smartctl --scan 출력(예: "/dev/sda -d nvme # /dev/sda, NVMe device")을 파싱한다.
// Windows에서 diskLayout이 주는 \\.\PhysicalDriveN 경로로는 이 시스템의 NVMe 컨트롤러를
// smartctl이 열지 못하는 경우가 실측으로 확인됐다(-d nvme를 붙여도 "Invalid argument").
// 반면 smartctl 자신이 --scan으로 보고하는 이름(/dev/sda 등)과 타입을 그대로 쓰면
// 정상적으로 SMART 값을 읽어온다. 그래서 diskLayout이 아니라 --scan 결과를 SMART 조회의
// 기준으로 삼는다.
function parseSmartctlScan(out) {
  if (!out) return [];
  return out.split('\n')
    .map((line) => line.match(/^(\S+)\s+-d\s+(\S+)/))
    .filter(Boolean)
    .map((m) => ({ name: m[1], type: m[2] }));
}

// SMART 조회가 실패(healthy: null)한 특정 장치에 대해서만 관리자 권한으로 재시도한다.
async function retrySmartElevated(device, type) {
  if (os.platform() !== 'win32') return { device, healthy: null, status: 'unknown' };
  const smartctlPath = resolveSmartctlPath();
  const out = await runElevatedSmartHealth(smartctlPath, device, type);
  return { device, ...parseSmartHealthOutput(out) };
}

// ---------- CPU 온도 ----------
// ⚠ 실측으로 확인한 사실 (개발 데스크톱 + 사용자 노트북, 2대 모두 동일):
//   `si.cpuTemperature()`가 null을 돌려주는 이유는 **센서가 없어서가 아니라 권한 때문**이다.
//   systeminformation이 쓰는 WMI 클래스 `MSAcpi_ThermalZoneTemperature`는
//   **관리자 권한을 요구한다.** 비관리자로 조회하면 "액세스가 거부되었습니다"가 뜬다.
//   (클래스 자체는 존재한다 — Get-CimClass로 확인)
//   관리자 PowerShell에서는 같은 쿼리가 온도 값을 정상 반환하는 것을 확인했다.
//
//   그래서 "센서 없음"과 "권한 없음"을 반드시 구분한다. 사용자가 취할 행동이 다르다 —
//   전자는 어쩔 수 없고, 후자는 관리자 권한으로 다시 재면 된다.

const TEMP_REASON = {
  OK: 'ok',
  PERMISSION: 'permission',     // 관리자 권한이 없어 거부됨 → 승격하면 읽을 수 있다
  NOT_SUPPORTED: 'not-supported', // 권한이 있어도 값이 없다(보드가 ACPI로 노출하지 않음)
  UNKNOWN: 'unknown',
};

// ACPI 열 영역 온도를 읽는 PowerShell 스크립트. 승격 여부와 무관하게 같은 쿼리를 쓴다.
// CurrentTemperature는 10분의 1 켈빈 단위다.
const THERMAL_QUERY =
  '$z = Get-CimInstance -Namespace root\\wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop; '
  + '$r = @($z | ForEach-Object { [PSCustomObject]@{ zone = $_.InstanceName; c = [math]::Round(($_.CurrentTemperature/10)-273.15,1) } }); '
  + 'ConvertTo-Json -InputObject @{ zones = $r } -Compress';

function parseThermalZones(out) {
  if (!out) return null;
  try {
    // ⚠ Windows PowerShell의 `Out-File -Encoding utf8`은 **BOM을 붙인다.**
    //   BOM이 남아 있으면 JSON.parse가 그대로 던진다. 승격 경로가 이 때문에 조용히
    //   실패하지 않도록 앞에서 걷어낸다.
    const parsed = JSON.parse(out.replace(/^﻿/, '').trim());
    const zones = (Array.isArray(parsed.zones) ? parsed.zones : (parsed.zones ? [parsed.zones] : []))
      .map((z) => ({ zone: str(z.zone), tempC: Number(z.c) }))
      .filter((z) => Number.isFinite(z.tempC) && z.tempC > 0 && z.tempC < 150);
    if (!zones.length) return null;
    // 여러 열 영역이 잡히면 가장 높은 값을 쓴다. 어느 영역인지도 함께 남겨서
    // "CPU 패키지 온도"라고 단정하지 않는다(ACPI 열 영역은 칩셋일 수도 있다).
    const hottest = zones.reduce((a, b) => (b.tempC > a.tempC ? b : a));
    return { tempC: hottest.tempC, zone: hottest.zone, zones, source: 'acpi-thermal-zone' };
  } catch {
    return null;
  }
}

// 온도를 못 읽는 사유는 프로세스가 사는 동안 바뀌지 않는다(권한은 실행 시점에 정해진다).
// 실시간 샘플링은 1초마다 돌므로 매번 PowerShell을 띄우면 안 된다 → 한 번만 확인하고 캐시한다.
// 승격해서 다시 실행하면 새 프로세스라 캐시도 새로 잡힌다.
let cachedTempReason = null;
async function cpuTempReason() {
  if (cachedTempReason) return cachedTempReason;
  cachedTempReason = (await probeCpuTemperature()).reason;
  return cachedTempReason;
}

// 비승격 상태에서 시도해보고, 실패했다면 그 이유를 분류한다.
async function probeCpuTemperature() {
  if (process.platform !== 'win32') return { tempC: null, reason: TEMP_REASON.NOT_SUPPORTED, zones: [] };
  const { out, err } = await new Promise((resolve) => {
    exec(
      `powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${THERMAL_QUERY}"`,
      { timeout: 8000, windowsHide: true },
      (e, stdout, stderr) => resolve({ out: stdout ? stdout.toString() : null, err: stderr ? stderr.toString() : '' })
    );
  });

  const parsed = parseThermalZones(out);
  if (parsed) return { ...parsed, reason: TEMP_REASON.OK };

  // "액세스가 거부되었습니다" / "Access is denied" — 언어에 의존하지 않도록 두 가지를 다 본다.
  // (한국어 Windows에서 실제로 확인한 문구)
  if (/액세스가 거부|Access is denied|UnauthorizedAccess|0x80070005/i.test(err)) {
    return { tempC: null, reason: TEMP_REASON.PERMISSION, zones: [] };
  }
  if (err && err.trim()) return { tempC: null, reason: TEMP_REASON.UNKNOWN, zones: [], error: err.trim().slice(0, 200) };
  return { tempC: null, reason: TEMP_REASON.NOT_SUPPORTED, zones: [] };
}

// 관리자 권한으로 승격해서 온도를 읽는다(UAC 승인 필요).
// SMART 재검사와 같은 방식 — cmd.exe를 승격 실행하고 출력을 임시 파일로 받는다.
function collectCpuTemperatureElevated(timeoutMs = 60000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ tempC: null, reason: TEMP_REASON.NOT_SUPPORTED, zones: [] });
    const tmpOut = path.join(os.tmpdir(), `diagbench-temp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    // 승격된 powershell이 쿼리 결과를 파일로 쓴다. cmd 리다이렉션 이스케이프를 피하려고
    // Out-File을 쓴다(SMART 쪽 주석 참고 — 여러 겹 이스케이프는 깨지기 쉽다).
    const inner = `${THERMAL_QUERY} | Out-File -FilePath ${q(tmpOut)} -Encoding utf8`;
    const encodedInner = Buffer.from(inner, 'utf16le').toString('base64');
    const psScript = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-EncodedCommand',${psSingleQuote(encodedInner)} -Verb RunAs -WindowStyle Hidden -Wait`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: timeoutMs, windowsHide: true },
      () => {
        let out = null;
        try { out = fs.readFileSync(tmpOut, 'utf-8'); } catch { out = null; }
        try { fs.unlinkSync(tmpOut); } catch {}
        const parsed = parseThermalZones(out);
        // UAC를 취소하면 파일이 생기지 않는다 → 거부된 것으로 본다(값을 지어내지 않는다).
        resolve(parsed ? { ...parsed, reason: TEMP_REASON.OK, elevated: true }
          : { tempC: null, reason: out === null ? TEMP_REASON.PERMISSION : TEMP_REASON.NOT_SUPPORTED, zones: [], elevated: true });
      }
    );
  });
}

// ---------- CPU ----------
async function collectCpu() {
  const [load, temp, speed, staticInfo] = await Promise.all([
    si.currentLoad(),
    si.cpuTemperature(),
    si.cpuCurrentSpeed(),
    si.cpu(),
  ]);
  // systeminformation이 온도를 못 읽었으면 **왜 못 읽었는지**를 따로 확인한다.
  // "센서 없음"과 "권한 없음"은 사용자가 취할 행동이 완전히 다르다(위 주석 참고).
  let tempC = temp.main ?? null;
  let tempReason = tempC !== null ? TEMP_REASON.OK : TEMP_REASON.UNKNOWN;
  let tempSource = tempC !== null ? 'systeminformation' : null;
  let tempZone = null;
  if (tempC === null) {
    const probe = await probeCpuTemperature();
    tempReason = probe.reason;
    if (probe.tempC !== null) {
      tempC = probe.tempC;
      tempSource = probe.source;
      tempZone = probe.zone;
    }
  }

  return {
    model: `${staticInfo.manufacturer} ${staticInfo.brand}`.trim(),
    cores: staticInfo.cores,
    physicalCores: staticInfo.physicalCores,
    loadPercent: round(load.currentLoad),
    perCoreLoad: load.cpus ? load.cpus.map((c) => round(c.load)) : [],
    tempC,
    // 온도를 못 읽었을 때의 사유. 'permission'이면 관리자 권한으로 다시 잴 수 있다.
    tempReason,
    tempSource,
    tempZone,
    clockGHz: speed.avg ?? null,
    clockMaxGHz: staticInfo.speedMax ?? null,
  };
}

// ---------- MEMORY ----------
async function collectMemory() {
  const m = await si.mem();
  return {
    totalGB: round(m.total / 1e9, 1),
    usedGB: round((m.total - m.available) / 1e9, 1),
    availableGB: round(m.available / 1e9, 1),
    usedPercent: round(((m.total - m.available) / m.total) * 100),
    swapUsedGB: round(m.swapused / 1e9, 1),
    swapTotalGB: round(m.swaptotal / 1e9, 1),
  };
}

// ---------- MEMORY: 모듈(DIMM) 단위 구성 ----------
// si.mem()은 총 용량/사용량만 준다. "이 PC에 어떤 메모리가 어떻게 꽂혀 있는가"는
// Win32_PhysicalMemory로만 알 수 있고, 이게 혼합 DIMM·정격 미달 동작 진단의 근거가 된다.
//
// 이 PC에서 실측으로 확인한 것(관리자 권한 불필요):
//   읽힘   : Manufacturer, PartNumber, Capacity, Speed(정격), ConfiguredClockSpeed(현재),
//            ConfiguredVoltage, DeviceLocator(슬롯), SMBIOSMemoryType, SerialNumber
//   안 읽힘: **타이밍(CL/tRCD/tRP)** — WMI에 속성 자체가 없다. SPD를 SMBus로 직접 읽어야
//            하는데 그건 커널 드라이버가 필요하다. 그러니 타이밍은 "확인 안 됨"으로 남긴다.
//   비어옴 : MinVoltage/MaxVoltage가 0으로 오는 보드가 있다(이 PC가 그렇다) → 0은 값이 아니라
//            "보드가 안 채웠다"는 뜻이므로 null로 바꾼다. 0V를 실제 전압으로 보여주면 오정보다.
//
// XMP/EXPO 프로파일 목록 자체도 SPD를 읽어야 알 수 있어서 조회할 수 없다. 대신
// Speed(모듈이 보고한 정격)와 ConfiguredClockSpeed(지금 도는 속도)의 차이는 실제로 읽히므로,
// **"프로파일이 있다"고 말하지 않고 "정격보다 낮게/높게 돌고 있다"는 측정 사실만** 말한다.

// SMBIOS 규격의 메모리 타입 코드. 모르는 값은 지어내지 않고 null로 둔다.
const SMBIOS_MEMORY_TYPES = { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5' };

async function collectMemoryModules() {
  const unsupported = {
    supported: false, modules: [], totalSlots: null, usedSlots: null,
    maxCapacityGB: null, timingsAvailable: false, error: null,
  };
  if (process.platform !== 'win32') return { ...unsupported, error: 'Windows에서만 조회할 수 있습니다.' };

  const out = await run(
    'powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_PhysicalMemory | Select-Object BankLabel,DeviceLocator,Manufacturer,PartNumber,Capacity,Speed,ConfiguredClockSpeed,ConfiguredVoltage,SMBIOSMemoryType,FormFactor,SerialNumber | ConvertTo-Json -Compress"',
    8000
  );
  if (!out) return { ...unsupported, error: '메모리 모듈 정보를 조회하지 못했습니다.' };

  let raw;
  try {
    const parsed = JSON.parse(out);
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return { ...unsupported, error: '메모리 모듈 정보를 해석하지 못했습니다.' };
  }
  if (!raw.length) return { ...unsupported, error: '메모리 모듈이 조회되지 않았습니다.' };

  // 슬롯 총개수는 별도 클래스에 있다. 실패해도 모듈 정보는 살린다(부분 성공 허용).
  let totalSlots = null;
  let maxCapacityGB = null;
  const arrOut = await run(
    'powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_PhysicalMemoryArray | Select-Object MemoryDevices,MaxCapacityEx | ConvertTo-Json -Compress"',
    6000
  );
  if (arrOut) {
    try {
      const a = JSON.parse(arrOut);
      const first = Array.isArray(a) ? a[0] : a;
      if (first) {
        totalSlots = Number(first.MemoryDevices) || null;
        // MaxCapacityEx 단위는 KB다.
        maxCapacityGB = first.MaxCapacityEx ? round(Number(first.MaxCapacityEx) / 1024 / 1024, 0) : null;
      }
    } catch { /* 슬롯 수는 없어도 된다 */ }
  }

  const modules = raw.map((m, i) => {
    const cap = Number(m.Capacity);
    const rated = Number(m.Speed) || null;
    const configured = Number(m.ConfiguredClockSpeed) || null; // 0으로 오면 "확인 안 됨"
    const volt = Number(m.ConfiguredVoltage) || null;          // 0으로 오면 "확인 안 됨"
    return {
      slot: str(m.DeviceLocator) || str(m.BankLabel) || `DIMM ${i + 1}`,
      bank: str(m.BankLabel),
      manufacturer: str(m.Manufacturer),
      partNumber: str(m.PartNumber),
      capacityGB: Number.isFinite(cap) && cap > 0 ? round(cap / 1024 / 1024 / 1024, 0) : null,
      ratedSpeedMTs: rated,
      configuredSpeedMTs: configured,
      voltageV: volt ? round(volt / 1000, 3) : null,
      type: SMBIOS_MEMORY_TYPES[Number(m.SMBIOSMemoryType)] || null,
      serial: str(m.SerialNumber),
    };
  });

  return {
    supported: true,
    modules,
    totalSlots,
    usedSlots: modules.length,
    maxCapacityGB,
    // 타이밍은 이 경로로는 절대 못 읽는다. "검사 안 함"임을 데이터에 남겨서
    // 리포트가 "타이밍 정상"이라고 말하는 일이 생기지 않게 한다.
    timingsAvailable: false,
    error: null,
  };
}

// PowerShell이 돌려주는 문자열은 뒤에 공백이 붙어 오는 경우가 많다(PartNumber가 특히 그렇다).
function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

// ---------- GPU ----------
// systeminformation의 si.graphics()는 정적 정보(모델/VRAM 용량) 위주라
// 실시간 로드/온도/클럭은 NVIDIA의 경우 nvidia-smi로 보완한다.
async function collectGpu() {
  const graphics = await si.graphics();
  const controllers = (graphics.controllers || []).map((c) => ({
    vendor: c.vendor,
    model: c.model,
    vramMB: c.vram,
    driverVersion: c.driverVersion || null,
  }));

  let nvidia = null;
  const nvOut = await run(
    'nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,clocks.sm,clocks.max.sm,memory.used,memory.total,power.draw --format=csv,noheader,nounits'
  );
  if (nvOut) {
    const line = nvOut.trim().split('\n')[0];
    const parts = line.split(',').map((s) => parseFloat(s.trim()));
    if (parts.length >= 7 && !parts.some(Number.isNaN)) {
      nvidia = {
        loadPercent: parts[0],
        tempC: parts[1],
        clockMHz: parts[2],
        clockMaxMHz: parts[3],
        vramUsedMB: parts[4],
        vramTotalMB: parts[5],
        powerDrawW: parts[6],
      };
    }
  }

  return { controllers, nvidia, supported: !!nvidia };
}

// ---------- LIVE MONITORING ----------
// collectCpu/collectGpu는 진단용이라 정적 정보(모델명, VRAM 용량 등)까지 매번 다시 읽는다.
// 실시간 모니터링 화면은 1초 간격으로 계속 호출되므로, 자주 바뀌는 값만 가볍게 읽는
// 전용 샘플러를 따로 둔다.
async function collectLiveSample() {
  const [load, temp, speed, mem] = await Promise.all([
    si.currentLoad(),
    si.cpuTemperature(),
    si.cpuCurrentSpeed(),
    si.mem(),
  ]);

  let gpu = null;
  const nvOut = await run(
    'nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,clocks.sm,memory.used,memory.total --format=csv,noheader,nounits',
    2000
  );
  if (nvOut) {
    const parts = nvOut.trim().split('\n')[0].split(',').map((s) => parseFloat(s.trim()));
    if (parts.length >= 5 && !parts.some(Number.isNaN)) {
      gpu = { loadPercent: parts[0], tempC: parts[1], clockMHz: parts[2], vramUsedMB: parts[3], vramTotalMB: parts[4] };
    }
  }

  // 온도를 못 읽었으면 사유도 함께 싣는다. 기준선이 이 값을 쓰기 때문에,
  // "센서가 없다"와 "권한이 없다"를 여기서도 구분해야 안내가 정확해진다.
  const cpuTempC = temp.main ?? null;
  return {
    t: Date.now(),
    cpu: {
      loadPercent: round(load.currentLoad),
      tempC: cpuTempC,
      tempReason: cpuTempC !== null ? TEMP_REASON.OK : await cpuTempReason(),
      clockGHz: speed.avg ?? null,
    },
    gpu,
    ram: { usedPercent: round(((mem.total - mem.available) / mem.total) * 100) },
  };
}

// ---------- 배터리 (노트북) ----------
// 중고 노트북 거래에서 가장 먼저 묻는 것이 배터리 상태다. 핵심 지표는
// **설계 용량 대비 현재 완충 용량**(건강도)과 **사이클 수**다.
//
// 실측으로 확인한 경로(LG 노트북, Windows 10 한국어):
//
//   ❌ Win32_Battery.DesignCapacity / FullChargeCapacity → **둘 다 비어 있다**
//      많은 노트북에서 이 값을 채우지 않는다. 여기에 의존하면 배터리 항목이 통째로 빈다.
//   ❌ root\wmi BatteryStaticData → 클래스는 존재하지만 **인스턴스 조회 결과가 없다**
//      (DesignedCapacity·CycleCount를 여기서 읽으려던 시도는 실패)
//   ✅ root\wmi BatteryFullChargedCapacity → 65410 (mWh)
//   ✅ root\wmi BatteryCycleCount → 173
//   ✅ powercfg /batteryreport → DESIGN CAPACITY 80,000 mWh / FULL CHARGE 65,410 / CYCLE 173
//
// 즉 **설계 용량은 powercfg 리포트에서만 나온다.** 그래서 그쪽을 주 경로로 쓰고,
// WMI 값은 교차 검증에 쓴다(위 사례에서 완충 용량·사이클 수가 정확히 일치했다).
// 라벨은 한국어 Windows에서도 영어로 나왔지만, 다른 환경을 위해 한글 라벨도 함께 찾는다.

// powercfg 배터리 리포트 HTML에서 용량·사이클을 뽑는다.
// 실제 장비 없이 테스트할 수 있도록 파서를 따로 내보낸다(SMART·ping 파서와 같은 이유).
function parseBatteryReport(html) {
  if (!html) return { designCapacityMWh: null, fullChargeCapacityMWh: null, cycleCount: null };

  // 구조: <span class="label">DESIGN CAPACITY</span></td><td>80,000 mWh</td>
  const pick = (patterns) => {
    for (const p of patterns) {
      const m = html.match(new RegExp(`<span class="label">\\s*${p}\\s*</span>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)</td>`, 'i'));
      if (m) {
        const n = Number(String(m[1]).replace(/<[^>]+>/g, '').replace(/[,\s]/g, '').replace(/mwh$/i, ''));
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };

  return {
    designCapacityMWh: pick(['DESIGN CAPACITY', '설계\\s*용량']),
    fullChargeCapacityMWh: pick(['FULL CHARGE CAPACITY', '전체\\s*충전\\s*용량', '완전\\s*충전\\s*용량']),
    cycleCount: pick(['CYCLE COUNT', '주기\\s*수', '사이클\\s*수']),
  };
}

// Win32_Battery.BatteryStatus 코드 → 사람이 읽는 상태.
// 1=방전 중, 2=AC 연결(충전 중은 아님), 3=완충, 4=낮음, 5=위험, 6=충전 중 …
const BATTERY_STATUS = {
  1: '배터리로 동작 중', 2: '전원 연결됨', 3: '완전 충전됨', 4: '잔량 부족',
  5: '잔량 매우 부족', 6: '충전 중', 7: '충전 중(잔량 부족)', 8: '충전 중(잔량 매우 부족)',
  9: '충전 중(완충 근접)', 10: '상태 확인 불가', 11: '부분 충전됨',
};
// Win32_Battery.Chemistry 코드
const BATTERY_CHEMISTRY = {
  1: '기타', 2: '알 수 없음', 3: '납축', 4: '니켈카드뮴', 5: '니켈수소',
  6: '리튬이온', 7: '아연공기', 8: '리튬폴리머',
};

async function collectBattery() {
  const empty = {
    present: false, isLaptop: false, name: null, chemistry: null, statusText: null,
    chargePercent: null, designCapacityMWh: null, fullChargeCapacityMWh: null,
    cycleCount: null, healthPercent: null, sources: {}, error: null,
  };
  if (process.platform !== 'win32') return { ...empty, error: 'Windows에서만 조회할 수 있습니다.' };

  // 배터리 기본 정보 + WMI 용량/사이클을 한 번에 읽는다.
  const out = await run(
    'powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
    + '$b = Get-CimInstance Win32_Battery | Select-Object -First 1; '
    + '$f = Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity -EA SilentlyContinue | Select-Object -First 1; '
    + '$c = Get-CimInstance -Namespace root\\wmi -ClassName BatteryCycleCount -EA SilentlyContinue | Select-Object -First 1; '
    + '$s = Get-CimInstance Win32_ComputerSystem; '
    + '[PSCustomObject]@{ name=$b.Name; status=$b.BatteryStatus; charge=$b.EstimatedChargeRemaining; '
    + 'chem=$b.Chemistry; designV=$b.DesignVoltage; wmiDesign=$b.DesignCapacity; wmiFull=$b.FullChargeCapacity; '
    + 'fullCap=$f.FullChargedCapacity; cycles=$c.CycleCount; sysType=$s.PCSystemType } | ConvertTo-Json -Compress"',
    9000
  );

  // 조회 자체가 실패한 것과 "배터리가 없는 기기"는 다르다. 구분해서 남긴다 —
  // 데스크톱에 "배터리 검사 못 함"이라고 하면 틀린 말이고, 노트북에서 조회가 실패한 것을
  // "배터리 없음"으로 넘기면 진짜 문제를 숨기게 된다.
  if (!out) return { ...empty, queryFailed: true, error: '배터리 정보를 조회하지 못했습니다.' };

  let info = null;
  try { info = JSON.parse(out); } catch { info = null; }
  if (!info) return { ...empty, queryFailed: true, error: '배터리 정보를 해석하지 못했습니다.' };
  // PCSystemType 2 = Mobile(노트북). 데스크톱이면 배터리가 없는 게 정상이다.
  const isLaptop = Number(info.sysType) === 2;
  if (!info.name) return { ...empty, isLaptop, error: isLaptop ? '배터리를 찾지 못했습니다(분리형이거나 인식되지 않음).' : null };

  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // 설계 용량은 powercfg 리포트에서만 나온다(위 주석 참고). 리포트를 임시 폴더에 만들고 지운다.
  const reportPath = path.join(os.tmpdir(), `diagbench-battery-${Date.now()}.html`);
  let report = { designCapacityMWh: null, fullChargeCapacityMWh: null, cycleCount: null };
  await run(`powercfg /batteryreport /output "${reportPath}"`, 12000);
  try {
    if (fs.existsSync(reportPath)) {
      report = parseBatteryReport(fs.readFileSync(reportPath, 'utf-8'));
      fs.unlinkSync(reportPath);
    }
  } catch { /* 리포트를 못 읽어도 WMI 값은 살린다 */ }

  const design = report.designCapacityMWh ?? num(info.wmiDesign);
  const full = num(info.fullCap) ?? report.fullChargeCapacityMWh ?? num(info.wmiFull);
  const cycles = num(info.cycles) ?? report.cycleCount;

  // 건강도는 **두 값이 모두 있을 때만** 계산한다. 하나라도 없으면 null —
  // 완충 용량만 있다고 "건강도 몇 %"라고 말할 수 없다.
  const healthPercent = design && full ? round((full / design) * 100, 1) : null;

  return {
    present: true,
    isLaptop,
    name: str(info.name),
    chemistry: BATTERY_CHEMISTRY[Number(info.chem)] || null,
    statusText: BATTERY_STATUS[Number(info.status)] || null,
    statusCode: Number(info.status) || null,
    chargePercent: num(info.charge),
    designVoltageV: info.designV ? round(Number(info.designV) / 1000, 3) : null,
    designCapacityMWh: design,
    fullChargeCapacityMWh: full,
    cycleCount: cycles,
    healthPercent,
    // 어느 경로에서 읽었는지 남긴다 — 값이 이상할 때 원인을 찾을 수 있어야 한다.
    sources: {
      designCapacity: report.designCapacityMWh ? 'powercfg' : (num(info.wmiDesign) ? 'wmi' : null),
      fullCharge: num(info.fullCap) ? 'wmi' : (report.fullChargeCapacityMWh ? 'powercfg' : null),
      cycleCount: num(info.cycles) ? 'wmi' : (report.cycleCount ? 'powercfg' : null),
    },
    error: null,
  };
}

// ---------- 설정 변경(오버클럭/언더볼팅) 상태 ----------
// "이 PC가 정품 설정 그대로인가, 누가 손댔는가"를 본다. 중고 거래에서 특히 중요한 정보다.
//
// 실측으로 확인한 것(이 PC: Xeon E3-1230 v5 / GTX 1060 3GB):
//
//   ✅ 쓸 수 있는 신호
//     - CPU 모델명에 정품 기본 클럭이 박혀 있다: "... CPU E3-1230 v5 @ 3.40GHz"
//       ↔ Win32_Processor.MaxClockSpeed = 3401. 둘 다 같은 시스템에서 나오므로 외부
//       하드웨어 DB 없이 자기들끼리 비교할 수 있다. BCLK를 올리면 MaxClockSpeed가 따라 오른다.
//     - Win32_Processor.ExtClock = 100 (BCLK). 기본값에서 벗어나면 참고 근거가 된다.
//     - nvidia-smi의 power.limit vs power.default_limit. 이 PC는 120W = 120W(정품).
//       다르면 전력 제한이 손대진 것이고, 이건 오해의 여지가 거의 없는 확실한 신호다.
//
//   ❌ 쓸 수 없는 것 — 지어내면 안 되는 값들
//     - Win32_Processor.CurrentVoltage: 이 PC에서 12로 오는데 **전압이 아니다.**
//       SMBIOS 규격상 8번째 비트(0x80)가 켜져 있을 때만 하위 7비트가 (전압 × 10)이다.
//       여기선 꺼져 있고 VoltageCaps도 비어 있어 전압을 알 수 없다. 12를 1.2V로 읽으면 오정보다.
//     - nvidia-smi의 clocks.applications.graphics: 지포스는 [N/A]다(Tesla/Quadro 전용 기능).
//     - clocks.max.sm(이 PC 1923MHz)만으로는 오버클럭을 판정할 수 없다. 공장 OC 모델은
//       원래부터 레퍼런스보다 높다. 레퍼런스 값 DB가 없으면 비교 자체가 불가능하므로
//       **참고 수치로만 남기고 판정에 쓰지 않는다.**
async function collectOverclockState() {
  const cpu = {
    model: null, stockBaseGHz: null, maxClockGHz: null, bclkMHz: null,
    voltageV: null, voltageReadable: false, readable: false,
  };
  const gpu = {
    supported: false, powerLimitW: null, defaultPowerLimitW: null,
    minPowerLimitW: null, maxPowerLimitW: null, enforcedPowerLimitW: null,
    maxClockMHz: null, maxMemClockMHz: null,
  };

  if (process.platform === 'win32') {
    const out = await run(
      'powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-CimInstance Win32_Processor | Select-Object Name,MaxClockSpeed,ExtClock,CurrentVoltage,VoltageCaps | ConvertTo-Json -Compress"',
      8000
    );
    if (out) {
      try {
        const parsed = JSON.parse(out);
        const p = Array.isArray(parsed) ? parsed[0] : parsed;
        if (p) {
          cpu.readable = true;
          cpu.model = str(p.Name);
          cpu.maxClockGHz = p.MaxClockSpeed ? round(Number(p.MaxClockSpeed) / 1000, 2) : null;
          cpu.bclkMHz = Number(p.ExtClock) || null;
          // 모델명에 박힌 정품 기본 클럭. 없는 CPU도 많다(특히 AMD) — 그러면 비교하지 않는다.
          const m = /@\s*([\d.]+)\s*GHz/i.exec(cpu.model || '');
          cpu.stockBaseGHz = m ? Number(m[1]) : null;
          // 위 주석 참고: 8번째 비트가 켜져 있을 때만 실제 전압이다.
          const raw = Number(p.CurrentVoltage);
          if (Number.isFinite(raw) && (raw & 0x80)) {
            cpu.voltageV = round((raw & 0x7f) / 10, 2);
            cpu.voltageReadable = true;
          }
        }
      } catch { /* 못 읽으면 readable=false로 남는다 */ }
    }
  }

  const nvOut = await run(
    'nvidia-smi --query-gpu=power.limit,power.default_limit,power.min_limit,power.max_limit,enforced.power.limit,clocks.max.sm,clocks.max.mem --format=csv,noheader,nounits',
    6000
  );
  if (nvOut) {
    const parts = nvOut.trim().split('\n')[0].split(',').map((s) => s.trim());
    const num = (v) => {
      if (v === undefined || /^\[?N\/A\]?$/i.test(v)) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    if (parts.length >= 7) {
      gpu.supported = true;
      gpu.powerLimitW = num(parts[0]);
      gpu.defaultPowerLimitW = num(parts[1]);
      gpu.minPowerLimitW = num(parts[2]);
      gpu.maxPowerLimitW = num(parts[3]);
      gpu.enforcedPowerLimitW = num(parts[4]);
      gpu.maxClockMHz = num(parts[5]);
      gpu.maxMemClockMHz = num(parts[6]);
    }
  }

  return { cpu, gpu };
}

// ---------- 기준선 비교용 사전 스냅샷 ----------
// 기준선(평소 상태) 비교는 "지금이 유휴인가"에 전적으로 의존한다. 그런데 진단 본작업이
// 시작되면 **이 앱 자신이** PowerShell·nvidia-smi·SMART 조회를 돌리느라 CPU를 크게 쓴다.
// 실측: 4코어 Xeon E3-1230 v5에서 진단 중 CPU 부하 36% — 유휴 판정 기준(20%)을 훌쩍 넘는다.
// 그 값으로 판단하면 진단할 때마다 "지금은 부하 중이라 비교 못 함"이 되어 기능이 사실상
// 동작하지 않는다.
//
// 그래서 본작업을 시작하기 **전에** 조용한 상태를 한 번 뜬다. si.currentLoad()는 이전 호출
// 이후의 차분이라 첫 호출은 부팅 이후 평균이 섞여 나오므로, 기준점을 한 번 잡아 버리고
// 짧은 간격 뒤의 값을 쓴다.
async function collectIdleSnapshot(gapMs = 700) {
  await si.currentLoad();   // 기준점만 잡고 값은 버린다
  await new Promise((r) => setTimeout(r, gapMs));
  return collectLiveSample();
}

// GPU 트렌드 감지를 위해 짧은 간격으로 N번 샘플링 (스로틀링 판정에 사용)
async function sampleGpuTrend(samples = 4, intervalMs = 800) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    const g = await collectGpu();
    if (g.nvidia) out.push({ t: Date.now(), ...g.nvidia });
    if (i < samples - 1) await sleep(intervalMs);
  }
  return out;
}

// ---------- STORAGE ----------
async function collectStorage() {
  const [fsSize, diskLayout, disksIO] = await Promise.all([
    si.fsSize(),
    si.diskLayout(),
    si.disksIO().catch(() => null),
  ]);

  const volumes = fsSize.map((v) => ({
    mount: v.mount,
    fs: v.fs,
    sizeGB: round(v.size / 1e9, 1),
    usedGB: round(v.used / 1e9, 1),
    usePercent: round(v.use),
  }));

  const disks = diskLayout.map((d) => ({
    device: d.device,
    type: d.type, // SSD / HDD 등 (플랫폼에 따라 비어있을 수 있음)
    name: d.name,
    sizeGB: round(d.size / 1e9, 1),
    interfaceType: d.interfaceType,
  }));

  // SMART: smartctl 자체가 없는 것("미지원")과, smartctl은 있지만 결과가 비정상인 것("이상")을
  // 명확히 구분한다. 이 구분이 없으면 "SMART를 못 읽었을 뿐"인데 사용자가 안심하거나,
  // 반대로 불안해하는 잘못된 신호를 줄 수 있다.
  const smartctlPath = resolveSmartctlPath();
  const smartctlVersionOut = await runFile(smartctlPath, ['--version'], 3000);
  const smartctlAvailable = !!smartctlVersionOut;

  // -H(전체 판정) + -i(모델/시리얼) + -A(속성)를 한 번에 읽는다. 호출을 나누면 그만큼
  // 느려지고, 장치를 여러 번 여는 동안 상태가 달라질 수도 있다.
  const smart = [];
  if (smartctlAvailable) {
    const scanOut = await runFile(smartctlPath, ['--scan'], 5000);
    const scannedDevices = parseSmartctlScan(scanOut);
    const readOne = async (name, args) => {
      const { out, code } = await runSmartctl(smartctlPath, args, 8000);
      return {
        device: name,
        ...parseSmartHealthOutput(out),
        identity: parseSmartIdentity(out),
        attributes: parseSmartAttributes(out),
        exitCode: code,
      };
    };
    if (scannedDevices.length) {
      for (const dev of scannedDevices) {
        const entry = await readOne(dev.name, ['-d', dev.type, '-H', '-i', '-A', dev.name]);
        smart.push({ ...entry, type: dev.type });
      }
    } else {
      // --scan이 아무것도 못 찾았을 때의 최후 폴백: diskLayout 경로로 직접 시도.
      // (--scan 자체가 실패하는 드문 경우에도 완전히 포기하지 않기 위함)
      for (const d of diskLayout) {
        if (!d.device) continue;
        let entry = await readOne(d.device, ['-H', '-i', '-A', d.device]);
        if (entry.healthy === null && !entry.attributes) {
          entry = await readOne(d.device, ['-d', 'nvme', '-H', '-i', '-A', d.device]);
        }
        smart.push(entry);
      }
    }
  }

  return { volumes, disks, smart, smartctlAvailable, io: disksIO };
}

// ---------- NETWORK ----------
async function collectNetwork() {
  const [ifaces, stats, defaultIface] = await Promise.all([
    si.networkInterfaces(),
    si.networkStats().catch(() => []),
    si.networkInterfaceDefault().catch(() => null),
  ]);

  const ping = await pingTest('1.1.1.1', 5);

  return {
    defaultInterface: defaultIface,
    interfaces: (Array.isArray(ifaces) ? ifaces : [])
      .filter((i) => !i.internal)
      .map((i) => ({
        iface: i.iface,
        type: i.type,
        speedMbps: i.speed,
        operstate: i.operstate,
      })),
    stats: (stats || []).map((s) => ({
      iface: s.iface,
      rxSec: s.rx_sec,
      txSec: s.tx_sec,
    })),
    ping,
  };
}

// 플랫폼별 ping 명령 결과를 파싱해 avg/jitter/loss 산출
async function pingTest(host, count) {
  const isWin = os.platform() === 'win32';
  const cmd = isWin ? `ping -n ${count} ${host}` : `ping -c ${count} ${host}`;
  const out = await run(cmd, 8000);
  return parsePingOutput(out);
}

// ping 출력 파서. 실제 네트워크 없이 테스트할 수 있도록 따로 분리해서 내보낸다
// (SMART 파서들과 같은 이유).
function parsePingOutput(out) {
  if (!out) return { avgMs: null, jitterMs: null, lossPercent: null, raw: null };

  // ⚠ 언어·인코딩에 기대지 않는다 (실측으로 발견한 문제).
  //   한국어 Windows의 ping 출력은 CP949라서 Node가 읽으면 한글이 깨진다. 실제 출력 예:
  //     "1.1.1.1�� ����: ����Ʈ=32 �ð�=3ms TTL=56"
  //   예전 정규식은 "시간=" 또는 "time="을 찾았는데 둘 다 매칭되지 않아,
  //   **핑이 멀쩡히 3ms로 성공했는데도 avgMs=null**이 됐다. 그런데도 네트워크 섹션은
  //   "정상"으로 표시됐다(검사 안 한 것을 정상이라고 말하던 문제의 한 사례).
  //   숫자와 "ms"·"%"는 인코딩이 깨져도 그대로 남으므로 그 부분만 읽는다.
  //   `=`/`<` 앞의 라벨이 무엇이든(시간/time/tempo/…) 상관없이 동작한다.
  const times = [...out.matchAll(/[=<]\s*([\d.]+)\s*ms/gi)].map((m) => parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));

  // 손실률도 같은 이유로 라벨(loss/손실/…)에 최대한 기대지 않는다. 다만 아무 %나 잡으면
  // 안 되므로 형식이 뚜렷한 순서로 시도한다:
  //   Windows  "... = 0 (0% 손실)"        → 괄호 안의 %
  //   Linux    "2 packets transmitted, 2 received, 0% packet loss"
  //   그 외     "... 0% loss"
  const lossMatch = out.match(/\((\d+(?:\.\d+)?)\s*%/)
    || out.match(/(\d+(?:\.\d+)?)\s*%\s*packet\s*loss/i)
    || out.match(/(\d+(?:\.\d+)?)\s*%\s*(loss|손실)/i);
  const lossPercent = lossMatch ? parseFloat(lossMatch[1]) : null;

  if (times.length === 0) return { avgMs: null, jitterMs: null, lossPercent, raw: out };

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const jitter = Math.sqrt(
    times.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / times.length
  );
  return { avgMs: round(avg, 1), jitterMs: round(jitter, 1), lossPercent, raw: null };
}

// ---------- DISPLAY ----------
async function collectDisplay() {
  const graphics = await si.graphics();
  return (graphics.displays || []).map((d) => ({
    model: d.model || d.deviceName || 'Unknown',
    main: d.main,
    resolutionX: d.currentResX,
    resolutionY: d.currentResY,
    refreshRateHz: d.currentRefreshRate || null,
    connection: d.connection || null,
  }));
}

// ---------- OS / DRIVERS ----------
async function collectSystem() {
  const [osInfo, systemInfo] = await Promise.all([si.osInfo(), si.system()]);

  // ⚠ `si.osInfo().platform`은 Windows에서 **'win32'가 아니라 'Windows'** 를 반환한다(실측).
  //   예전 조건(`osInfo.platform === 'win32'`)은 Windows에서도 한 번도 참이 되지 않아서
  //   **드라이버 오류 조회가 아예 실행된 적이 없었다.** 그런데도 DRIVERS 섹션은 늘
  //   "오류 장치 0개 · 정상"으로 표시됐다 — 검사하지 않은 것을 정상이라고 말하던 사례다.
  //   플랫폼 판정은 항상 Node의 `process.platform`을 쓴다(값이 규격으로 고정돼 있다).
  const isWindows = process.platform === 'win32';
  let driverErrors = [];
  let driverQueryOk = false;
  if (isWindows) {
    const out = await run(
      'powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-PnpDevice -Status Error | Select-Object -Property FriendlyName,InstanceId | ConvertTo-Json"',
      6000
    );
    if (out !== null) {
      driverQueryOk = true;
      const trimmed = out.trim();
      if (trimmed.length) {
        try {
          const parsed = JSON.parse(trimmed);
          driverErrors = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
          // 조회는 됐는데 해석을 못 한 경우 — "오류 0개"라고 단정하면 안 된다.
          driverQueryOk = false;
        }
      }
      // 출력이 비어 있으면 오류 장치가 정말 0개라는 뜻이다(정상적인 결과).
    }
  }

  return {
    // 화면·리포트가 보여주는 이름은 si의 값을 그대로 쓰되(예: "Windows"),
    // 판정에 쓰는 값은 규격이 고정된 process.platform으로 따로 싣는다.
    platform: process.platform,
    platformLabel: osInfo.platform,
    driverQueryOk,
    distro: osInfo.distro,
    release: osInfo.release,
    arch: osInfo.arch,
    manufacturer: systemInfo.manufacturer,
    model: systemInfo.model,
    driverErrors,
  };
}

// CPU 트렌드 감지: 부하가 이미 높을 때만 호출해서 온도/클럭 추이를 본다 (correlation engine용)
async function sampleCpuTrend(samples = 4, intervalMs = 800) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    const c = await collectCpu();
    out.push({ t: Date.now(), loadPercent: c.loadPercent, tempC: c.tempC, clockGHz: c.clockGHz });
    if (i < samples - 1) await sleep(intervalMs);
  }
  return out;
}

// ---------- TOP PROCESSES ----------
// RAM/CPU 사용량이 높을 때 "무엇이" 자원을 쓰고 있는지 보여주기 위한 수집기.
// 개인정보 보호를 위해 프로세스 이름/PID/사용률만 가져오고 로컬에서만 사용한다.
async function collectTopProcesses(limit = 5) {
  const data = await si.processes();
  const list = data.list || [];
  const sortAndTrim = (key) =>
    [...list]
      .sort((a, b) => (b[key] || 0) - (a[key] || 0))
      .slice(0, limit)
      .map((p) => ({ name: p.name, pid: p.pid, cpuPercent: round(p.cpu, 1), memPercent: round(p.mem, 1) }));
  return { byCpu: sortAndTrim('cpu'), byMem: sortAndTrim('mem') };
}

// ---------- WINDOWS EVENT LOG ----------
// 하드웨어 센서만으로는 못 잡는 문제(간헐적 재부팅, 블루스크린, 드라이버 크래시)를
// Windows 자체 이벤트 로그에서 찾는다. 관련 있는 provider만 골라서 최근 N일치를 가져온다.
//   - Kernel-Power(41): 비정상 종료/재부팅
//   - WHEA-Logger: CPU/RAM/PCIe 등 하드웨어 오류
//   - Display: 그래픽 드라이버 응답 없음/복구(TDR)
//   - disk / Ntfs: 저장장치·파일시스템 오류
//   - BugCheck: 블루스크린
//   - Application Error: 프로그램 반복 비정상 종료
// ⚠ 예전에는 전체 이벤트를 시간순으로 정렬해 앞에서 maxEvents개만 잘라서 돌려줬다. 그러면
//    특정 provider(예: Kernel-Power)의 이벤트가 많을 때 다른 provider가 통째로 잘려나가서,
//    진단 엔진이 "WHEA 0건"이라고 잘못 판단할 수 있었다.
//    이제 **전체 건수는 provider/ID별로 따로 집계**해서 절대 잘리지 않게 하고,
//    화면에 보여줄 상세 목록만 maxEvents개로 제한한다.
async function collectEventLogs(days = 7, maxEvents = 50) {
  const empty = (error) => ({ supported: true, events: [], counts: [], totalCount: 0, days, maxEvents, truncated: false, error });
  if (os.platform() !== 'win32') {
    return { supported: false, events: [], counts: [], totalCount: 0, days, maxEvents, truncated: false, error: null };
  }

  const script = `
    [Console]::OutputEncoding=[System.Text.Encoding]::UTF8;
    $providers = @('Microsoft-Windows-Kernel-Power','Microsoft-Windows-WHEA-Logger','disk','Ntfs','Display','BugCheck');
    $sys = @(Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName=$providers; StartTime=(Get-Date).AddDays(-${days})} -ErrorAction SilentlyContinue);
    $app = @(Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; StartTime=(Get-Date).AddDays(-${days})} -ErrorAction SilentlyContinue);
    $all = $sys + $app;
    $counts = @($all | Group-Object -Property ProviderName,Id,LevelDisplayName | ForEach-Object { $p = $_.Name -split ','; [PSCustomObject]@{ provider = $p[0].Trim(); id = $p[1].Trim(); level = $p[2].Trim(); count = $_.Count; latest = ($_.Group | Sort-Object TimeCreated -Descending | Select-Object -First 1).TimeCreated } });
    $recent = @($all | Sort-Object TimeCreated -Descending | Select-Object -First ${maxEvents} TimeCreated,Id,ProviderName,LevelDisplayName,@{Name='Message';Expression={ ($_.Message -replace '\\s+',' ').Trim() }});
    ConvertTo-Json -InputObject ([PSCustomObject]@{ total = $all.Count; counts = $counts; recent = $recent }) -Depth 4 -Compress
  `.replace(/\r?\n\s*/g, ' ');

  const out = await run(`powershell -NoProfile -Command "${script}"`, 20000);
  if (out === null) return empty('query_failed');
  try {
    const parsed = JSON.parse(out);
    const asArray = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
    const events = asArray(parsed.recent).map((e) => ({
      time: e.TimeCreated,
      id: e.Id,
      provider: e.ProviderName,
      level: e.LevelDisplayName,
      message: (e.Message || '').slice(0, 300),
    }));
    const counts = asArray(parsed.counts).map((c) => ({
      provider: c.provider,
      id: Number(c.id),
      level: c.level || null,
      count: Number(c.count) || 0,
      latest: c.latest || null,
    }));
    const totalCount = Number(parsed.total) || counts.reduce((a, c) => a + c.count, 0);
    return { supported: true, events, counts, totalCount, days, maxEvents, truncated: totalCount > events.length, error: null };
  } catch (err) {
    return empty('parse_failed');
  }
}

// ---------- HARDWARE IDENTITY (판매용 점검 리포트용) ----------
// 중고 거래 시 "이 리포트가 진짜 이 PC 것인가"를 구매자가 대조할 수 있도록
// 하드웨어 시리얼/고유 식별자를 모은다. 가상머신이나 일부 OEM 제품은
// 제조사가 시리얼을 아예 노출하지 않을 수 있어, 값이 없으면 정직하게 "확인 불가"로 남긴다.
async function collectHardwareIdentity() {
  const [sys, board, disks, cpuInfo] = await Promise.all([
    si.system(),
    si.baseboard(),
    si.diskLayout(),
    si.cpu(),
  ]);

  // BIOS/메인보드 제조사(특히 조립 PC용 보드)는 진짜 시리얼 대신 이런 더미 플레이스홀더를
  // 남겨두는 경우가 매우 흔하다. 이걸 "확인 불가"로 안 걸러내면, 아무 의미 없는 텍스트를
  // 마치 진짜 식별값인 것처럼 보여주는 심각한 오탐이 된다. (실제 조립 PC에서 발견된 사례로 추가함)
  const PLACEHOLDER_PATTERNS = [
    /to be filled by o\.?e\.?m\.?/i,
    /^default string$/i,
    /^system serial number$/i,
    /^system manufacturer$/i,
    /^system product name$/i,
    /^system version$/i,
    /^not specified$/i,
    /^none$/i,
    /^n\/?a$/i,
    /^\.+$/,
    /^0+$/,
  ];
  const clean = (v) => {
    if (!v || v === '-') return null;
    const trimmed = v.trim();
    if (trimmed === '') return null;
    if (PLACEHOLDER_PATTERNS.some((re) => re.test(trimmed))) return null;
    return trimmed;
  };

  let gpuUuid = null;
  const nvOut = await run('nvidia-smi --query-gpu=uuid --format=csv,noheader', 3000);
  if (nvOut) {
    const first = nvOut.trim().split('\n')[0];
    gpuUuid = clean(first);
  }

  return {
    systemManufacturer: clean(sys.manufacturer),
    systemModel: clean(sys.model),
    systemSerial: clean(sys.serial),
    systemUuid: clean(sys.uuid),
    baseboardSerial: clean(board.serial),
    cpuModel: `${cpuInfo.manufacturer} ${cpuInfo.brand}`.trim(),
    gpuUuid, // CPU는 OS에서 시리얼을 읽을 수 있는 표준 방법이 없어 모델명만 사용
    disks: disks.map((d) => ({ name: d.name, serial: clean(d.serialNum), sizeGB: round(d.size / 1e9, 1) })),
  };
}

// ---------- helpers ----------
function round(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  collectCpu,
  collectIdleSnapshot,
  sampleCpuTrend,
  collectMemory,
  collectMemoryModules,
  collectOverclockState,
  collectBattery,
  probeCpuTemperature,
  collectCpuTemperatureElevated,
  TEMP_REASON,
  collectGpu,
  sampleGpuTrend,
  collectStorage,
  collectNetwork,
  collectDisplay,
  collectSystem,
  collectTopProcesses,
  collectEventLogs,
  collectHardwareIdentity,
  retrySmartElevated,
  collectLiveSample,
  // 파서는 실제 장비 없이 테스트하기 위해 따로 내보낸다(SATA 장비가 이 PC에 없다).
  parseSmartAttributes,
  parseNvmeSmart,
  parseAtaSmart,
  parseSmartIdentity,
  parseSmartHealthOutput,
  parsePingOutput,
  parseBatteryReport,
  parseThermalZones,
};
