// inspectionReportHtml.js
// buildInspectionReport()가 만든 데이터를 사람이 읽고 출력/공유할 수 있는 HTML 문서로 렌더링한다.
// 중고차 성능·상태점검기록부의 형식(식별 정보 → 점검 항목 → 면책 조항)을 참고했다.

const QRCode = require('qrcode');
const { maskSerial } = require('./inspectionReport');

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function statusKo(status) {
  if (status === 'normal') return '정상';
  if (status === 'watch') return '관찰 필요';
  if (status === 'warning') return '주의';
  if (status === 'critical') return '위험';
  return status;
}
const catKo = { CPU: 'CPU', GPU: 'GPU', RAM: '메모리', STORAGE: '저장장치', NETWORK: '네트워크', DISPLAY: '디스플레이', DRIVERS: '드라이버', EVENTS: 'Windows 이벤트' };
const scoreLabelKo = {
  hardwareHealth: 'Hardware Health (하드웨어 이상 여부)',
  thermalCondition: 'Thermal Condition (온도·냉각 상태)',
  storageHealth: 'Storage Health (저장장치 건강)',
  stability: 'Stability (부하 테스트·안정성)',
  softwareCondition: 'Software Condition (드라이버·이벤트)',
};

// 한 줄 요약(접혔을 때 보이는 내용). 정상이면 측정값, 이상이 있으면 이슈 제목들.
function sectionSummary(s) {
  if (s.issues.length) return s.issues.map((i) => `${i.title} (${statusKo(i.level)})`).join(', ');
  if (s.note) return s.note;
  return (s.normalEvidence || []).join(' · ') || '측정값 없음';
}

function issuesHtmlBlock(issues) {
  return issues.map((i) => `
    <div class="issue-detail">
      <div class="issue-detail-title">${esc(i.title)} <span class="badge ${i.level}">${statusKo(i.level)}</span></div>
      <p>${esc(i.explanation)}</p>
      ${i.evidence.length ? `<p><b>근거:</b> ${i.evidence.map(esc).join(' · ')}</p>` : ''}
      ${i.causes && i.causes.length ? `<p><b>가능한 원인:</b> ${i.causes.map(esc).join(', ')}</p>` : ''}
      ${i.actions && i.actions.length ? `<p><b>권장 조치:</b> ${i.actions.map(esc).join(', ')}</p>` : ''}
      ${i.verification ? `<p><b>재검사 방법:</b> ${esc(i.verification)}</p>` : ''}
    </div>`).join('');
}

// "상세설명"을 펼쳤을 때 보이는 내용: 무엇을 검사했고, 어떤 값이 나와서 이 판정이 나왔는지.
// 정상 판정도 "왜 정상인지"(측정값)를 남기고, 이상 판정은 rules.js가 이미 만들어둔
// explanation/evidence/causes/actions/verification을 그대로 보여준다.
function sectionDetailHtml(s) {
  if (!s.issues.length) {
    const evidence = (s.normalEvidence || []).map(esc).join(' · ');
    return `<p>이 항목에서는 문제가 발견되지 않았습니다.${s.note ? ` ${esc(s.note)}` : ''}</p>
      ${evidence ? `<p><b>측정값:</b> ${evidence}</p>` : ''}`;
  }
  return issuesHtmlBlock(s.issues);
}

// ---------- 영역별 점검 결과(Category Scores) 상세설명 ----------
// hardwareHealth/thermalCondition/softwareCondition은 여러 세부 항목(CPU/GPU/RAM/저장장치 등)
// 중 "가장 나쁜 상태"를 그대로 가져온 요약 점수라(inspectionReport.js의 worstStatus/thermalStatus),
// 그 자체로는 왜 그 등급인지 알 수 없다. 여기서는 실제로 어떤 세부 항목이 근거가 됐는지
// 같은 issue 데이터를 다시 보여줘서 "요약 점수 → 근거"를 연결한다.
const SCORE_SOURCE_CATEGORIES = {
  hardwareHealth: ['CPU', 'GPU', 'RAM', 'STORAGE'],
  softwareCondition: ['DRIVERS', 'EVENTS'],
};

