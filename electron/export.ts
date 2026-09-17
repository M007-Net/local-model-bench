import {benchmarkReport} from './benchmark-report';
import type { GpuStat, Run, RunGpu, Sample, Wave } from '../src/types';
import { average, percentile } from './metrics';
import { combineStats, gpuMetricLabels, gpuMetricUnits, gpuMetrics } from '../src/gpu-stats';
import { measuredDepths, mtpDepthLabel, mtpDepthText, sweepVerdicts } from '../src/mtp-sweep';
import type { VisionState } from './vision';
// The confirmed effective state is recorded per model when its instance is loaded, so a
// row reports what LM Studio actually confirmed rather than only what was requested.
const visionOf=(run:Run,modelKey:string)=>(run.modelInfo[modelKey] as {vision?:VisionState}|undefined)?.vision;
export const visionRunNote=(run:Run)=>{const v=(run.environment as {vision?:{requested:string;note:string}}).vision;const states=run.config.modelKeys.map(k=>visionOf(run,k)).filter(Boolean) as VisionState[];return {requested:run.config.vision??v?.requested??'legacy/default',effective:[...new Set(states.map(s=>s.effective))].join(' | ')||'Not confirmed: no model was loaded for this run.',limitation:[...new Set(states.map(s=>s.limitation).filter(Boolean))].join(' ')||v?.note||''};};
// Accepted-draft figures for the waves behind one summary row, pooled the way the sweep panel
// pools them: total kept over total drafted. Null where nothing was drafted at all, which is
// not the same as drafting that was always rejected.
const draftShare=(waves:Wave[])=>{const found=waves.map(w=>w.draft).filter(Boolean) as NonNullable<Wave['draft']>[];const generated=found.reduce((n,d)=>n+d.generated,0);return generated>0?found.reduce((n,d)=>n+d.accepted,0)/generated:null;};
const draftRun=(waves:Wave[])=>{const found=(waves.map(w=>w.draft).filter(Boolean) as NonNullable<Wave['draft']>[]).filter(d=>d.meanLen!==null);const tasks=found.reduce((n,d)=>n+d.tasks,0);return tasks>0?found.reduce((n,d)=>n+d.meanLen!*d.tasks,0)/tasks:null;};
export function summaries(run:Run){
 // An MTP sweep measures one model at several prediction depths in a single run, so the depth
 // is part of what identifies a measurement: pooling depths together would average a setting
 // against itself and hide the very difference the sweep was run to find.
 const groups=new Map<string,Sample[]>();for(const s of run.samples.filter(s=>!s.warmup)){const key=JSON.stringify([s.modelKey,s.testId,s.concurrency,s.mtpTokens??null]);const list=groups.get(key)??[];list.push(s);groups.set(key,list);}
 return [...groups.values()].map(ss=>{const s=ss[0],ok=ss.filter(x=>x.status==='completed'),waves=run.waves.filter(w=>w.modelKey===s.modelKey&&w.testId===s.testId&&w.concurrency===s.concurrency&&(w.mtpTokens??null)===(s.mtpTokens??null));const gpu=combineStats(ss.map(x=>x.gpu));return {vision:run.config.vision??'legacy/default',visionEffective:visionOf(run,s.modelKey)?.effective??'Not confirmed',visionImagesSent:visionOf(run,s.modelKey)?.imagesSent??false,visionProjectorUnloaded:visionOf(run,s.modelKey)?.projectorUnloaded??false,visionLimitation:visionOf(run,s.modelKey)?.limitation??'',mtp:s.mtpTokens===undefined?(run.config.mtp??'legacy/default'):s.mtpTokens===0?'off':'on',mtpDraftTokens:s.mtpTokens===undefined?(run.config.mtp==='on'?(run.config.mtpDraftTokens??2):null):(s.mtpTokens||null),mtpDepth:s.mtpTokens??null,draftAcceptance:draftShare(waves),draftMeanLen:draftRun(waves),model:s.modelName,modelKey:s.modelKey,test:s.testName,testId:s.testId,concurrency:s.concurrency,requests:ss.length,failures:ss.length-ok.length,failureRate:(ss.length-ok.length)/ss.length,generationTps:average(ok.map(x=>x.metrics.generationTps)),estimatedPrefillTps:average(ok.map(x=>x.metrics.prefillTps)),throughput:average(waves.map(w=>w.throughput)),medianMs:percentile(ok.map(x=>x.metrics.durationMs),0.5),p95Ms:percentile(ok.map(x=>x.metrics.durationMs),0.95),ttftMs:average(ok.map(x=>x.metrics.ttftMs)),objective:average(ok.map(x=>x.objective.score)),localJudge:average(ok.map(x=>x.grades.filter(g=>g.source==='local').at(-1)?.score??null)),externalJudge:average(ok.map(x=>x.grades.filter(g=>g.source==='external').at(-1)?.score??null)),gpuHotSpotAvg:gpu?.tempHotSpot?.avg??null,gpuHotSpotMax:gpu?.tempHotSpot?.max??null,gpuCoreTempAvg:gpu?.tempCore?.avg??null,gpuCoreTempMax:gpu?.tempCore?.max??null,gpuMemoryTempMax:gpu?.tempMemory?.max??null,gpuPowerAvg:gpu?.power?.avg??null,gpuLoadAvg:gpu?.load?.avg??null,gpuReadings:gpu?.samples??0};});
}
// Written only when a run actually measured more than one depth. A sweep whose later steps
// never loaded leaves one depth of results, which is a normal run and is reported as one.
export function mtpSweepReport(run:Run){
 if(measuredDepths(run).length<2)return '';
 const f=(n:number|null,d=2)=>n===null?'Unavailable':n.toFixed(d);
 const accepted=(r:{draft:{acceptance:number|null;accepted:number;generated:number;meanLen:number|null;tasks:number}|null})=>
  r.draft?.acceptance==null?'not applicable':`${(r.draft.acceptance*100).toFixed(1)}% (${r.draft.accepted} of ${r.draft.generated} drafted, mean accepted run ${f(r.draft.meanLen)}, from ${r.draft.tasks} reported request(s))`;
 const body=sweepVerdicts(run).map(v=>`### ${v.modelName} — ${v.concurrency} concurrent request${v.concurrency===1?'':'s'}\n\n${v.summary}\n\n`+v.rows.map(r=>
  `- ${r.label}: ${f(r.generationTps)} tok/s${r.generationSd===null?'':` (spread ${f(r.generationSd)})`}; total ${f(r.throughput)} tok/s; drafted tokens accepted ${accepted(r)}; median ${f(r.medianMs===null?null:r.medianMs/1000)} s; time to first token ${f(r.ttftMs===null?null:r.ttftMs/1000)} s; objective ${f(r.objective,1)}; ${r.completed} of ${r.requests} completed.`).join('\n')).join('\n\n');
 return `\n## Native MTP sweep\n\nEach depth is a separate load of the model. Depth 0 is MTP off; every other depth is how many tokens the model's own prediction heads draft ahead before the main model verifies them. Depths are compared only within one concurrency level, because the depth that is fastest on its own need not be the fastest under load. The accepted-draft figures are LM Studio's own, printed by its engine as each request finishes. Requests inside one concurrent wave are not independent of each other, so the spread quoted here is a floor on the real uncertainty rather than a significance test.\n\n${body}\n`;
}
const range=(s:GpuStat|null|undefined,unit:string,digits=1)=>!s?'Unavailable':`${s.min.toFixed(digits)}–${s.max.toFixed(digits)} ${unit} (average ${s.avg.toFixed(digits)})`;
export function gpuReport(gpu:RunGpu|undefined){
 if(!gpu)return 'GPU telemetry was not recorded for this run.';
 if(!gpu.available||!gpu.stats)return gpu.note||'GPU telemetry was not recorded for this run.';
 const stats=gpu.stats;
 return `Device: ${gpu.device}\n\nReadings: ${stats.samples}, sampled every ${gpu.intervalMs} ms.\n\n`+gpuMetrics.map(key=>`- ${gpuMetricLabels[key]}: ${range(stats[key],gpuMetricUnits[key])}`).join('\n')+`\n- Peak memory in use: ${stats.memoryUsedMax===null?'Unavailable':stats.memoryUsedMax.toFixed(0)+' MB'}\n\n${gpu.note}`;
}
function cell(v:unknown){let s=v===null||v===undefined?'':String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function exportText(run:Run,format:string){
 if(format==='json')return JSON.stringify(run,null,2);
 const rows=summaries(run);
 if(format==='csv'){const headers=rows.length?Object.keys(rows[0]):['model','test','concurrency','requests'];return '\uFEFF'+[headers.map(cell).join(','),...rows.map(row=>headers.map(k=>cell((row as any)[k])).join(','))].join('\r\n');}
 if(format!=='md')throw Error('Unsupported export format');
 const f=(n:number|null)=>n===null?'Unavailable':n.toFixed(2);
 return benchmarkReport(run)+`\n\n# ${run.config.name||'Local Model Bench'}\n\nCreated: ${run.created}\nStatus: ${run.status}\nVision requested: ${visionRunNote(run).requested}; confirmed effective state: ${visionRunNote(run).effective}${visionRunNote(run).limitation?'\n\nVision limitation: '+visionRunNote(run).limitation:''}\n\nNative MTP: ${run.config.mtp??'legacy/default'}; draft tokens: ${run.config.mtp==='on'?(run.config.mtpDraftTokens??2):'not applicable'}${measuredDepths(run).length>1?`; swept depths: ${measuredDepths(run).map(d=>mtpDepthLabel(d)).join(', ')}`:''}\n\nPrefill rates are estimates from client-timed processing events. Cache reuse is not measurable. Warm-ups are excluded. Generation includes reasoning tokens where reported by LM Studio.\n\n## Measurements\n\n`+rows.map(r=>`### ${r.model} / ${r.test} / concurrency ${r.concurrency}${r.mtpDepth===null?'':' / '+mtpDepthText(r.mtpDepth)}\n\nGeneration: ${f(r.generationTps)} tok/s; estimated prefill: ${f(r.estimatedPrefillTps)} tok/s; aggregate throughput: ${f(r.throughput)} tok/s. Median latency: ${f(r.medianMs)} ms; p95: ${f(r.p95Ms)} ms. Failures: ${r.failures}/${r.requests}.\n\nObjective: ${f(r.objective)}; local judge: ${f(r.localJudge)}; external judge: ${f(r.externalJudge)}.\n\nGPU hot spot: ${f(r.gpuHotSpotAvg)} °C average, ${f(r.gpuHotSpotMax)} °C peak; core ${f(r.gpuCoreTempAvg)} °C average; board power ${f(r.gpuPowerAvg)} W; from ${r.gpuReadings} reading(s) inside these requests.\n`).join('\n')+mtpSweepReport(run)+'\n## GPU thermals\n\n'+gpuReport(run.gpu)+'\n\n## Responses\n\n'+run.samples.filter(s=>!s.warmup).map(s=>`### ${s.modelName} — ${s.testName} (${s.id})\n\nStatus: ${s.status}${s.error?' — '+s.error:''}\n\n**Prompt**\n\n${s.prompt}\n\n**Response**\n\n${s.output}\n\n**Objective checks**\n\n${s.objective.checks.map(c=>`- ${c.passed?'PASS':'FAIL'}: ${c.label}: ${c.detail}`).join('\n')}\n\n${s.grades.map(g=>`**${g.source} grade (${g.judge}): ${g.score}**\n\n${g.summary}\n`).join('\n')}`).join('\n')+'\n## Run log\n\n'+run.logs.join('\n');
}
