// sessions.js
// 검사 세션 기록. (기획서 §46 검사 세션, §47 검사 이력)
//
// history.js와 무엇이 다른가: history는 "전체 진단을 언제 돌렸고 대략 어땠나"를 쌓는
// 가벼운 기록이다. 여기는 **전후 비교가 성립하도록 필요한 값을 빠짐없이** 남긴다 —
// 어떤 프로필로 검사했는지, 부하 테스트를 돌렸는지, 그때 하드웨어 구성이 무엇이었는지까지.
// 이게 없으면 "수리 전 94°C → 수리 후 76°C" 같은 비교를 만들 수 없다.
//
// ⚠ 비교의 전제를 함께 저장하는 것이 핵심이다.
//   같은 숫자라도 "부하 테스트 중 최고 온도"와 "유휴 상태 온도"는 전혀 다른 값이다.
//   deepTestsIncluded를 같이 남기지 않으면 나중에 그 둘을 나란히 놓는 사고가 난다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'inspection-sessions.json';
const MAX_SESSIONS = 200;

function filePath(userDataDir) {
  return path.join(userDataDir, FILE);
}

function loadSessions(userDataDir) {
  const f = filePath(userDataDir);
  if (!fs.existsSync(f)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 같은 PC인지 묶는 열쇠. 시리얼이 없는 조립 PC도 많아서 여러 값을 조합한다.
// 하드웨어를 "인증"하는 값이 아니라 **기록을 묶기 위한 열쇠**일 뿐이다.
function hardwareKeyOf(hardware) {
  const h = hardware || {};
  const parts = [h.baseboardSerial, h.systemUuid, h.cpuModel, h.memoryTotalGB].filter(Boolean);
  if (!parts.length) return null;
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

// 리포트/raw에서 비교에 쓸 값만 뽑아낸다. 못 읽은 값은 반드시 null로 남긴다
// (0으로 채우면 "오류 0건"이라는 없는 사실을 만들어낸다).
function extractMetrics(report, raw) {
  const deep = (raw.deepTests && raw.deepTests.included) ? raw.deepTests : null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  // 이벤트 건수는 규칙 엔진이 이미 분류해둔 counts에서 센다(provider 이름만으로 세면 오탐).
  const counts = (raw.eventLog && raw.eventLog.counts) || [];
  const countIds = (provider, ids) => {
    if (!raw.eventLog || !raw.eventLog.supported) return null;
    return counts.filter((c) => c.provider === provider && ids.includes(c.id))
      .reduce((a, c) => a + (c.count || 0), 0);
  };

  const ramSection = (report.sections || []).find((s) => s.category === 'RAM');
  const memCfg = ramSection && ramSection.memoryConfig;

  return {
    // 부하 테스트를 돌렸으면 그때의 최고 온도, 아니면 null(유휴 온도로 대체하지 않는다 —
    // 성격이 다른 값을 같은 칸에 넣으면 비교가 거짓이 된다).
    cpuMaxTempC: deep && deep.cpuStress ? num(deep.cpuStress.maxTempC) : null,
    gpuMaxTempC: raw.gpuStressCheck ? num(raw.gpuStressCheck.maxTempC) : null,
    ramSpeedMTs: memCfg ? num(memCfg.currentMTs) : null,
    wheaErrors: countIds('Microsoft-Windows-WHEA-Logger', [18, 19, 20, 23, 24, 25, 46]),
    unexpectedShutdowns: countIds('Microsoft-Windows-Kernel-Power', [41]),
    bugchecks: countIds('BugCheck', [1001]),
    driverErrors: raw.system && raw.system.driverQueryOk ? (raw.system.driverErrors || []).length : null,
    ramTestErrors: deep && deep.ramTest ? num(deep.ramTest.errors) : null,
    storageWriteMBps: deep && deep.storageTest ? num(deep.storageTest.writeMBps) : null,
    storageReadMBps: deep && deep.storageTest ? num(deep.storageTest.readMBps) : null,
  };
}

// 비교에 쓸 하드웨어 구성 스냅샷.
function extractHardware(raw, hardwareIdentity) {
  const hi = hardwareIdentity || {};
  const mods = (raw.memoryModules && raw.memoryModules.modules) || [];
  return {
    cpuModel: (raw.cpu && raw.cpu.model) || hi.cpuModel || null,
    gpuModels: ((raw.gpu && raw.gpu.controllers) || []).map((c) => c.model).filter(Boolean),
    memoryTotalGB: raw.memory ? raw.memory.totalGB : null,
    memoryModuleCount: mods.length || null,
    diskSerials: (hi.disks || []).map((d) => d.serial).filter(Boolean),
    baseboardSerial: hi.baseboardSerial || null,
    systemUuid: hi.systemUuid || null,
  };
}

// 검사 "범위"의 지문. 프로필 이름이 아니라 실제로 무엇을 쟀는지로 비교 가능성을 판단하기 위한 값이다.
// 수리 입고/출고는 이름은 다르지만 범위가 같도록 만들어져 있어서, 이름으로 비교하면
// "프로필이 다릅니다"라는 잘못된 경고가 뜬다. 범위가 같으면 같은 열쇠가 나온다.
function scopeKeyOf(profile) {
  if (!profile) return null;
  const payload = JSON.stringify({ collect: profile.collect, deep: profile.deep || null });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// 업무용 메모. 수리점·업체는 하루에 여러 대를 보므로 "이 세션이 누구 PC인지"를
// 적어둘 수 없으면 기록이 쌓여도 쓸 수가 없다.
//
// ⚠ 이 값들은 **판정에 전혀 관여하지 않는다.** 사람이 적는 자유 입력이라 진단 근거로
//   쓰면 안 된다. 다만 점검 리포트에는 실리고 검증 해시에도 들어간다 —
//   "누구 것을 언제 누가 검사했다"는 기록 자체가 문서의 일부이기 때문이다.
const NOTE_LIMITS = { customer: 60, device: 60, technician: 40, memo: 500 };

function sanitizeNotes(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  Object.entries(NOTE_LIMITS).forEach(([key, max]) => {
    const v = input[key];
    if (typeof v !== 'string') return;
    const trimmed = v.trim().slice(0, max);
    if (trimmed) out[key] = trimmed;
  });
  return Object.keys(out).length ? out : null;
}

function appendSession(userDataDir, { report, raw, hardwareIdentity, inspectionReport, profile, notes }) {
  const hardware = extractHardware(raw, hardwareIdentity);
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
    issuedAt: (inspectionReport && inspectionReport.issuedAt) || report.timestamp || new Date().toISOString(),
    profileId: profile ? profile.id : null,
    profileLabel: profile ? profile.label : null,
    sessionRole: profile ? (profile.sessionRole || null) : null,
    scopeKey: scopeKeyOf(profile),
    notes: sanitizeNotes(notes),
    reportId: inspectionReport ? inspectionReport.reportId : null,
    grade: inspectionReport ? inspectionReport.overallGrade.letter : null,
    // 비교의 전제 — 이게 없으면 성격이 다른 값을 나란히 놓게 된다.
    deepTestsIncluded: !!(raw.deepTests && raw.deepTests.included),
    hardwareKey: hardwareKeyOf(hardware),
    hardware,
    metrics: extractMetrics(report, raw),
    headline: report.headline,
  };

  const list = loadSessions(userDataDir);
  list.push(entry);
  fs.writeFileSync(filePath(userDataDir), JSON.stringify(list.slice(-MAX_SESSIONS), null, 2), 'utf-8');
  return entry;
}

// 짝이 되는 이전 세션을 찾는다(예: 출고 검사 → 같은 PC의 가장 최근 입고 검사).
// 하드웨어 열쇠가 다르면 다른 PC이므로 짝으로 삼지 않는다.
//
// customer가 주어지면 같은 고객의 기록만 본다. 같은 모델 PC를 여러 대 다루는
// 수리점에서 하드웨어 지문만으로는 구별되지 않는 경우가 있기 때문이다.
function findPairSession(userDataDir, { hardwareKey, role, beforeId, customer } = {}) {
  const list = loadSessions(userDataDir);
  const candidates = list.filter((s) => {
    if (beforeId && s.id === beforeId) return false;
    if (role && s.sessionRole !== role) return false;
    if (hardwareKey && s.hardwareKey && s.hardwareKey !== hardwareKey) return false;
    if (customer && s.notes && s.notes.customer && s.notes.customer !== customer) return false;
    return true;
  });
  return candidates.length ? candidates[candidates.length - 1] : null;
}

// 세션에 메모를 나중에 붙이거나 고친다. 검사 중에는 정신없어서 나중에 적는 일이 흔하다.
function updateSessionNotes(userDataDir, sessionId, notes) {
  const list = loadSessions(userDataDir);
  const idx = list.findIndex((s) => s.id === sessionId);
  if (idx < 0) return null;
  list[idx] = { ...list[idx], notes: sanitizeNotes(notes) };
  fs.writeFileSync(filePath(userDataDir), JSON.stringify(list, null, 2), 'utf-8');
  return list[idx];
}

function clearSessions(userDataDir) {
  const f = filePath(userDataDir);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

module.exports = {
  loadSessions, appendSession, findPairSession, clearSessions, updateSessionNotes,
  extractMetrics, extractHardware, hardwareKeyOf, scopeKeyOf, sanitizeNotes, NOTE_LIMITS, filePath,
};
