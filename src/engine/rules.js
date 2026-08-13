// rules.js
// 각 수집기(collectors.js)가 반환한 데이터를 조합해서
// "정상 / 경고 / 위험" 판정과 원인·조치·신뢰도·재검사 방법을 만들어내는 규칙 기반 진단 엔진.
//
// 실제 AI 추론이 아니라 임계값 + 상관관계 규칙(rule)이다.
// confidence는 "증거가 몇 개나 겹치는가"를 사람이 정한 가중치로 점수화한 것이며,
// 통계적으로 검증된 확률이 아니다.
//
// 정상 판정도 근거를 남긴다: "GPU 정상"이라고만 말하지 않고
// "온도 65°C, 클럭 안정, VRAM 여유" 같은 근거를 함께 제공한다.

const { compareToBaseline, deltasForSection, IDLE_CPU_LOAD_MAX, IDLE_GPU_LOAD_MAX } = require('./baseline');
const { analyzeMemoryConfig } = require('./memoryConfig');

// 진단 신뢰도의 어휘. 숫자만으로는 "무엇을 근거로 이 정도 확신을 하는가"가 드러나지 않는다.
//   CONFIRMED          실제 오류/사실이 측정으로 확인됨
//   STRONG_INDICATION  강한 연관성이 있으나 그것만으로 원인을 확정할 수는 없음
//   POSSIBLE_CAUSE     가능성 있는 원인 후보
//   NEEDS_VERIFICATION 추가 검사가 필요함
// 기존 숫자 confidence와 함께 쓴다(과거 리포트/화면과의 호환을 깨지 않기 위해).
const CONFIDENCE_SCORE = {
  CONFIRMED: 95,
  STRONG_INDICATION: 78,
  POSSIBLE_CAUSE: 55,
  NEEDS_VERIFICATION: 35,
};

// memoryConfig 같은 "규칙 모듈"이 만든 finding을 이슈로 옮긴다.
// 판정(level·confidence)은 규칙 모듈이 이미 끝냈고 여기서는 형태만 맞춘다.
function issueFromFinding(f) {
  // 조치는 {text, risk} 형태로 온다. 위험도를 모르는 기존 화면도 그대로 동작하도록
  // 문자열 배열(actions)을 유지하고, 위험도가 필요한 쪽은 actionDetails를 읽는다.
  const details = (f.actions || []).map((a) => (typeof a === 'string' ? { text: a, risk: null } : a));
  const issue = mkIssue(
    f.level, f.title, f.explanation, f.causes,
    details.map((a) => a.text),
    CONFIDENCE_SCORE[f.confidence] ?? null,
    f.evidence, f.verification
  );
  issue.ruleId = f.ruleId;             // 어떤 규칙이 이 판정을 냈는지 (기획서 §12)
  issue.ruleVersion = f.ruleVersion;   // 판정 로직이 바뀌어도 과거 결과를 설명할 수 있게 (§60)
  issue.confidenceLevel = f.confidence; // §11 어휘
  issue.actionDetails = details;        // §14 조치별 위험도
  return issue;
}

function evaluateCpu(cpu, trend, topProcesses, cpuStress, baselineComparison) {
  const stress = cpuStressFindings(cpuStress);
  const base = baselineFindings(baselineComparison, 'CPU');
  const issues = [...stress.issues, ...base.issues];

  if (cpu.tempC !== null) {
    if (cpu.tempC >= 95) {
      issues.push(mkIssue('critical', 'CPU 온도가 위험 수준입니다',
        `현재 CPU 온도가 ${cpu.tempC}°C로, 서멀 스로틀링이나 시스템 강제 종료가 발생할 수 있는 범위입니다.`,
        ['쿨러 장착 불량 또는 서멀 그리스 열화', '케이스 흡배기 부족', '고부하 작업(렌더링/게임) 지속'],
        ['CPU 쿨러 장착 상태 재확인', '서멀 그리스 재도포 고려', '케이스 팬 흡배기 방향 점검'],
        95, [`온도 ${cpu.tempC}°C (위험 임계값 95°C 이상)`],
        '조치 후 안정성 테스트 탭에서 CPU 부하 테스트를 다시 실행해 최고 온도가 낮아졌는지 확인하세요.'));
    } else if (cpu.tempC >= 85 && cpu.loadPercent >= 80) {
      issues.push(mkIssue('warning', 'CPU가 고부하 상태에서 온도가 높습니다',
        `부하 ${cpu.loadPercent}% 상태에서 온도가 ${cpu.tempC}°C까지 상승했습니다. 지속되면 스로틀링 가능성이 있습니다.`,
        ['공랭/수랭 쿨러 냉각 성능 한계', '주변 온도가 높은 환경', '먼지로 인한 방열판 성능 저하'],
        ['부하가 큰 작업을 몇 분 지속하며 온도 추이 관찰', '케이스 내부 먼지 제거', '필요 시 쿨러 교체 검토'],
        62, [`부하 ${cpu.loadPercent}%`, `온도 ${cpu.tempC}°C`, '단일 시점 측정 (추이 미확인)'],
        '안정성 테스트 탭의 CPU 부하 테스트를 15초간 실행해 온도가 계속 상승하는지, 클럭이 떨어지는지 확인하세요.'));
    } else if (cpu.tempC >= 78 && cpu.loadPercent >= 70) {
      issues.push(mkIssue('watch', 'CPU 온도가 다소 높은 편입니다',
        `부하 ${cpu.loadPercent}% 상태에서 온도가 ${cpu.tempC}°C입니다. 즉각적인 문제는 아니지만 지켜볼 필요가 있습니다.`,
        ['일반적인 고부하 작업 중일 가능성', '냉각 여유가 줄어들고 있을 가능성'],
        ['특별한 조치 없이 지켜봐도 되지만, 계속 상승하면 안정성 테스트를 실행해 확인하세요'],
        40, [`부하 ${cpu.loadPercent}%`, `온도 ${cpu.tempC}°C`, '경고 임계값(85°C) 미만 — 근거 부족으로 판단 보류'],
        '평소보다 온도가 높다고 느껴지면 안정성 테스트 탭에서 CPU 부하 테스트를 실행해 추이를 확인하세요.'));
    }
  }

  if (trend && trend.length >= 3 && trend.every((t) => t.tempC !== null && t.clockGHz !== null)) {
    const first = trend[0];
    const last = trend[trend.length - 1];
    const loadHigh = trend.every((t) => t.loadPercent >= 85);
    const tempRising = last.tempC - first.tempC >= 2;
    const clockDropping = first.clockGHz - last.clockGHz >= 0.3;
    if (loadHigh && tempRising && clockDropping) {
      issues.push(mkIssue('warning', 'CPU 열 스로틀링이 의심됩니다',
        `CPU 사용률이 계속 85% 이상인 상태에서 온도는 ${first.tempC}°C → ${last.tempC}°C로 상승했고, 클럭은 ${first.clockGHz}GHz → ${last.clockGHz}GHz로 감소했습니다.`,
        ['냉각 성능 부족으로 인한 열 제한(throttling)', '고온 환경에서의 장시간 고부하 작업', '메인보드 전력 제한 설정'],
        ['케이스 airflow(흡기/배기) 확인', 'CPU 쿨러 장착 재확인', '메인보드 전력 제한(PL1/PL2) 설정 확인'],
        87, ['고부하 지속 확인됨', '온도 상승 추세 확인됨', '클럭 하락 추세 확인됨'],
        '케이스를 열어 airflow를 개선한 뒤 안정성 테스트 탭에서 CPU 부하 테스트를 재실행해 클럭 하락폭이 줄어드는지 비교하세요.'));
    } else if (loadHigh && tempRising && !clockDropping) {
      // 온도는 오르지만 클럭 하락까지는 확인되지 않은 경우 — "스로틀링"이라 단정하지 않는다.
      issues.push(mkIssue('watch', 'CPU 온도가 상승 중이지만 스로틀링 근거는 아직 부족합니다',
        `온도는 ${first.tempC}°C → ${last.tempC}°C로 상승했지만, 클럭은 ${first.clockGHz}GHz → ${last.clockGHz}GHz로 유지되고 있어 성능 제한의 뚜렷한 증거는 없습니다.`,
        ['정상적인 고부하 반응(아직 스로틀링 아님)', '온도가 더 상승하면 스로틀링으로 이어질 가능성'],
        ['지금 당장 조치할 필요는 없지만, 같은 작업을 더 길게 지속하며 온도 추이를 지켜보세요'],
        45, ['온도 상승 확인됨', '클럭 하락은 확인되지 않음 — 스로틀링 판정 보류'],
        '안정성 테스트 탭에서 CPU 부하 테스트를 더 길게(예: 60초) 돌려 온도가 계속 오르는지, 그때도 클럭이 유지되는지 확인하세요.'));
    }
  }

  if (cpu.loadPercent >= 95) {
    const issue = mkIssue('warning', 'CPU 사용률이 지속적으로 매우 높습니다',
      `현재 부하가 ${cpu.loadPercent}%입니다. 아래 프로세스가 CPU를 많이 점유하고 있습니다.`,
      ['백그라운드 프로세스 과다 실행', '무한 루프 등 비정상 프로세스', '단순 고부하 작업 중'],
      ['작업 관리자에서 CPU 사용률 높은 프로세스 확인', '불필요한 시작 프로그램 정리'],
      55, [`부하 ${cpu.loadPercent}%`],
      '의심되는 프로세스를 종료한 뒤 전체 진단을 다시 실행해 CPU 부하가 정상 범위로 돌아왔는지 확인하세요.');
    if (topProcesses && topProcesses.byCpu && topProcesses.byCpu.length) {
      issue.topProcesses = topProcesses.byCpu.slice(0, 5);
    }
    issues.push(issue);
  }

  const normalEvidence = [];
  if (cpu.tempC !== null) normalEvidence.push(`온도 ${cpu.tempC}°C`);
  normalEvidence.push(`부하 ${cpu.loadPercent}%`);
  if (cpu.clockGHz) normalEvidence.push(`클럭 ${cpu.clockGHz}GHz`);
  normalEvidence.push(...stress.evidence, ...base.evidence);

  return finalize('CPU', issues, null, normalEvidence);
}

function evaluateMemory(mem, topProcesses, ramTest, baselineComparison, memModules) {
  const ram = ramTestFindings(ramTest);
  const base = baselineFindings(baselineComparison, 'RAM');
  // 용량/사용률과 별개로 "어떤 모듈이 어떻게 꽂혀서 어떤 속도로 도는가"를 본다.
  // 안정성 테스트를 통과해도 구성 문제는 그대로 남아 있을 수 있다(memoryConfig.js).
  const cfg = analyzeMemoryConfig(memModules);
  const issues = [...ram.issues, ...base.issues, ...cfg.findings.map(issueFromFinding)];
  if (mem.usedPercent >= 90) {
    const issue = mkIssue('warning', '메모리 사용량이 한계에 가깝습니다',
      `전체 ${mem.totalGB}GB 중 ${mem.usedGB}GB(${mem.usedPercent}%)가 사용 중입니다. 아래 프로세스가 메모리를 많이 점유하고 있습니다.`,
      ['동시 실행 프로그램/브라우저 탭 과다', '메모리 누수가 있는 프로그램', '물리 메모리 용량 자체 부족'],
      ['불필요한 프로그램 종료', '작업 관리자에서 메모리 점유 높은 프로세스 확인', '반복된다면 RAM 증설 고려'],
      75, [`메모리 사용률 ${mem.usedPercent}%`, `가용 메모리 ${mem.availableGB}GB`],
      '프로그램을 정리한 뒤 전체 진단을 다시 실행해 사용률이 내려갔는지 확인하세요.');
    if (topProcesses && topProcesses.byMem && topProcesses.byMem.length) {
      issue.topProcesses = topProcesses.byMem.slice(0, 5);
    }
    issues.push(issue);
  }
  if (mem.swapTotalGB > 0 && mem.swapUsedGB / mem.swapTotalGB > 0.5) {
    issues.push(mkIssue('warning', '가상 메모리(스왑) 사용량이 높습니다',
      '물리 메모리가 부족해 디스크 기반 가상 메모리를 많이 사용하고 있어 속도 저하가 발생할 수 있습니다.',
      ['물리 RAM 부족'],
      ['실행 중인 프로그램 수 줄이기', 'RAM 증설 검토'],
      70, [`스왑 ${mem.swapUsedGB}GB / ${mem.swapTotalGB}GB 사용 중`],
      '재부팅 후 동일 작업을 반복하며 스왑 사용량 추이를 다시 확인하세요.'));
  }
  const normalEvidence = [`사용률 ${mem.usedPercent}%`, `가용 메모리 ${mem.availableGB}GB / 전체 ${mem.totalGB}GB`, ...ram.evidence, ...base.evidence, ...cfg.evidence];
  const section = finalize('RAM', issues, null, normalEvidence);
  // 이슈가 있어도 구성 근거는 보여야 한다(어떤 모듈이 꽂혀 있는지는 판정과 무관한 사실이다).
  section.memoryConfig = cfg.summary;
  section.notTested = cfg.notTested;
  if (section.status !== 'normal') section.evidenceAlways = cfg.evidence;
  return section;
}

