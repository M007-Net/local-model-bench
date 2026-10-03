import type {Run,Sample,Wave} from './types';
import {summaries} from '../electron/export';
import {escapeHtml} from './charts';

const cell=(value:unknown)=>`<td>${value===null||value===undefined?'Unavailable':escapeHtml(typeof value==='number'?Number(value.toFixed(2)):value)}</td>`;
const percent=(value:number|null|undefined)=>value==null?'Unavailable':`${value.toFixed(1)}%`;
const cacheIntent=(mode:string)=>mode==='cold-prompt'?'Cold-prompt intent':mode==='cached-prefix-followup'?'Cached-prefix follow-up intent':mode==='total-context'?'Total-context intent':'Unknown (legacy or not recorded)';
const sampleMatches=(sample:Sample,row:{modelKey:string;testId:string;concurrency:number;mtpDepth:number|null})=>
 !sample.warmup&&sample.modelKey===row.modelKey&&sample.testId===row.testId&&sample.concurrency===row.concurrency&&(sample.mtpTokens??null)===row.mtpDepth;
const stopLimitCell=(samples:Sample[])=>{
 const known=samples.filter(s=>typeof s.possibleTruncation==='boolean');
 return known.length?`${known.filter(s=>s.possibleTruncation).length} / ${known.length} possible output-limit stops`:'Unavailable';
};
const toleranceCell=(row:{inputTargetTokens:number|null;inputWithinTolerance:number|null;inputToleranceObservedN:number})=>
 row.inputTargetTokens==null?'Not measured':row.inputWithinTolerance==null?'Unavailable':`${row.inputWithinTolerance} / ${row.inputToleranceObservedN} measured inputs within tolerance`;

function inputCacheOutputTable(run:Run,rows:ReturnType<typeof summaries>){
 if(!rows.length)return '';
 const headings=['Model / prompt','Concurrency','Controlled input target (tokens)','Input tolerance','Observed input mean (tokens)','Observed deviation from target','Within tolerance (count / observed)','Approximate context target (tokens)','Cache intent','Cache-prime input tokens','Cached input mean (server reported)','New input mean (server reported)','Cache accounting source','Requested output limit (tokens)','Actual output mean (tokens)','Possible output-limit stops'];
 return `<h3>Input, cache, and output observations</h3><p>Actual input counts come from endpoint usage when available. The cache mode describes prompt protocol intent; it does not prove a cold cache or a cache hit. Cache-prime input is shown separately and is not counted as a measured cache hit. Output-limit stops are inferred from the saved truncation/finish-reason flag; they indicate a possible cap stop rather than a confirmed cause.</p><div style="overflow-x:auto"><table><tr>${headings.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr>${rows.map(r=>{
  const samples=run.samples.filter(s=>sampleMatches(s,r));
  const within=toleranceCell(r);
  const cached=r.cacheHitsKnown?r.cachedInputTokensMean:null,newTokens=r.cacheHitsKnown?r.newInputTokensMean:null;
  return `<tr>${[
   `${r.model} / ${r.test}${r.mtpDepth===null?'':` / MTP ${r.mtpDepth}`}`,r.concurrency,r.inputTargetTokens,r.inputTargetTolerancePct==null?null:`± ${percent(r.inputTargetTolerancePct)}`,
   r.actualInputTokensMean??r.inputTokensMean,r.inputTargetDeviationPct==null?null:percent(r.inputTargetDeviationPct),within,r.contextTarget,
   cacheIntent(r.cacheMode),r.cachePrimeInputTokens,cached,newTokens,r.cacheAccountingMethods,
   r.requestedOutputLimitTokens,r.actualOutputTokensMean,stopLimitCell(samples),
  ].map(cell).join('')}</tr>`;
 }).join('')}</table></div>`;
}

