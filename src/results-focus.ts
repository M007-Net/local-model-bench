import type {ChartRow} from './charts';
import type {Run} from './types';
import type {PrefillCalibration} from './prefill';
import {mtpDepthText} from './mtp-sweep';
import {calibrationFor} from './prefill';
export {calibrationFor};

// Reading a run one question at a time.
//
// The comparison table carries every measurement a run produced, which is right when the question
// is "what happened" and wrong when it is "why is prompt processing slow". Prefill and generation
// are not the same measurement and they are not limited by the same thing: generation is bound by
// memory bandwidth and helped by speculative decoding, prefill is bound by compute and helped by
// neither. Mixing them into one row means the columns that would answer either question are
// spread across a table too wide to read.
//
// So the same rows are offered under three headings. Nothing is recalculated and nothing is
// hidden that the "All measurements" view would not also show; the columns simply change to the
// ones that bear on the question being asked.
export type ResultsFocus='all'|'prefill'|'generation';
export const resultsFocuses:{value:ResultsFocus;label:string}[]=[
 {value:'all',label:'All measurements'},
 {value:'prefill',label:'Prompt processing'},
 {value:'generation',label:'Token generation'},
];

export type Fmt=(n:number|null|undefined,digits?:number)=>string;
// `identity` is the model/test cell, which is several lines rather than a value and is rendered by
// the table itself; every other column is a single string this module produces.
export type FocusColumn={header:string;identity?:true;cell:(r:ChartRow,n:Fmt,rows:ChartRow[])=>string;title?:string};


// A row pooled from another run carries that run's calibration with it, because this screen only
// holds the modelInfo of the run being viewed. Own rows have no such field and fall back to it.
const carried=(r:ChartRow,key:'prefillCalibratedTps'|'prefillOverheadMs'):number|null|undefined=>
 (r as ChartRow&{prefillCalibratedTps?:number|null;prefillOverheadMs?:number|null})[key];
const identity:FocusColumn={header:'Model / test',identity:true,cell:r=>r.model};
const concurrency:FocusColumn={header:'Concurrency',cell:r=>String(r.concurrency)};
const failures:FocusColumn={header:'Failures',cell:r=>`${r.failures}/${r.requests}`};

// The columns that bear on how fast the model turns a prompt into its first token. Calibrated
// prefill is the honest figure; the estimate beside it is the one every earlier run recorded, kept
// so the two can be compared rather than silently swapped.
const prefillColumns=(run:Run):FocusColumn[]=>[
 identity,concurrency,
 {header:'Prefill, calibrated',title:'Measured from two prompt lengths so the fixed per-request cost cancels. This is the figure to compare across machines.',
  cell:(r,n)=>{const v=carried(r,'prefillCalibratedTps')??calibrationFor(run,r.modelKey,r.mtpDepth)?.marginalTps;return v==null?'—':n(v,0)+' tok/s';}},
 {header:'Fixed overhead',title:'The part of time-to-first-token that is not prompt processing: HTTP, tokenization, scheduling, the first sampling step.',
  cell:(r,n)=>{const v=carried(r,'prefillOverheadMs')??calibrationFor(run,r.modelKey,r.mtpDepth)?.overheadMs;return v==null?'—':n(v,0)+' ms';}},
 {header:'Prefill, per request',title:'Input tokens divided by the prompt-processing interval LM Studio reports. At short prompts this is mostly fixed overhead, which is why the calibrated column exists.',
  cell:(r,n)=>n(r.estimatedPrefillTps)},
 {header:'First token',cell:(r,n)=>r.ttftMs===null?'—':n(r.ttftMs/1000,2)+' s'},
 {header:'Median / p95',cell:(r,n)=>`${n(r.medianMs===null?null:r.medianMs/1000)} / ${n(r.p95Ms===null?null:r.p95Ms/1000)} s`},
 failures,
];

