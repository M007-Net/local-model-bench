// Measuring prompt processing honestly.
//
// The per-request prefill figure this app has always reported is input tokens divided by the
// interval between LM Studio's prompt_processing.start and prompt_processing.end events. That
// interval is not prefill. In practice it lands within a millisecond or two of time-to-first-token
// on every sample, because LM Studio raises the end event when the first token is ready rather
// than when the prompt finished being processed. So the figure carries the whole fixed cost of a
// request — HTTP, tokenization, scheduling, the sampler's first step — on top of the prefill
// itself.
//
// At the prompt sizes the performance tests use that fixed cost IS the measurement. A short test
// prompt of ~100 tokens against a ~150 ms floor reports somewhere near a third of the rate the
// same machine reaches on a long prompt, and the shortfall looks exactly like slow hardware.
//
// The fix is not a better single measurement, because no single measurement can separate a fixed
// cost from a per-token one. It takes two. Run the same model over a short prompt and a long one
// and the fixed cost is identical in both, so subtracting one from the other cancels it and what
// is left is the real per-token rate:
//
//     marginal t/s = (bigTokens - smallTokens) / (bigSeconds - smallSeconds)
//
// which is the slope of a two-point line, and the intercept is the fixed overhead the old figure
// was silently charging to the GPU.

import type {Run} from './types';
import {mtpDepthLabel,mtpDepthText} from './mtp-sweep';

export type PrefillPoint={tokens:number;ms:number};
export type PrefillCalibration={
 small:PrefillPoint;big:PrefillPoint;
 // Null whenever the two points cannot support a slope, rather than a number that looks measured.
 marginalTps:number|null;overheadMs:number|null;
 naiveTps:number|null; // What the old single-point method would have reported for the short prompt.
 note:string;repetitions?:number;validPairCount?:number;sampleSdTps?:number|null;cv?:number|null;fitR2?:number|null;method?:string;pairs?:{short:PrefillPoint;long:PrefillPoint;rate:number|null}[];
};

// The long prompt has to be enough longer than the short one that the difference is dominated by
// prefill rather than by the noise in two timings. Below these the slope is not reported at all.
export const minTokenRatio=4;
export const minDeltaMs=40;

export function calibratePrefill(small:PrefillPoint,big:PrefillPoint):PrefillCalibration{
 const naive=small.ms>0?small.tokens/(small.ms/1000):null;
 const dTok=big.tokens-small.tokens,dMs=big.ms-small.ms;
 const base={small,big,naiveTps:naive};
 if(![small.tokens,big.tokens,small.ms,big.ms].every(Number.isFinite)||!(small.tokens>0&&big.tokens>0&&small.ms>0&&big.ms>0))
  return {...base,marginalTps:null,overheadMs:null,note:'Not calibrated: a calibration request returned no timing.'};
 if(big.tokens<small.tokens*minTokenRatio)
  return {...base,marginalTps:null,overheadMs:null,note:`Not calibrated: the long prompt (${big.tokens} tokens) is not at least ${minTokenRatio}× the short one (${small.tokens}).`};
 if(dMs<minDeltaMs)
  return {...base,marginalTps:null,overheadMs:null,note:`Not calibrated: the two prompts differed by only ${Math.round(dMs)} ms, which is inside timing noise.`};
 const marginal=dTok/(dMs/1000);
 // Derived rather than measured: the part of the short request that was not prefill. A negative
 // value means the long prompt was cheaper per token than the line implies (cache reuse, or a
 // batch boundary), so it is clamped to zero rather than reported as a negative cost.
 const overhead=Math.max(0,small.ms-(small.tokens/marginal)*1000);
 return {...base,marginalTps:marginal,overheadMs:overhead,method:'Two-point client estimate',
  note:`Marginal client estimate from ${small.tokens} and ${big.tokens} token prompts; ${Math.round(overhead)} ms of fixed per-request cost removed.`};
}