// VRAM 압박·무결성 테스트는 렌더러에서 따로 실행하고 결과만 기록해둔다(vramChecks.js).
// 그 기록을 GPU 진단의 근거로 옮기는 부분. 판정 자체는 이미 끝나 있고 여기서는 해석만 한다.
function vramCheckFindings(vramCheck) {
  const issues = [];
  const evidence = [];
  if (!vramCheck) return { issues, evidence };

  const when = new Date(vramCheck.checkedAt).toLocaleDateString('ko-KR');
  const coverage = vramCheck.coveredMB !== null && vramCheck.totalMB
    ? `전체 VRAM ${vramCheck.totalMB}MB 중 ${Math.round(vramCheck.coveredMB)}MB 범위`
    : `${Math.round(vramCheck.allocatedMB)}MB 할당 범위(실제 VRAM 여부는 확인 안 됨)`;

  if (vramCheck.mismatchWords > 0) {
    issues.push(mkIssue('warning', 'VRAM 무결성 검사에서 불일치가 발견되었습니다',
      `VRAM에 올린 데이터를 다시 읽어 비교했을 때 ${vramCheck.mismatchWords.toLocaleString()}개 워드(4바이트 단위)가 올린 값과 달랐습니다(${when} 검사, ${coverage}). 관측된 사실은 "올린 값과 읽은 값이 다르다"까지이고, 그 원인이 VRAM 셀 불량인지 드라이버 문제인지는 이 검사만으로 구분되지 않습니다.`,
      ['VRAM 셀 불량', '메모리 클럭 오버클럭이 과도함', '그래픽 드라이버 오류', 'GPU 과열로 인한 데이터 손상'],
      ['메모리 오버클럭을 했다면 기본값으로 되돌린 뒤 다시 검사', '그래픽 드라이버를 최신 또는 직전 안정 버전으로 바꾼 뒤 다시 검사', '같은 결과가 반복되면 GPU 점검/A-S 문의'],
      74, [`불일치 ${vramCheck.mismatchWords.toLocaleString()}워드`, `검사 범위: ${coverage}`],
      '"안정성 테스트 > VRAM 압박·무결성 테스트"를 한 번 더 실행해 같은 결과가 재현되는지 확인하세요. 한 번만 나온 불일치는 일시적 오류일 수 있습니다.'));
  }

  if (vramCheck.contextLost) {
    issues.push(mkIssue('warning', 'VRAM 테스트 도중 그래픽 컨텍스트가 손실되었습니다',
      `${when}에 실행한 VRAM 테스트가 도중에 그래픽 컨텍스트를 잃었습니다. 그래픽 드라이버가 리셋(TDR)됐을 때 나타나는 증상입니다.`,
      ['그래픽 드라이버 응답 없음(TDR)', 'VRAM 부족', '전원 공급 불안정', 'GPU 하드웨어 이상'],
      ['그래픽 드라이버 재설치', '다른 GPU 사용 프로그램을 모두 끄고 다시 검사', 'Windows 이벤트 로그의 Display 오류 확인'],
      68, ['VRAM 테스트 중 그래픽 컨텍스트 손실'],
      'VRAM 테스트를 다시 실행해 같은 지점에서 반복되는지 확인하세요.'));
  }

  if (vramCheck.verdict === 'pass') {
    evidence.push(`VRAM 무결성 간이검사: 이상 없음 — ${coverage}만 확인 (${when})`);
  } else if (vramCheck.verdict === 'inconclusive') {
    // 판단 보류를 이슈로 올리면 "문제 있음"처럼 보이고, 아무 말도 안 하면 "정상"으로 읽힌다.
    // 그래서 이슈는 만들지 않되 근거에는 검사했다는 사실과 보류 사유를 남긴다.
    const reason = vramCheck.aborted ? '검사가 중간에 중단됨'
      : vramCheck.residencyLevel === 'unknown' ? '검사한 데이터가 실제 VRAM에 올라갔는지 확인되지 않음'
        : '검사를 끝까지 완료하지 못함';
    evidence.push(`VRAM 무결성 간이검사: 판단 보류 — ${reason} (${when})`);
  }

  return { issues, evidence };
}

// GPU 부하 테스트도 렌더러에서 따로 실행하고 결과만 기록한다(gpuStressChecks.js).
// 진단 화면의 gpuTrend는 "마침 부하가 걸려 있을 때 관찰한 것"이고, 이쪽은 우리가 부하를 직접
// 걸어서 본 값이라 근거로서의 성격이 다르다 — 그래서 별도 이슈로 서술한다.
function gpuStressFindings(stressCheck) {
  const issues = [];
  const evidence = [];
  if (!stressCheck) return { issues, evidence };

  const when = new Date(stressCheck.checkedAt).toLocaleDateString('ko-KR');
  const clockLine = stressCheck.highLoadStartClockMHz !== null && stressCheck.highLoadEndClockMHz !== null
    ? `${Math.round(stressCheck.highLoadStartClockMHz)}MHz → ${Math.round(stressCheck.highLoadEndClockMHz)}MHz`
    : null;
  const tempLine = stressCheck.highLoadStartTempC !== null && stressCheck.highLoadEndTempC !== null
    ? `${Math.round(stressCheck.highLoadStartTempC)}°C → ${Math.round(stressCheck.highLoadEndTempC)}°C`
    : null;

  if (stressCheck.throttleSuspected) {
    issues.push(mkIssue('warning', '부하 테스트에서 GPU 열 스로틀링이 확인되었습니다',
      `${when}에 실행한 GPU 부하 테스트의 최고 부하 구간에서 온도는 상승(${tempLine || '측정값 없음'})하고 클럭은 하락(${clockLine || '측정값 없음'})했습니다. 부하를 직접 걸어 만든 조건에서 관측된 값이라, 우연히 부하가 걸린 순간을 본 것보다 재현성이 높습니다.`,
      ['냉각 성능 부족(팬 회전 불량, 방열판 먼지)', '케이스 내부 공기 흐름 부족', '서멀 패드/그리스 노후'],
      ['GPU 팬이 부하 시 실제로 도는지 육안 확인', '케이스 흡기/배기 팬 점검', '방열판 먼지 제거 후 같은 부하 테스트 재실행'],
      80, [
        `최고 온도 ${stressCheck.maxTempC !== null ? Math.round(stressCheck.maxTempC) + '°C' : '측정 불가'}`,
        ...(tempLine ? [`최고 부하 구간 온도 ${tempLine}`] : []),
        ...(clockLine ? [`최고 부하 구간 클럭 ${clockLine}`] : []),
      ],
      '먼지 제거나 팬 설정 변경 후 "안정성 테스트 > GPU 부하 테스트"를 다시 실행해 같은 구간에서 클럭이 유지되는지 비교하세요.'));
  }

  if (stressCheck.abortReason === 'safety-temp') {
    issues.push(mkIssue('warning', 'GPU 부하 테스트가 안전 한계 온도에서 자동 중단되었습니다',
      `${when} 테스트 중 GPU 온도가 안전 한계(${stressCheck.safetyTempC !== null ? Math.round(stressCheck.safetyTempC) : 90}°C)에 도달해 테스트를 자동으로 멈췄습니다. 다만 이 테스트는 실제 게임보다 인위적으로 강한 부하를 걸기 때문에, 이 온도가 일상 사용에서도 그대로 나온다는 뜻은 아닙니다.`,
      ['냉각 성능 부족', '실내 온도가 높은 환경', '해당 GPU 모델의 원래 높은 동작 온도'],
      ['같은 테스트를 케이스 개방 상태에서 실행해 온도 차이를 비교', '팬 커브 설정 확인', '실제 사용하는 게임에서 실시간 모니터링으로 온도 확인'],
      70, [`부하 테스트 중 최고 온도 ${stressCheck.maxTempC !== null ? Math.round(stressCheck.maxTempC) + '°C' : '측정 불가'}`, '안전 한계 도달로 자동 중단'],
      '실제로 사용하는 게임을 실행한 상태에서 실시간 모니터링으로 온도를 확인해, 부하 테스트만큼 올라가는지 비교하세요.'));
  }

  if (stressCheck.verdict === 'pass') {
    // "부하 테스트를 통과했다"는 말은 실제로 부하가 걸렸을 때만 의미가 있다. 그래서 실제로
    // 관측된 최고 사용률을 근거에 함께 적는다(테스트가 얼마나 밀어붙였는지 독자가 판단하도록).
    evidence.push(`GPU 부하 테스트: 최고 부하까지 완주, 스로틀링 근거 없음 — ${stressCheck.maxLoadPercent !== null ? `실제 최고 사용률 ${Math.round(stressCheck.maxLoadPercent)}%, ` : ''}최고 온도 ${stressCheck.maxTempC !== null ? Math.round(stressCheck.maxTempC) + '°C' : '측정 불가'}${clockLine ? `, 최고 부하 구간 클럭 ${clockLine}` : ''} (${when})`);
  } else if (stressCheck.verdict === 'inconclusive') {
    const reason = stressCheck.abortReason === 'user' ? '사용자가 중간에 중단함'
      : stressCheck.maxTempC === null ? 'GPU 센서 값을 읽지 못해 온도·클럭을 확인할 수 없었음'
        : stressCheck.maxLoadPercent !== null && stressCheck.maxLoadPercent < 50
          ? `GPU 사용률이 ${Math.round(stressCheck.maxLoadPercent)}%까지밖에 올라가지 않아 부하가 제대로 걸렸다고 볼 수 없음(테스트 중 창이 가려졌을 가능성)`
          : '테스트를 끝까지 완료하지 못함';
    evidence.push(`GPU 부하 테스트: 판단 보류 — ${reason} (${when})`);
  }

  return { issues, evidence };
}