function scoreSummary(key, status, byCat) {
  if (status === null) return '정밀 검사를 실행하지 않아 검사하지 않음';
  if (key === 'thermalCondition') {
    const issues = ['CPU', 'GPU'].flatMap((c) => (byCat[c]?.issues || [])).filter((i) => /온도|스로틀링/.test(i.title));
    return issues.length ? issues.map((i) => i.title).join(', ') : '과열·스로틀링 징후 없음';
  }
  if (key === 'storageHealth') return sectionSummary(byCat.STORAGE || { issues: [], normalEvidence: [] });
  if (key === 'stability') return status === 'normal' ? '정밀 검사 결과 특이사항 없음' : '정밀 검사 중 특이사항 확인됨';
  const cats = SCORE_SOURCE_CATEGORIES[key] || [];
  const issues = cats.flatMap((c) => (byCat[c]?.issues || []));
  return issues.length ? issues.map((i) => i.title).join(', ') : '관련 항목 모두 정상';
}

// SMART 상세 표. 중고 거래에서 구매자가 가장 알고 싶어하는 값(사용 시간, 수명, 불량 섹터)을
// 요약 문장이 아니라 **원본 수치 그대로** 보여준다. 판매자가 "괜찮다"고 말하는 것보다
// 숫자가 찍혀 있는 편이 문서로서 훨씬 쓸모 있다.
function smartAttributeTableHtml(smartList) {
  const withAttrs = (smartList || []).filter((s) => s && s.attributes);
  if (!withAttrs.length) return '';
  const fmt = (v, unit = '') => (v === null || v === undefined ? '–' : `${typeof v === 'number' ? v.toLocaleString() : esc(String(v))}${unit}`);
  return withAttrs.map((s) => {
    const a = s.attributes;
    const model = (s.identity && s.identity.model) || s.device;
    const rows = [];
    if (a.powerOnHours !== null && a.powerOnHours !== undefined) {
      rows.push(['사용 시간', `${a.powerOnHours.toLocaleString()}시간 (약 ${(a.powerOnHours / 24 / 365).toFixed(1)}년치 가동)`]);
    }
    if (a.powerCycles !== null && a.powerCycles !== undefined) rows.push(['전원 켠 횟수', fmt(a.powerCycles, '회')]);
    if (a.wearPercentUsed !== null && a.wearPercentUsed !== undefined) rows.push(['쓰기 수명 사용률', fmt(a.wearPercentUsed, '%')]);
    if (a.totalHostWritesTB !== null && a.totalHostWritesTB !== undefined) rows.push(['누적 쓰기량', fmt(a.totalHostWritesTB, 'TB')]);
    if (a.availableSparePercent !== null && a.availableSparePercent !== undefined) {
      rows.push(['예비 영역', `${a.availableSparePercent}% (제조사 임계값 ${a.availableSpareThreshold}%)`]);
    }
    if (a.pendingSectors !== null && a.pendingSectors !== undefined) rows.push(['대기 중 섹터 (읽기 실패)', fmt(a.pendingSectors, '개')]);
    if (a.reallocatedSectors !== null && a.reallocatedSectors !== undefined) rows.push(['재할당된 섹터', fmt(a.reallocatedSectors, '개')]);
    if (a.uncorrectableSectors !== null && a.uncorrectableSectors !== undefined) rows.push(['정정 불가 섹터', fmt(a.uncorrectableSectors, '개')]);
    if (a.crcErrors !== null && a.crcErrors !== undefined) rows.push(['전송 오류(CRC) — 주로 케이블', fmt(a.crcErrors, '건')]);
    if (a.mediaErrors !== null && a.mediaErrors !== undefined) rows.push(['미디어/무결성 오류', fmt(a.mediaErrors, '건')]);
    if (a.temperatureC !== null && a.temperatureC !== undefined) rows.push(['측정 시 온도', fmt(a.temperatureC, '°C')]);
    if (!rows.length) return '';
    return `<p style="margin-top:10px;"><b>${esc(model)}</b> — SMART 상세 (측정값 원본)</p>
      <table class="smart-table">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}</table>`;
  }).join('');
}

