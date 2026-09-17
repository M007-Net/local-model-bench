import data from './benchmark-data/packs.json';
import type {Run, RunConfig, TestCase} from './types';
import {mtpDepthText,sweepSteps} from './mtp-sweep';

export type BenchmarkSelection={packId:string;count:number;seed:number};
export type BenchmarkMeta={packId:string;itemId:string;datasetHash:string;protocol:string};
export type BenchmarkPack={id:string;source:string;datasetHash:string;protocol:string;originalCount:number;count:number;tests:TestCase[];name?:string;scoring?:string;instruction?:string;custom?:boolean;imported?:string;fileName?:string};
// What a screen needs to describe a pack without carrying its questions across the process boundary.
export type PackSummary={id:string;name:string;skill:string;meaning:string;limit:string;protocol:string;source:string;datasetHash:string;originalCount:number;count:number;custom:boolean};
export const builtInPacks=data as unknown as BenchmarkPack[];
export const benchmarkPacks=builtInPacks;
export const benchmarkDescriptions:Record<string,{name:string;skill:string;meaning:string;limit:string;protocol:string}>={
 gsm8k:{name:'GSM8K',skill:'Math word problems',meaning:'Can it turn a short story problem into the right calculation and final answer?',limit:'This tests numerical word problems. It does not establish advanced math ability or explain whether the reasoning was sound.',protocol:'Published test questions; local zero-shot prompt and final-number scoring.'},
 ifeval:{name:'IFEval',skill:'Following instructions',meaning:'Can it follow specific rules such as the number of bullets, required words, JSON format, or a required ending?',limit:'This checks stated constraints, not factual correctness or good writing. The included subset covers 11 supported instruction types.',protocol:'Published prompts unchanged; 205 of 541 prompts with supported constraints. Local strict-style, all-constraints scoring; no loose variant.'},
 cruxeval:{name:'CRUXEval-O',skill:'Understanding Python code',meaning:'Can it read a short Python function and predict the value it returns for a given input?',limit:'This measures code reading and tracing. Even 100 does not mean it can build, debug, or maintain a whole application.',protocol:'Published functions and inputs; 750 of 800 items with JSON-representable outputs. Local JSON answer format; no code execution.'}
};
// A report is written from a saved run, which may name a pack that was imported (and so
// never had a hand-written entry above) or one that has since been deleted. Describing
// the benchmark from the metadata the run itself carries is what lets those runs export.
export function describeMeta(meta:BenchmarkMeta,fallbackName?:string){
 const published=benchmarkDescriptions[meta.packId];
 if(published)return published;
 return {name:fallbackName?.trim()||'Imported questions',skill:'Your own questions',
  meaning:'This pack was imported rather than published. It measures how often a response passes the check chosen for these answers, on these questions.',
  limit:'Nothing here is a published benchmark or a leaderboard score. The questions, the answers, and the scoring rule are local, so the result describes that test set and nothing wider.',
  protocol:meta.protocol||'Imported questions, scored locally.'};
}
export function validateBenchmark(selection:BenchmarkSelection,packs:BenchmarkPack[]=builtInPacks):BenchmarkPack{
 const pack=packs.find(p=>p.id===selection?.packId);
 if(!pack)throw Error('Choose an available benchmark pack.');
 if(!Number.isInteger(selection.count)||selection.count<1||selection.count>pack.count)throw Error(`Choose between 1 and ${pack.count} questions.`);
 if(!Number.isInteger(selection.seed)||selection.seed<0||selection.seed>2147483647)throw Error('Question seed must be an integer from 0 to 2147483647.');
 return pack;
}
// Fixed seeded Fisher-Yates selection: all models/settings receive identical
// item IDs, and a larger run with the same seed includes the smaller run's items.
export function selectBenchmark(selection:BenchmarkSelection,packs:BenchmarkPack[]=builtInPacks):TestCase[]{
 const pack=validateBenchmark(selection,packs),items=[...pack.tests];let seed=selection.seed>>>0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}
 return structuredClone(items.slice(0,selection.count));
}
export function benchmarkConfig(current:RunConfig,selection:BenchmarkSelection,packName:string):RunConfig{
 return {...current,benchmark:selection,name:`${packName} · ${selection.count} questions`,mode:'quality',testIds:[],preset:'Custom',concurrency:[1],waves:1,maxTokens:2048,contextLength:Math.max(current.contextLength,8192),temperature:0,judgeModel:''};
}
// A published pack has a hand-written explanation; an imported one is described from what was imported, so the
// meaning panel never has to guess what your own questions measure.
export function describePack(pack:BenchmarkPack):PackSummary{
 const shared={id:pack.id,source:pack.source,datasetHash:pack.datasetHash,originalCount:pack.originalCount,count:pack.count};
 const published=benchmarkDescriptions[pack.id];
 if(published)return {...shared,...published,custom:false};
 return {...shared,custom:true,name:pack.name||pack.id,skill:'Your own questions',
  meaning:'This pack is whatever you imported. It measures how often a response passes the check you chose for these answers, on these questions.',
  limit:'Nothing here is a published benchmark or a leaderboard score. The questions, the answers, and the scoring rule are yours, so the result describes your test set and nothing wider.',
  protocol:`${pack.protocol}. ${pack.originalCount.toLocaleString()} questions imported from ${pack.fileName||'a local file'}${pack.imported?' on '+pack.imported.slice(0,10):''}.${pack.instruction?.trim()?` Every question is sent with this appended: "${pack.instruction.trim()}"`:' Questions are sent exactly as imported, with nothing appended.'}`};
}
// A run outlives the pack it came from: deleting an imported pack must never make a saved result unreadable.
export const removedPackSummary=(id:string):PackSummary=>({id,name:'Removed benchmark',skill:'No longer installed',
 meaning:'The pack behind this run has been deleted, so its description is gone. The run itself still holds every question, answer, check, and response it recorded.',
 limit:'Scores below were computed when the run happened and are unchanged.',protocol:'Unavailable: the pack was removed.',
 source:'Removed',datasetHash:'',originalCount:0,count:0,custom:true});