function evaluateGpu(gpu, trend, checks = {}) {
  const vram = vramCheckFindings(checks.vramCheck);
  const stress = gpuStressFindings(checks.gpuStressCheck);
  const base = baselineFindings(checks.baselineComparison, 'GPU');
  const issues = [...vram.issues, ...stress.issues, ...base.issues];
  if (!gpu.supported) {
    const models = (gpu.controllers || []).map((c) => c.model).filter(Boolean).join(', ');
    return finalize('GPU', issues, 'NVIDIA GPU가 아니거나 nvidia-smi를 찾을 수 없어 실시간 로드/온도 진단은 건너뛰었습니다. (VRAM·모델 정보만 표시)',
      [...(models ? [`인식된 GPU: ${models}`] : []), ...vram.evidence, ...stress.evidence, ...base.evidence]);
  }
  const nv = gpu.nvidia;
  if (nv.tempC >= 90) {
    issues.push(mkIssue('critical', 'GPU 온도가 위험 수준입니다',
      `현재 GPU 온도가 ${nv.tempC}°C입니다.`,
      ['쿨러/팬 고장', '방열판 먼지 누적', '케이스 내부 열 정체'],
      ['GPU 팬 회전 여부 육안 확인', '케이스 개방 후 온도 변화 확인', '먼지 제거'],
      92, [`온도 ${nv.tempC}°C (위험 임계값 90°C 이상)`],
      '먼지 제거 후 같은 게임/작업을 실행하며 GPU 온도가 90°C 아래로 유지되는지 확인하세요.'));
  } else if (nv.tempC >= 80 && nv.loadPercent >= 80) {
    issues.push(mkIssue('watch', 'GPU 온도가 다소 높은 편입니다',
      `부하 ${nv.loadPercent}% 상태에서 온도가 ${nv.tempC}°C입니다. 이 GPU 모델의 정상 범위일 수도 있어 즉각적인 문제로 보기는 이릅니다.`,
      ['일반적인 고부하 작업 중일 가능성', '냉각 여유가 점점 줄어들고 있을 가능성'],
      ['특별한 조치 없이 지켜봐도 되지만, 계속 상승하면 케이스 airflow를 점검하세요'],
      42, [`부하 ${nv.loadPercent}%`, `온도 ${nv.tempC}°C`, '위험 임계값(90°C) 미만 — 판단 보류'],
      '같은 게임을 30분 이상 플레이한 뒤 다시 진단해 온도가 90°C에 근접하는지 확인하세요.'));
  }
  if (trend && trend.length >= 3) {
    const first = trend[0];
    const last = trend[trend.length - 1];
    const loadHigh = trend.every((t) => t.loadPercent >= 90);
    const tempRising = last.tempC - first.tempC >= 3;
    const clockDropping = first.clockMHz - last.clockMHz >= 100;
    if (loadHigh && tempRising && clockDropping) {
      issues.push(mkIssue('warning', 'GPU 열 스로틀링이 의심됩니다',
        `GPU 사용률이 계속 90% 이상인 상태에서 온도는 ${first.tempC}°C → ${last.tempC}°C로 상승했고, 클럭은 ${first.clockMHz}MHz → ${last.clockMHz}MHz로 감소했습니다.`,
        ['냉각 성능 부족으로 인한 열 제한(throttling)', '고온 환경에서의 장시간 고부하 작업'],
        ['케이스 airflow(흡기/배기) 확인', 'GPU 팬 커브 설정 확인', '방열판 먼지 제거 후 재검사'],
        91, ['GPU 고부하 지속 확인됨', '온도 상승 추세 확인됨', '클럭 하락 추세 확인됨', '성능 저하 가능성'],
        '같은 게임을 다시 실행하면서 전체 진단을 돌려 온도·클럭 추이가 개선되었는지 비교하세요.'));
    } else if (loadHigh && tempRising && !clockDropping) {
      issues.push(mkIssue('watch', 'GPU 온도가 상승 중이지만 스로틀링 근거는 아직 부족합니다',
        `온도는 ${first.tempC}°C → ${last.tempC}°C로 상승했지만, 클럭은 ${first.clockMHz}MHz → ${last.clockMHz}MHz로 유지되고 있어 성능 제한의 뚜렷한 증거는 없습니다.`,
        ['정상적인 고부하 반응(아직 스로틀링 아님)', '온도가 더 상승하면 스로틀링으로 이어질 가능성'],
        ['지금 당장 조치할 필요는 없지만, 더 긴 게임 세션에서 온도 추이를 지켜보세요'],
        45, ['온도 상승 확인됨', '클럭 하락은 확인되지 않음 — 스로틀링 판정 보류'],
        '같은 게임을 더 오래 플레이한 뒤 전체 진단을 다시 실행해 클럭이 그때도 유지되는지 확인하세요.'));
    }
  }
  if (nv.vramUsedMB / nv.vramTotalMB > 0.95) {
    issues.push(mkIssue('warning', 'VRAM 사용량이 한계에 가깝습니다',
      `VRAM ${nv.vramTotalMB}MB 중 ${nv.vramUsedMB}MB 사용 중입니다.`,
      ['그래픽 설정이 VRAM 용량 대비 과도하게 높음', '다수 GPU 가속 프로그램 동시 실행'],
      ['게임/작업 그래픽 옵션(텍스처 품질 등) 낮추기', '불필요한 GPU 가속 프로그램 종료'],
      72, [`VRAM 사용률 ${Math.round((nv.vramUsedMB / nv.vramTotalMB) * 100)}%`],
      '그래픽 옵션을 낮춘 뒤 같은 장면에서 VRAM 사용률을 다시 확인하세요.'));
  }
  const normalEvidence = [`온도 ${nv.tempC}°C`, `부하 ${nv.loadPercent}%`, `클럭 ${nv.clockMHz}MHz`, `VRAM ${nv.vramUsedMB}/${nv.vramTotalMB}MB`, ...vram.evidence, ...stress.evidence, ...base.evidence];
  return finalize('GPU', issues, null, normalEvidence);
}

// ---------- 기준선(평소 상태) 대비 변화 → 진단 ----------
// 판정(어느 정도 차이를 watch/warning으로 볼지)은 baseline.js의 compareToBaseline이 이미
// 끝냈다. 여기서는 그 결과를 사람이 읽을 문장으로 옮기기만 한다 — 임계값을 여기서 다시
// 구현하면 두 곳이 어긋난다(VRAM·GPU 부하 검사와 같은 원칙).
//
// 이 진단이 특히 조심해야 하는 것: 온도 차이의 원인이 하드웨어가 아닐 수 있다는 점이다.
// 실내 온도(계절), 직전 작업의 잔열이 모두 같은 모양의 신호를 만든다. 그래서 원인 후보의
// 맨 앞에 그것들을 적고, confidence를 60 이상으로 올리지 않는다.
function baselineFindings(comparison, section) {
  const issues = [];
  const evidence = [];
  if (!comparison) return { issues, evidence };

  if (!comparison.available) {
    // 기준선이 없거나 쓸 수 없는 상태. CPU 섹션에서 한 번만 알린다(세 섹션에서 반복하면 시끄럽다).
    if (section === 'CPU') {
      if (comparison.reason === 'hardware-changed') {
        evidence.push(`기준선은 다른 CPU(${comparison.changedFrom})에서 측정된 것이라 비교하지 않았습니다`);
      } else if (comparison.reason === 'no-baseline') {
        evidence.push('평소 상태 기준선이 아직 없어 "평소 대비" 비교는 하지 않았습니다');
      }
    }
    return { issues, evidence };
  }

  const ageText = comparison.ageDays === 0 ? '오늘' : `${comparison.ageDays}일 전`;
  const deltas = deltasForSection(comparison, section);

  deltas.forEach((d) => {
    if (d.skipped === 'not-idle') {
      // 부하 중에는 유휴 기준선과 비교할 수 없다. 정상이라고도, 이상이라고도 하지 않는다.
      const gateLabel = d.section === 'GPU' ? `GPU 부하 ${IDLE_GPU_LOAD_MAX}%` : `CPU 부하 ${IDLE_CPU_LOAD_MAX}%`;
      evidence.push(`${d.label}: 지금은 부하가 걸린 상태(${gateLabel} 초과)라 평소(유휴) 기준선과 비교하지 않았습니다`);
      return;
    }
    if (d.skipped === 'gpu-changed') {
      evidence.push(`${d.label}: 기준선 측정 이후 GPU가 바뀌어 비교하지 않았습니다`);
      return;
    }

    const sign = d.diff > 0 ? '+' : '';
    const line = `${d.label} ${d.currentVal}${d.unit} (평소 ${d.baselineVal}${d.unit}, ${sign}${d.diff}${d.unit} · 기준선 ${ageText})`;

    if (d.level === 'normal') {
      evidence.push(line);
      return;
    }

    const isTemp = d.unit === '°C';
    const confidence = d.level === 'warning' ? (comparison.stale ? 45 : 60) : 40;
    const ev = [
      `기준선 ${d.baselineVal}${d.unit} (${ageText} 측정, 샘플 ${comparison.sampleCount ?? '?'}개)`,
      `현재 ${d.currentVal}${d.unit}`,
      `차이 ${sign}${d.diff}${d.unit}`,
      '유휴 상태끼리 비교한 값입니다',
    ];
    if (comparison.stale) ev.push(`기준선이 ${comparison.ageDays}일 전 값이라 그동안 실내 온도가 달라졌을 수 있습니다 — 판단 근거를 약하게 봅니다`);
    if (d.level === 'watch') ev.push('실내 온도 변화만으로도 설명될 수 있는 범위 — 단정하지 않고 지켜봅니다');

    if (isTemp) {
      issues.push(mkIssue(d.level, `${d.label}가 평소보다 높습니다`,
        `이 PC의 평소 ${d.label}는 ${d.baselineVal}${d.unit}였는데 지금은 ${d.currentVal}${d.unit}로 ${d.diff}${d.unit} 높습니다. 절대 온도로는 아직 위험 범위가 아니지만, 같은 PC의 평소와 달라졌다는 점이 냉각 성능 저하의 신호일 수 있습니다.`,
        [
          '기준선 측정 때보다 실내 온도가 높음(계절·냉방 여부)',
          '직전까지 고부하 작업을 해서 잔열이 남아 있음',
          '방열판·팬에 먼지가 쌓여 냉각 성능이 떨어짐',
          '서멀 그리스 열화 또는 쿨러 장착 상태 변화',
        ],
        [
          '몇 분간 아무 작업도 하지 않은 뒤 다시 진단해 잔열 영향을 배제하세요',
          '케이스를 열어 방열판·팬 먼지를 제거한 뒤 다시 진단하세요',
          '실내 온도가 기준선 측정 때와 크게 다르다면 기준선을 다시 측정하세요',
        ],
        confidence, ev,
        '먼지 제거 후 PC를 몇 분 유휴 상태로 둔 다음 전체 진단을 다시 실행해 평소 대비 차이가 줄었는지 확인하세요.'));
    } else {
      issues.push(mkIssue(d.level, `${d.label}이 평소보다 높습니다`,
        `이 PC의 평소 ${d.label}은 ${d.baselineVal}${d.unit}였는데 지금은 ${d.currentVal}${d.unit}입니다. 같은 유휴 상태인데도 ${d.diff}${d.unit} 더 쓰고 있습니다.`,
        ['시작 프로그램·백그라운드 상주 프로그램이 늘어남', '메모리를 반환하지 않는 프로그램이 실행 중', '기준선 측정 이후 설치한 프로그램의 상주 서비스'],
        ['작업 관리자 → 시작 프로그램에서 불필요한 항목 비활성화', '메모리 점유가 큰 상주 프로그램 확인 후 종료', '정리 후 기준선을 다시 측정해 새 평소 상태를 기록'],
        confidence, ev,
        '상주 프로그램을 정리하고 재부팅한 뒤 전체 진단을 다시 실행해 유휴 사용률이 기준선에 가까워졌는지 확인하세요.'));
    }
  });

  if (comparison.gpuNote && section === 'GPU') evidence.push(comparison.gpuNote);

  return { issues, evidence };
}

// ---------- 부하 테스트(정밀 검사) 결과 → 진단 ----------
// 정밀 검사를 돌렸으면 그 결과가 최종 판정에 반영되어야 한다. 리포트에 숫자만 찍히고
// 등급은 그대로인 상태가 가장 위험하다(검사에서 오류가 났는데 "정상"으로 보임).
//
// 반대로 "느리다"만으로 고장이라고 하지도 않는다. 저장장치 속도는 HDD/SATA SSD/NVMe에 따라
// 수십 배 차이가 나서 절대 임계값으로 판정할 수 없다 — I/O 실패나 되읽기 불일치처럼
// 장치 종류와 무관하게 이상인 것만 이슈로 올린다.

function cpuStressFindings(cpuStress) {
  const issues = [];
  const evidence = [];
  if (!cpuStress) return { issues, evidence };

  if (cpuStress.abortKind === 'worker-error' || cpuStress.workerError) {
    issues.push(mkIssue('watch', 'CPU 부하 테스트를 정상적으로 실행하지 못했습니다',
      `부하를 거는 작업 스레드에서 오류가 발생해 테스트가 완료되지 않았습니다(${cpuStress.workerError || '원인 미상'}). 이 결과로는 CPU 안정성을 판단할 수 없습니다.`,
      ['일시적인 시스템 자원 부족', '보안 프로그램의 스레드 생성 차단'],
      ['다른 프로그램을 종료한 뒤 다시 실행해보세요'],
      null, ['부하 테스트 실행 실패 — 판단 보류'],
      '"안정성 테스트 > CPU 부하 테스트"를 다시 실행해보세요.'));
    return { issues, evidence };
  }

  if (cpuStress.abortKind === 'safety-temp') {
    issues.push(mkIssue('warning', 'CPU 부하 테스트가 안전 한계 온도에서 자동 중단되었습니다',
      `부하 테스트 중 CPU 온도가 안전 한계(${cpuStress.safetyTempC}°C)에 도달해 자동으로 멈췄습니다. 다만 이 테스트는 모든 코어를 동시에 최대로 태우는 인위적인 부하라, 일상 사용에서도 같은 온도가 나온다는 뜻은 아닙니다.`,
      ['쿨러 장착 불량 또는 서멀 그리스 노후', '쿨러 성능 대비 과도한 CPU 설정(오버클럭/전력 제한 해제)', '케이스 내부 공기 흐름 부족'],
      ['쿨러가 제대로 밀착되어 있는지 확인', '방열판/팬 먼지 제거', '실제 사용하는 작업에서 실시간 모니터링으로 온도 확인'],
      75, [`부하 테스트 중 최고 온도 ${cpuStress.maxTempC}°C`, `안전 한계 ${cpuStress.safetyTempC}°C 도달로 자동 중단`],
      '먼지 제거 후 같은 부하 테스트를 다시 실행해 최고 온도가 내려갔는지 비교하세요.'));
  } else if (cpuStress.clockDroppedUnderLoad && cpuStress.maxTempC !== null && cpuStress.maxTempC >= 80) {
    // 클럭 하락만으로는 스로틀링이라고 못 한다(전력 관리 정책일 수도 있다).
    // 온도까지 높을 때만 열 문제로 본다.
    issues.push(mkIssue('watch', '부하 테스트 중 CPU 클럭이 떨어졌습니다',
      `부하 테스트 동안 CPU 클럭이 ${cpuStress.maxClockGHz}GHz → ${cpuStress.minClockGHz}GHz로 변동했고, 최고 온도는 ${cpuStress.maxTempC}°C였습니다. 열 제한일 수도 있고 정상적인 전력 관리 동작일 수도 있어 단정하지 않습니다.`,
      ['열 제한(thermal throttling)', '메인보드 전력 제한 설정', '정상적인 터보 부스트 동작'],
      ['먼지 제거 후 재검사해 클럭 변동 폭이 줄어드는지 확인'],
      45, [`클럭 ${cpuStress.maxClockGHz}GHz → ${cpuStress.minClockGHz}GHz`, `최고 온도 ${cpuStress.maxTempC}°C`],
      '냉각을 개선한 뒤 같은 테스트를 반복해 클럭 유지 여부를 비교하세요.'));
  }

  // 센서를 못 읽었으면 "온도 안전장치가 동작했다"고 말하면 안 된다.
  if (cpuStress.tempSensorAvailable === false) {
    evidence.push(`CPU 부하 테스트: 온도 센서를 읽을 수 없어 온도 기반 자동 중단 없이, 시간 제한(${cpuStress.effectiveDurationSec ?? cpuStress.durationSec}초) 안전 모드로만 실행했습니다`);
  }
  if (cpuStress.completed && cpuStress.loadAchieved === false) {
    evidence.push(`CPU 부하 테스트: 부하가 ${cpuStress.maxLoadPercent}%까지밖에 올라가지 않아 충분히 밀어붙였다고 보기 어렵습니다`);
  }
  if (cpuStress.completed) {
    evidence.push(`CPU 부하 테스트 ${cpuStress.durationSec}초 완주(${cpuStress.coreCount}코어)${cpuStress.maxTempC !== null ? `, 최고 온도 ${cpuStress.maxTempC}°C` : ''}`);
  } else if (cpuStress.abortKind === 'user') {
    evidence.push('CPU 부하 테스트: 사용자가 중단해 완주하지 못했습니다(판단 보류)');
  }

  return { issues, evidence };
}

