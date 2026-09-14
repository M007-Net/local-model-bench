import type {ChartRow} from './charts';
import type {ModelProfile} from './model-profile';
import {percentile} from '../electron/metrics';
// One saved measurement group (model x test x concurrency) from one run, carrying the facts needed to pool
// it with the same measurement taken in a different run. It extends the summary row the single-run screens
// already use, so no measurement is recomputed here.
export const unknownFacet='Unknown';
export const unknownSize='Unknown size';
export type HistoryRow=ChartRow&{
 runId:string;runName:string;runCreated:string;runStatus:string;
 family:string;kind:ModelProfile['kind'];sizeLabel:string;sizeBucket:string;quantization:string;quantTier:string;
 publisher:string;architecture:string;totalB:number|null;activeB:number|null;
 promptSize:string|null;testKind:string;benchmarkPack:string|null;
 reasoning:string;temperature:number;contextLength:number;maxTokens:number;waves:number;
 completed:number;durationsMs:number[];objectiveCount:number;localJudgeCount:number;externalJudgeCount:number;
};
const titled=(s:string)=>s?s[0].toUpperCase()+s.slice(1).toLowerCase():s;
// LM Studio's architecture is the reliable family signal: gemma4 and qwen35moe both name the family that
// built the model. `publisher` is the repackager (unsloth, lmstudio-community) and never the family.
export function familyOf(architecture:string|undefined|null,modelKey:string|undefined|null){
 const arch=/^[A-Za-z]+/.exec(String(architecture??'').trim());
 if(arch)return titled(arch[0]);
 const key=/^[A-Za-z]+/.exec(String(modelKey??'').split('@')[0].trim());
 return key?titled(key[0]):unknownFacet;
}
// IQ3_XXS and Q3_K_XL are both three-bit tiers. A format with no bit count (F16, MXFP4) keeps its own name
// rather than collapsing into Unknown, which would hide it behind every genuinely unlabelled model.
export function quantTier(name:string|undefined|null){
 const n=String(name??'').trim();
 if(!n)return unknownFacet;
 const m=/^(iq|q)(\d+)/i.exec(n);
 return m?m[1].toUpperCase()+m[2]:n.toUpperCase();
}
const trimNumber=(n:number)=>Number(n.toFixed(1)).toString();
export function sizeLabel(totalB:number|null|undefined){return typeof totalB!=='number'||!Number.isFinite(totalB)?unknownSize:trimNumber(totalB)+'B';}
// The same boundaries the single-run Compare models ranges offer, so the two screens never disagree about
// which bracket a model belongs to. Upper bounds are inclusive.
// An empty or unparseable timestamp renders as the literal string "Invalid Date";
// history.aggregate() explicitly allows first:'' for a group with no dated run.
export const shortDate=(value:string|null|undefined)=>{const t=value?Date.parse(value):NaN;return Number.isFinite(t)?new Date(t).toLocaleDateString():'—';};
export const sizeBuckets=[{max:8,label:'Up to 8B'},{max:20,label:'8-20B'},{max:35,label:'20-35B'},{max:70,label:'35-70B'},{max:Infinity,label:'70B and above'}];
export function sizeBucket(totalB:number|null|undefined){if(typeof totalB!=='number'||!Number.isFinite(totalB))return unknownSize;return sizeBuckets.find(b=>totalB<=b.max)?.label??unknownSize;}
export function promptSizeOf(testId:string|undefined|null){const m=/^perf-(short|medium|long)$/.exec(String(testId??''));return m?m[1]:null;}
export const kindLabel=(kind:string)=>kind==='moe'?'MoE':kind==='dense'?'Dense':'Unknown type';
export const otherPrompt='Other tests';
export const ownTests='Your own tests';
export const facetValue={
 families:(r:HistoryRow)=>r.family,
 kinds:(r:HistoryRow)=>kindLabel(r.kind),
 sizes:(r:HistoryRow)=>r.sizeLabel,
 quantTiers:(r:HistoryRow)=>r.quantTier,
 quants:(r:HistoryRow)=>r.quantization||unknownFacet,
 concurrency:(r:HistoryRow)=>String(r.concurrency),
 promptSizes:(r:HistoryRow)=>r.promptSize??otherPrompt,
 benchmarks:(r:HistoryRow)=>r.benchmarkPack??ownTests,
 mtp:(r:HistoryRow)=>r.mtp,
 vision:(r:HistoryRow)=>r.vision,
 reasoning:(r:HistoryRow)=>r.reasoning,
 statuses:(r:HistoryRow)=>r.runStatus,
} as const;
export type FacetKey=keyof typeof facetValue;
export const facetKeys=Object.keys(facetValue) as FacetKey[];
export const facetLabels:Record<FacetKey,string>={families:'Model family',kinds:'Architecture',sizes:'Parameters',quantTiers:'Quantization tier',quants:'Exact quantization',concurrency:'Concurrent requests',promptSizes:'Prompt size',benchmarks:'Benchmark pack',mtp:'Native MTP',vision:'Vision',reasoning:'Reasoning',statuses:'Run status'};
export const modelFacets:FacetKey[]=['families','kinds','sizes','quantTiers','quants'];
export const conditionFacets:FacetKey[]=['benchmarks','concurrency','promptSizes','mtp','vision','reasoning','statuses'];
export const groupOptions={model:'Model',family:'Model family',kind:'Dense vs MoE',size:'Parameters',sizeBucket:'Size range',quantTier:'Quantization tier',quantization:'Exact quantization',benchmark:'Benchmark pack'} as const;
export type GroupBy=keyof typeof groupOptions;
export const groupValue:Record<GroupBy,(r:HistoryRow)=>string>={model:r=>r.modelKey,family:r=>r.family,kind:r=>kindLabel(r.kind),size:r=>r.sizeLabel,sizeBucket:r=>r.sizeBucket,quantTier:r=>r.quantTier,quantization:r=>r.quantization||unknownFacet,benchmark:r=>r.benchmarkPack??ownTests};
export const sortOptions={label:'Name',runs:'Runs',requests:'Requests',generationTps:'Generation tok/s',estimatedPrefillTps:'Prefill tok/s',throughput:'Total tok/s',medianMs:'Median latency',p95Ms:'p95 latency',failureRate:'Failure rate',objective:'Objective score',localJudge:'Local judge',gpuHotSpotMax:'GPU hot spot peak'} as const;
export type SortKey=keyof typeof sortOptions;
export type HistoryView={search:string;groupBy:GroupBy;sort:SortKey;descending:boolean}&Record<FacetKey,string[]>;
const emptyFacets=()=>Object.fromEntries(facetKeys.map(k=>[k,[] as string[]])) as Record<FacetKey,string[]>;
export const defaultHistoryView:HistoryView={...emptyFacets(),search:'',groupBy:'model',sort:'generationTps',descending:true};
// Every chosen value inside one facet is an alternative (OR); every facet that has a choice must match (AND).
// An untouched facet means "all", so the overview starts by showing everything ever measured.
export function matchesHistory(row:HistoryRow,view:HistoryView,ignore?:FacetKey){
 for(const key of facetKeys){
  if(key===ignore)continue;
  const chosen=view[key];
  if(chosen.length&&!chosen.includes(facetValue[key](row)))return false;
 }
 const terms=view.search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 if(!terms.length)return true;
 const haystack=[row.modelKey,row.model,row.quantization,row.family,row.architecture,row.publisher,row.runName,row.test].join(' ').toLocaleLowerCase();
 return terms.every(t=>haystack.includes(t));
}
const promptOrder=['short','medium','long',otherPrompt];
function compareFacet(key:FacetKey,a:string,b:string){
 const unknownA=a===unknownFacet||a===unknownSize,unknownB=b===unknownFacet||b===unknownSize;
 if(unknownA!==unknownB)return unknownA?1:-1;
 if(key==='promptSizes')return promptOrder.indexOf(a)-promptOrder.indexOf(b);
 return a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
}
// Every value ever measured stays on offer, so a row of chips does not rearrange itself underneath you as you
// press them. The count ignores this facet's own choices and reports what pressing the chip would show, which
// is how a zero explains itself: nothing saved matches it alongside what is already pinned elsewhere.
export function facetOptions(rows:HistoryRow[],view:HistoryView,key:FacetKey){
 const counts=new Map<string,number>();
 for(const r of rows)counts.set(facetValue[key](r),0);
 for(const r of rows)if(matchesHistory(r,view,key)){const v=facetValue[key](r);counts.set(v,(counts.get(v)??0)+1);}
 for(const chosen of view[key])if(!counts.has(chosen))counts.set(chosen,0);
 return [...counts.entries()].map(([value,count])=>({value,count})).sort((a,b)=>compareFacet(key,a.value,b.value));
}
export type Spread={value:number;min:number;max:number}|null;
// Rates are already averages over requests, so pooling them has to weight by how many requests stood behind
// each one. A two-request row must not outvote a two-hundred-request row.
function weighted(rows:HistoryRow[],pick:(r:HistoryRow)=>number|null,weight:(r:HistoryRow)=>number):Spread{
 let sum=0,total=0,min=Infinity,max=-Infinity;
 for(const r of rows){
  const v=pick(r),w=weight(r);
  if(v===null||!Number.isFinite(v)||!(w>0))continue;
  sum+=v*w;total+=w;min=Math.min(min,v);max=Math.max(max,v);
 }
 return total>0?{value:sum/total,min,max}:null;
}
export type HistoryGroup={
 key:string;label:string;rows:HistoryRow[];models:string[];
 runs:{id:string;name:string;created:string;status:string}[];
 first:string;last:string;
 requests:number;completed:number;failures:number;failureRate:number|null;
 generationTps:Spread;estimatedPrefillTps:Spread;throughput:Spread;ttftMs:Spread;
 medianMs:number|null;p95Ms:number|null;
 objective:number|null;localJudge:number|null;externalJudge:number|null;
 gpuHotSpotAvg:number|null;gpuHotSpotMax:number|null;
 conditions:Record<'concurrency'|'promptSizes'|'mtp'|'vision'|'reasoning',string[]>;
 mixed:boolean;
};
const distinct=(rows:HistoryRow[],pick:(r:HistoryRow)=>string)=>[...new Set(rows.map(pick))].filter(Boolean);
const ok=(r:HistoryRow)=>r.requests-r.failures;
function aggregate(key:string,label:string,rows:HistoryRow[]):HistoryGroup{
 const requests=rows.reduce((n,r)=>n+r.requests,0),failures=rows.reduce((n,r)=>n+r.failures,0);
 // Percentiles cannot be pooled by averaging percentiles, so the real durations are pooled and measured again.
 const durations=rows.flatMap(r=>r.durationsMs);
 const runs=[...new Map(rows.map(r=>[r.runId,{id:r.runId,name:r.runName,created:r.runCreated,status:r.runStatus}])).values()].sort((a,b)=>b.created.localeCompare(a.created));
 const created=rows.map(r=>r.runCreated).sort();
 const conditions={
  concurrency:distinct(rows,r=>String(r.concurrency)).sort((a,b)=>+a-+b),
  promptSizes:distinct(rows,r=>r.promptSize??otherPrompt),
  mtp:distinct(rows,r=>r.mtp),vision:distinct(rows,r=>r.vision),reasoning:distinct(rows,r=>r.reasoning)};
 return {key,label,rows,models:distinct(rows,r=>r.modelKey).sort(),runs,first:created[0]??'',last:created[created.length-1]??'',
  requests,completed:requests-failures,failures,failureRate:requests?failures/requests:null,
  generationTps:weighted(rows,r=>r.generationTps,ok),estimatedPrefillTps:weighted(rows,r=>r.estimatedPrefillTps,ok),
  throughput:weighted(rows,r=>r.throughput,ok),ttftMs:weighted(rows,r=>r.ttftMs,ok),
  medianMs:percentile(durations,.5),p95Ms:percentile(durations,.95),
  // Scores weight by responses that actually carried a score, so an ungraded run never dilutes a graded one.
  objective:weighted(rows,r=>r.objective,r=>r.objectiveCount)?.value??null,
  localJudge:weighted(rows,r=>r.localJudge,r=>r.localJudgeCount)?.value??null,
  externalJudge:weighted(rows,r=>r.externalJudge,r=>r.externalJudgeCount)?.value??null,
  gpuHotSpotAvg:weighted(rows,r=>r.gpuHotSpotAvg,r=>r.gpuReadings)?.value??null,
  gpuHotSpotMax:rows.reduce<number|null>((m,r)=>r.gpuHotSpotMax===null?m:m===null?r.gpuHotSpotMax:Math.max(m,r.gpuHotSpotMax),null),
  conditions,mixed:Object.values(conditions).some(v=>v.length>1)};
}
export function groupHistory(rows:HistoryRow[],view:HistoryView,options:{by?:GroupBy;splitConcurrency?:boolean}={}):HistoryGroup[]{
 const by=options.by??view.groupBy,map=new Map<string,{label:string;rows:HistoryRow[]}>();
 for(const row of rows){
  if(!matchesHistory(row,view))continue;
  const label=groupValue[by](row),key=options.splitConcurrency?label+' '+row.concurrency:label;
  const entry=map.get(key)??{label,rows:[]};entry.rows.push(row);map.set(key,entry);
 }
 return [...map.entries()].map(([key,{label,rows}])=>aggregate(key,label,rows));
}
const sortValue=(g:HistoryGroup,key:SortKey):number|string|null=>{
 switch(key){
  case 'label':return g.label;
  case 'runs':return g.runs.length;
  case 'requests':return g.requests;
  case 'generationTps':case 'estimatedPrefillTps':case 'throughput':return g[key]?.value??null;
  default:return g[key];
 }
};
// Groups with no measurement for the chosen column stay at the bottom in both directions: an absent number
// is not a low one.
export function sortGroups(groups:HistoryGroup[],view:HistoryView){
 const dir=view.descending?-1:1,byLabel=(a:HistoryGroup,b:HistoryGroup)=>a.label.localeCompare(b.label,undefined,{numeric:true,sensitivity:'base'});
 return [...groups].sort((a,b)=>{
  const av=sortValue(a,view.sort),bv=sortValue(b,view.sort);
  if(av===null&&bv===null)return byLabel(a,b);
  if(av===null)return 1;
  if(bv===null)return -1;
  const order=typeof av==='string'||typeof bv==='string'?String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'}):av-bv;
  return order*dir||byLabel(a,b);
 });
}
// The automatic graphs plot one line per model key across concurrency, so a group label takes the place of a
// model key and the pooled numbers take the place of that model's own.
export function chartRows(groups:HistoryGroup[]):ChartRow[]{
 return groups.filter(g=>g.rows.length).map(g=>({...g.rows[0],modelKey:g.label,model:g.label,requests:g.requests,failures:g.failures,failureRate:g.failureRate??0,
  generationTps:g.generationTps?.value??null,estimatedPrefillTps:g.estimatedPrefillTps?.value??null,throughput:g.throughput?.value??null,ttftMs:g.ttftMs?.value??null,
  medianMs:g.medianMs,p95Ms:g.p95Ms,objective:g.objective,localJudge:g.localJudge,externalJudge:g.externalJudge,
  gpuHotSpotAvg:g.gpuHotSpotAvg,gpuHotSpotMax:g.gpuHotSpotMax}));
}
export function restoreHistoryView(value:unknown):HistoryView{
 if(!value||typeof value!=='object')return {...defaultHistoryView,...emptyFacets()};
 const v=value as Partial<HistoryView>;
 const list=(x:unknown)=>Array.isArray(x)?[...new Set(x.filter((s):s is string=>typeof s==='string'))].slice(0,64):[];
 const facets=Object.fromEntries(facetKeys.map(k=>[k,list(v[k])])) as Record<FacetKey,string[]>;
 return {...facets,search:typeof v.search==='string'?v.search:'',
  groupBy:v.groupBy&&Object.hasOwn(groupOptions,v.groupBy)?v.groupBy:'model',
  sort:v.sort&&Object.hasOwn(sortOptions,v.sort)?v.sort:'generationTps',
  descending:typeof v.descending==='boolean'?v.descending:true};
}
