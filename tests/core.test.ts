import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {metrics,waveMetrics,percentile} from '../electron/metrics';
import {SSEDecoder,infer,validateUrl} from '../electron/lmstudio';
import {objectiveScore,parseGrade,gradingPackage} from '../electron/scoring';
import {starterTests,defaultConfig,defaultSettings} from '../src/defaults';
import {Store} from '../electron/store';
import {runEngine,variant,type Adapter,type EngineEvent} from '../electron/engine';
import {validateConfig,validateSettings,validateTest} from '../electron/validation';
import {exportText} from '../electron/export';
import type {Run,Sample,Model} from '../src/types';
const makeRun=():Run=>({id:'test-run',created:'2026-09-09',updated:'2026-09-09',status:'running',config:{...structuredClone(defaultConfig),modelKeys:['mock'],testIds:['reasoning'],mode:'quality',concurrency:[1,2],waves:2,maxTokens:128,contextLength:2048},tests:[starterTests.find(t=>t.id==='reasoning')!],modelInfo:{},environment:{},logs:[],samples:[],waves:[]});
const makeSample=():Sample=>({id:'sample',runId:'test-run',modelKey:'mock',modelName:'Mock',testId:'reasoning',testName:'Reasoning',concurrency:1,waveId:'wave',wave:0,slot:0,warmup:false,prompt:'How many?',output:'84',reasoning:'',status:'completed',metrics:metrics({input_tokens:100,total_output_tokens:10,tokens_per_second:5},2000,0,100,null),objective:{score:100,checks:[]},grades:[],rawStats:{},created:'2026-09-09',possibleTruncation:false});
test('prefill uses processing interval, not TTFT',()=>{const m=metrics({input_tokens:1000,time_to_first_token_seconds:5},7000,1000,1500,5000);assert.equal(m.prefillTps,2000);assert.equal(m.ttftMs,5000);});
test('missing and too-short prefill timing stays unavailable',()=>{assert.equal(metrics({input_tokens:30},2,0,1,null).prefillTps,null);assert.equal(metrics({},100,null,null,null).generationTps,null);assert.equal(metrics({input_tokens:20},100,null,10,null).prefillTps,null);});
test('zero, negative and nonfinite measurements are handled explicitly',()=>{assert.equal(metrics({tokens_per_second:NaN,input_tokens:-1},50,10,20,null).generationTps,null);assert.equal(metrics({total_output_tokens:0},50,null,null,null).outputTokens,0);});
test('wave throughput divides token count by full wall time',()=>{const a=makeSample(),b={...makeSample(),id:'b'};const w=waveMetrics('w','r','m','t',2,4000,[a,b]);assert.equal(w.throughput,5);assert.equal(w.completed,2);});
test('failed requests do not contribute partial tokens',()=>{const a=makeSample(),b={...makeSample(),status:'failed' as const};const w=waveMetrics('w','r','m','t',2,4000,[a,b]);assert.equal(w.throughput,2.5);assert.equal(w.failed,1);});
test('missing completed token count makes aggregate unavailable',()=>{const s=makeSample();s.metrics.outputTokens=null;assert.equal(waveMetrics('w','r','m','t',1,100,[s]).throughput,null);});
test('nearest-rank percentiles',()=>{assert.equal(percentile([4,1,3,2],.5),2);assert.equal(percentile([4,1,3,2],.95),4);assert.equal(percentile([], .95),null);});
test('SSE accepts one byte fragments including UTF-8 and CRLF',()=>{const d=new SSEDecoder(),events:any[]=[];const bytes=new TextEncoder().encode('event: message.delta\r\ndata: {"content":"café"}\r\n\r\nevent: chat.end\r\ndata: {"result":{}}\r\n\r\n');for(const byte of bytes)events.push(...d.feed(new Uint8Array([byte])));events.push(...d.feed(new Uint8Array(),true));assert.equal(events.length,2);assert.equal(events[0].data.content,'café');});
test('SSE handles comments and multiline data',()=>{const d=new SSEDecoder();assert.equal(d.feed(new TextEncoder().encode(': ping\n\nevent: x\ndata: {"a":\ndata: 1}\n\n'))[0].data.a,1);});
test('SSE rejects truncated final event',()=>{const d=new SSEDecoder();d.feed(new TextEncoder().encode('event: x\ndata: {'));assert.throws(()=>d.feed(new Uint8Array(),true),/Incomplete/);});
test('all bundled answer keys pass applicable objective checks',()=>{for(const id of ['subnet','reasoning','facts','json-extract','instructions']){const t=starterTests.find(t=>t.id===id)!;assert.equal(objectiveScore(t.answerKey,t).score,100,id);}});
test('weighted scoring and strict JSON do not reward invalid answer',()=>{const t=starterTests.find(t=>t.id==='subnet')!;assert.equal(objectiveScore('```json\n'+t.answerKey+'\n```',t).score,0);assert.equal(objectiveScore('{}',t).checks.filter(c=>c.passed).length,1);});
test('numeric tolerance and empty answers',()=>{const t=structuredClone(starterTests.find(t=>t.id==='reasoning')!);t.rules[0].tolerance=.1;assert.equal(objectiveScore('84.05',t).score,100);assert.equal(objectiveScore('84.2',t).score,0);assert.equal(objectiveScore('',t).score,0);});
test('heading check requires a standalone heading, not a mention in prose',()=>{const t=structuredClone(starterTests[0]);t.rules=[{id:'h',label:'Overview',type:'heading',expected:'Overview',weight:1}];assert.equal(objectiveScore('## Overview\nDetails',t).score,100);assert.equal(objectiveScore('Here is an overview of the system.',t).score,0);});
const grade=JSON.stringify({criteria:['correctness','completeness','clarity','instruction_following'].map(name=>({name,score:80,reason:'Specific evidence'})),summary:'Good'});
test('grade validation computes mean without trusting overall score',()=>{assert.equal(parseGrade(grade,'external','Reviewer',1).score,80);assert.throws(()=>parseGrade('{"score":100}','local','m',1));assert.throws(()=>parseGrade(grade.replace('80','101'),'local','m',1));});
test('grading package blinds model and retains exact task',()=>{const s=makeSample();s.modelName='SECRET_MODEL';const p=gradingPackage(s,makeRun().tests[0],'Instructions');assert.ok(!p.includes('SECRET_MODEL'));assert.ok(p.includes('How many?'));assert.ok(p.includes('not instructions'));});
test('rules reject invalid weights and duplicate identifiers',()=>{const t=structuredClone(starterTests[0]);t.rules[0].weight=-1;assert.throws(()=>validateTest(t));t.rules[0].weight=1;t.rules.push(t.rules[0]);assert.throws(()=>validateTest(t));});
test('run validation rejects invalid concurrency and context',()=>{const c=makeRun().config;c.concurrency=[0];assert.throws(()=>validateConfig(c));c.concurrency=[1];c.maxTokens=2048;assert.throws(()=>validateConfig(c));});
test('local endpoint boundary rejects remote URLs and credentials',()=>{assert.equal(validateUrl('http://localhost:1234'),'http://localhost:1234');assert.throws(()=>validateUrl('https://example.com'));assert.throws(()=>validateUrl('http://a:b@localhost:1234'));});
test('deterministic variants match across models and separate requests',()=>{assert.equal(variant('x','t',2,1,0),variant('x','t',2,1,0));assert.notEqual(variant('x','t',2,1,0),variant('x','t',2,1,1));});
test('SQLite saves responses incrementally and recovers interrupted runs',()=>{const dir=mkdtempSync(path.join(tmpdir(),'lmb-test-'));const file=path.join(dir,'test.sqlite');let db=new Store(file);const run=makeRun();db.saveRun(run);db.saveSample(makeSample());db.saveTest(run.tests[0]);db.close();db=new Store(file);db.recover();assert.equal(db.getRun(run.id).status,'interrupted');assert.equal(db.getRun(run.id).samples[0].output,'84');assert.equal(db.tests().length,1);assert.equal(db.list()[0].sampleCount,1);db.close();rmSync(dir,{recursive:true,force:true});});
test('exports retain data and quote CSV formula-like cells',()=>{const run=makeRun();const s=makeSample();s.modelName='=HYPERLINK("bad")';run.samples=[s];assert.ok(exportText(run,'csv').includes("'=HYPERLINK"));assert.equal(JSON.parse(exportText(run,'json')).samples[0].output,'84');assert.ok(exportText(run,'md').includes('Prefill rates are estimates'));});
function mockAdapter(opts:{failLoad?:boolean;badConfig?:boolean;abort?:AbortController;judge?:boolean}={}){let instance='',capacity=0,ctx=0,inflight=0,maxInflight=0,loads=0,unloads=0;const m:Model={key:'mock',display_name:'Mock',type:'llm',size_bytes:100,quantization:null,max_context_length:8192,loaded_instances:[]};const events:string[]=[];
 const adapter:Adapter={models:async()=>[{...m,loaded_instances:instance?[{id:instance,config:{context_length:ctx,parallel:opts.badConfig?999:capacity}}]:[]}],cli:async(_s,args)=>{loads++;events.push('load');instance=args[args.indexOf('--identifier')+1];capacity=Number(args[args.indexOf('--parallel')+1]);ctx=Number(args[args.indexOf('--context-length')+1]);if(opts.failLoad)throw Error('Out of memory');return 'loaded';},api:async()=>{unloads++;instance='';events.push('unload');return {};},infer:async(_s,_id,prompt,_max,_temp,_reason,signal)=>{inflight++;maxInflight=Math.max(maxInflight,inflight);events.push('infer');await new Promise(r=>setTimeout(r,8));inflight--;if(opts.abort&&prompt.includes('Work'))opts.abort.abort();return {output:opts.judge&&prompt.includes('criteria')?grade:'84',reasoning:'',rawStats:{},metrics:metrics({input_tokens:10,total_output_tokens:2,tokens_per_second:50},40,0,10,20),status:signal.aborted?'cancelled':'completed',possibleTruncation:false};}};return {adapter,events,state:()=>({loads,unloads,maxInflight,contextArg:ctx})};}
