// memoryConfig.js
// 메모리 "구성"을 진단한다. 용량이 얼마인지가 아니라, 어떤 모듈이 어떻게 꽂혀서
// 지금 어떤 속도로 돌고 있는지를 본다.
//
// 왜 별도 모듈인가: 실제 중고 PC에서 가장 흔한 숨은 문제 중 하나가
// "서로 다른 RAM이 섞여 있어서 전체가 느린 쪽에 맞춰 도는 것"이다. 용량만 보면
// 64GB로 멀쩡해 보이고, 안정성 테스트도 통과한다. 구성을 봐야만 드러난다.
//
// ⚠ 이 진단이 넘지 말아야 할 선 — "혼합 RAM = 고장"이 아니다.
//    서로 다른 모듈이 섞여 있어도 전부 정격 속도로 돌고 있으면 아무 문제가 없다.
//    그래서 혼합 사실 하나만으로는 이슈를 올리지 않고, **정격보다 낮게 돌고 있을 때만**
//    경고한다. 그때도 "고장"이 아니라 "보수적인 설정으로 동작 중"이라고 말한다.
//
// ⚠ 알 수 없는 것을 아는 척하지 않는다.
//    - 타이밍(CL/tRCD/tRP): WMI로 못 읽는다(SPD를 SMBus로 직접 읽어야 함) → 검사 안 함.
//    - XMP/EXPO 프로파일 목록: 같은 이유로 못 읽는다 → "프로파일이 있다"고 말하지 않고,
//      모듈이 보고한 정격 속도와 현재 속도의 차이라는 **측정된 사실만** 말한다.

// 판정 로직이 바뀌어도 과거 성적서의 결과를 설명할 수 있도록 규칙 묶음에 버전을 붙인다.
const RULESET_VERSION = '2026.08.1';

// 제목·원인·조치·재검사·Wizard 같은 정적 지식은 issueDb에 모여 있다.
// 여기(규칙 모듈)는 **측정하고 판정하는 일만** 한다 — 측정값이 들어간 문장만 직접 만든다.
// 이렇게 나눠야 같은 문제에 대한 안내가 화면·리포트·Wizard에서 제각각이 되지 않는다.
const { knowledge, RISK } = require('./issueDb');

// 슬롯 이름에서 채널을 뽑는다. 보드마다 표기가 제각각이라(ChannelA-DIMM0, DIMM_A1, P0 CHANNEL A)
// **전부 확실하게 읽힐 때만** 채널 판정을 한다. 하나라도 못 읽으면 채널 얘기를 아예 하지 않는다.
// 애매한 근거로 "싱글 채널입니다"라고 말하는 것보다 말하지 않는 게 낫다.
function channelOf(slot) {
  if (!slot) return null;
  const m1 = /channel\s*([a-h])/i.exec(slot);
  if (m1) return m1[1].toUpperCase();
  const m2 = /dimm[_\s-]?([a-h])\d/i.exec(slot);
  if (m2) return m2[1].toUpperCase();
  return null;
}

function uniq(xs) {
  return [...new Set(xs.filter((x) => x !== null && x !== undefined))];
}

function speedLabel(type, mts) {
  if (!mts) return null;
  return type ? `${type}-${mts}` : `${mts} MT/s`;
}