function arrivalTable(run:Run){
 const waves=run.waves.filter(w=>w.arrival);
 if(!waves.length)return '';
 const headings=['Model','Prompt','Concurrency cap','Offered target (requests/s)','Offered interval (s)','Response latency target (ms)','Planned arrivals','Started','Cancelled before start','Capacity drops','Completed','Failed','Achieved starts/s (offer interval)','Mean / p95 queue wait (ms)','Target-meeting goodput (requests/s)','Goodput denominator'];
 const rows=waves.map(w=>{
  const a=w.arrival!;
  const info=run.modelInfo[w.modelKey] as {model?:{display_name?:string}}|undefined;
  const model=info?.model?.display_name??w.modelKey;
  const test=run.tests.find(t=>t.id===w.testId)?.name??w.testId;
  const target=a.latencyTargetsMs?.responseMs??run.config.latencyTargetMs??null;
  return `<tr>${[
   model,test,w.concurrency,run.config.arrivalRatePerSecond??null,
   a.offeredIntervalMs==null?null:a.offeredIntervalMs/1000,target,a.planned,a.started,a.cancelledBeforeStart,a.capacityDrops,
   a.completed,a.failed,a.achievedArrivalRatePerSecond,a.meanQueueWaitMs==null&&a.p95QueueWaitMs==null?null:`${a.meanQueueWaitMs==null?'Unavailable':a.meanQueueWaitMs.toFixed(1)} / ${a.p95QueueWaitMs==null?'Unavailable':a.p95QueueWaitMs.toFixed(1)}`,
   a.latencyTargetGoodputPerSecond,a.latencyTargetGoodputDenominator,
  ].map(cell).join('')}</tr>`;
 });
 return `<h3>Arrival-rate outcomes</h3><p>Offered arrivals follow a fixed schedule, independent of response completion. Starts/s uses the offer interval; response-target goodput counts completed requests whose scheduled-arrival-to-completion latency met the target, divided by the full wall interval. Queue wait runs from each scheduled arrival to actual dispatch. A finite concurrency cap can limit delivered load. Wave records preserve planned and cancelled arrivals even when no request sample was saved.</p><div style="overflow-x:auto"><table><tr>${headings.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr>${rows.join('')}</table></div>`;
}

export function streamingReport(run:Run){
 const rows=summaries(run),arrivalWaves=run.waves.some(w=>!!w.arrival);
 if(!rows.some(r=>r.streamingRequests||r.contextTarget!==null||r.inputTargetTokens!==null||r.cacheMode!=='legacy/unknown'||r.loadProfile==='sustained')&&!arrivalWaves)return '';
 const isArrival=run.config.loadProfile==='arrival-rate'||arrivalWaves;
 const lead=`Load profile: ${escapeHtml(run.config.loadProfile??'waves')}. ${run.config.loadProfile==='sustained'?`${run.config.durationSec??30} seconds of new requests per combination; throughput includes in-flight drain. Fixed concurrency, not fixed arrival rate.`:''}${isArrival?' Offered arrivals are open-loop; queued arrivals and the configured in-flight cap affect achieved starts.':''} First output and stream gaps are client-observed, including buffering. Chunks can contain multiple tokens; gaps are not exact inter-token latency. Percentiles exclude failed requests and warm-ups and are unstable for small samples. Approximate context targets do not change server context capacity. Missing historical fields remain unavailable.`;
 const streamingHeadings=['Model / prompt','Concurrency','Approximate context target (tokens)','Actual input tokens (mean)','Timed responses','First output p50 ms','First output p95 ms','First output p99 ms','Response p99 ms','Mean stream gap ms','Worst stream gap ms','Estimated ms/token'];
 const streamingRows=rows.map(r=>`<tr>${[
  `${r.model} / ${r.test}${r.mtpDepth===null?'':` / MTP ${r.mtpDepth}`}`,r.concurrency,r.contextTarget,r.inputTokensMean,r.streamingRequests,
  r.firstEventP50Ms,r.firstEventP95Ms,r.firstEventP99Ms,r.requestP99Ms,r.meanStreamGapMs,r.worstStreamGapMs,r.estimatedTpotMs,
 ].map(cell).join('')}</tr>`).join('');
 return `<h2>Streaming and load behavior</h2><p>${lead}</p>${streamingRows?`<div style="overflow-x:auto"><table><tr>${streamingHeadings.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr>${streamingRows}</table></div>`:''}${inputCacheOutputTable(run,rows)}${arrivalTable(run)}`;
}
