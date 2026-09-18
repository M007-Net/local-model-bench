import type {AgenticRun,PointStats} from '../src/agentic';
import {agenticStages,hostWorkCaveat,modelCallLabel,stageLabels,sweepColumns,sweepStats,sweepVerdict} from '../src/agentic';
import {scalingSvg,staticStageLegendHtml,timelineSvg,scalingMetrics,type ScalingMetric} from '../src/agentic-charts';
import {escapeHtml} from '../src/charts';
import {cell} from './export';

const num=(v:number|null|undefined,d=2)=>v===null||v===undefined||!Number.isFinite(v)?'Unavailable':v.toFixed(d);
const column=(s:PointStats,c:typeof sweepColumns[number])=>{const v=c.value(s);return v===null||!Number.isFinite(v)?'Unavailable':v.toFixed(c.digits)+(c.suffix??'');};
const heading=(run:AgenticRun)=>`${run.created} · status ${run.status} · ${run.config.turns} agent turns per worker count · host work scale ${run.config.hostWorkScale} · model call ${modelCallLabel(run.config)}`;

export function agenticRows(run:AgenticRun){
 return sweepStats(run.points).map(s=>({
  run:run.config.name,modelCall:run.config.modelCall,model:modelCallLabel(run.config),
  turns:run.config.turns,hostWorkScale:run.config.hostWorkScale,workers:s.workers,lanesUsed:s.lanes,
  wallSeconds:s.wallMs/1000,turnsPerMinute:s.turnsPerMin,speedup:s.speedup,efficiency:s.efficiency,
  meanTurnMs:s.meanTurnMs,meanModelCallMs:s.meanLlmMs,meanHostMs:s.meanHostMs,offGpuSharePercent:s.offGpuShare,
  completed:s.completed,failed:s.failed,
  ...Object.fromEntries(agenticStages.map(stage=>[`${stage}TotalMs`,s.stageMs[stage]]))
 }));
}
export function agenticText(run:AgenticRun,format:string){
 if(format==='json')return JSON.stringify(run,null,2);
 const rows=agenticRows(run);
 if(format==='csv'){const headers=rows.length?Object.keys(rows[0]):['workers','wallSeconds'];return '﻿'+[headers.map(cell).join(','),...rows.map(r=>headers.map(k=>cell((r as any)[k])).join(','))].join('\r\n');}
 if(format!=='md')throw Error('Unsupported export format');
 const stats=sweepStats(run.points);
 return `# ${run.config.name||'Agent worker sweep'}\n\n${heading(run)}\n\n${hostWorkCaveat}\n\n## Sweep points\n\n`+
 `| ${sweepColumns.map(c=>c.header).join(' | ')} |\n| ${sweepColumns.map(()=>'---').join(' | ')} |\n`+
 stats.map(s=>`| ${sweepColumns.map(c=>column(s,c)).join(' | ')} |`).join('\n')+
 `\n\n${sweepVerdict(stats,run.config.modelCall)}\n\n## Stage totals\n\n`+
 stats.map(s=>`### ${s.workers} worker(s)\n\n`+agenticStages.map(stage=>`- ${stageLabels[stage]}: ${num(s.stageMs[stage],0)} ms total across ${s.completed} completed turns`).join('\n')).join('\n\n')+
 `\n\n## Environment\n\n${Object.entries(run.environment).map(([k,v])=>`- ${k}: ${String(v)}`).join('\n')}\n\n## Run log\n\n${run.logs.join('\n')||'No additional messages.'}\n`;
}
export function agenticReport(run:AgenticRun){
 const stats=sweepStats(run.points);
 const series=[{id:run.id,label:run.config.name||'This sweep',stats,active:true}];
 const charts=(['turnsPerMin','speedup','efficiency','meanTurnMs'] as ScalingMetric[]).map(metric=>`<article><h3>${escapeHtml(scalingMetrics[metric].title)}</h3><p>${escapeHtml(scalingMetrics[metric].description)}</p>${scalingSvg(series,metric)}</article>`).join('');
 const max=Math.max(...run.points.map(p=>p.wallMs),1);
 // Both axes are shared across the sweep — time and plot height — so the timelines below can be
 // compared by eye without measuring anything.
 const height=Math.max(90,Math.min(420,Math.max(1,...run.points.map(p=>p.lanes))*14+40));
 const timelines=run.points.map(point=>`<article><h3>${point.workers} worker${point.workers===1?'':'s'}</h3><p>${point.turns.length} agent turns · ${point.lanes} lane(s) · wall clock ${num(point.wallMs/1000)} s · axis locked to the slowest worker count in this sweep.</p>${timelineSvg(point,{axisMaxMs:max,height})}</article>`).join('');
 const table=`<table><tr>${sweepColumns.map(c=>`<th>${escapeHtml(c.header)}</th>`).join('')}</tr>${stats.map(s=>`<tr>${sweepColumns.map(c=>`<td>${escapeHtml(column(s,c))}</td>`).join('')}</tr>`).join('')}</table>`;
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escapeHtml(run.config.name||'Agent worker sweep')} — agent sweep report</title><style>body{margin:0;background:#0b1114;color:#e3ebe7;font:14px 'Segoe UI',sans-serif}main{max-width:1320px;margin:auto;padding:40px}h1{font-size:32px;letter-spacing:-.8px}h2{margin-top:38px}h3{margin:0 0 6px;font-size:16px}p{color:#9fb0b6;line-height:1.7}article{padding:22px;background:#111a1e;border:1px solid #223038;border-radius:12px;margin-bottom:18px;break-inside:avoid}svg{width:100%;display:block}.legend{display:flex;flex-wrap:wrap;gap:16px;margin:16px 0 26px;color:#b7c7ca;font-size:12px}.legend span{display:flex;align-items:center;gap:8px}.legend i{width:10px;height:10px;border-radius:3px}table{border-collapse:collapse;font-size:12px;width:100%}td,th{text-align:left;border-bottom:1px solid #223038;padding:9px;overflow-wrap:anywhere}th{color:#8b9aa0;font-weight:600;letter-spacing:.6px;text-transform:uppercase;font-size:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#9fb0b6}@media print{body{background:#fff;color:#16222a}article{background:#fff;border-color:#bbb}p,.legend{color:#3f5059}}</style><main><h1>${escapeHtml(run.config.name||'Agent worker sweep')}</h1><p>${escapeHtml(heading(run))}</p><p>${escapeHtml(hostWorkCaveat)}</p><div class="legend">${staticStageLegendHtml()}</div><h2>Scaling</h2>${charts}<h2>All sweep points</h2><article>${table}<p>${escapeHtml(sweepVerdict(stats,run.config.modelCall))}</p></article><h2>Worker timelines</h2>${timelines}<h2>Environment and log</h2><article><pre>${escapeHtml(JSON.stringify({config:run.config,environment:run.environment},null,2))}</pre><pre>${escapeHtml(run.logs.join('\n')||'No additional messages.')}</pre></article></main></html>`;
}
