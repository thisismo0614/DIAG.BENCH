// settings.js
// 사용자 설정. 지금은 표시 모드(기본/전문가) 하나뿐이지만, 설정이 늘어날 자리를 만들어둔다.
//
// ⚠ 설정은 **보여줄 양**만 바꾼다. 판정 결과는 절대 바꾸지 않는다.
//   기본 모드에서 경고가 사라지거나 등급이 달라지면, 같은 PC가 화면 설정에 따라
//   다른 상태로 보이게 된다. 그건 이 프로그램이 해서는 안 되는 일이다.
//   특히 "검사 안 함(NOT_TESTED)"은 기본 모드에서도 반드시 보여야 한다 —
//   상세 근거는 접어도, 확인되지 않았다는 사실 자체는 감추지 않는다.

const fs = require('fs');
const path = require('path');

const FILE = 'settings.json';

const VIEW_MODES = ['basic', 'expert'];
const DEFAULTS = {
  // 기본값은 basic. 처음 쓰는 사람에게 센서 원시값부터 보여주면 읽지 못한다.
  viewMode: 'basic',
};

function filePath(userDataDir) {
  return path.join(userDataDir, FILE);
}

function loadSettings(userDataDir) {
  const f = filePath(userDataDir);
  if (!fs.existsSync(f)) return { ...DEFAULTS };
  try {
    const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'));
    return { ...DEFAULTS, ...sanitize(parsed) };
  } catch {
    return { ...DEFAULTS };
  }
}

// 파일이나 렌더러에서 오는 값을 그대로 믿지 않는다. 모르는 값은 기본값으로 접는다.
function sanitize(input = {}) {
  const out = {};
  if (VIEW_MODES.includes(input.viewMode)) out.viewMode = input.viewMode;
  return out;
}

function saveSettings(userDataDir, patch = {}) {
  const next = { ...loadSettings(userDataDir), ...sanitize(patch) };
  fs.writeFileSync(filePath(userDataDir), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

module.exports = { loadSettings, saveSettings, sanitize, VIEW_MODES, DEFAULTS, filePath };