test('runner launches concurrency waves, warms up once, and unloads',async()=>{const run=makeRun(),mock=mockAdapter(),events:EngineEvent[]=[];await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter);assert.equal(events.filter(e=>e.type==='sample'&&!e.sample.warmup).length,6);assert.equal(events.filter(e=>e.type==='sample'&&e.sample.warmup).length,1);assert.equal(mock.state().maxInflight,2);assert.equal(mock.state().unloads,1);assert.equal(events.filter(e=>e.type==='wave').length,4);assert.equal((events.findLast(e=>e.type==='finish') as any).status,'completed');});
test('load failure records failure and still attempts owned cleanup',async()=>{const mock=mockAdapter({failLoad:true}),events:EngineEvent[]=[];await runEngine(makeRun(),defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter);assert.equal(events.filter(e=>e.type==='sample').length,0);assert.equal(mock.state().unloads,1);assert.equal((events.find(e=>e.type==='finish') as any).status,'failed');});
test('the loaded context covers every parallel slot so concurrent requests keep their full context',async()=>{
 const run=makeRun(),mock=mockAdapter(),events:EngineEvent[]=[];
 await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter);
 // concurrency [1,2] loads 2 slots, so 2048 per request needs 4096 shared tokens.
 assert.equal(mock.state().contextArg,4096);
 assert.equal((events.findLast(e=>e.type==='finish') as any).status,'completed');
});
test('a context budget larger than the model supports fails before any measurement',async()=>{
 const run=makeRun();run.config.contextLength=8192;run.config.concurrency=[8];
 const mock=mockAdapter(),events:EngineEvent[]=[];
 await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter);
 assert.equal(events.filter(e=>e.type==='sample').length,0);
 assert.ok(events.some(e=>e.type==='log'&&e.message.includes('8 parallel slots at 8192 tokens each need 65536')));
});
test('mismatched parallel settings prevent misleading measurements',async()=>{const mock=mockAdapter({badConfig:true}),events:EngineEvent[]=[];await runEngine(makeRun(),defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter);assert.equal(events.filter(e=>e.type==='sample').length,0);assert.ok(events.some(e=>e.type==='log'&&e.message.includes('settings differ')));});
test('cancellation prevents subsequent waves and unloads',async()=>{const controller=new AbortController(),mock=mockAdapter(),events:EngineEvent[]=[];await runEngine(makeRun(),defaultSettings,controller.signal,e=>{events.push(e);if(e.type==='wave')controller.abort();},mock.adapter);assert.equal(events.filter(e=>e.type==='wave').length,1);assert.equal(mock.state().unloads,1);assert.equal((events.find(e=>e.type==='finish') as any).status,'cancelled');});
test('local grading starts after benchmark unload and grades all good quality responses',async()=>{const run=makeRun();run.config.judgeModel='mock';const mock=mockAdapter({judge:true}),events:EngineEvent[]=[];await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter);assert.equal(mock.state().loads,2);assert.equal(mock.state().unloads,2);assert.equal(events.filter(e=>e.type==='grade').length,6);const firstGrade=events.findIndex(e=>e.type==='grade');assert.ok(events.slice(firstGrade).every(e=>e.type!=='wave'));});
test('retry keeps prompt, links previous sample, and uses actual partial-wave concurrency',async()=>{const run=makeRun(),s=makeSample(),mock=mockAdapter(),events:EngineEvent[]=[];s.status='failed';await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),mock.adapter,[s]);const sample=events.find(e=>e.type==='sample'&&!e.sample.warmup) as any;assert.equal(sample.sample.prompt,s.prompt);assert.equal(sample.sample.retryOf,s.id);assert.equal(sample.sample.concurrency,1);});
test('inference retains partial output when stream errors',async()=>{const original=global.fetch;global.fetch=async()=>new Response('event: message.delta\ndata: {"content":"partial"}\n\nevent: error\ndata: {"error":{"message":"failure"}}\n\nevent: chat.end\ndata: {"result":{"stats":{}}}\n\n');try{const r=await infer(defaultSettings,'m','x',100,0,'default',new AbortController().signal);assert.equal(r.status,'failed');assert.equal(r.output,'partial');assert.equal(r.metrics.generationTps,null);}finally{global.fetch=original;}});
test('inference distinguishes explicit cancellation',async()=>{const controller=new AbortController();controller.abort();const r=await infer(defaultSettings,'m','x',100,0,'default',controller.signal);assert.equal(r.status,'cancelled');});
test('inference timeout is saved distinctly from cancellation',async()=>{const original=global.fetch;global.fetch=async(_url,options)=>new Promise((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>reject(new Error('timeout')),{once:true});});const keepAlive=setInterval(()=>{},50);try{const r=await infer({...defaultSettings,timeoutSec:1},'m','x',100,0,'default',new AbortController().signal);assert.equal(r.status,'timeout');}finally{clearInterval(keepAlive);global.fetch=original;}});
test('runner accepts an unseen model identity and format without family-specific behavior',async()=>{
 const run=makeRun(),mock=mockAdapter(),events:EngineEvent[]=[];
 const key='custom-publisher/future-finetune@unfamiliar-quant';run.config.modelKeys=[key];run.config.reasoning='default';
 const adapter={...mock.adapter,models:async(...args:Parameters<typeof mock.adapter.models>)=>(await mock.adapter.models(...args)).map(m=>({...m,key,format:'future-format',max_context_length:0,capabilities:undefined}))};
 await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),adapter);
 assert.equal((events.findLast(e=>e.type==='finish') as any).status,'completed');
 assert.ok(events.filter(e=>e.type==='sample').every(e=>e.type==='sample'&&e.sample.modelKey===key));
 assert.equal(events.filter(e=>e.type==='sample'&&!e.sample.warmup).length,6);
});

