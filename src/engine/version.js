// version.js
// 검사 결과에 함께 기록하는 버전 정보. (기획서 §59 검사 데이터 버전 관리, §60 Rule 버전)
//
// 왜 필요한가: **같은 PC라도 미래 버전의 진단 규칙이 다른 판정을 낼 수 있다.**
// 임계값을 조정하거나 오탐을 고치면 예전 리포트와 결과가 달라진다. 그때
// "이 성적서는 어느 버전이 어떤 규칙으로 낸 판정인가"를 답할 수 없으면
// 과거 리포트를 설명할 방법이 없다. 그래서 리포트마다 버전을 박아둔다.
//
// 세 가지를 따로 기록한다. 바뀌는 이유와 주기가 서로 다르기 때문이다.
//   app      앱 릴리스 버전 (package.json). UI·기능 변경까지 포함해 가장 자주 바뀐다.
//   engine   진단 엔진 구조 버전. 리포트 데이터 모양이 바뀔 때 올린다.
//   ruleset  판정 규칙 묶음 버전. 임계값·판정 로직이 바뀔 때 올린다.
//
// ⚠ engine/ruleset은 손으로 올린다. 자동 생성하면 "바뀌지 않았는데 바뀐 것처럼" 보이거나
//   반대로 판정이 바뀌었는데 버전이 그대로인 일이 생긴다. 규칙을 고치면 반드시 함께 올릴 것.

const pkg = require('../../package.json');

// 리포트 데이터 구조가 바뀔 때 올린다.
//   1.0  섹션 status 4단계 시절
//   2.0  결과 상태 6단계(result/NOT_TESTED) 도입, 프로필·기준선·메모리 구성 추가
const ENGINE_VERSION = '2.0';

// 판정 규칙 묶음. 임계값이나 판정 로직이 바뀌면 올린다.
const RULESET_VERSION = '2026.08.1';

function versionInfo() {
  return {
    app: pkg.version,
    engine: ENGINE_VERSION,
    ruleset: RULESET_VERSION,
    // 사람이 읽는 한 줄 표기 (기획서 §59의 예시 형식)
    label: `DiagBench ${pkg.version} · Diagnostic Engine ${ENGINE_VERSION} · Rule Set ${RULESET_VERSION}`,
  };
}

module.exports = { versionInfo, ENGINE_VERSION, RULESET_VERSION, APP_VERSION: pkg.version };