function ramTestFindings(ramTest) {
  const issues = [];
  const evidence = [];
  if (!ramTest) return { issues, evidence };

  if (ramTest.errors > 0) {
    // 메모리 검사에서 실제 불일치가 나온 건 가장 강한 신호 중 하나다. 다만 이 검사는
    // OS가 할당해준 가상 메모리 영역만 보므로 "어느 모듈이 불량"까지는 알 수 없다.
    issues.push(mkIssue('critical', `RAM 무결성 검사에서 ${ramTest.errors.toLocaleString()}건의 불일치가 발견되었습니다`,
      `${ramTest.sizeMB}MB 버퍼에 패턴을 쓰고 다시 읽었을 때 값이 달라진 곳이 있습니다${ramTest.firstErrorOffset !== null ? ` (첫 발생 위치: ${ramTest.firstErrorOffset.toLocaleString()}바이트 지점)` : ''}. 소프트웨어 자가점검에서 이 결과가 나오는 것은 정상이 아닙니다.`,
      ['메모리 모듈 불량', '메모리 오버클럭(XMP/EXPO)이 불안정함', '메모리 슬롯/접촉 불량', 'CPU 메모리 컨트롤러 이상'],
      ['중요 데이터를 먼저 백업하세요', '메모리 오버클럭(XMP/EXPO)을 껐다가 다시 검사', 'RAM을 한 개씩만 꽂아 어느 모듈에서 재현되는지 확인', 'MemTest86 등 부팅형 정밀 검사로 교차 확인'],
      88, [`불일치 ${ramTest.errors.toLocaleString()}건`, `검사 크기 ${ramTest.sizeMB}MB`, `검사한 패턴 ${ramTest.patternsRun}종`],
      'MemTest86 같은 부팅형 도구로 최소 1회 전체 검사를 돌려 같은 결과가 나오는지 반드시 교차 확인하세요.'));
  } else if (!ramTest.completed) {
    issues.push(mkIssue('watch', 'RAM 무결성 검사를 완료하지 못했습니다',
      `검사가 끝까지 진행되지 않았습니다(${ramTest.error || '원인 미상'}). 이 결과로는 메모리 상태를 판단할 수 없습니다.`,
      ['검사용 메모리를 확보하지 못함(사용 가능한 RAM 부족)', '검사 중 오류 발생'],
      ['다른 프로그램을 종료한 뒤 더 작은 크기로 다시 검사'],
      null, ['RAM 검사 미완료 — 판단 보류'],
      '실행 중인 프로그램을 정리한 뒤 다시 검사해보세요.'));
  } else {
    evidence.push(`RAM 무결성 간이검사: ${ramTest.sizeMB}MB / 패턴 ${ramTest.patternsRun}종 이상 없음 (부팅형 정밀 검사를 대체하지 않음)`);
  }

  return { issues, evidence };
}

function storageTestFindings(storageTest) {
  const issues = [];
  const evidence = [];
  if (!storageTest) return { issues, evidence };

  if (storageTest.verifyMismatch) {
    issues.push(mkIssue('critical', '저장장치 검사에서 쓴 데이터와 읽은 데이터가 달랐습니다',
      '임시 파일에 쓴 내용을 다시 읽었을 때 값이 일치하지 않았습니다. 속도 문제와는 전혀 다른, 데이터 손상 신호입니다.',
      ['저장장치 불량 또는 수명 말기', '케이블/컨트롤러 접촉 불량', '파일시스템 손상'],
      ['중요 데이터를 즉시 백업하세요', 'SMART 상태를 함께 확인', 'SATA 케이블 교체 또는 다른 포트에 연결해 재검사', 'chkdsk로 파일시스템 점검'],
      90, ['쓰기/읽기 데이터 불일치 확인됨'],
      '백업 후 같은 검사를 다시 실행하고, 제조사 진단 도구로도 교차 확인하세요.'));
  } else if (storageTest.errorStage === 'precheck') {
    issues.push(mkIssue('watch', '저장장치 처리량 테스트를 실행하지 못했습니다',
      `${storageTest.error}. 검사를 건너뛰었으므로 저장장치 성능은 확인되지 않았습니다.`,
      ['임시 폴더가 있는 드라이브의 여유 공간 부족'],
      ['불필요한 파일을 정리한 뒤 다시 검사하세요'],
      null, ['검사 미실행 — 판단 보류'],
      '여유 공간을 확보한 뒤 다시 검사해보세요.'));
  } else if (storageTest.error || storageTest.ioErrors > 0) {
    issues.push(mkIssue('warning', '저장장치 읽기/쓰기 중 오류가 발생했습니다',
      `테스트 파일을 쓰거나 읽는 과정에서 오류가 났습니다(${storageTest.errorStage || '단계 미상'}: ${storageTest.error || '원인 미상'}). 처리량이 느린 것과는 다른 문제입니다.`,
      ['저장장치 이상', '드라이브 여유 공간 부족', '권한 문제 또는 보안 프로그램 차단', '파일시스템 오류'],
      ['SMART 상태 확인', '여유 공간 확보 후 재검사', 'chkdsk로 파일시스템 점검'],
      70, [`오류 단계: ${storageTest.errorStage || '미상'}`, `메시지: ${storageTest.error || '없음'}`],
      '여유 공간을 확보하고 보안 프로그램을 잠시 끈 뒤 다시 검사해보세요.'));
  } else if (storageTest.completed) {
    // 속도는 장치 종류에 따라 수십 배 차이 나므로 임계값으로 판정하지 않고 측정값만 남긴다.
    evidence.push(`저장장치 처리량 테스트: 쓰기 ${storageTest.writeMBps}MB/s, 읽기 ${storageTest.readMBps}MB/s (${storageTest.sizeMB}MB 순차 I/O, 장치 종류에 따라 정상 범위가 크게 다르므로 속도만으로는 판정하지 않음)`);
  }

  return { issues, evidence };
}