const avg=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length;
const sd=(xs:number[])=>xs.length<2?null:Math.sqrt(xs.reduce((n,x)=>n+(x-avg(xs))**2,0)/(xs.length-1));
/** Repeated short/long calibration; the fit and paired spread remain client estimates. */
export function calibratePrefillRepeated(short:PrefillPoint[],long:PrefillPoint[]):PrefillCalibration{
 if(short.length!==long.length||short.length<2)throw Error('Repeated calibration needs at least two matched short/long pairs.');
 const pairs=short.map((s,i)=>({short:s,long:long[i],rate:calibratePrefill(s,long[i]).marginalTps}));
 const valid=pairs.filter((p):p is typeof p & {rate:number}=>p.rate!==null&&Number.isFinite(p.rate));
 const averagePoint=(xs:PrefillPoint[])=>xs.length?{tokens:avg(xs.map(x=>x.tokens)),ms:avg(xs.map(x=>x.ms))}:{tokens:0,ms:0};
 const small=averagePoint(valid.map(p=>p.short)),big=averagePoint(valid.map(p=>p.long));
 const base=calibratePrefill(small,big),rates=valid.map(p=>p.rate);
 if(valid.length<2)return {...base,marginalTps:null,overheadMs:null,sampleSdTps:null,cv:null,fitR2:null,repetitions:pairs.length,validPairCount:valid.length,pairs,method:'Repeated marginal client estimate',note:`Not calibrated: ${valid.length} of ${pairs.length} pairs passed token-size and timing checks; at least two valid pairs are required.`};
 const points=valid.flatMap(p=>[p.short,p.long]),mx=avg(points.map(p=>p.tokens)),my=avg(points.map(p=>p.ms));
 const slope=points.reduce((n,p)=>n+(p.tokens-mx)*(p.ms-my),0)/points.reduce((n,p)=>n+(p.tokens-mx)**2,0);
 const ssTot=points.reduce((n,p)=>n+(p.ms-my)**2,0),ssRes=points.reduce((n,p)=>n+(p.ms-(my+slope*(p.tokens-mx)))**2,0);
 const spread=sd(rates),meanRate=avg(rates),marginal=Number.isFinite(slope)&&slope>0?1000/slope:null,r2=ssTot>0?1-ssRes/ssTot:null;
 return {...base,small,big,marginalTps:marginal,overheadMs:marginal===null?null:Math.max(0,my-slope*mx),sampleSdTps:spread,cv:spread!==null&&meanRate?spread/meanRate:null,fitR2:r2,repetitions:short.length,validPairCount:rates.length,pairs,method:'Repeated marginal client estimate from a least-squares time/token fit; spread describes individual paired rates',
  note:marginal===null?'Not calibrated: valid pairs did not support a positive timing slope.':`Repeated ${rates.length}/${short.length}-pair marginal client estimate ${marginal.toFixed(1)} tok/s (paired-rate sample SD ${spread?.toFixed(1)??'unavailable'}, CV ${spread!==null&&meanRate?(100*spread/meanRate).toFixed(1)+'%':'unavailable'}, fit R² ${r2?.toFixed(4)??'unavailable'}). Fixed request overhead is estimated, not engine-measured.`};
}

// The prompt the calibration sends. Deliberately repetitive and free of anything a model would
// treat as an instruction: it is never scored, and only its length matters. The unit is sized so
// that a few repeats land near 100 tokens and sixty land near 3000.
const UNIT='A regional office runs a router, two switches, staff workstations, and a file service. Backups complete nightly. Monitoring tracks latency, availability, capacity, and authentication errors.\n';
export const calibrationPrompt=(repeats:number):string=>
 `Read these notes and reply with the single word noted.\n${UNIT.repeat(Math.max(1,repeats))}`;
// Small enough to be mostly overhead, large enough to be a real request; and a long one that at
// 8192 context still leaves room for the reply.
export const calibrationRepeats={small:2,big:60,count:3};

export const prefillText=(c:PrefillCalibration|null|undefined):string=>
 !c?'Not measured':c.marginalTps===null?c.note:`${Math.round(c.marginalTps)} t/s (${Math.round(c.overheadMs??0)} ms overhead removed)`;

// Calibrated prompt processing is measured once per loaded instance rather than per request, so it
// is looked up by model (and by depth when a sweep loaded the model more than once) rather than
// living on the row. Rows pooled from other runs carry their own copy instead; see HistoryRow.
// The key a calibration is stored under. mtpDepthText, never 'MTP ' + mtpDepthLabel: the label for
// depth 0 is already 'MTP off', so the shorter form spells 'MTP MTP off' — the same trap the sweep
// labels carry a warning about.
export const calibrationKey=(modelKey:string,depth:number|null,pMin?:number|null):string=>
 (depth===null?`prefill:${modelKey}`:`prefill:${modelKey} · ${mtpDepthText(depth)}`)+(pMin==null?'':` · p-min ${pMin}`);
// Runs saved before that was fixed used 'MTP ' + the label, doubling the prefix at depth 0. They are
// still read, because a key format is not worth losing a finished run's measurements over.
const legacyKey=(modelKey:string,depth:number):string=>`prefill:${modelKey} · MTP ${mtpDepthLabel(depth)}`;
export function calibrationFor(run:Run,modelKey:string,depth:number|null,pMin?:number|null):PrefillCalibration|null{
 const info=run.modelInfo as Record<string,unknown>;
 if(pMin!=null){const value=info[calibrationKey(modelKey,depth,pMin)];return value&&typeof value==='object'&&'marginalTps' in value?value as PrefillCalibration:null;}
 const candidates=depth===null?[]:[calibrationKey(modelKey,depth),legacyKey(modelKey,depth)];
 // The undepthed key last: a run with no sweep stores exactly one calibration under it.
 for(const key of [...candidates,`prefill:${modelKey}`]){
  const value=info[key];
  if(value&&typeof value==='object'&&'marginalTps' in (value as object))return value as PrefillCalibration;
 }
 return null;
}
