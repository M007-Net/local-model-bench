import {average,percentile} from '../electron/metrics';
import type {Run,Sample,Wave} from './types';

// One sweep step is one MTP depth: how many tokens the model's own prediction heads are
// allowed to draft ahead before the main model verifies them. Depth 0 means MTP off, so a
// sweep can include the baseline that any claimed speedup has to be measured against.
// Depth is a load-time setting, so every depth costs a full reload of the model.
export const maxMtpDepth=8;
// 1 through 5 is the range that separates a real speed-up from a deeper draft the main model
// keeps having to throw away, and 0 is the MTP-off baseline the whole comparison rests on.
export const defaultSweep=[0,1,2,3,4,5];
export const mtpDepthLabel=(depth:number|null|undefined)=>
 depth===0?'MTP off':typeof depth==='number'&&Number.isInteger(depth)?`${depth} token${depth===1?'':'s'}`:'Legacy/default';
// The same thing said where it stands on its own rather than under a column heading, so that a
// bare "2 tokens" cannot be read as anything else. Never "MTP " + mtpDepthLabel, which would
// say "MTP MTP off" at depth 0.
export const mtpDepthText=(depth:number|null|undefined)=>
 depth===0?'MTP off':typeof depth==='number'&&Number.isInteger(depth)?`MTP ${mtpDepthLabel(depth)}`:'MTP legacy/default';

// Discards anything that could not be loaded, and orders and de-duplicates what is left, so
// "4, 2, 2, 0" and "0, 2, 4" describe the same sweep and produce the same steps.
export function normalizeSweep(values:unknown):number[]{
 if(!Array.isArray(values))return [];
 return [...new Set(values.filter((n):n is number=>typeof n==='number'&&Number.isInteger(n)&&n>=0&&n<=maxMtpDepth))].sort((a,b)=>a-b);
}

export type MtpConfig={mtp?:'off'|'on';mtpDraftTokens?:number;mtpSweep?:number[]};
export type MtpStep={depth:number|null;mode:'off'|'on'|undefined;tokens:number;label:string};
// A sweep only means anything where MTP is available at all, which is exactly what the run's
// own MTP switch already asserts for every selected model. With no sweep this returns the
// single step the run has always had, whose depth is null: measurements from runs saved
// before sweeping existed are left exactly as they were rather than relabelled.
export function sweepSteps(config:MtpConfig):MtpStep[]{
 const tokens=config.mtpDraftTokens??2,sweep=normalizeSweep(config.mtpSweep);
 if(config.mtp!=='on'||!sweep.length)return [{depth:null,mode:config.mtp,tokens,label:mtpDepthLabel(null)}];
 return sweep.map(depth=>({depth,mode:depth===0?'off':'on',tokens:depth===0?tokens:depth,label:mtpDepthLabel(depth)}));
}
export const isSweep=(config:MtpConfig)=>sweepSteps(config).length>1;
// Every depth a preflight would stand in for. Whether a model can attach its MTP head at all
// does not depend on how many tokens it is then allowed to draft, so one load answers the
// question for all of them and the shallowest is the cheapest one to ask with.
export const onSteps=(steps:MtpStep[])=>steps.filter(s=>s.mode==='on');
export const preflightStep=(steps:MtpStep[]):MtpStep|null=>onSteps(steps)[0]??null;

// The depth a saved measurement was taken at, whether it came from a sweep step or from a
// run's single MTP setting. This is what lets a sweep step be compared with an ordinary run
// that happened to use the same depth.
export const rowDepth=(r:{mtpDepth?:number|null;mtp?:string;mtpDraftTokens?:number|null}):number|null=>
 typeof r.mtpDepth==='number'?r.mtpDepth:r.mtp==='on'?(typeof r.mtpDraftTokens==='number'?r.mtpDraftTokens:2):r.mtp==='off'?0:null;

// Depths actually present in saved responses, not the depths that were requested: a step
// whose load failed verification took no measurements and must not appear as a result.
export function measuredDepths(run:Pick<Run,'samples'>):number[]{
 return [...new Set(run.samples.filter(s=>!s.warmup&&typeof s.mtpTokens==='number').map(s=>s.mtpTokens as number))].sort((a,b)=>a-b);
}