export const summaryFor=(id:string,summaries:PackSummary[])=>summaries.find(s=>s.id===id)??removedPackSummary(id);
export const scoreBands=[
 {min:0,max:49.999,label:'0–49',title:'Frequent misses',text:'Fewer than half of the attempted responses passed. Expect frequent mistakes on this kind of task.'},
 {min:50,max:74.999,label:'50–74',title:'Mixed results',text:'About half to three quarters passed. It can handle some of these tasks, but you should check its answers carefully.'},
 {min:75,max:89.999,label:'75–89',title:'Usually successful here',text:'Most responses passed, with noticeable gaps. It looks useful for similar tasks when you review the result.'},
 {min:90,max:99.999,label:'90–99',title:'Very strong on this run',text:'Nearly all responses passed. That is encouraging for similar tasks, though a different question set can expose weaknesses.'},
 {min:100,max:100,label:'100',title:'Every attempted response passed',text:'Every attempted response passed its checks. This describes the tested questions and settings, not every possible task.'}
];
export function interpretScore(score:number|null){return score===null||!Number.isFinite(score)||score<0||score>100?null:[...scoreBands].reverse().find(b=>score>=b.min)??null;}
export function benchmarkRows(run:Run){
 const tests=run.tests.filter(t=>t.benchmark),ids=new Set(tests.map(t=>t.id));
 if(!tests.length)return [];
 // An MTP sweep runs the whole pack once per prediction depth, so a depth is a separate score
 // with its own expected question count. Runs that did not sweep have a single depth of null,
 // which matches every response and leaves their rows exactly as they were.
 const depths=sweepSteps(run.config).map(s=>s.depth);
 return run.config.modelKeys.flatMap(key=>depths.flatMap(depth=>run.config.concurrency.map(concurrency=>{
  const samples=run.samples.filter(s=>!s.warmup&&s.modelKey===key&&s.concurrency===concurrency&&ids.has(s.testId)&&(depth===null||s.mtpTokens===depth));
  const passed=samples.filter(s=>s.status==='completed'&&s.objective.score===100).length;
  const failed=samples.filter(s=>s.status!=='completed').length;
  const expected=tests.length*run.config.waves*concurrency;
  const score=samples.length?passed/samples.length*100:null;
  return {key,concurrency,depth,mtp:mtpDepthText(depth),passed,attempted:samples.length,expected,failed,score,provisional:samples.length!==expected||run.status!=='completed',truncated:samples.filter(s=>s.possibleTruncation).length,uniqueQuestions:new Set(samples.map(s=>s.testId)).size};
 })));
}
export function sameBenchmarkQuestions(a:Run,b:Run){
 const signature=(r:Run)=>JSON.stringify(r.tests.filter(t=>t.benchmark).map(t=>[t.id,t.benchmark?.datasetHash,t.benchmark?.protocol,t.prompt,t.rules]).sort((x,y)=>String(x[0]).localeCompare(String(y[0]))));
 return a.tests.some(t=>t.benchmark)&&signature(a)===signature(b);
}