function scoreDetailHtml(key, inspectionReport, byCat) {
  if (key === 'storageHealth') {
    const smartTable = smartAttributeTableHtml(inspectionReport.smartDetails);
    const base = byCat.STORAGE ? sectionDetailHtml(byCat.STORAGE) : '<p>저장장치 정보를 확인하지 못했습니다.</p>';
    return base + smartTable;
  }

  if (key === 'thermalCondition') {
    const issues = ['CPU', 'GPU'].flatMap((c) => (byCat[c]?.issues || [])).filter((i) => /온도|스로틀링/.test(i.title));
    if (!issues.length) return '<p>CPU/GPU 온도 및 클럭 추이에서 과열이나 스로틀링 징후가 발견되지 않았습니다.</p>';
    return issuesHtmlBlock(issues);
  }

  if (key === 'stability') {
    if (!inspectionReport.deepTestsIncluded) {
      return '<p>"정밀 검사 포함"을 켜지 않아 부하 테스트(CPU/저장장치/RAM)를 실행하지 않았습니다. 이건 "정상"이 아니라 "검사 안 함"입니다 — 안정성은 이번 점검에서 확인되지 않았습니다.</p>';
    }
    const dt = inspectionReport.deepTests || {};
    const parts = [];
    if (dt.cpuStress) {
      const c = dt.cpuStress;
      parts.push(`<p><b>CPU 부하 테스트:</b> ${c.durationSec}초간 ${c.coreCount}코어 부하. `
        + `최고 온도 ${c.maxTempC ?? '측정 불가'}${c.maxTempC !== null && c.maxTempC !== undefined ? '°C' : ''}, 클럭 ${c.minClockGHz ?? '?'}~${c.maxClockGHz ?? '?'}GHz.`
        + `${c.abortKind === 'safety-temp' ? ` <b style="color:#E0173A">안전 한계로 중단됨(${esc(c.abortReason || '사유 미상')})</b>` : ''}`
        + `${c.abortKind === 'user' ? ' <b style="color:#C98A00">사용자가 중단해 완주하지 않았습니다(판단 보류).</b>' : ''}`
        + `${c.abortKind === 'worker-error' ? ` <b style="color:#C98A00">부하를 걸지 못해 실행에 실패했습니다(${esc(c.workerError || '원인 미상')}).</b>` : ''}`
        + `${c.clockDroppedUnderLoad ? ' 부하 중 클럭이 눈에 띄게 하락했습니다(열 제한 또는 전력 관리 동작).' : ''}`
        + `${c.tempSensorAvailable === false ? ' <b style="color:#C98A00">이 시스템은 CPU 온도 센서를 읽을 수 없어, 온도 기반 자동 중단 없이 시간 제한 안전 모드로만 실행했습니다.</b>' : ''}</p>`);
    }
    if (dt.storageTest) {
      const s = dt.storageTest;
      parts.push(`<p><b>저장장치 처리량 테스트:</b> `
        + (s.completed
          ? `쓰기 ${s.writeMBps}MB/s, 읽기 ${s.readMBps}MB/s (${s.sizeMB}MB 순차 I/O). 처리량은 장치 종류(HDD/SATA SSD/NVMe)에 따라 정상 범위가 크게 달라 속도만으로는 판정하지 않습니다.`
          : `<b style="color:#E0173A">완료하지 못했습니다</b> — ${esc(s.verifyMismatch ? '쓴 데이터와 읽은 데이터가 일치하지 않았습니다' : `${s.errorStage || '단계 미상'}: ${s.error || '원인 미상'}`)}`)
        + `</p>`);
    }
    if (dt.ramTest) {
      const r = dt.ramTest;
      parts.push(`<p><b>RAM 무결성 간이검사:</b> `
        + (r.completed
          ? `${r.sizeMB}MB / 패턴 ${r.patternsRun}종 검사, 오류 ${r.errors.toLocaleString()}건 (${r.passed ? '통과' : '<b style="color:#E0173A">실패</b>'}). 부팅형 정밀 검사(MemTest86 등)를 대체하지 않습니다.`
          : `<b style="color:#C98A00">완료하지 못했습니다</b> — ${esc(r.error || '원인 미상')}`)
        + `</p>`);
    }
    const eventIssues = byCat.EVENTS?.issues || [];
    if (eventIssues.length) parts.push(issuesHtmlBlock(eventIssues));
    return parts.join('') || '<p>정밀 검사를 실행했지만 세부 결과를 확인하지 못했습니다.</p>';
  }

  // hardwareHealth, softwareCondition: 여러 세부 항목의 worst-of 요약
  const cats = SCORE_SOURCE_CATEGORIES[key] || [];
  const relevant = cats.map((c) => byCat[c]).filter(Boolean);
  const issues = relevant.flatMap((s) => s.issues);
  if (!issues.length) {
    const ev = relevant.flatMap((s) => s.normalEvidence || []).map(esc).join(' · ');
    const names = cats.map((c) => catKo[c] || c).join('/');
    return `<p>${names} 모두 눈에 띄는 이상 없이 정상 범위로 확인되었습니다.</p>${ev ? `<p><b>측정값:</b> ${ev}</p>` : ''}`;
  }
  return issuesHtmlBlock(issues);
}

