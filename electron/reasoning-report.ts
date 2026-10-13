import type {Run} from '../src/types';
import {unlimitedDescription,reasoningStopDescription,effectiveReasoningSamples,reasoningAnswerChanges,reasoningSummaries,settingLabel} from '../src/reasoning-comparison';
import {escapeHtml} from '../src/charts';

export function reasoningComparisonReport(run:Run){
 if(!run.config.reasoningComparison)return '';
 const rows=reasoningSummaries(run),samples=effectiveReasoningSamples(run);
 const f=(n:number|null,d=2)=>n===null?'Unavailable':n.toFixed(d);
 const baseline=(modelKey:string,id:string)=>{const row=rows.find(r=>r.modelKey===modelKey&&r.setting.id===id);return row?settingLabel(row.setting):id;};
 const body=rows.map(row=>{
  const controls=[...new Set(samples.filter(s=>s.modelKey===row.modelKey&&s.reasoningSetting?.id===row.setting.id).map(s=>s.reasoningControl?`${s.reasoningControl.transport}; ${s.reasoningControl.confirmation}; ${s.reasoningControl.note}`:'Control confirmation was not recorded.'))];
  const delta=row.delta===null?'Unavailable':`${row.delta>=0?'+':''}${row.delta.toFixed(2)} percentage points`;
  return `### ${row.modelName} / ${settingLabel(row.setting)}\n\nAccuracy: ${f(row.accuracy)}% (${row.correct}/${row.attempts} correct); baseline: ${baseline(row.modelKey,row.baselineId)}; difference: ${delta}. Stop condition: ${reasoningStopDescription(row.stop)||'No early stop recorded.'} Planned maximum attempts: ${row.expected===null?'Retry subset; full comparison not implied':row.expected}. Failures/timeouts/cancellations: ${row.failures}; truncated responses: ${row.truncations}.\n\nMean reasoning tokens: ${f(row.reasoningTokens)} (${row.reasoningCoverage}/${row.attempts} reported); mean total output tokens: ${f(row.outputTokens)} (${row.outputCoverage}/${row.attempts} reported); mean elapsed time: ${f(row.durationMs===null?null:row.durationMs/1000)} s. Missing token counts remain unavailable.\n\nRepeat scores: ${row.repeatScores.map(r=>`repeat ${r.repeat+1}: ${f(r.accuracy)}% (${r.attempts} attempts)`).join('; ')}.\n\nControl provenance:\n${controls.map(c=>'- '+c).join('\n')}`;
 }).join('\n\n');
 const models=run.config.modelKeys;
 const unsupported=models.flatMap(key=>{const info=run.modelInfo['reasoning:'+key] as {unsupported?:import('../src/reasoning-comparison').ReasoningSetting[]}|undefined;return info?.unsupported?.length?[`${key}: ${info.unsupported.map(settingLabel).join(', ')}`]:[];});
 return `## Reasoning comparison\n\nThe same selected questions and automatic scoring checks are repeated across supported reasoning settings. Accuracy counts wrong/malformed answers, failed requests, timeouts, and truncations as misses; work skipped by the consecutive-mistake stop rule is intentional; other unattempted work stays incomplete. Retry replacements within this run count once. ${run.status==='completed'?'': 'This run is incomplete and its scores are provisional. '}${unlimitedDescription(run.config)} ${run.config.reasoningComparison?.stopAfterConsecutiveMisses?`Stop rule: ${run.config.reasoningComparison.stopAfterConsecutiveMisses} consecutive mistakes per model and setting. Correct answers reset the streak. A setting also ends when its selected question pool is exhausted. Settings can cover different subsets, so compare shared paired questions as well as stop points.`:''} API acceptance alone does not prove enforcement.\n\n${unsupported.length?'Unsupported settings (not attempted):\n'+unsupported.map(s=>'- '+s).join('\n')+'\n\n':''}${body}\n\nThese are effects observed on the selected questions and conditions. Larger reasoning budgets need not improve accuracy.\n`;
}

