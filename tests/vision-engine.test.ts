import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {exportText,summaries,visionRunNote} from '../electron/export';
import {visionTests} from '../electron/vision-image';
import {defaultConfig,defaultSettings,starterTests} from '../src/defaults';
import {metrics} from '../electron/metrics';
import type {Model,Run,Sample} from '../src/types';
import type {VisionState} from '../electron/vision';

const textTest=starterTests.find(t=>t.id==='reasoning')!;
const makeRun=(vision?:'auto'|'off'|'on',tests=[textTest]):Run=>({id:'vision-run',created:'2026-09-13',updated:'2026-09-13',status:'running',
 config:{...structuredClone(defaultConfig),vision,modelKeys:['mock'],testIds:['reasoning'],mode:'quality',concurrency:[1],waves:1,maxTokens:128,contextLength:2048},
 tests,modelInfo:{},environment:{},logs:[],samples:[],waves:[]});

// Mirrors the real adapter: the model list is the only place vision is reported, exactly
// as LM Studio does, and the loaded instance config carries no vision field at all.
function mockAdapter(capabilities:Record<string,unknown>|undefined){
 let instance='';const seen:{prompt:string;image?:string}[]=[];
 const model={key:'mock',display_name:'Mock',type:'llm',size_bytes:100,quantization:null,max_context_length:8192,loaded_instances:[],...(capabilities?{capabilities}:{})} as unknown as Model;
 const adapter:Adapter={cacheQuant:()=>()=>{},
  models:async()=>[{...model,loaded_instances:instance?[{id:instance,config:{context_length:2048,parallel:1}}]:[]}],
  cli:async(_s,args)=>{instance=args[args.indexOf('--identifier')+1];return 'loaded';},
  api:async()=>{instance='';return {};},
  infer:async(_s,_id,prompt,_max,_temp,_reason,_signal,image)=>{seen.push({prompt,image});
   return {output:'3',reasoning:'',rawStats:{},metrics:metrics({input_tokens:10,total_output_tokens:1,tokens_per_second:50},40,0,10,20),status:'completed' as const,possibleTruncation:false};}
 };
 return {adapter,seen};
}
const runIt=async(run:Run,capabilities:Record<string,unknown>|undefined)=>{
 const mock=mockAdapter(capabilities);const events:EngineEvent[]=[];
 await runEngine(run,defaultSettings,new AbortController().signal,e=>{events.push(e);if(e.type==='model')run.modelInfo[e.key]=e.info;if(e.type==='sample')run.samples.push(e.sample);},mock.adapter);
 return {events,seen:mock.seen,finish:events.findLast(e=>e.type==='finish') as Extract<EngineEvent,{type:'finish'}>,
  vision:(run.modelInfo.mock as {vision?:VisionState}|undefined)?.vision,logs:events.filter(e=>e.type==='log').map(e=>(e as Extract<EngineEvent,{type:'log'}>).message)};
};

test('vision off and auto send no image at all, and still measure text normally',async()=>{
 for(const mode of ['off','auto',undefined] as const){
  const r=await runIt(makeRun(mode),{vision:true});
  assert.equal(r.finish.status,'completed',mode+' should complete');
  assert.ok(r.seen.length>0);
  assert.ok(r.seen.every(s=>s.image===undefined),mode+' must not attach an image');
  assert.equal(r.vision?.imagesSent,false);
  assert.equal(r.vision?.projectorUnloaded,false);
 }
});