// expanded: true면 <details>를 펼친 채로 렌더링한다. PDF는 인쇄 순간의 DOM 상태를
// 그대로 굳히는 정적 문서라, 접힌 채로 저장하면 그 안의 내용을 영영 못 보게 된다.
// 그래서 PDF로 저장할 때만 강제로 펼치고, 화면/HTML 저장은 접은 채로 시작해 스캔하기 쉽게 한다.
async function buildInspectionReportHtml(inspectionReport, { expanded = false } = {}) {
  const qrDataUrl = await QRCode.toDataURL(
    JSON.stringify({ id: inspectionReport.reportId, hash: inspectionReport.verificationHash, issuedAt: inspectionReport.issuedAt }),
    { width: 220, margin: 1 }
  );

  const issuedDate = new Date(inspectionReport.issuedAt).toLocaleString('ko-KR');
  const validDate = new Date(inspectionReport.validUntil).toLocaleString('ko-KR');
  const hw = inspectionReport.hardwareIdentity;

  // 공개 문서로 공유될 수 있으므로 시리얼류는 뒤 4자리만 남기고 마스킹한다.
  const hwRows = [
    ['시스템 제조사/모델', [hw.systemManufacturer, hw.systemModel].filter(Boolean).join(' ') || '확인 불가'],
    ['시스템 시리얼', maskSerial(hw.systemSerial) || '확인 불가 (조립 PC는 보드 제조사가 이 값을 채우지 않는 경우가 많습니다)'],
    ['시스템 UUID', maskSerial(hw.systemUuid) || '확인 불가'],
    ['메인보드 시리얼', maskSerial(hw.baseboardSerial) || '확인 불가'],
    ['CPU', hw.cpuModel || '확인 불가'],
    ['GPU UUID', maskSerial(hw.gpuUuid) || '확인 불가 (NVIDIA만 지원)'],
  ];
  const diskRows = (hw.disks || []).map((d) => `${d.name} (${d.sizeGB}GB) — 시리얼: ${maskSerial(d.serial) || '확인 불가'}`);

  // 등급 글자만 크게 보이면 "이 PC 전체가 C급"으로 읽힌다. 실제로는 하드웨어는 멀쩡한데
  // 이벤트 기록 하나 때문에 C가 되는 경우가 흔해서, 등급 바로 아래에 근거와 정상 영역을 함께 둔다.
  const ge = inspectionReport.gradeExplanation;
  const gradeReasonHtml = !ge ? '' : `
  <div class="grade-reason">
    ${ge.drivers.length ? `
      <div class="gr-block">
        <b>이 등급의 이유</b>
        <ul>${ge.drivers.slice(0, 5).map((d) => `<li class="${d.level}">${d.level === 'critical' ? '✕' : '⚠'} ${esc(d.categoryLabel)} — ${esc(d.title)}</li>`).join('')}</ul>
      </div>` : `
      <div class="gr-block"><b>이 등급의 이유</b><ul><li class="ok">검사한 범위에서 문제로 판정된 항목이 없습니다</li></ul></div>`}
    ${ge.normalAreas.length ? `<div class="gr-block"><b>정상으로 확인된 영역</b><div class="gr-tags">${ge.normalAreas.map((a) => `<span class="tag ok">${esc(a)}</span>`).join('')}</div></div>` : ''}
    ${ge.watchAreas.length ? `<div class="gr-block"><b>지켜볼 영역</b><div class="gr-tags">${ge.watchAreas.map((a) => `<span class="tag watch">${esc(a)}</span>`).join('')}</div></div>` : ''}
  </div>`;

  // "정밀 검사 3/4 완료"처럼 한눈에 보이는 요약. 검사 안 한 걸 정상으로 집계하지 않는다.
  const scope = inspectionReport.testScope;
  const scopeSummary = `기본 검사 ${scope.completed.filter((t) => !/부하 테스트|무결성|처리량/.test(t)).length}건 완료 · `
    + `정밀 검사 ${scope.completed.filter((t) => /부하 테스트|무결성|처리량/.test(t)).length}건 완료, `
    + `${scope.notTested.length}건 미검사 (미검사 항목은 정상으로 집계하지 않았습니다)`;

  const byCat = Object.fromEntries(inspectionReport.diagnosisReport.sections.map((s) => [s.category, s]));

  const sectionsHtml = inspectionReport.diagnosisReport.sections.map((s) => `
    <div class="section-card">
      <div class="section-head">
        <span class="section-cat">${catKo[s.category] || s.category}</span>
        <span class="badge ${s.status}">${statusKo(s.status)}</span>
        <span class="section-summary">${esc(sectionSummary(s))}</span>
      </div>
      <details class="section-details"${expanded ? ' open' : ''}>
        <summary>상세설명</summary>
        <div class="section-details-body">${sectionDetailHtml(s)}</div>
      </details>
    </div>`).join('');

  // 영역별 점검 결과(Category Scores)도 세부 점검 결과와 같은 카드+상세설명 형식으로 만든다.
  // 배지만 봐서는 "왜" 그 등급인지 알 수 없다는 게 이번에 보강한 부분이다.
  const scoreRows = Object.entries(scoreLabelKo).map(([key, label]) => {
    const status = inspectionReport.categoryScores[key];
    const badge = status === null
      ? '<span class="badge nottested">검사 안 함</span>'
      : `<span class="badge ${status}">${statusKo(status)}</span>`;
    return `
    <div class="section-card">
      <div class="section-head">
        <span class="section-cat">${esc(label)}</span>
        ${badge}
        <span class="section-summary">${esc(scoreSummary(key, status, byCat))}</span>
      </div>
      <details class="section-details"${expanded ? ' open' : ''}>
        <summary>상세설명</summary>
        <div class="section-details-body">${scoreDetailHtml(key, inspectionReport, byCat)}</div>
      </details>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>PC 상태 점검 리포트 — ${inspectionReport.reportId}</title>
<style>
  body{font-family:'Malgun Gothic','Segoe UI',sans-serif;background:#FAFAF9;color:#14161A;max-width:840px;margin:0 auto;padding:36px 28px;line-height:1.6;}
  .doc-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #14161A;padding-bottom:16px;margin-bottom:20px;}
  .doc-title{font-size:22px;font-weight:800;margin:0;}
  .doc-sub{font-family:monospace;font-size:12px;color:#5B5F6A;margin-top:4px;}
  .qr-box{text-align:center;}
  .qr-box img{width:110px;height:110px;}
  .qr-box div{font-family:monospace;font-size:9.5px;color:#9296A0;margin-top:4px;}
  .grade-banner{display:flex;align-items:center;gap:18px;padding:18px 22px;border-radius:12px;margin-bottom:8px;}
  .grade-banner.normal{background:#E9FAF0;color:#12A150;}
  .grade-banner.watch{background:#F1ECFF;color:#6E56CF;}
  .grade-banner.warning{background:#FFF6E0;color:#C98A00;}
  .grade-banner.critical{background:#FFEEF1;color:#E0173A;}
  .grade-letter{font-size:34px;font-weight:800;line-height:1;}
  .grade-text{font-weight:700;font-size:15px;}
  .validity{font-size:11.5px;font-weight:500;opacity:.85;margin-top:2px;}
  h2{font-size:15px;border-top:1px solid #E4E6EB;padding-top:16px;margin-top:24px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  td{padding:7px 6px;border-bottom:1px solid #EEF0F3;vertical-align:top;}
  td:first-child{width:34%;color:#5B5F6A;}
  .badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;}
  .badge.normal{background:#E9FAF0;color:#12A150;}
  .badge.watch{background:#F1ECFF;color:#6E56CF;}
  .badge.warning{background:#FFF6E0;color:#C98A00;}
  .badge.critical{background:#FFEEF1;color:#E0173A;}
  .badge.nottested{background:#F4F4F5;color:#9296A0;}
  .grade-reason{border:1px solid #E7E7E4;border-radius:10px;padding:14px 18px;margin-bottom:18px;background:#FCFCFB;}
  .grade-reason .gr-block{margin-bottom:10px;}
  .grade-reason .gr-block:last-child{margin-bottom:0;}
  .grade-reason b{font-size:12px;color:#6B6F76;display:block;margin-bottom:5px;}
  .grade-reason ul{margin:0;padding-left:18px;font-size:13px;}
  .grade-reason li{margin-bottom:3px;}
  .grade-reason li.critical{color:#E0173A;}
  .grade-reason li.warning{color:#C98A00;}
  .grade-reason li.ok{color:#12A150;}
  .grade-reason .gr-tags{display:flex;flex-wrap:wrap;gap:6px;}
  .grade-reason .tag{font-size:11.5px;padding:2px 9px;border-radius:20px;border:1px solid;}
  .grade-reason .tag.ok{color:#12A150;border-color:#B8E6CB;background:#F2FCF6;}
  .grade-reason .tag.watch{color:#6E56CF;border-color:#D6CCF5;background:#F7F4FF;}
  .smart-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:5px;}
  .smart-table td{border:1px solid #EDEDEA;padding:5px 9px;}
  .smart-table td:first-child{color:#6B6F76;width:44%;background:#FAFAF9;}
  .scope-summary{font-size:12.5px;color:#6B6F76;margin-bottom:10px;padding:8px 12px;background:#F7F7F5;border-radius:8px;}
  .scope-cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;font-size:12.5px;}
  .scope-cols ul{margin:6px 0 0;padding-left:18px;}
  .scope-cols li{margin-bottom:3px;}
  .scope-cols .done{color:#12A150;}
  .scope-cols .skip{color:#9296A0;}
  .disclaimer{margin-top:28px;padding:16px 18px;background:#F4F4F5;border-radius:10px;font-size:11.5px;color:#5B5F6A;line-height:1.7;}
  .disclaimer b{color:#14161A;}
  .verify-code{font-family:monospace;font-size:11px;color:#9296A0;margin-top:14px;word-break:break-all;}
  .section-list{display:flex;flex-direction:column;gap:8px;}
  .section-card{background:#fff;border:1px solid #E4E6EB;border-radius:10px;padding:10px 14px;}
  .section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;}
  .section-cat{font-weight:700;min-width:78px;}
  .section-summary{color:#5B5F6A;font-size:12.5px;}
  .section-details{margin-top:2px;}
  .section-details summary{cursor:pointer;font-size:11.5px;font-weight:600;color:#6E56CF;padding:4px 0;list-style:none;}
  .section-details summary::-webkit-details-marker{display:none;}
  .section-details summary::before{content:"▸ ";}
  .section-details[open] summary::before{content:"▾ ";}
  .section-details-body{padding:10px 2px 4px;border-top:1px dashed #E4E6EB;margin-top:6px;font-size:12.5px;}
  .section-details-body p{margin:6px 0;}
  .section-details-body b{color:#14161A;}
  .issue-detail{padding:8px 0;}
  .issue-detail + .issue-detail{border-top:1px dashed #EEF0F3;}
  .issue-detail-title{font-weight:700;margin-bottom:4px;}
</style></head>
<body>

  <div class="doc-head">
    <div>
      <p class="doc-title">PC 상태 점검 리포트</p>
      <p class="doc-sub">리포트 번호 ${inspectionReport.reportId}</p>
      <p class="doc-sub">발급: ${issuedDate}</p>
    </div>
    <div class="qr-box">
      <img src="${qrDataUrl}" alt="검증 QR" />
      <div>대조용 QR<br>(자체 검증용, 서버 조회 아님)</div>
    </div>
  </div>

  <div class="grade-banner ${inspectionReport.overallGrade.level}">
    <div class="grade-letter">${inspectionReport.overallGrade.letter}</div>
    <div>
      <div class="grade-text">${inspectionReport.overallGrade.label}</div>
      <div class="validity">유효기간: ~${validDate} (발급 후 ${inspectionReport.validityDays}일) · ${inspectionReport.deepTestsIncluded ? '정밀 검사(부하 테스트) 포함' : '기본 검사만 수행'}</div>
    </div>
  </div>
  ${gradeReasonHtml}

  <h2>영역별 점검 결과 <span style="font-weight:400;color:#9296A0;font-size:11px;">— "상세설명"을 누르면 어떤 세부 항목이 근거가 됐는지 볼 수 있습니다</span></h2>
  <div class="section-list">${scoreRows}</div>

  <h2>검사 범위 <span style="font-weight:400;color:#9296A0;font-size:11px;">— "검사하지 않음"은 정상이라는 뜻이 아니라 이번에 측정하지 않았다는 뜻입니다</span></h2>
  <div class="scope-summary">${esc(scopeSummary)}</div>
  <div class="scope-cols">
    <div>
      <b>검사 완료 (${inspectionReport.testScope.completed.length}건)</b>
      <ul>${inspectionReport.testScope.completed.map((t) => `<li class="done">✓ ${esc(t)}</li>`).join('')}</ul>
    </div>
    <div>
      <b>검사하지 않음 (${inspectionReport.testScope.notTested.length}건)</b>
      <ul>${inspectionReport.testScope.notTested.map((t) => `<li class="skip">– ${esc(t)}</li>`).join('')}</ul>
    </div>
  </div>

  <h2>하드웨어 식별 정보 <span style="font-weight:400;color:#9296A0;font-size:11px;">— 뒤 4자리만 표시(개인정보 보호). 구매자는 실제 PC의 뒷자리와 대조하세요</span></h2>
  <table>
    ${hwRows.map(([label, val]) => `<tr><td>${esc(label)}</td><td>${esc(val)}</td></tr>`).join('')}
    ${diskRows.length ? `<tr><td>저장장치</td><td>${diskRows.map(esc).join('<br>')}</td></tr>` : ''}
  </table>
  ${!inspectionReport.hasIdentity ? '<p style="font-size:12px;color:#C98A00;margin-top:8px;">⚠ 이 시스템에서는 하드웨어 시리얼을 하나도 읽지 못했습니다. 대조용 식별 정보 없이 발급된 리포트입니다.</p>' : ''}

  <h2>세부 점검 결과 <span style="font-weight:400;color:#9296A0;font-size:11px;">— "상세설명"을 누르면 무엇을 검사했고 어떤 값이 나와서 이 판정이 나왔는지 볼 수 있습니다</span></h2>
  <div class="section-list">${sectionsHtml}</div>

  <div class="disclaimer">
    <b>이 문서에 대하여</b><br>
    이 리포트는 <b>DIAG.BENCH</b> 소프트웨어가 ${issuedDate}에 이 PC에서 정해진 검사 항목을 수행하고 확인한 결과를 기록한 문서입니다.
    "검사를 완료했다"는 것과 "이 PC에 고장이 없다"는 것은 다른 의미입니다 — 위 "검사 범위"에 없는 항목은 확인되지 않았습니다.
    법적 성능 보증서나 공인 인증서가 아니며, 정부의 "성능인증(EPC)" 제도와 무관합니다.
    측정 시점 이후 하드웨어·소프트웨어 변경이나 새로운 고장에 대해서는 이 결과가 어떤 것도 보증하지 않습니다.<br><br>
    <b>대조 QR / 검증코드에 대하여</b><br>
    QR과 아래 코드는 이 리포트에 적힌 하드웨어 식별값과 점검 결과를 해시로 요약한 것입니다.
    구매자는 판매자에게 <b>같은 PC에서 DiagBench를 재실행</b>해 검증코드가 일치하는지 확인해달라고 요청할 수 있습니다.
    다만 이 방식은 "복사/입력 실수"나 "다른 PC 리포트 재사용"을 걸러내는 수준이며,
    판매자가 값을 직접 조작하는 것까지 막는 암호학적 서명 방식은 아닙니다. 현재 온라인 서버 검증 페이지는 제공하지 않습니다.
    이 검증코드는 하드웨어 식별값뿐 아니라 <b>각 항목의 판정·근거·부하 테스트 측정값·검사 범위·최종 등급까지</b> 포함해 계산됩니다.
    따라서 리포트 내용 중 무엇 하나라도 바뀌면 검증코드가 달라집니다.<br><br>
    <b>리포트 번호와 검증코드는 역할이 다릅니다.</b> 리포트 번호는 이 문서를 가리키는 이름(조회·식별용)이고,
    검증코드는 내용이 바뀌지 않았음을 확인하는 값입니다. 같은 검사에서 내용이 정정되면 번호는 유지되고 검증코드만 바뀝니다.
    <div class="verify-code">리포트 번호: ${inspectionReport.reportId}<br>검증코드(SHA-256): ${inspectionReport.verificationHash}</div>
  </div>

</body></html>`;
}

module.exports = { buildInspectionReportHtml };