// memModules: collectors.collectMemoryModules()의 반환값
function analyzeMemoryConfig(memModules) {
  const empty = { supported: false, summary: null, findings: [], evidence: [], notTested: [] };
  if (!memModules || !memModules.supported || !Array.isArray(memModules.modules) || !memModules.modules.length) {
    return {
      ...empty,
      // 못 읽은 것은 "이상 없음"이 아니라 "검사 안 함"이다.
      notTested: ['메모리 모듈 구성 (조회 실패 또는 미지원)'],
      evidence: memModules && memModules.error ? [`메모리 모듈 구성: ${memModules.error}`] : [],
    };
  }

  const mods = memModules.modules;
  const partNumbers = uniq(mods.map((m) => m.partNumber));
  const makers = uniq(mods.map((m) => m.manufacturer));
  const capacities = uniq(mods.map((m) => m.capacityGB));
  const ratedSpeeds = uniq(mods.map((m) => m.ratedSpeedMTs));
  const configuredSpeeds = uniq(mods.map((m) => m.configuredSpeedMTs));
  const types = uniq(mods.map((m) => m.type));

  // 모듈 사양이 서로 다른가. PartNumber가 가장 정확한 기준이고, 못 읽었으면 제조사/용량/정격으로 본다.
  const mixed = partNumbers.length > 1 || makers.length > 1 || capacities.length > 1 || ratedSpeeds.length > 1;

  // §12의 "HIGHEST_SUPPORTED_PROFILE" — 모듈들이 보고한 정격 중 가장 높은 값.
  const highestRated = ratedSpeeds.length ? Math.max(...ratedSpeeds) : null;
  // 지금 실제로 도는 속도. 모듈마다 다르게 보고되면 가장 낮은 값이 시스템 속도다.
  const currentSpeed = configuredSpeeds.length ? Math.min(...configuredSpeeds) : null;

  const channels = mods.map((m) => channelOf(m.slot));
  const channelsKnown = channels.every((c) => c !== null);
  const distinctChannels = channelsKnown ? uniq(channels) : [];

  const type = types.length === 1 ? types[0] : null;
  const totalGB = capacities.length ? mods.reduce((a, m) => a + (m.capacityGB || 0), 0) : null;

  const summary = {
    moduleCount: mods.length,
    totalSlots: memModules.totalSlots,
    usedSlots: memModules.usedSlots,
    totalGB: totalGB || null,
    type,
    mixed,
    distinctPartNumbers: partNumbers,
    highestRatedMTs: highestRated,
    currentMTs: currentSpeed,
    channels: channelsKnown ? distinctChannels : null,
    channelsKnown,
    maxCapacityGB: memModules.maxCapacityGB,
    timingsAvailable: !!memModules.timingsAvailable,
  };

  const findings = [];
  const evidence = [];

  // 근거는 이슈가 없어도 남긴다 — "정상 판정도 근거를 남긴다".
  evidence.push(`모듈 ${mods.length}개${memModules.totalSlots ? ` / 슬롯 ${memModules.totalSlots}개` : ''}${totalGB ? ` · 합계 ${totalGB}GB` : ''}`);
  if (type) evidence.push(`메모리 타입 ${type}`);
  if (currentSpeed) evidence.push(`현재 동작 속도 ${speedLabel(type, currentSpeed)}`);
  if (highestRated && highestRated !== currentSpeed) evidence.push(`모듈 정격(최고) ${speedLabel(type, highestRated)}`);
  evidence.push(mixed
    ? `서로 다른 모듈이 섞여 있음 (${partNumbers.length > 1 ? partNumbers.join(' / ') : makers.join(' / ')})`
    : `모든 모듈이 동일 사양${partNumbers.length === 1 ? ` (${partNumbers[0]})` : ''}`);
  if (channelsKnown) evidence.push(`채널 구성 ${distinctChannels.join('/')} (슬롯: ${mods.map((m) => m.slot).join(', ')})`);

  // ---------- 규칙 1: 정격보다 낮게 동작 ----------
  // 기획서 §12의 규칙. 혼합 여부에 따라 원인 후보와 심각도가 달라진다.
  if (highestRated && currentSpeed && currentSpeed < highestRated) {
    const gap = highestRated - currentSpeed;
    const kb = knowledge(mixed ? 'MEMORY-MIXED-DIMM-BELOW-RATED' : 'MEMORY-BELOW-RATED-SPEED');
    findings.push({
      ruleId: kb.id,
      ruleVersion: kb.version,
      level: mixed ? 'warning' : 'watch',
      title: kb.title,
      explanation: mixed
        ? `모듈 ${mods.length}개의 사양이 서로 달라(${partNumbers.join(' / ')}) 메모리 컨트롤러가 가장 보수적인 설정으로 동작하고 있는 것으로 보입니다. `
          + `현재 ${speedLabel(type, currentSpeed)}로 동작 중이며, 모듈이 보고한 정격 중 가장 높은 값은 ${speedLabel(type, highestRated)}입니다.`
        : `모듈이 보고한 정격은 ${speedLabel(type, highestRated)}인데 현재 ${speedLabel(type, currentSpeed)}로 동작하고 있습니다.`,
      causes: kb.causes,
      actions: kb.actions,
      // 여기서 "느려서 문제다"라고 단정하지 않는다. 체감 영향은 용도에 따라 다르다.
      confidence: mixed ? 'STRONG_INDICATION' : 'POSSIBLE_CAUSE',
      evidence: [
        `현재 ${speedLabel(type, currentSpeed)} / 정격(최고) ${speedLabel(type, highestRated)} — 차이 ${gap} MT/s`,
        ...(mixed ? [`혼합 구성: ${mods.map((m) => `${m.slot} ${m.capacityGB}GB ${m.partNumber || m.manufacturer || '모델 미상'} ${m.ratedSpeedMTs || '?'}MT/s`).join(' | ')}`] : []),
        '측정된 사실은 "정격보다 낮게 동작 중"이라는 것까지입니다 — 사용 가능한 프로파일 목록은 OS에서 읽을 수 없어 확인하지 못했습니다',
      ],
      verification: kb.verification,
    });
  }

  // ---------- 규칙 2: 정격보다 높게 동작 (설정 변경/오버클럭 신호) ----------
  // 기획서 §8 — 오버클럭을 흑백으로 판단하지 않는다. "설정이 변경된 상태"라는 사실만 알린다.
  if (highestRated && currentSpeed && currentSpeed > highestRated) {
    const kb = knowledge('MEMORY-ABOVE-RATED-SPEED');
    findings.push({
      ruleId: kb.id,
      ruleVersion: kb.version,
      level: 'watch',
      title: kb.title,
      explanation: `모듈이 보고한 정격은 ${speedLabel(type, highestRated)}인데 현재 ${speedLabel(type, currentSpeed)}로 동작하고 있습니다. `
        + '메모리 프로파일이 적용됐거나 수동으로 설정이 변경된 상태입니다. 그 자체가 고장은 아니지만, 안정성 문제의 원인이 될 수 있으므로 알려드립니다.',
      causes: kb.causes,
      actions: kb.actions,
      confidence: 'CONFIRMED',
      evidence: [
        `현재 ${speedLabel(type, currentSpeed)} / 모듈 정격 ${speedLabel(type, highestRated)}`,
        '설정이 변경됐다는 사실만 확인한 것이며, 불안정하다는 뜻은 아닙니다',
      ],
      verification: kb.verification,
    });
  }

  // ---------- 규칙 3: 싱글 채널 동작 가능성 ----------
  // 채널을 확실히 읽었을 때만 말한다.
  if (channelsKnown && mods.length >= 2 && distinctChannels.length === 1) {
    const kb = knowledge('MEMORY-SINGLE-CHANNEL');
    findings.push({
      ruleId: kb.id,
      ruleVersion: kb.version,
      level: 'watch',
      title: kb.title,
      explanation: `모듈 ${mods.length}개가 모두 채널 ${distinctChannels[0]}에 있습니다. 듀얼 채널로 나눠 꽂으면 메모리 대역폭이 늘어나 `
        + '특히 내장 그래픽이나 게임에서 성능 차이가 날 수 있습니다. 고장은 아니고 구성 문제입니다.',
      causes: kb.causes,
      actions: kb.actions,
      confidence: 'STRONG_INDICATION',
      evidence: [`장착 슬롯: ${mods.map((m) => m.slot).join(', ')}`, `확인된 채널: ${distinctChannels.join(', ')}`],
      verification: kb.verification,
    });
  }

  // 검사하지 않은 것을 명시한다 (기획서 §37).
  const notTested = [];
  if (!memModules.timingsAvailable) {
    notTested.push('메모리 타이밍(CL/tRCD/tRP) — OS에서 읽을 수 없어 검사하지 않음');
    evidence.push('메모리 타이밍은 OS에서 읽을 수 없어 확인하지 않았습니다 (정상이라는 뜻이 아닙니다)');
  }
  if (!channelsKnown) {
    notTested.push('메모리 채널 구성 — 슬롯 이름에서 채널을 확인할 수 없음');
  }

  return { supported: true, summary, findings, evidence, notTested };
}

module.exports = { analyzeMemoryConfig, RULESET_VERSION, RISK, channelOf };