// ---------- SMART 속성 판정 ----------
// 전체 판정(-H)의 PASSED/FAILED는 디스크가 거의 죽어야 FAILED로 바뀐다. 실제로 "곧 죽을
// 디스크"를 알아보는 근거는 개별 속성값이다. 여기서 그걸 본다.
//
// 임계값 선택 근거: 저장장치 수명 연구에서 반복적으로 실패 예측력이 확인된 항목은
// 재할당 섹터(5), 대기 중 섹터(197), 정정 불가(198), 보고된 정정 불가(187)이다.
// 그중에서도 **대기 중 섹터(197)는 "읽기에 실패해서 재할당을 기다리는 중"이라 가장 강한
// 조기 신호**다. 반면 CRC 오류(199)는 디스크가 아니라 대개 케이블/연결 문제라서, 같은
// 심각도로 다루면 멀쩡한 디스크를 교체하게 만든다 — 따로 구분한다.
function smartAttributeFindings(smartEntry) {
  const issues = [];
  const evidence = [];
  const a = smartEntry && smartEntry.attributes;
  if (!a) return { issues, evidence };

  const dev = smartEntry.device;
  const model = (smartEntry.identity && smartEntry.identity.model) || dev;
  const label = `${model}`;
  const has = (v) => v !== null && v !== undefined;

  // --- 이미 데이터 손실이 발생했거나 임박한 신호 ---
  if (has(a.pendingSectors) && a.pendingSectors > 0) {
    const severe = a.pendingSectors >= 10;
    issues.push(mkIssue(severe ? 'critical' : 'warning', `${label}: 읽기에 실패한 섹터가 ${a.pendingSectors}개 있습니다 (대기 중 섹터)`,
      `SMART 전체 판정은 아직 정상(PASSED)이지만, 읽기에 실패해 재할당을 기다리는 섹터가 ${a.pendingSectors}개 있습니다. 이 값은 디스크가 완전히 고장나기 전에 먼저 올라가는 신호로 알려져 있어, 전체 판정보다 빨리 문제를 알려줍니다.`,
      ['디스크 표면/셀 열화', '읽기 중 전원 불안정', '케이블 접촉 불량으로 인한 읽기 실패'],
      ['지금 바로 중요 데이터를 백업하세요', '백업 후 전체 표면 검사(chkdsk /r 또는 제조사 도구) 실행', '값이 계속 늘어나면 디스크 교체'],
      severe ? 90 : 78, [`대기 중 섹터(Current_Pending_Sector) ${a.pendingSectors}개`, `SMART 전체 판정: ${smartEntry.status === 'passed' ? 'PASSED (하지만 속성에 이상 신호)' : smartEntry.status}`],
      '백업 후 표면 검사를 돌리고, 며칠 뒤 다시 진단해 대기 중 섹터가 늘어나는지 비교하세요. 늘어나면 교체가 필요합니다.'));
  }
  if (has(a.uncorrectableSectors) && a.uncorrectableSectors > 0) {
    issues.push(mkIssue('critical', `${label}: 정정할 수 없는 섹터가 ${a.uncorrectableSectors}개 있습니다`,
      `오프라인 검사에서도 정정하지 못한 섹터입니다. 해당 위치의 데이터는 이미 손상되었을 수 있습니다.`,
      ['디스크 물리적 손상', '수명 말기'],
      ['중요 데이터를 즉시 백업하세요', '디스크 교체를 준비하세요'],
      92, [`정정 불가 섹터(Offline_Uncorrectable) ${a.uncorrectableSectors}개`],
      '백업을 마친 뒤 제조사 진단 도구로 교차 확인하세요.'));
  }
  if (has(a.reallocatedSectors) && a.reallocatedSectors > 0) {
    // 재할당은 "이미 처리된" 불량이라 소량은 흔하다. 많을 때만 경고로 올린다.
    const many = a.reallocatedSectors >= 50;
    issues.push(mkIssue(many ? 'warning' : 'watch', `${label}: 재할당된 섹터가 ${a.reallocatedSectors}개 있습니다`,
      `불량으로 판정되어 예비 영역으로 옮겨진 섹터입니다. ${many ? '개수가 적지 않아 열화가 진행 중일 가능성이 있습니다.' : '소수의 재할당은 사용 중인 디스크에서 드물지 않으며, 그 자체로 고장을 뜻하지는 않습니다. 다만 개수가 늘어나는지가 중요합니다.'}`,
      ['디스크 표면 열화(사용에 따른 자연스러운 진행 포함)'],
      ['중요 데이터 백업 상태를 점검하세요', '몇 주 간격으로 다시 진단해 개수가 늘어나는지 확인하세요'],
      many ? 72 : 40, [`재할당 섹터(Reallocated_Sector_Ct) ${a.reallocatedSectors}개`],
      '몇 주 뒤 다시 진단해 재할당 섹터 수가 증가했는지 비교하세요. 증가 추세가 교체 판단의 핵심 근거입니다.'));
  }
  if (has(a.reportedUncorrect) && a.reportedUncorrect > 0) {
    issues.push(mkIssue('warning', `${label}: 정정 불가 오류가 ${a.reportedUncorrect}건 보고되었습니다`,
      '디스크가 스스로 정정하지 못한 오류를 보고한 횟수입니다. 실패 예측력이 높은 항목으로 알려져 있습니다.',
      ['디스크 열화', '컨트롤러/펌웨어 문제'],
      ['중요 데이터 백업', '값이 늘어나는지 추적'],
      70, [`Reported_Uncorrect ${a.reportedUncorrect}건`],
      '며칠 뒤 다시 진단해 값이 증가하는지 확인하세요.'));
  }

  // --- 전송 계층(케이블) 문제: 디스크 자체와 구분해야 한다 ---
  if (has(a.crcErrors) && a.crcErrors > 0) {
    issues.push(mkIssue('watch', `${label}: 데이터 전송 오류(CRC)가 ${a.crcErrors}건 있습니다`,
      `디스크와 메인보드 사이 전송 과정에서 발생한 오류입니다. **디스크 자체보다 케이블/연결 문제인 경우가 많습니다.** 누적값이라 과거에 한 번 발생한 뒤 그대로 남아 있을 수도 있습니다.`,
      ['SATA 케이블 불량/헐거움', '전원 케이블 접촉 불량', '메인보드 포트 문제'],
      ['SATA 케이블을 다른 것으로 교체하고 다른 포트에 연결해보세요(가장 흔한 해결책)', '교체 후 값이 더 늘지 않으면 케이블 문제였던 것입니다'],
      45, [`UDMA_CRC_Error_Count ${a.crcErrors}건`, '이 항목은 디스크 수명이 아니라 연결 상태를 가리킵니다'],
      '케이블 교체 후 며칠 사용하고 다시 진단해, 값이 더 늘지 않는지 확인하세요.'));
  }

  // --- SSD 수명 ---
  if (has(a.availableSparePercent) && has(a.availableSpareThreshold) && a.availableSparePercent <= a.availableSpareThreshold) {
    issues.push(mkIssue('critical', `${label}: 예비 영역이 임계값 아래로 떨어졌습니다`,
      `사용 가능한 예비 블록이 ${a.availableSparePercent}%로, 제조사 임계값(${a.availableSpareThreshold}%) 이하입니다. SSD가 수명 말기에 도달했다는 신호입니다.`,
      ['SSD 쓰기 수명 소진', '불량 블록 누적'],
      ['중요 데이터를 즉시 백업하세요', 'SSD 교체를 준비하세요'],
      93, [`Available Spare ${a.availableSparePercent}% (임계값 ${a.availableSpareThreshold}%)`],
      '백업 후 제조사 도구로 교차 확인하고 교체를 진행하세요.'));
  }
  if (has(a.wearPercentUsed) && a.wearPercentUsed >= 90) {
    const over = a.wearPercentUsed >= 100;
    issues.push(mkIssue(over ? 'warning' : 'watch', `${label}: 쓰기 수명을 ${a.wearPercentUsed}% 사용했습니다`,
      over
        ? '제조사가 보증하는 쓰기 수명을 모두 사용했습니다. 즉시 고장난다는 뜻은 아니지만, 보증 사양을 넘어선 구간이라 백업 주기를 짧게 가져가는 것이 좋습니다.'
        : '제조사 보증 쓰기 수명에 근접했습니다. 아직 정상 동작 범위지만 지켜볼 필요가 있습니다.',
      ['누적 쓰기량이 많음(정상적인 사용에 따른 소모)'],
      ['중요 데이터 백업 주기를 짧게 유지하세요', over ? '교체 계획을 세우는 것을 권장합니다' : '수명 수치를 주기적으로 확인하세요'],
      over ? 68 : 38, [`Percentage Used ${a.wearPercentUsed}%`, ...(has(a.totalHostWritesTB) ? [`누적 쓰기 ${a.totalHostWritesTB}TB`] : [])],
      '몇 달 간격으로 다시 진단해 수명 수치가 얼마나 빠르게 오르는지 확인하세요.'));
  }

  // --- NVMe 자체 경고 플래그 / 미디어 오류 ---
  if (has(a.criticalWarningValue) && a.criticalWarningValue !== 0) {
    issues.push(mkIssue('critical', `${label}: 드라이브가 critical warning 플래그를 보고했습니다 (${a.criticalWarning})`,
      'NVMe 드라이브가 스스로 위험 상태를 보고하고 있습니다(예비 영역 부족, 온도 초과, 신뢰성 저하, 읽기 전용 전환 등).',
      ['예비 영역 소진', '온도 임계 초과', '내부 신뢰성 저하'],
      ['중요 데이터를 즉시 백업하세요', '제조사 도구로 상세 상태를 확인하세요'],
      92, [`Critical Warning ${a.criticalWarning}`],
      '백업 후 제조사 진단 도구로 교차 확인하세요.'));
  }
  if (has(a.mediaErrors) && a.mediaErrors > 0) {
    issues.push(mkIssue('warning', `${label}: 미디어/데이터 무결성 오류가 ${a.mediaErrors}건 기록되었습니다`,
      '드라이브가 정정하지 못한 데이터 오류입니다. 누적값이며, 늘어나는 추세가 중요합니다.',
      ['NAND 셀 열화', '컨트롤러/펌웨어 문제'],
      ['중요 데이터 백업', '펌웨어 업데이트 확인', '값이 증가하는지 추적'],
      72, [`Media and Data Integrity Errors ${a.mediaErrors}건`],
      '며칠 뒤 다시 진단해 값이 늘어나는지 확인하세요.'));
  }

  // --- 제조사 기준 "지금 고장 중"인 속성 (ATA WHEN_FAILED 열) ---
  if (a.failingNow && a.failingNow.length) {
    issues.push(mkIssue('critical', `${label}: 제조사 기준 임계값 아래로 떨어진 속성이 있습니다`,
      `${a.failingNow.map((f) => f.name).join(', ')} 항목이 제조사가 정한 임계값 아래입니다. 이건 우리가 정한 기준이 아니라 디스크 제조사 자신의 기준입니다.`,
      ['해당 속성이 가리키는 부위의 열화'],
      ['중요 데이터를 즉시 백업하세요', '디스크 교체를 준비하세요'],
      94, a.failingNow.map((f) => `${f.name} (ID ${f.id}) — 임계값 이하`),
      '백업 후 제조사 진단 도구로 교차 확인하세요.'));
  }

  // --- 이슈가 아니어도 남겨야 하는 맥락 정보 ---
  // 중고 거래에서 "얼마나 쓴 디스크인가"는 구매자가 가장 알고 싶어하는 값이다.
  const ctx = [];
  if (has(a.powerOnHours)) {
    const years = (a.powerOnHours / 24 / 365).toFixed(1);
    ctx.push(`사용 시간 ${a.powerOnHours.toLocaleString()}시간(약 ${years}년치 가동)`);
  }
  if (has(a.powerCycles)) ctx.push(`전원 켠 횟수 ${a.powerCycles.toLocaleString()}회`);
  if (has(a.wearPercentUsed) && a.wearPercentUsed < 90) ctx.push(`쓰기 수명 사용률 ${a.wearPercentUsed}%`);
  if (has(a.totalHostWritesTB)) ctx.push(`누적 쓰기 ${a.totalHostWritesTB}TB`);
  if (has(a.temperatureC)) ctx.push(`현재 온도 ${a.temperatureC}°C`);
  if (has(a.unsafeShutdowns)) ctx.push(`비정상 전원 차단 ${a.unsafeShutdowns.toLocaleString()}회(절전 전환 포함일 수 있음)`);
  if (ctx.length) evidence.push(`${label} — ${ctx.join(' · ')}`);

  // 문제 신호가 하나도 없을 때만 "속성도 정상"이라고 말한다.
  if (!issues.length) {
    const checked = [];
    if (has(a.pendingSectors)) checked.push('대기 중 섹터 0');
    if (has(a.reallocatedSectors)) checked.push('재할당 섹터 0');
    if (has(a.mediaErrors)) checked.push('미디어 오류 0');
    if (has(a.availableSparePercent)) checked.push(`예비 영역 ${a.availableSparePercent}%`);
    if (checked.length) evidence.push(`${label} SMART 상세 속성: ${checked.join(', ')}`);
  }

  return { issues, evidence };
}

function evaluateStorage(storage, storageTest) {
  const st = storageTestFindings(storageTest);
  const issues = [...st.issues];
  const smartAttrEvidence = [];
  (storage.smart || []).forEach((s) => {
    const f = smartAttributeFindings(s);
    issues.push(...f.issues);
    smartAttrEvidence.push(...f.evidence);
  });
  storage.volumes.forEach((v) => {
    if (v.usePercent >= 90) {
      issues.push(mkIssue('warning', `${v.mount} 드라이브 여유 공간이 부족합니다`,
        `${v.sizeGB}GB 중 ${v.usedGB}GB(${v.usePercent}%) 사용 중입니다.`,
        ['불필요한 파일/캐시 누적', '용량 대비 과도한 설치 프로그램'],
        ['디스크 정리 도구 실행', '대용량 파일 백업 후 삭제'],
        80, [`사용률 ${v.usePercent}%`],
        '정리 후 전체 진단을 다시 실행해 사용률이 90% 아래로 내려갔는지 확인하세요.'));
    }
  });
  storage.smart.forEach((s) => {
    if (s.healthy === false) {
      issues.push(mkIssue('critical', `저장장치(${s.device}) SMART 상태 이상`,
        'SMART 자가진단에서 정상(PASSED)이 아닌 결과가 확인되었습니다. 데이터 손실 위험이 있습니다.',
        ['저장장치 물리적 노후/불량'],
        ['중요 데이터 즉시 백업', '저장장치 교체 검토'],
        97, ['SMART 자가진단 결과: FAILED'],
        '백업 후 제조사 진단 도구로 SMART 상태를 다시 한번 교차 확인하세요.'));
    } else if (s.healthy === null) {
      // smartctl은 응답했지만 PASSED/FAILED를 명확히 판별하지 못한 경우.
      // "정상"도 "이상"도 아니라는 걸 분명히 해서, 잘못된 안심/불안을 주지 않는다.
      // 원인 중 하나가 Windows의 관리자 권한 제약이라, code/device를 달아두면
      // 렌더러가 "관리자 권한으로 재검사" 버튼을 이 카드에만 붙일 수 있다.
      issues.push({
        ...mkIssue('watch', `저장장치(${s.device}) SMART 상태를 명확히 판별할 수 없습니다`,
          'smartctl이 응답했지만 결과에서 PASSED/FAILED를 확실히 읽어내지 못했습니다. 이 장치는 정상/이상 어느 쪽으로도 단정하지 않습니다. Windows에서는 관리자 권한이 없어 SMART를 못 읽는 경우가 흔합니다.',
          ['관리자 권한 없이는 열 수 없는 장치(가장 흔한 원인)', '일부 SSD/RAID 컨트롤러의 SMART 출력 형식 차이', 'USB-SATA 브릿지를 통한 연결로 SMART 패스스루 미지원'],
          ['관리자 권한으로 다시 검사해보세요', '그래도 안 되면 제조사 전용 SSD 관리 툴로 직접 확인하는 것을 권장합니다'],
          null, ['smartctl 실행 결과 판독 불가'],
          null),
        code: 'smart-unknown',
        device: s.device,
        smartType: s.type || null,
      });
    }
  });
  if (!storage.smartctlAvailable) {
    issues.push(mkIssue('watch', 'SMART 상태를 확인할 수 없습니다',
      'smartctl을 실행하지 못해 저장장치의 SMART 자가진단 결과를 읽지 못했습니다. 이건 저장장치에 문제가 있다는 뜻이 아니라, 검사 도구를 실행할 수 없었다는 뜻입니다.',
      ['앱에 동봉된 smartctl 실행 파일을 찾거나 실행하지 못함(설치 손상 가능성) 또는 지원하지 않는 OS'],
      ['앱을 재설치해 보세요. 계속되면 smartmontools(smartctl)를 직접 설치해도 확인할 수 있습니다'],
      null, ['smartctl 실행 실패'],
      null));
  }
  const normalEvidence = [...storage.volumes.map((v) => `${v.mount} ${v.usePercent}% 사용`), ...smartAttrEvidence, ...st.evidence];
  return finalize('STORAGE', issues, null, normalEvidence);
}