function spread(values:number[]){
 if(values.length<2)return null;
 const mean=values.reduce((a,b)=>a+b,0)/values.length;
 return Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/(values.length-1));
}

// Concurrency levels measured on one model at one depth, in the order a sweep ran them.
export const measuredConcurrency=(run:Pick<Run,'samples'>):number[]=>
 [...new Set(run.samples.filter(s=>!s.warmup).map(s=>s.concurrency))].sort((a,b)=>a-b);

// How much of the drafting was kept, pooled over the waves in a row: total accepted over total
// drafted, which weights a long request more heavily than a short one exactly as it should.
// `tasks` is how many requests llama.cpp actually reported on, so a row can say whether every
// request it covers was accounted for rather than quietly averaging fewer.
export type SweepDraft={acceptance:number|null;meanLen:number|null;accepted:number;generated:number;tasks:number};
function pooledDraft(waves:Wave[]):SweepDraft|null{
 const found=waves.map(w=>w.draft).filter((d):d is NonNullable<Wave['draft']>=>!!d&&d.generated>0);
 if(!found.length)return null;
 const accepted=found.reduce((n,d)=>n+d.accepted,0),generated=found.reduce((n,d)=>n+d.generated,0);
 const tasks=found.reduce((n,d)=>n+d.tasks,0);
 const lengths=found.filter(d=>d.meanLen!==null);
 return {acceptance:generated>0?accepted/generated:null,
  meanLen:lengths.length?lengths.reduce((n,d)=>n+d.meanLen!*d.tasks,0)/lengths.reduce((n,d)=>n+d.tasks,0):null,
  accepted,generated,tasks};
}

export type SweepRow={
 modelKey:string;modelName:string;depth:number;label:string;concurrency:number;
 requests:number;completed:number;failures:number;
 generationTps:number|null;generationSd:number|null;generationSe:number|null;
 throughput:number|null;ttftMs:number|null;medianMs:number|null;p95Ms:number|null;objective:number|null;
 draft:SweepDraft|null;
};
// One row per model, depth and concurrency level, pooled across every test and wave that ran
// there. Concurrency is kept apart rather than pooled into the depth: drafting competes with
// the other slots for the same batch, so the depth that wins alone is not always the depth
// that wins under load, and averaging the two together would hide exactly that. Failed
// requests are counted but never averaged into a rate.
export function sweepRows(run:Pick<Run,'samples'|'waves'>):SweepRow[]{
 const depths=measuredDepths(run),levels=measuredConcurrency(run);
 const keys=[...new Set(run.samples.filter(s=>!s.warmup).map(s=>s.modelKey))];
 const rows:SweepRow[]=[];
 for(const modelKey of keys)for(const depth of depths)for(const concurrency of levels){
  const samples=run.samples.filter((s:Sample)=>!s.warmup&&s.modelKey===modelKey&&s.mtpTokens===depth&&s.concurrency===concurrency);
  if(!samples.length)continue;
  const ok=samples.filter(s=>s.status==='completed');
  const rates=ok.map(s=>s.metrics.generationTps).filter((n):n is number=>typeof n==='number'&&Number.isFinite(n));
  const sd=spread(rates);
  const waves=run.waves.filter((w:Wave)=>w.modelKey===modelKey&&w.mtpTokens===depth&&w.concurrency===concurrency);
  rows.push({modelKey,modelName:samples[0].modelName,depth,label:mtpDepthLabel(depth),concurrency,
   requests:samples.length,completed:ok.length,failures:samples.length-ok.length,
   generationTps:average(rates),generationSd:sd,generationSe:sd!==null&&rates.length>1?sd/Math.sqrt(rates.length):null,
   throughput:average(waves.map(w=>w.throughput)),ttftMs:average(ok.map(s=>s.metrics.ttftMs)),
   medianMs:percentile(ok.map(s=>s.metrics.durationMs),.5),p95Ms:percentile(ok.map(s=>s.metrics.durationMs),.95),
   objective:average(ok.map(s=>s.objective.score)),draft:pooledDraft(waves)});
 }
 return rows;
}