export function reasoningComparisonHtml(run:Run){
 const rows=reasoningSummaries(run),f=(n:number|null)=>n===null?'Unavailable':n.toFixed(2);
 const chart=(modelRows:typeof rows)=>{
  const width=760,height=300,left=55,right=25,top=28,bottom=90;
  const step=(width-left-right)/Math.max(1,modelRows.length),y=(n:number)=>top+(100-n)/100*(height-top-bottom);
  const ticks=[0,25,50,75,100].map(n=>`<line x1="${left}" x2="${width-right}" y1="${y(n)}" y2="${y(n)}" stroke="#344048"/><text x="${left-8}" y="${y(n)+4}" text-anchor="end">${n}%</text>`).join('');
  const bars=modelRows.map((row,i)=>{const x=left+step*(i+.5),label=settingLabel(row.setting),title=`${label}: ${f(row.accuracy)}%, ${row.correct}/${row.attempts} correct`;
   return `<rect x="${x-step*.3}" y="${y(row.accuracy)}" width="${step*.6}" height="${y(0)-y(row.accuracy)}" fill="#84c8ab"><title>${escapeHtml(title)}</title></rect><text x="${x}" y="${y(row.accuracy)-7}" text-anchor="middle">${f(row.accuracy)}%</text><text x="${x}" y="${height-bottom+20}" text-anchor="middle"><tspan x="${x}">${escapeHtml(label.replace(' thinking tokens',''))}</tspan>${row.setting.kind==='budget'?`<tspan x="${x}" dy="16">thinking tokens</tspan>`:''}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Objective accuracy by reasoning setting"><style>text{font:12px Segoe UI;fill:#b7c7ca}</style>${ticks}${bars}<text x="${width/2}" y="${height-12}" text-anchor="middle">Selected reasoning setting</text></svg>`;
 };
 const models=[...new Set(rows.map(r=>r.modelKey))];
 const body=models.map(key=>{const modelRows=rows.filter(r=>r.modelKey===key),name=modelRows[0].modelName,baselineId=modelRows[0].baselineId;
  const table=`<table><thead><tr><th>Setting</th><th>Accuracy</th><th>Baseline delta (pp)</th><th>Correct / attempts</th><th>Mean reasoning tokens</th><th>Mean total output tokens</th><th>Mean elapsed seconds</th><th>Failures</th><th>Truncations</th><th>Stop condition</th></tr></thead><tbody>${modelRows.map(r=>`<tr>${[settingLabel(r.setting),f(r.accuracy)+'%',f(r.delta),`${r.correct}/${r.attempts}`,`${f(r.reasoningTokens)} (${r.reasoningCoverage}/${r.attempts} reported)`,`${f(r.outputTokens)} (${r.outputCoverage}/${r.attempts} reported)`,f(r.durationMs===null?null:r.durationMs/1000),r.failures,r.truncations,reasoningStopDescription(r.stop)].map(v=>`<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const answers=modelRows.filter(r=>r.setting.id!==baselineId).map(row=>{const changes=reasoningAnswerChanges(run,key,baselineId,row.setting.id);if(!changes.length)return '';
   return `<details><summary>Final answer comparison: ${escapeHtml(settingLabel(row.setting))} versus baseline (${changes.length} paired responses)</summary>${changes.map(c=>`<article><h4>${escapeHtml(c.testName)} · repeat ${c.repeat+1} · ${escapeHtml(c.change)}${c.answerChanged?' · changed answer':''}</h4><div class="answers"><div><h5>Baseline (${escapeHtml(settingLabel(c.baseline.reasoningSetting!))}) · ${escapeHtml(c.baseline.status)}</h5><pre>${escapeHtml(c.baseline.output||'(No final answer received)')}</pre>${c.baseline.reasoning?`<details><summary>Reasoning output</summary><pre>${escapeHtml(c.baseline.reasoning)}</pre></details>`:''}</div><div><h5>${escapeHtml(settingLabel(c.target.reasoningSetting!))} · ${escapeHtml(c.target.status)}</h5><pre>${escapeHtml(c.target.output||'(No final answer received)')}</pre>${c.target.reasoning?`<details><summary>Reasoning output</summary><pre>${escapeHtml(c.target.reasoning)}</pre></details>`:''}</div></div></article>`).join('')}</details>`;
  }).join('');
  return `<section><h2>${escapeHtml(name)}: objective accuracy versus reasoning setting</h2>${chart(modelRows)}${table}${answers}</section>`;
 }).join('');
 return `<h1>${escapeHtml(run.config.name||'Reasoning comparison')}</h1><p>${escapeHtml(run.created)} · Run status: ${escapeHtml(run.status)}</p>${body}<h2>Scoring, repeats, and control provenance</h2><pre>${escapeHtml(reasoningComparisonReport(run))}</pre>`;
}