function evaluateNetwork(net) {
  const issues = [];
  const p = net.ping;
  if (p.avgMs !== null) {
    if (p.avgMs >= 100) {
      issues.push(mkIssue('warning', '네트워크 지연시간이 높습니다',
        `평균 핑이 ${p.avgMs}ms입니다. 온라인 게임이나 화상회의에서 지연이 체감될 수 있습니다.`,
        ['Wi-Fi 신호 약함', 'ISP 회선 혼잡', '공유기 성능/거리 문제'],
        ['유선 연결로 재측정', '공유기 재부팅', '다른 시간대에 재측정해 ISP 문제인지 확인'],
        70, [`평균 핑 ${p.avgMs}ms`],
        '유선으로 연결하거나 공유기 재부팅 후 인터넷 속도 테스트 탭에서 핑을 다시 측정하세요.'));
    }
    if (p.jitterMs !== null && p.jitterMs >= 15) {
      issues.push(mkIssue('warning', '네트워크 지터(변동폭)가 큽니다',
        `핑 변동폭이 ${p.jitterMs}ms로 불안정합니다. 끊김이나 랙이 간헐적으로 발생할 수 있습니다.`,
        ['Wi-Fi 간섭', '동시 대역폭 사용(다운로드/스트리밍)'],
        ['유선 연결 시도', '동시 사용 기기/다운로드 확인'],
        65, [`지터 ${p.jitterMs}ms`],
        '다른 기기의 다운로드/스트리밍을 멈춘 뒤 인터넷 속도 테스트를 다시 실행해 지터가 줄어드는지 확인하세요.'));
    }
  }
  if (p.lossPercent) {
    issues.push(mkIssue('critical', '패킷 손실이 발생하고 있습니다',
      `약 ${p.lossPercent}%의 패킷이 손실되고 있습니다.`,
      ['회선 불안정', '공유기/모뎀 이상', 'Wi-Fi 간섭'],
      ['공유기/모뎀 재부팅', '유선 연결 테스트', '지속 시 ISP 문의'],
      90, [`패킷 손실률 ${p.lossPercent}%`],
      '공유기 재부팅 후 몇 분 지나 다시 측정해 손실률이 0%로 돌아오는지 확인하세요.'));
  }
  const normalEvidence = p.avgMs !== null ? [`핑 ${p.avgMs}ms`, `지터 ${p.jitterMs}ms`, `손실 ${p.lossPercent ?? 0}%`] : [];
  return finalize('NETWORK', issues, null, normalEvidence);
}

function evaluateSystem(system) {
  const issues = [];
  if (system.driverErrors && system.driverErrors.length > 0) {
    const names = system.driverErrors.map((d) => d.FriendlyName).filter(Boolean).join(', ');
    issues.push(mkIssue('warning', '오류 상태의 장치 드라이버가 있습니다',
      `장치관리자 기준 오류 상태인 장치: ${names || system.driverErrors.length + '개'}`,
      ['드라이버 미설치/손상', '하드웨어 연결 불량'],
      ['장치관리자에서 드라이버 업데이트/재설치', '제조사 최신 드라이버 다운로드'],
      85, [`오류 장치 ${system.driverErrors.length}개 확인됨`],
      '드라이버 재설치 후 장치관리자에서 오류 아이콘이 사라졌는지 확인하세요.'));
  }
  const normalEvidence = [`오류 장치 0개`, `${system.distro || system.platform} 확인됨`];
  return finalize('DRIVERS', issues, null, normalEvidence);
}

function evaluateDisplay(displays, visualChecks) {
  const issues = [];
  displays.forEach((d) => {
    if (d.refreshRateHz && d.refreshRateHz < 60) {
      issues.push(mkIssue('warning', `${d.model} 주사율이 낮게 설정되어 있습니다`,
        `현재 ${d.refreshRateHz}Hz로 인식됩니다.`,
        ['디스플레이 설정에서 낮은 주사율로 고정됨', '케이블/포트가 고주사율을 지원하지 않음'],
        ['Windows 디스플레이 설정에서 주사율 확인 및 변경', 'DisplayPort/HDMI 케이블 규격 확인'],
        60, [`현재 주사율 ${d.refreshRateHz}Hz`],
        '설정 변경 후 winver 화면이나 디스플레이 설정에서 적용된 주사율을 다시 확인하세요.'));
    }
  });

  // 불량화소/잔상/균일도는 사람 눈으로만 판별 가능해서 소프트웨어가 자동으로 검사할 수 없다.
  // 그래서 "디스플레이 테스트" 화면에서 사용자가 직접 기록한 최근 결과를 근거로 반영한다.
  (visualChecks || []).forEach((c) => {
    if (c.verdict === 'issue') {
      issues.push(mkIssue('warning', `${c.label}에서 이상이 확인되었습니다`,
        `사용자가 ${new Date(c.checkedAt).toLocaleString('ko-KR')}에 화면을 직접 보고 이상을 발견했다고 기록했습니다.${c.note ? ` 메모: "${c.note}"` : ''}`,
        ['패널 자체의 물리적 결함', '케이블/포트 연결 상태 불량'],
        ['다른 밝기/각도에서 재확인', '가능하면 다른 케이블/포트로 연결해 재확인', '반복 확인되면 제조사 A/S 문의'],
        null, [`사용자 셀프체크: ${c.label} — 이상 발견`],
        `"디스플레이 테스트" 화면에서 ${c.label}을 다시 실행해 재확인해보세요.`));
    }
  });

  const normalEvidence = displays.map((d) => `${d.model} ${d.resolutionX}x${d.resolutionY}@${d.refreshRateHz || '?'}Hz`);
  (visualChecks || []).filter((c) => c.verdict === 'pass').forEach((c) => {
    normalEvidence.push(`${c.label}: 이상 없음(사용자 확인, ${new Date(c.checkedAt).toLocaleDateString('ko-KR')})`);
  });

  return finalize('DISPLAY', issues, null, normalEvidence);
}

function evaluateEventLogs(eventLog) {
  if (!eventLog || !eventLog.supported) {
    return finalize('EVENTS', [], 'Windows가 아닌 환경에서는 이벤트 로그를 확인하지 않습니다.', []);
  }
  if (eventLog.error) {
    const reason = eventLog.error === 'query_failed'
      ? '이벤트 로그 조회에 실패했습니다. 관리자 권한으로 실행하면 더 안정적으로 조회됩니다.'
      : '이벤트 로그 결과를 해석하지 못했습니다.';
    return finalize('EVENTS', [], reason, []);
  }

  const events = eventLog.events || [];
  const byCat = { whea: [], wheaCorrected: [], kernelPower: [], display: [], disk: [], ntfs: [], bugcheck: [], appError: [] };

  // ⚠ provider 이름만으로 분류하면 심각한 오탐이 난다. 실제 사용자 PC에서 확인된 사례:
  //    Kernel-Power provider에는 "비정상 종료"(ID 41)뿐 아니라 **정상적인 절전 진입(42),
  //    절전 복귀(107), 정상 종료 전환(109), 최신 대기모드 관련(131/172/187)** 이벤트가
  //    전부 들어온다. 그걸 다 세는 바람에 멀쩡한 PC가 "최근 7일 비정상 종료 19건"으로
  //    표시되고 등급까지 내려갔다. 반드시 이벤트 ID로 판별해야 한다.
  const KERNEL_POWER_UNEXPECTED = new Set([41]);      // 41: 정상 종료 절차 없이 재부팅됨
  const EVENTLOG_UNEXPECTED = new Set([6008]);        // 6008: 이전 시스템 종료가 예기치 않았음
  // WHEA는 "정정된 오류"(17/47 등)와 "정정 불가 오류"를 구분해야 한다. 정정된 오류는
  // 하드웨어가 스스로 복구한 것이라 흔하게 기록되며, 그것만으로 critical이라고 하면 과잉 경고다.
  const WHEA_UNCORRECTED = new Set([18, 19, 20, 23, 24, 25, 46]);
  const WHEA_CORRECTED = new Set([17, 47]);
  const DISK_ERROR = new Set([7, 9, 11, 15, 51, 52, 153]);   // 배드블록/컨트롤러/페이징 I/O 오류 등
  const NTFS_ERROR = new Set([55, 98, 130, 137, 140]);       // 파일시스템 손상/지연 쓰기 실패 등
  const DISPLAY_TDR = new Set([4101]);                        // 드라이버 응답 없음 후 복구

  const catOf = (provider, id) => {
    const p = (provider || '').toLowerCase();
    const n = Number(id);
    if (p.includes('whea')) {
      if (WHEA_UNCORRECTED.has(n)) return 'whea';
      if (WHEA_CORRECTED.has(n)) return 'wheaCorrected';
      return 'whea'; // 모르는 WHEA ID는 보수적으로 하드웨어 오류 쪽으로 본다
    }
    if (p.includes('kernel-power')) return KERNEL_POWER_UNEXPECTED.has(n) ? 'kernelPower' : null;
    if (p.includes('eventlog')) return EVENTLOG_UNEXPECTED.has(n) ? 'kernelPower' : null;
    if (p.includes('display')) return DISPLAY_TDR.has(n) ? 'display' : null;
    if (p === 'disk') return DISK_ERROR.has(n) ? 'disk' : null;
    if (p.includes('ntfs')) return NTFS_ERROR.has(n) ? 'ntfs' : null;
    if (p.includes('bugcheck')) return 'bugcheck';
    if (p.includes('application error')) return 'appError';
    return null;
  };
  events.forEach((e) => {
    const c = catOf(e.provider, e.id);
    if (c) byCat[c].push(e);
  });

  // 화면에 보여주는 events 목록은 개수 제한이 걸려 있어서, 그걸로 건수를 세면 실제보다
  // 적게 나온다. collectEventLogs가 따로 집계해준 provider별 전체 건수(counts)를 우선 쓴다.
  const counts = eventLog.counts || null;
  const totalByCat = { whea: 0, wheaCorrected: 0, kernelPower: 0, display: 0, disk: 0, ntfs: 0, bugcheck: 0, appError: 0 };
  // 판정 대상이 아닌 이벤트(정상 절전/복귀 등)가 몇 건이나 걸러졌는지도 세어둔다 —
  // "왜 이벤트가 많은데 아무 말도 없지?"라는 의문에 답할 수 있어야 한다.
  let ignoredCount = 0;
  if (counts) {
    counts.forEach((c) => {
      const cat = catOf(c.provider, c.id);
      if (cat) totalByCat[cat] += c.count;
      else ignoredCount += c.count;
    });
  } else {
    Object.keys(byCat).forEach((k) => { totalByCat[k] = byCat[k].length; });
  }
  const latestOf = (cat) => {
    if (byCat[cat].length) return byCat[cat][0].time;
    if (!counts) return null;
    const times = counts.filter((c) => catOf(c.provider, c.id) === cat).map((c) => c.latest).filter(Boolean).sort();
    return times.length ? times[times.length - 1] : null;
  };

  const issues = [];
  const days = eventLog.days || 7;

  // 전체 그림을 한 줄로 요약해서 각 이슈의 근거로 붙인다. 어떤 계통이 0건인지도 함께
  // 보여줘야 "무엇을 우선 확인해야 하는지"를 사용자가 판단할 수 있다.
  const breakdown = [
    `비정상 종료(Kernel-Power 41) ${totalByCat.kernelPower}건`,
    `하드웨어 오류(WHEA, 정정 불가) ${totalByCat.whea}건`,
    `블루스크린(BugCheck) ${totalByCat.bugcheck}건`,
    `그래픽 드라이버 복구(TDR) ${totalByCat.display}건`,
    `디스크/NTFS 오류 ${totalByCat.disk + totalByCat.ntfs}건`,
  ].join(' · ');

  if (totalByCat.whea > 0) {
    issues.push(mkIssue('critical', `하드웨어 오류 이벤트(WHEA)가 ${totalByCat.whea}건 발견되었습니다`,
      `최근 ${days}일 동안 Windows가 CPU/메모리/PCIe 등 하드웨어 수준의 오류를 기록했습니다. 반복되면 하드웨어 불량 가능성이 있습니다.`,
      ['메모리 불량', 'CPU 불안정(오버클럭 등)', 'PCIe 장치(GPU 등) 접촉 불량', '전원 공급 불안정'],
      ['최근 오버클럭/전압 설정을 초기화', 'RAM 재장착 및 슬롯 변경 시도', 'GPU 등 PCIe 카드 재장착'],
      80, [`최근 ${days}일 ${totalByCat.whea}건`, ...(latestOf('whea') ? [`가장 최근: ${latestOf('whea')}`] : []), `이벤트 내역: ${breakdown}`],
      '설정을 초기화한 뒤 며칠 사용하며 이벤트 로그에 WHEA 오류가 재발하는지 확인하세요.'));
  }
  if (totalByCat.wheaCorrected > 0) {
    // 정정된(corrected) WHEA 오류는 하드웨어가 스스로 복구한 것이라 흔히 기록된다.
    // 이걸 critical로 올리면 멀쩡한 PC에 과잉 경고를 하게 되므로 "지켜볼 항목"으로만 남긴다.
    issues.push(mkIssue('watch', `정정된 하드웨어 오류(WHEA)가 ${totalByCat.wheaCorrected}건 기록되었습니다`,
      `최근 ${days}일 동안 하드웨어가 오류를 감지했지만 스스로 정정한 기록입니다. 정정된 오류는 비교적 흔하며 그 자체로 고장을 뜻하지 않습니다. 다만 건수가 계속 늘어난다면 지켜볼 가치가 있습니다.`,
      ['메모리/PCIe 링크에서 간헐적으로 발생하는 정정 가능한 오류', '오버클럭으로 인한 경계선 동작'],
      ['지금 당장 조치할 필요는 없습니다', '건수가 계속 증가하는지 며칠 간격으로 확인', '오버클럭을 했다면 기본값과 비교'],
      35, [`최근 ${days}일 정정된 오류 ${totalByCat.wheaCorrected}건`, '정정 불가 오류는 0건 — 시스템이 복구에 성공했습니다'],
      '며칠 뒤 다시 진단해 정정된 오류 건수가 눈에 띄게 늘었는지 비교하세요.'));
  }
  if (totalByCat.bugcheck > 0) {
    issues.push(mkIssue('critical', `블루스크린(시스템 충돌) 기록이 ${totalByCat.bugcheck}건 있습니다`,
      `최근 ${days}일 동안 Windows가 치명적 오류로 강제 재시작된 기록입니다.`,
      ['드라이버 문제', '메모리 불량', '하드웨어 불안정'],
      ['최근 설치/업데이트한 드라이버 확인', 'Windows Update 확인', '반복되면 Windows 메모리 진단 도구 실행'],
      75, [`최근 ${days}일 ${totalByCat.bugcheck}건`, ...(latestOf('bugcheck') ? [`가장 최근: ${latestOf('bugcheck')}`] : []), `이벤트 내역: ${breakdown}`],
      '조치 후 며칠 사용하며 블루스크린이 재발하는지 확인하세요.'));
  }
  if (totalByCat.kernelPower > 0) {
    // 비정상 종료는 원인 후보가 넓다(전원/과열/드라이버/정전). 다른 계통 이벤트가 0건이라는
    // 사실 자체가 "어디부터 볼지"를 좁혀주므로, 단정하지 않되 우선 확인 순서를 제시한다.
    const companions = [];
    if (totalByCat.whea > 0) companions.push(`WHEA ${totalByCat.whea}건`);
    if (totalByCat.bugcheck > 0) companions.push(`블루스크린 ${totalByCat.bugcheck}건`);
    if (totalByCat.display > 0) companions.push(`그래픽 드라이버 오류 ${totalByCat.display}건`);
    const priorityNote = companions.length
      ? `같은 기간에 ${companions.join(', ')}도 함께 기록되어 있어, 그쪽 원인과 이어질 가능성을 먼저 확인하는 것이 좋습니다.`
      : '같은 기간에 하드웨어 오류(WHEA)·블루스크린·그래픽 드라이버 오류 기록은 없습니다. 그래서 소프트웨어 크래시보다는 전원 공급이나 과열로 인한 보호 종료 쪽을 우선 확인할 근거가 있습니다(원인이 확정된 것은 아닙니다).';
    issues.push(mkIssue('warning', `예기치 않은 종료/재부팅 기록이 ${totalByCat.kernelPower}건 있습니다`,
      `정상 종료 절차 없이 전원이 꺼지거나 재부팅된 기록입니다. ${priorityNote}`,
      ['전원 공급 불안정(PSU/전원 케이블/멀티탭)', '과열로 인한 보호 종료', '순간 정전 등 외부 전원 문제', 'CPU/GPU 오버클럭 불안정', '사용자가 전원 버튼을 길게 눌러 강제 종료한 경우'],
      ['전원 케이블·멀티탭 연결 상태부터 확인(가장 간단하고 흔한 원인)', '오버클럭 설정을 초기화', '안정성 테스트로 부하를 걸어 재현되는지 확인', '종료 시각과 온도 기록이 겹치는지 확인'],
      65, [`최근 ${days}일 ${totalByCat.kernelPower}건`, ...(latestOf('kernelPower') ? [`가장 최근: ${latestOf('kernelPower')}`] : []), `이벤트 내역: ${breakdown}`],
      '안정성 테스트 탭에서 CPU 부하 테스트를 돌려 재현되는지 확인하세요.'));
  }
  if (totalByCat.display > 0) {
    issues.push(mkIssue('warning', `그래픽 드라이버 응답 없음/복구 기록이 ${totalByCat.display}건 있습니다`,
      'GPU 드라이버가 응답하지 않아 Windows가 복구를 시도한 기록입니다(TDR). GPU 온도·클럭이 정상이어도 이 문제는 발생할 수 있습니다.',
      ['그래픽 드라이버 손상/버전 문제', 'GPU 오버클럭 불안정', 'GPU 하드웨어 불안정'],
      ['그래픽 드라이버 완전 재설치(DDU 등 클린 설치 도구 권장)', 'GPU 오버클럭 초기화'],
      70, [`최근 ${days}일 ${totalByCat.display}건`, ...(latestOf('display') ? [`가장 최근: ${latestOf('display')}`] : []), `이벤트 내역: ${breakdown}`],
      '드라이버 재설치 후 같은 게임/작업을 실행하며 재발 여부를 확인하세요.'));
  }
  if (totalByCat.disk + totalByCat.ntfs > 0) {
    const count = totalByCat.disk + totalByCat.ntfs;
    issues.push(mkIssue('warning', `저장장치/파일시스템 오류 이벤트가 ${count}건 있습니다`,
      '디스크 I/O 또는 NTFS 파일시스템 수준의 오류가 기록되었습니다.',
      ['저장장치 노후/불량', 'SATA/NVMe 케이블 연결 불량', '파일시스템 손상'],
      ['저장장치 탭에서 SMART 상태 확인', '케이블/연결 재확인', 'chkdsk 실행 고려'],
      72, [`disk ${totalByCat.disk}건, Ntfs ${totalByCat.ntfs}건`, `이벤트 내역: ${breakdown}`],
      '저장장치 탭에서 SMART 상태와 처리량 테스트를 다시 확인하세요.'));
  }
  if (totalByCat.appError >= 3) {
    issues.push(mkIssue('watch', `특정 프로그램이 반복적으로 비정상 종료된 기록이 있습니다 (${totalByCat.appError}건)`,
      '하드웨어 관련 이벤트는 아니며, 프로그램 자체의 문제일 가능성이 있습니다.',
      ['프로그램 버전/호환성 문제', '프로그램-드라이버 상호작용 문제'],
      ['해당 프로그램 업데이트 또는 재설치'],
      50, [`최근 ${days}일 ${totalByCat.appError}건`],
      '프로그램을 업데이트한 뒤 같은 작업을 반복하며 재발 여부를 확인하세요.'));
  }

  const totalCount = eventLog.totalCount !== undefined ? eventLog.totalCount : events.length;
  const normalEvidence = [
    `최근 ${days}일간 관련 이벤트 ${totalCount}건 확인 (하드웨어/크래시 관련 이상 없음)`,
    `이벤트 내역: ${breakdown}`,
  ];
  // 정상 절전/복귀처럼 문제가 아닌 이벤트가 섞여 있었다면 그 사실을 밝힌다 —
  // 다른 도구에서 "이벤트 수십 건"을 보고 온 사용자가 왜 여기선 조용한지 알 수 있어야 한다.
  if (ignoredCount > 0) {
    normalEvidence.push(`전원 상태 전환(절전 진입/복귀, 정상 종료) 등 문제로 볼 수 없는 이벤트 ${ignoredCount}건은 판정에서 제외했습니다`);
  }
  return finalize('EVENTS', issues, null, normalEvidence);
}