// The columns that bear on how fast the model produces tokens once it has started: the per-request
// rate, what speculative decoding did to it, and what happens to both under concurrency.
const generationColumns:FocusColumn[]=[
 identity,concurrency,
 {header:'MTP',title:'How many tokens the model’s own prediction heads drafted ahead before the main model verified them. Depth is fixed when the model is loaded.',
  cell:r=>r.mtpDepth===null?String(r.mtp):mtpDepthText(r.mtpDepth)},
 {header:'Gen tok/s',title:'Per request, averaged over the requests that completed. This is what one user experiences.',cell:(r,n)=>n(r.generationTps)},
 {header:'Total tok/s',title:'The whole wave’s output divided by the wall time it took. This is what the machine delivers across all concurrent users at once, and it keeps rising after the per-request rate has started falling.',
  cell:(r,n)=>n(r.throughput)},
 {header:'Per user vs 1',title:'The per-request rate at this concurrency as a share of the same model, test and depth at concurrency 1. This is the cost each extra concurrent user imposes on every other one.',
  cell:(r,n,rows)=>{const ratio=perUserRatio(rows,r);return ratio===null?'—':(ratio*100).toFixed(0)+'%';}},
 {header:'Draft accepted',title:'The share of drafted tokens the main model kept. Blank where nothing was drafted.',
  cell:(r,n)=>r.draftAcceptance==null?'—':(r.draftAcceptance*100).toFixed(1)+'%'},
 {header:'Median / p95',cell:(r,n)=>`${n(r.medianMs===null?null:r.medianMs/1000)} / ${n(r.p95Ms===null?null:r.p95Ms/1000)} s`},
 failures,
];

const allColumns:FocusColumn[]=[
 identity,concurrency,
 {header:'Gen tok/s',cell:(r,n)=>n(r.generationTps)},
 {header:'Prefill est.',cell:(r,n)=>n(r.estimatedPrefillTps)},
 {header:'Total tok/s',cell:(r,n)=>n(r.throughput)},
 {header:'Median / p95',cell:(r,n)=>`${n(r.medianMs===null?null:r.medianMs/1000)} / ${n(r.p95Ms===null?null:r.p95Ms/1000)} s`},
 failures,
 {header:'Objective',cell:(r,n)=>n(r.objective)},
 {header:'Local judge',cell:(r,n)=>n(r.localJudge)},
 {header:'External',cell:(r,n)=>n(r.externalJudge)},
 {header:'GPU hot spot avg / peak',cell:(r,n)=>`${n(r.gpuHotSpotAvg)} / ${n(r.gpuHotSpotMax)} °C`},
];

// Which engine a row was measured on. Only shown while more than one engine is in the table: on a
// single-engine view it would be the same word on every line.
const engineColumn:FocusColumn={header:'Engine',title:'The llama.cpp build that produced this row. Rows from other engines come from other saved runs, whose other conditions may differ.',
 cell:r=>(r as ChartRow&{backend?:string}).backend??'—'};

export const focusColumns=(focus:ResultsFocus,run:Run,withEngine=false):FocusColumn[]=>{
 const base=focus==='prefill'?prefillColumns(run):focus==='generation'?generationColumns:allColumns;
 return withEngine?[base[0],engineColumn,...base.slice(1)]:base;
};

// Filled in by the caller, which has the per-request samples; this only says which tiles belong to
// which question and what each one means.
export const focusBlurb=(focus:ResultsFocus):string=>
 focus==='prefill'
  ?'Prompt processing is how fast the model reads a prompt before it writes anything. It is compute-bound, so it is helped by a faster engine and by a quantization the engine has a fast kernel for, and not at all by speculative decoding. The calibrated column is measured from two prompt lengths so the fixed per-request cost cancels; the per-request column is the older estimate, which at short prompts is mostly that fixed cost rather than the GPU.'
  :focus==='generation'
  ?'Token generation is how fast the model writes once it has started. It is bound by memory bandwidth, so a smaller quantization of the same model usually helps and speculative decoding can help further by letting the model verify several drafted tokens at once. Per-request rate falls as concurrency rises while total throughput keeps climbing: the first is what one user feels, the second is what the machine delivers.'
  :'Every measurement this run produced, including quality scores and GPU telemetry. Use the other two views when the question is specifically about prompt processing or about generation speed.';

// One-line label for the per-user-versus-one column, resolved against the concurrency-1 row for the
// same model, test and depth. Returned as a ratio so a run with no concurrency-1 row shows nothing
// rather than an unexplained number.
export function perUserRatio(rows:ChartRow[],r:ChartRow):number|null{
 if(r.concurrency===1)return 1;
 const base=rows.find(x=>x.modelKey===r.modelKey&&x.testId===r.testId&&x.mtpDepth===r.mtpDepth&&x.concurrency===1);
 return base?.generationTps&&r.generationTps?r.generationTps/base.generationTps:null;
}
