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

export type PrefillPoint={tokens:number;ms:number};
export type PrefillCalibration={
 small:PrefillPoint;big:PrefillPoint;
 // Null whenever the two points cannot support a slope, rather than a number that looks measured.
 marginalTps:number|null;overheadMs:number|null;
 naiveTps:number|null; // What the old single-point method would have reported for the short prompt.
 note:string;
};

// The long prompt has to be enough longer than the short one that the difference is dominated by
// prefill rather than by the noise in two timings. Below these the slope is not reported at all.
export const minTokenRatio=4;
export const minDeltaMs=40;

export function calibratePrefill(small:PrefillPoint,big:PrefillPoint):PrefillCalibration{
 const naive=small.ms>0?small.tokens/(small.ms/1000):null;
 const dTok=big.tokens-small.tokens,dMs=big.ms-small.ms;
 const base={small,big,naiveTps:naive};
 if(!(small.tokens>0&&big.tokens>0&&small.ms>0&&big.ms>0))
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
 return {...base,marginalTps:marginal,overheadMs:overhead,
  note:`Calibrated from ${small.tokens} and ${big.tokens} token prompts; ${Math.round(overhead)} ms of fixed per-request cost removed.`};
}

// The prompt the calibration sends. Deliberately repetitive and free of anything a model would
// treat as an instruction: it is never scored, and only its length matters. The unit is sized so
// that a few repeats land near 100 tokens and sixty land near 3000.
const UNIT='A regional office runs a router, two switches, staff workstations, and a file service. Backups complete nightly. Monitoring tracks latency, availability, capacity, and authentication errors.\n';
export const calibrationPrompt=(repeats:number):string=>
 `Read these notes and reply with the single word noted.\n${UNIT.repeat(Math.max(1,repeats))}`;
// Small enough to be mostly overhead, large enough to be a real request; and a long one that at
// 8192 context still leaves room for the reply.
export const calibrationRepeats={small:2,big:60};

export const prefillText=(c:PrefillCalibration|null|undefined):string=>
 !c?'Not measured':c.marginalTps===null?c.note:`${Math.round(c.marginalTps)} t/s (${Math.round(c.overheadMs??0)} ms overhead removed)`;

// Calibrated prompt processing is measured once per loaded instance rather than per request, so it
// is looked up by model (and by depth when a sweep loaded the model more than once) rather than
// living on the row. Rows pooled from other runs carry their own copy instead; see HistoryRow.
export function calibrationFor(run:Run,modelKey:string,depth:number|null):PrefillCalibration|null{
 const info=run.modelInfo as Record<string,unknown>;
 const exact=depth===null?undefined:info[`prefill:${modelKey} · MTP ${depth===0?'off':String(depth)}`];
 const value=exact??info[`prefill:${modelKey}`];
 return value&&typeof value==='object'&&'marginalTps' in (value as object)?value as PrefillCalibration:null;
}