export type SweepVerdict={
 modelKey:string;modelName:string;concurrency:number;rows:SweepRow[];
 baseline:SweepRow|null;best:SweepRow|null;gainPercent:number|null;withinNoise:boolean;qualityDelta:number|null;summary:string;
};
const percent=(n:number)=>`${n>=0?'+':'−'}${Math.abs(n).toFixed(1)}%`;
// Two averages differ meaningfully only when the gap clears the spread of the measurements
// behind them. Requests inside one concurrent wave are not independent of each other, so this
// interval is optimistic and is described as a floor, never as a significance test.
const noisy=(a:SweepRow,b:SweepRow)=>{
 const ea=a.generationSe,eb=b.generationSe;
 if(ea===null&&eb===null)return true;
 const combined=Math.sqrt((ea??0)**2+(eb??0)**2);
 return Math.abs((a.generationTps??0)-(b.generationTps??0))<2*combined;
};
// One verdict per model and concurrency level. A depth is only ever compared with another
// depth measured under the same load, because that is the only comparison that means anything:
// the fastest depth at one request at a time need not be the fastest with five in flight.
export function sweepVerdicts(run:Pick<Run,'samples'|'waves'>):SweepVerdict[]{
 const all=sweepRows(run);
 const groups=[...new Set(all.map(r=>r.modelKey+' '+r.concurrency))];
 return groups.map(group=>{
  const [modelKey,level]=group.split(' '),concurrency=Number(level);
  const rows=all.filter(r=>r.modelKey===modelKey&&r.concurrency===concurrency).sort((a,b)=>a.depth-b.depth);
  const usable=rows.filter(r=>r.generationTps!==null&&r.completed>0);
  const baseline=usable[0]??null;
  const best=usable.reduce<SweepRow|null>((b,r)=>b===null||r.generationTps!>b.generationTps!?r:b,null);
  const modelName=rows[0]?.modelName??modelKey;
  if(!baseline||!best||usable.length<2)
   return {modelKey,modelName,concurrency,rows,baseline,best,gainPercent:null,withinNoise:true,qualityDelta:null,
    summary:'Not enough completed measurements to compare depths. Only one depth produced results.'};
  const gainPercent=baseline.generationTps!>0?(best.generationTps!-baseline.generationTps!)/baseline.generationTps!*100:null;
  const qualityDelta=best.objective!==null&&baseline.objective!==null?best.objective-baseline.objective:null;
  // When the baseline itself comes out fastest, what matters is whether the next-best depth was
  // really beaten or merely came second by less than the measurements can resolve. Saying
  // "nothing beat MTP off" about a dead heat would read as a verdict on MTP that was not earned.
  const runnerUp=usable.filter(r=>r.depth!==best.depth).reduce<SweepRow|null>((b,r)=>b===null||r.generationTps!>b.generationTps!?r:b,null);
  const withinNoise=best.depth===baseline.depth?runnerUp!==null&&noisy(best,runnerUp):noisy(best,baseline);
  const quality=qualityDelta!==null&&qualityDelta<=-1
   ? ` Objective checks scored ${Math.abs(qualityDelta).toFixed(1)} points lower at that depth than at ${baseline.label}; read the responses before adopting it.`:'';
  const summary=best.depth===baseline.depth
   ? withinNoise
    ? `Nothing beat ${baseline.label} on the numbers, but ${runnerUp!.label} is inside the spread of these measurements: this run does not separate them. Add waves before concluding anything.`
    : `Nothing beat ${baseline.label}: it was the fastest depth measured for this model at ${concurrency} concurrent request${concurrency===1?'':'s'}.`
   : withinNoise
    ? `${best.label} measured ${gainPercent===null?'faster':percent(gainPercent)} against ${baseline.label}, but the gap is no larger than the spread of the measurements themselves. Add waves before treating it as real.${quality}`
    : `${best.label} was fastest: ${gainPercent===null?'faster':percent(gainPercent)} against ${baseline.label}.${quality}`;
  return {modelKey,modelName,concurrency,rows,baseline,best,gainPercent,withinNoise,qualityDelta,summary};
 });
}
