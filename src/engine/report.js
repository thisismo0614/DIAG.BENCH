// report.js
// 진단 리포트 객체를 저장 가능한 HTML 문서로 변환한다. (기획서 20장 Reports)

function badgeKo(status) {
  if (status === 'normal') return '정상';
  if (status === 'warning') return '주의';
  if (status === 'critical') return '위험';
  if (status === 'watch') return '관찰 필요';
  return status;
}
const catKo = { CPU: 'CPU', GPU: 'GPU', RAM: '메모리', STORAGE: '저장장치', NETWORK: '네트워크', DISPLAY: '디스플레이', DRIVERS: '드라이버', EVENTS: 'Windows 이벤트' };

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildHtmlReport(report, raw, systemMeta) {
  const genDate = new Date(report.timestamp).toLocaleString('ko-KR');

  const comparisonHtml = (report.comparison && report.comparison.hasChanges) ? `
    <section class="cat-section">
      <h2>이전 진단 대비 변화</h2>
      <p class="note">비교 시점: ${new Date(report.comparison.previousTimestamp).toLocaleString('ko-KR')}</p>
      ${report.comparison.deltas.map((d) => `
        <div class="compare-row ${d.neutral ? 'neutral' : (d.improved ? 'improved' : 'worsened')}">
          <b>${esc(d.label)}</b> ${d.prevVal}${d.unit} → ${d.curVal}${d.unit}
          <span class="tag">${d.neutral ? '변화' : (d.improved ? '개선' : '악화')} ${Math.abs(d.diff)}${d.unit}</span>
        </div>`).join('')}
    </section>` : '';

  const sectionsHtml = report.sections.map((s) => {
    const issuesHtml = s.issues.map((issue) => `
      <div class="issue ${issue.level}">
        <div class="issue-top">
          <span class="badge ${issue.level}">${badgeKo(issue.level)}</span>
          ${issue.confidence !== null ? `<span class="conf">판단 근거 강도 ${issue.confidenceLabel} <span class="conf-pct">(규칙 기반 점수 ${issue.confidence}/100, 통계적 확률 아님)</span></span>` : ''}
        </div>
        <div class="issue-title">${esc(issue.title)}</div>
        <p>${esc(issue.explanation)}</p>
        <div class="cols">
          <div><b>가능한 원인</b><ul>${issue.causes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
          <div><b>권장 조치</b><ul>${issue.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>
        </div>
        ${issue.topProcesses ? `<div class="processes"><b>점유율 높은 프로세스</b><ul>${issue.topProcesses.map((p) => `<li>${esc(p.name)} (#${p.pid}) — CPU ${p.cpuPercent}% · MEM ${p.memPercent}%</li>`).join('')}</ul></div>` : ''}
        ${issue.evidence.length ? `<div class="evidence">근거: ${issue.evidence.map(esc).join(' · ')}</div>` : ''}
        ${issue.verification ? `<div class="verify"><b>재검사 방법:</b> ${esc(issue.verification)}</div>` : ''}
      </div>`).join('') || (s.normalEvidence && s.normalEvidence.length
        ? `<p class="none">정상 — ${s.normalEvidence.map(esc).join(' · ')}</p>`
        : '<p class="none">발견된 문제 없음</p>');

    return `
      <section class="cat-section">
        <h2>${catKo[s.category] || s.category} <span class="badge ${s.status}">${badgeKo(s.status)}</span></h2>
        ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
        ${issuesHtml}
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><title>DIAG.BENCH 진단 리포트 — ${genDate}</title>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#FAFAF9;color:#14161A;max-width:820px;margin:0 auto;padding:40px 24px;line-height:1.6;}
  h1{font-size:24px;margin-bottom:4px;}
  .meta{color:#5B5F6A;font-size:13px;margin-bottom:28px;}
  .headline{background:#14161A;color:#fff;padding:16px 20px;border-radius:10px;font-weight:700;margin-bottom:28px;}
  h2{font-size:16px;border-top:1px solid #E4E6EB;padding-top:20px;margin-top:28px;display:flex;align-items:center;gap:8px;}
  .badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;}
  .badge.normal{background:#E9FAF0;color:#12A150;}
  .badge.warning{background:#FFF6E0;color:#C98A00;}
  .badge.critical{background:#FFEEF1;color:#E0173A;}
  .badge.watch{background:#F1ECFF;color:#6E56CF;}
  .conf-pct{color:#9296A0;font-weight:400;}
  .issue{border:1px solid #E4E6EB;border-radius:10px;padding:14px 16px;margin:10px 0;}
  .issue.critical{border-color:#F3B4C0;}
  .issue.warning{border-color:#F0DBA8;}
  .issue-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
  .issue-title{font-weight:700;margin-bottom:6px;}
  .conf{font-size:11px;color:#9296A0;font-family:monospace;}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;color:#5B5F6A;margin-top:8px;}
  .cols ul{margin:4px 0 0;padding-left:18px;}
  .evidence{margin-top:8px;font-size:11.5px;color:#9296A0;font-family:monospace;}
  .verify{margin-top:8px;font-size:12px;color:#5B5F6A;padding-top:8px;border-top:1px dashed #E4E6EB;}
  .processes{margin-top:10px;font-size:12.5px;color:#5B5F6A;}
  .processes ul{margin:4px 0 0;padding-left:18px;}
  .compare-row{padding:8px 0;font-size:13px;border-bottom:1px dashed #E4E6EB;}
  .compare-row .tag{float:right;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;}
  .compare-row.improved .tag{background:#E9FAF0;color:#12A150;}
  .compare-row.worsened .tag{background:#FFEEF1;color:#E0173A;}
  .compare-row.neutral .tag{background:#FAFAF9;color:#9296A0;border:1px solid #CDD0D6;}
  .note{font-size:12.5px;color:#9296A0;font-style:italic;}
  .none{color:#9296A0;font-size:13px;}
  footer{margin-top:40px;font-size:11.5px;color:#9296A0;border-top:1px solid #E4E6EB;padding-top:14px;}
</style></head>
<body>
  <h1>DIAG.BENCH 진단 리포트</h1>
  <div class="meta">생성 시각: ${genDate}${systemMeta ? ` · ${esc(systemMeta.manufacturer || '')} ${esc(systemMeta.model || '')} · ${esc(systemMeta.distro || '')}` : ''}</div>
  <div class="headline">${esc(report.headline)}</div>
  ${comparisonHtml}
  ${sectionsHtml}
  <footer>이 리포트는 DIAG.BENCH의 규칙 기반 진단 엔진이 생성했습니다. 실제 하드웨어 고장 여부는 제조사 진단 도구나 전문가 점검으로 최종 확인하시기 바랍니다.</footer>
</body></html>`;
}

module.exports = { buildHtmlReport };