// --- the API token never reaches the renderer -------------------------------
// The window is told whether a token is stored, not what it is. These guard the
// boundary from both sides: the shape the main process sends out, and the shape
// it will accept back.
const publicSettings={baseUrl:'http://127.0.0.1:1234',lmsPath:'',timeoutSec:300,loadTimeoutSec:300,judgePrompt:defaultSettings.judgePrompt,updateRepo:'',updateCheck:false,tokenConfigured:true};
test('settings may be saved without sending a token back',()=>{validateSettings({...publicSettings});});
test('an empty token is accepted as an explicit clear',()=>{validateSettings({...publicSettings,token:''});});
test('a replacement token is accepted',()=>{validateSettings({...publicSettings,token:'lms-abc123'});});
test('tokens with control characters or absurd length are refused',()=>{
 for(const token of ['bad\ntoken','bad\u0000token','tab\tseparated','x'.repeat(4097)])
  assert.throws(()=>validateSettings({...publicSettings,token}),/Invalid API token/);
});
test('the snapshot handler sends public settings, never the decrypted token',()=>{
 const main=readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8');
 assert.ok(main.includes("handle('snapshot',()=>({settings:publicSettings()"),'snapshot must use publicSettings()');
 assert.ok(!main.includes("handle('snapshot',()=>({settings:settings()"),'snapshot must not send the decrypted settings');
 assert.ok(/function publicSettings\(\)[^\n]*tokenConfigured:!!encryptedToken/.test(main),'publicSettings must report only whether a token exists');
});
test('only a run that is still moving is re-read from the database',()=>{
 const ui=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
 assert.ok(ui.includes('const liveRun=!!progress&&progress.runId===runId;'),'liveness must be decided by the active run, not by the screen being open');
 assert.ok(ui.includes('update();if(!liveRun)return ()=>{alive=false;};const t=setInterval(update,2000)'),'a finished run must be read once, with no timer behind it');
 assert.ok(ui.includes('},[runId,liveRun]);'),'the effect must re-run when a run stops, so the final state is still read');
});
test('the window is denied every permission request',()=>{
 const main=readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8');
 for(const denial of ['setPermissionRequestHandler((_wc,_permission,callback)=>callback(false))','setPermissionCheckHandler(()=>false)','setDevicePermissionHandler(()=>false)'])
  assert.ok(main.includes(denial),'missing permission denial: '+denial);
});