// ---------- 증상 기반 우선순위 ----------
// 사용자가 선택한 증상에 따라 어떤 카테고리를 먼저 보여줄지 결정한다.
// 실제 판정 로직 자체는 바뀌지 않고, 결과를 보여주는 순서/강조만 달라진다.
const SYMPTOM_FOCUS = {
  gaming: ['GPU', 'CPU', 'RAM'],
  slow: ['CPU', 'RAM', 'STORAGE'],
  network: ['NETWORK'],
  display: ['DISPLAY'],
  crash: ['EVENTS', 'DRIVERS', 'CPU', 'GPU'],
  full: null, // 전체 진단, 우선순위 없음
};
const SYMPTOM_LABEL = {
  gaming: '게임/작업 중 버벅거림',
  slow: 'PC가 전반적으로 느려짐',
  network: '인터넷이 불안정함',
  display: '화면이 이상함',
  crash: '프로그램이 자주 튕기거나 재부팅됨',
  full: '전체 진단',
};

// ---------- Correlation Engine ----------
// 카테고리별 판정(evaluateCpu, evaluateEventLogs 등)은 이미 있지만, 그것만으로는
// "온도가 높다"와 "최근 예기치 않게 꺼졌다"가 사실 같은 문제라는 걸 알 수 없다.
// DIAG.BENCH의 핵심 차별점은 이 개별 신호들을 시간적/인과적으로 엮어 하나의 설명으로
// 만드는 것이다(기획서 24장, 59장). 여기서는 오늘 측정한 라이브 상태(CPU/GPU 스로틀링,
// 저장장치/메모리 이상)와 최근 며칠간의 Windows 이벤트 로그를 서로 대조해서, 둘 다
// 존재할 때만 서로를 근거로 추가하고 신뢰도를 높인다 — 하나만 있으면 아무것도 하지 않는다.
function findIssue(sections, category, titlePattern) {
  const section = sections.find((s) => s.category === category);
  if (!section) return null;
  return section.issues.find((i) => titlePattern.test(i.title)) || null;
}

// 두 이슈가 서로의 정황 증거가 되어줄 때, 서로에게 근거를 하나씩 추가하고 신뢰도를 올린다.
// (신뢰도가 null인 이슈, 즉 "판단 보류" 성격의 이슈는 이 상호보강 대상에서 제외한다 —
// 근거 부족을 명시적으로 남겨둔 판정을 상관관계만으로 슬쩍 격상시키지 않기 위함.)
function crossReference(issueA, issueB, noteForA, noteForB) {
  if (!issueA || !issueB) return;
  issueA.evidence.push(noteForA);
  issueB.evidence.push(noteForB);
  [issueA, issueB].forEach((i) => {
    if (i.confidence !== null) {
      i.confidence = Math.min(99, i.confidence + 8);
      i.confidenceLabel = confidenceLabel(i.confidence);
    }
  });
}