test('vision on sends the local image for image tests and never for the warm-up',async()=>{
 const run=makeRun('on',[textTest,...visionTests()]);
 const r=await runIt(run,{vision:true});
 assert.equal(r.finish.status,'completed');
 assert.equal(run.samples.filter(s=>s.warmup).length,1);
 const warmSent=r.seen.find(s=>s.prompt.includes('Reply with the word ready'));
 assert.equal(warmSent?.image,undefined,'the warm-up must stay text-only');
 const withImage=r.seen.filter(s=>s.image!==undefined);
 assert.equal(withImage.length,visionTests().length);
 assert.ok(withImage.every(s=>s.image!.startsWith('data:image/png;base64,')));
 // The plain text test in the same run is still sent without an image.
 assert.ok(r.seen.some(s=>s.image===undefined&&s.prompt.includes('machines')));
 assert.equal(r.vision?.imagesSent,true);
 assert.equal(r.vision?.confirmed,true);
});

test('vision on stops cleanly and measures nothing when capability is not reported',async()=>{
 for(const capabilities of [{vision:false},{},undefined]){
  const run=makeRun('on',[textTest,...visionTests()]);
  const r=await runIt(run,capabilities);
  assert.equal(r.finish.status,'failed',JSON.stringify(capabilities)+' must not run');
  assert.equal(run.samples.filter(s=>!s.warmup).length,0,'no measurement may be recorded');
  assert.equal(r.seen.filter(s=>s.image!==undefined).length,0,'no image may be sent');
  assert.ok(r.logs.some(m=>/vision is not confirmed|did not confirm vision/i.test(m)),'the reason must be explained');
 }
});

test('a vision-capable model still runs ordinary text benchmarks, so no duplicate model is needed',async()=>{
 const run=makeRun('off');
 const r=await runIt(run,{vision:true});
 assert.equal(r.finish.status,'completed');
 assert.equal(run.samples.filter(s=>!s.warmup&&s.status==='completed').length,1);
 assert.match(r.vision!.limitation,/remained attached and loaded/);
 assert.ok(r.logs.some(m=>/Vision: requested off/.test(m)));
});

test('the run record and every export carry the requested mode, effective state and limits',async()=>{
 const run=makeRun('off');
 const r=await runIt(run,{vision:true});
 run.status='completed';
 const note=visionRunNote(run);
 assert.equal(note.requested,'off');
 assert.match(note.effective,/no image was sent/);
 assert.match(note.limitation,/does not unload vision weights/);
 const [row]=summaries(run);
 assert.equal(row.vision,'off');
 assert.equal(row.visionImagesSent,false);
 assert.equal(row.visionProjectorUnloaded,false);
 assert.equal(row.visionEffective,r.vision!.effective);
 const csv=exportText(run,'csv');
 assert.ok(csv.includes('visionEffective')&&csv.includes('visionProjectorUnloaded'));
 const md=exportText(run,'md');
 assert.ok(md.includes('Vision requested: off'));
 assert.ok(md.includes('Vision limitation:'));
 const json=JSON.parse(exportText(run,'json'));
 assert.equal(json.config.vision,'off');
 assert.equal(json.modelInfo.mock.vision.projectorUnloaded,false);
});

test('runs saved before vision existed still export without claiming anything',()=>{
 const legacy=makeRun(undefined);legacy.status='completed';
 const sample:Sample={id:'s',runId:legacy.id,modelKey:'mock',modelName:'Mock',testId:'reasoning',testName:'Reasoning',concurrency:1,waveId:'w',wave:0,slot:0,warmup:false,prompt:'p',output:'84',reasoning:'',status:'completed',metrics:metrics({input_tokens:1,total_output_tokens:1,tokens_per_second:1},10,0,1,1),objective:{score:100,checks:[]},grades:[],rawStats:{},created:'2026-09-13',possibleTruncation:false};
 legacy.samples=[sample];
 delete (legacy.config as {vision?:unknown}).vision;
 const [row]=summaries(legacy);
 assert.equal(row.vision,'legacy/default');
 assert.equal(row.visionEffective,'Not confirmed');
 assert.equal(row.visionImagesSent,false);
 assert.ok(exportText(legacy,'md').includes('Vision requested: legacy/default'));
 assert.equal(visionRunNote(legacy).requested,'legacy/default');
});
