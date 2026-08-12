// latestCheckStore.js
// VRAM 검사, GPU 부하 테스트처럼 "렌더러에서만 실행할 수 있어서 진단 중에는 못 돌리는 검사"의
// 최신 결과 하나를 userData에 저장해두고, 다음 진단이 근거로 쓰게 하는 공통 저장소.
//
// 누적 이력이 아니라 "지금 상태"만 유지한다. 기록이 오래되면 지금을 반영하지 못하므로
// (그 사이 부품을 바꿨을 수도 있다) 유효기간이 지난 기록은 없는 것으로 취급한다.
//
// 같은 코드를 검사 종류마다 복사하지 않으려고 팩토리로 뺐다. 검사별로 다른 건
// 파일 이름과 "어떤 값을 저장할지(normalize)"뿐이다.

const fs = require('fs');
const path = require('path');

const DEFAULT_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30일

function createLatestCheckStore({ fileName, normalize, staleMs = DEFAULT_STALE_MS }) {
  const filePath = (userDataDir) => path.join(userDataDir, fileName);

  function load(userDataDir) {
    const file = filePath(userDataDir);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      // 파일이 깨졌으면 "기록 없음"으로 본다 — 잘못된 값으로 진단하는 것보다 낫다.
      return null;
    }
  }

  function save(userDataDir, input = {}) {
    const record = { ...normalize(input), checkedAt: new Date().toISOString() };
    fs.writeFileSync(filePath(userDataDir), JSON.stringify(record, null, 2), 'utf-8');
    return record;
  }

  function active(userDataDir) {
    const check = load(userDataDir);
    if (!check || !check.checkedAt) return null;
    if (Date.now() - new Date(check.checkedAt).getTime() >= staleMs) return null;
    return check;
  }

  return { load, save, active, staleMs, filePath };
}

module.exports = { createLatestCheckStore, DEFAULT_STALE_MS };