function applyCorrelations(sections) {
  const cpuThrottle = findIssue(sections, 'CPU', /CPU 열 스로틀링이 의심됩니다/);
  const gpuThrottle = findIssue(sections, 'GPU', /GPU 열 스로틀링이 의심됩니다/);
  const kernelPower = findIssue(sections, 'EVENTS', /예기치 않은 종료\/재부팅 기록이/);
  const displayTdr = findIssue(sections, 'EVENTS', /그래픽 드라이버 응답 없음\/복구 기록이/);
  const whea = findIssue(sections, 'EVENTS', /하드웨어 오류 이벤트\(WHEA\)가/);
  const diskEvt = findIssue(sections, 'EVENTS', /저장장치\/파일시스템 오류 이벤트가/);
  const bugcheck = findIssue(sections, 'EVENTS', /블루스크린\(시스템 충돌\) 기록이/);
  const storageSection = sections.find((s) => s.category === 'STORAGE');
  const storageBad = storageSection ? storageSection.issues.find((i) => i.level === 'critical' || i.level === 'warning') : null;
  const ramSection = sections.find((s) => s.category === 'RAM');
  const ramBad = ramSection ? ramSection.issues.find((i) => i.level === 'warning') : null;

  // CPU 과열 ↔ 예기치 않은 종료: 둘 다 있으면 "과열로 인한 보호 종료"라는 추정에 힘이 실린다.
  crossReference(cpuThrottle, kernelPower,
    '최근 예기치 않은 종료/재부팅 이벤트가 있어 과열로 인한 보호 종료로 이어졌을 가능성이 있음',
    '오늘 진단에서도 CPU 열 스로틀링이 확인되어, 과열로 인한 보호 종료였을 가능성이 높음');

  // GPU 과열 ↔ 그래픽 드라이버 TDR: 둘 다 있으면 "냉각 문제로 인한 드라이버 리셋"에 힘이 실린다.
  crossReference(gpuThrottle, displayTdr,
    '최근 그래픽 드라이버 응답 없음(TDR) 이벤트가 있어 같은 냉각 문제일 가능성이 있음',
    '오늘 진단에서 GPU 열 스로틀링이 함께 확인되어, 과열이 원인이었을 가능성이 있음');

  // RAM 검사 불일치 ↔ WHEA / 블루스크린: 메모리 검사에서 실제 오류가 나왔고 시스템 로그에도
  // 하드웨어 오류나 강제 재시작 기록이 있으면, 둘을 따로 보는 것보다 같은 메모리 문제로 볼 근거가 된다.
  const ramIntegrity = findIssue(sections, 'RAM', /RAM 무결성 검사에서 .*불일치가/);
  crossReference(ramIntegrity, whea,
    '최근 하드웨어 오류(WHEA) 이벤트도 함께 확인되어, 메모리 하드웨어 문제일 가능성이 높음',
    'RAM 무결성 검사에서도 불일치가 확인되어, 메모리 관련 하드웨어 오류일 가능성이 높음');
  crossReference(ramIntegrity, bugcheck,
    '최근 블루스크린 기록도 함께 확인되어, 메모리 오류가 시스템 충돌로 이어졌을 가능성이 있음',
    'RAM 무결성 검사에서 불일치가 확인되어, 메모리 문제가 원인이었을 가능성이 있음');

  // SMART 대기 중 섹터 ↔ 디스크 오류 이벤트: 디스크가 읽기에 실패하고 있다는 두 방향의 증거.
  const pendingSectors = findIssue(sections, 'STORAGE', /읽기에 실패한 섹터가/);
  crossReference(pendingSectors, diskEvt,
    'Windows 이벤트 로그에도 디스크 오류가 기록되어 있어, 실제 읽기 실패가 발생하고 있을 가능성이 높음',
    'SMART에서 읽기 실패 섹터가 확인되어, 디스크 자체 문제일 가능성이 높음');

  // CRC 오류 ↔ 디스크 오류 이벤트: 케이블 문제가 실제 I/O 오류로 이어지고 있다는 근거.
  const crcIssue = findIssue(sections, 'STORAGE', /데이터 전송 오류\(CRC\)가/);
  crossReference(crcIssue, diskEvt,
    'Windows 이벤트 로그에도 디스크 오류가 있어, 전송 문제가 실제 I/O 실패로 이어지고 있을 가능성이 있음 — 케이블 교체를 먼저 시도할 근거',
    'SMART에 전송 오류(CRC)가 함께 기록되어 있어, 디스크 고장보다 케이블/연결 문제일 가능성을 먼저 확인해볼 만함');

  // 저장장치 검사 데이터 불일치 ↔ 디스크/파일시스템 오류 이벤트: 같은 저장장치 문제의 두 증거.
  const storageIntegrity = findIssue(sections, 'STORAGE', /저장장치 검사에서 쓴 데이터와 읽은 데이터가/);
  crossReference(storageIntegrity, diskEvt,
    '최근 저장장치/파일시스템 오류 이벤트도 함께 확인되어, 장치 이상일 가능성이 높음',
    '저장장치 검사에서 데이터 불일치도 확인되어, 문제가 실제로 진행 중일 가능성이 높음');

  // CPU 부하 테스트 온도 중단 ↔ 예기치 않은 종료: 통제된 부하에서 과열이 재현된 셈이다.
  const cpuStressThermal = findIssue(sections, 'CPU', /CPU 부하 테스트가 안전 한계 온도에서/);
  crossReference(cpuStressThermal, kernelPower,
    '최근 예기치 않은 종료/재부팅 이벤트도 있어, 과열로 인한 보호 종료였을 가능성이 있음',
    '부하 테스트에서 CPU가 안전 한계 온도에 도달해, 과열로 인한 보호 종료였을 가능성이 있음');

  // WHEA(하드웨어 오류) ↔ 메모리 경고: WHEA는 원인 후보가 넓은데, 오늘 메모리 이슈가 실제로
  // 있다면 "메모리 관련 하드웨어 오류"일 가능성 쪽으로 근거를 좁혀준다.
  crossReference(whea, ramBad,
    '메모리 관련 이슈도 함께 확인되어 메모리 하드웨어 오류일 가능성이 있음',
    '최근 하드웨어 오류(WHEA) 이벤트도 함께 확인되어, 메모리 관련 하드웨어 문제일 가능성이 있음');

  // 부하 테스트 스로틀링 ↔ TDR/예기치 않은 종료: 통제된 부하에서 과열이 확인됐고 실제로
  // 드라이버가 죽거나 PC가 꺼진 기록도 있다면, 둘을 따로 보는 것보다 하나의 냉각 문제로 볼 근거가 된다.
  const gpuStressThrottle = findIssue(sections, 'GPU', /부하 테스트에서 GPU 열 스로틀링이/);
  crossReference(gpuStressThrottle, displayTdr,
    '최근 그래픽 드라이버 응답 없음(TDR) 이벤트도 함께 확인되어, 과열이 실제 증상으로 이어졌을 가능성이 있음',
    '부하 테스트에서 GPU 열 스로틀링이 확인되어, 과열이 원인이었을 가능성이 있음');
  crossReference(gpuStressThrottle, kernelPower,
    '최근 예기치 않은 종료/재부팅 이벤트도 있어 과열로 인한 보호 종료로 이어졌을 가능성이 있음',
    '부하 테스트에서 GPU 열 스로틀링이 확인되어, 과열로 인한 보호 종료였을 가능성이 있음');

  // VRAM 불일치 ↔ 그래픽 드라이버 TDR: 화면이 깨지거나 드라이버가 죽는 증상과 VRAM 검사 불일치가
  // 함께 나오면, 둘을 따로 보는 것보다 같은 원인(그래픽 메모리 문제)일 가능성이 높아진다.
  const vramMismatch = findIssue(sections, 'GPU', /VRAM 무결성 검사에서 불일치가/);
  crossReference(vramMismatch, displayTdr,
    '최근 그래픽 드라이버 응답 없음(TDR) 이벤트도 함께 확인되어, 그래픽 메모리 문제일 가능성이 있음',
    'VRAM 무결성 검사에서도 불일치가 확인되어, 드라이버 문제가 아니라 그래픽 메모리 쪽 원인일 가능성이 있음');

  // VRAM 불일치 ↔ WHEA(하드웨어 오류): WHEA는 원인 후보가 넓은데, VRAM 불일치가 함께 있으면
  // "그래픽 메모리 관련 하드웨어 오류" 쪽으로 근거가 좁혀진다.
  crossReference(vramMismatch, whea,
    '최근 하드웨어 오류(WHEA) 이벤트도 함께 확인되어, 일시적 오류가 아닐 가능성이 있음',
    'VRAM 무결성 검사 불일치도 함께 확인되어, 그래픽 메모리 관련 하드웨어 오류일 가능성이 있음');

  // VRAM 테스트 중 컨텍스트 손실 ↔ TDR 이벤트: 같은 현상이 검사 중에도 재현된 셈이다.
  const vramCtxLost = findIssue(sections, 'GPU', /VRAM 테스트 도중 그래픽 컨텍스트가 손실/);
  crossReference(vramCtxLost, displayTdr,
    '최근 그래픽 드라이버 응답 없음(TDR) 이벤트가 기록되어 있어, 검사 중 손실도 같은 문제의 재현일 가능성이 있음',
    'VRAM 테스트 중에도 컨텍스트 손실이 재현되어, 일회성 이벤트가 아닐 가능성이 있음');

  // 저장장치/파일시스템 오류 이벤트 ↔ 오늘의 저장장치 이상: 같은 저장장치 문제가 계속되고 있다는 근거.
  crossReference(diskEvt, storageBad,
    '저장장치 진단에서도 이상이 확인되어 같은 저장장치 문제일 가능성이 높음',
    '최근 저장장치/파일시스템 오류 이벤트도 함께 확인되어, 문제가 계속 진행 중일 가능성이 높음');
}

// ---------- 통합 ----------
function buildReport({ cpu, cpuTrend, memory, memoryModules, gpu, gpuTrend, storage, network, display, visualChecks, vramCheck, gpuStressCheck, baseline, baselineSnapshot, deepTests, system, symptom, topProcesses, eventLog }) {
  // 정밀 검사(부하 테스트)를 돌렸다면 그 결과도 규칙 엔진에 넣는다. 이게 빠져 있으면
  // "RAM 검사에서 오류가 났는데 최종 등급은 정상"이라는 최악의 상황이 생긴다.
  const dt = deepTests && deepTests.included ? deepTests : {};

  // 기준선 비교는 여기서 딱 한 번 만든다. 호출부(main.js)에서 만들어 넘기지 않는 이유는,
  // SMART 재검사처럼 raw로 리포트를 다시 만드는 경로에서 비교 결과만 예전 값으로 남는
  // 어긋남을 원천적으로 막기 위해서다. 지금 측정값과 항상 같이 계산된다.
  //
  // ⚠ 비교에 쓰는 "지금 값"은 진단 본작업 전에 뜬 스냅샷(baselineSnapshot)이 있으면 그걸 쓴다.
  //    본작업 중 값을 쓰면 앱 자신의 부하(실측 36%)가 섞여 매번 "부하 중이라 비교 불가"가 된다.
  //    기준선이 유휴 상태에서 만들어졌으니 비교 대상도 같은 조건이어야 공정하다.
  //    (collectors.collectIdleSnapshot 주석 참고)
  const snap = baselineSnapshot || null;
  const baselineComparison = compareToBaseline(baseline, {
    cpuModel: cpu ? cpu.model : null,
    gpuModel: (gpu && gpu.controllers && gpu.controllers[0] && gpu.controllers[0].model) || null,
    cpu: snap && snap.cpu ? { loadPercent: snap.cpu.loadPercent, tempC: snap.cpu.tempC }
      : (cpu ? { loadPercent: cpu.loadPercent, tempC: cpu.tempC } : null),
    gpu: snap && snap.gpu ? { loadPercent: snap.gpu.loadPercent, tempC: snap.gpu.tempC }
      : (gpu && gpu.nvidia ? { loadPercent: gpu.nvidia.loadPercent, tempC: gpu.nvidia.tempC } : null),
    memUsedPercent: snap && snap.ram ? snap.ram.usedPercent : (memory ? memory.usedPercent : null),
  });

  let sections = [
    evaluateCpu(cpu, cpuTrend, topProcesses, dt.cpuStress, baselineComparison),
    evaluateMemory(memory, topProcesses, dt.ramTest, baselineComparison, memoryModules),
    evaluateGpu(gpu, gpuTrend, { vramCheck, gpuStressCheck, baselineComparison }),
    evaluateStorage(storage, dt.storageTest),
    evaluateNetwork(network),
    evaluateDisplay(display, visualChecks),
    evaluateSystem(system),
    evaluateEventLogs(eventLog),
  ];

  applyCorrelations(sections);

  const focus = symptom ? SYMPTOM_FOCUS[symptom] : null;
  if (focus) {
    // SYMPTOM_FOCUS 배열에 적힌 순서 그대로 정렬한다 (원래 sections 배열 순서가 아니라).
    const rank = (cat) => { const i = focus.indexOf(cat); return i === -1 ? 999 : i; };
    const focused = sections
      .filter((s) => focus.includes(s.category))
      .sort((a, b) => rank(a.category) - rank(b.category))
      .map((s) => ({ ...s, focused: true }));
    const rest = sections
      .filter((s) => !focus.includes(s.category))
      .map((s) => ({ ...s, focused: false }));
    sections = [...focused, ...rest];
  }

  const totalWarnings = sections.reduce((a, s) => a + s.issues.filter((i) => i.level === 'warning').length, 0);
  const totalCritical = sections.reduce((a, s) => a + s.issues.filter((i) => i.level === 'critical').length, 0);
  const totalWatch = sections.reduce((a, s) => a + s.issues.filter((i) => i.level === 'watch').length, 0);

  let headline;
  if (totalCritical > 0) headline = `${totalCritical}개의 심각한 문제가 발견되었습니다.`;
  else if (totalWarnings > 0) headline = `${totalWarnings}개의 잠재적인 문제가 발견되었습니다.`;
  else if (totalWatch > 0) headline = `뚜렷한 문제는 없지만, ${totalWatch}개 항목을 지켜볼 필요가 있습니다.`;
  else headline = '현재 시스템은 정상입니다.';

  return {
    headline,
    totalWarnings,
    totalCritical,
    totalWatch,
    sections,
    symptom: symptom || 'full',
    symptomLabel: SYMPTOM_LABEL[symptom] || SYMPTOM_LABEL.full,
    // 화면에서 "평소 대비" 표를 그리는 데 쓴다. 판정은 이미 섹션 이슈에 반영돼 있고
    // 여기 있는 건 같은 데이터의 표시용 사본이다(여기서 다시 판정하면 안 된다).
    baseline: baselineComparison,
    timestamp: new Date().toISOString(),
  };
}

// ---------- helpers ----------
function mkIssue(level, title, explanation, causes, actions, confidence, evidence, verification) {
  return {
    level, title, explanation, causes, actions,
    confidence: confidence ?? null,
    confidenceLabel: confidenceLabel(confidence),
    evidence: evidence || [],
    verification: verification || null,
  };
}
function confidenceLabel(score) {
  if (score === undefined || score === null) return null;
  if (score >= 90) return 'VERY HIGH';
  if (score >= 75) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  return 'LOW';
}
function finalize(category, issues, note, normalEvidence) {
  const hasCritical = issues.some((i) => i.level === 'critical');
  const hasWarning = issues.some((i) => i.level === 'warning');
  const hasWatch = issues.some((i) => i.level === 'watch');
  const status = hasCritical ? 'critical' : hasWarning ? 'warning' : hasWatch ? 'watch' : 'normal';
  return {
    category, status, issues, note: note || null,
    normalEvidence: status === 'normal' ? (normalEvidence || []) : [],
  };
}

module.exports = { buildReport, SYMPTOM_LABEL };
