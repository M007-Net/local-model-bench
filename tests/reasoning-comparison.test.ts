import {test} from 'node:test';
import assert from 'node:assert/strict';
import {comparisonConfig,defaultReasoningSettings,effectiveReasoningSamples,reasoningAnswerChanges,reasoningSummaries,resolveReasoningSettings,rotatedSettings,validateReasoningContext,type ReasoningSetting} from '../src/reasoning-comparison';
import {defaultConfig,defaultSettings} from '../src/defaults';
import {selectBenchmark,benchmarkRows} from '../src/benchmarks';
import {validateConfig} from '../electron/validation';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {metrics} from '../electron/metrics';
import type {Model,Run,Sample} from '../src/types';
const settings:ReasoningSetting[]=[{id:'off',kind:'off'},{id:'budget-512',kind:'budget',tokens:512},{id:'unlimited',kind:'unlimited'}];
function makeRun():Run{return {id:'reasoning-fixture',created:'',updated:'',status:'running',config:{...comparisonConfig({...defaultConfig,modelKeys:['fixture']}),benchmark:{packId:'token-efficiency',count:2,seed:42},reasoningComparison:{settings,baselineId:'off'}},tests:selectBenchmark({packId:'token-efficiency',count:2,seed:42}),samples:[],waves:[],modelInfo:{},logs:[],environment:{}};}
function model():Model{return {key:'fixture',display_name:'Fixture',loaded_instances:[],reasoningSupport:{numeric:true,off:true,unlimited:true,efforts:[],transport:'fixture',confirmation:'reported',note:'Fixture controls'}} as unknown as Model;}
function result(output:string,extra:Partial<Awaited<ReturnType<Adapter['infer']>>>={}){return {output,reasoning:'reasoning',rawStats:{},status:'completed' as const,possibleTruncation:false,metrics:metrics({input_tokens:100,total_output_tokens:30,reasoning_output_tokens:20},10,null,null,10),...extra};}
function adapter(infer:Adapter['infer']):Adapter{return {models:async()=>[model()],api:async()=>{throw Error('Native API not permitted');},cli:async()=>{throw Error('CLI not permitted');},infer};}
function save(run:Run,e:EngineEvent){if(e.type==='sample')run.samples.push(e.sample);if(e.type==='model')run.modelInfo[e.key]=e.info;if(e.type==='finish')run.status=e.status;if(e.type==='wave')run.waves.push(e.wave);if(e.type==='log')run.logs.push(e.message);}
test('comparison configuration has chosen defaults and validates independent budgets',()=>{
 const run=makeRun();validateConfig(run.config);assert.equal(run.config.maxTokens,32768);assert.equal(run.config.timeoutSec,1200);assert.equal(run.config.waves,3);
 assert.deepEqual(defaultReasoningSettings.map(s=>s.kind==='budget'?s.tokens:s.kind),['off',512,1024,2048,4096,'unlimited']);
 for(const change of [{concurrency:[2]},{judgeModel:'judge'},{temperature:0.5},{maxTokens:768},{mtpSweep:[0,2]}])assert.throws(()=>validateConfig({...run.config,...change}));
 assert.throws(()=>validateConfig({...run.config,reasoningComparison:{settings:[settings[0],{id:'off',kind:'budget',tokens:12}]}}),/identifiers/);
});
test('unsupported numeric budgets become distinct supported effort settings with baseline fallback',()=>{
 const m={...model(),reasoningSupport:undefined,capabilities:{reasoning:{allowed_options:['low','medium','high'],default:'medium'}}};
 const p=resolveReasoningSettings(m,{settings:defaultReasoningSettings,baselineId:'off'});
 assert.deepEqual(p.settings.map(s=>s.id),['effort-low','effort-medium','effort-high']);assert.equal(p.baselineId,'effort-low');assert.equal(p.unsupported.length,6);
 const q=resolveReasoningSettings(model(),{settings:[{id:'budget-4096',kind:'budget',tokens:4096},settings[1]],baselineId:'off'});assert.equal(q.baselineId,'budget-512');
 assert.deepEqual(rotatedSettings(settings,1).map(s=>s.id),['budget-512','unlimited','off']);
});
test('engine runs identical objective questions at rotated settings with full shared output cap',async()=>{
 const run=makeRun(),calls:{prompt:string;setting:string;max:number}[]=[];let total=0;
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>{save(run,e);if(e.type==='progress')total=e.progress.total;},adapter(async(_s,_i,prompt,max,_t,_r,_a,_image,setting)=>{
  calls.push({prompt,max,setting:setting!.id});const question=run.tests.find(t=>t.prompt===prompt)!;return result(question.answerKey,{reasoningControl:{transport:'fixture',confirmation:'requested',note:'No enforcement claim'}});
 }));
 assert.equal(run.status,'completed');assert.equal(calls.length,18);assert.equal(total,18);assert.ok(calls.every(c=>c.max===32768));
 assert.deepEqual(calls.filter((_,i)=>i%2===0).map(c=>c.setting),['off','budget-512','unlimited','budget-512','unlimited','off','unlimited','off','budget-512']);
 assert.equal(new Set(calls.map(c=>c.prompt)).size,2);assert.deepEqual(run.samples.map(s=>s.reasoningRepeat),[0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,2]);
 assert.equal(reasoningSummaries(run).length,3);assert.ok(benchmarkRows(run).every(r=>r.attempted===6&&r.score===100));
});
test('failures, timeouts and truncation count as misses without dropping subsequent settings',async()=>{
 const run=makeRun();run.config.waves=1;let call=0;
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(run,e),adapter(async(_s,_i,prompt)=>{
  call++;if(call===1)throw Error('Rejected control');if(call===2)return result('',{status:'timeout',error:'Timed out'});return result(run.tests.find(t=>t.prompt===prompt)!.answerKey,{possibleTruncation:call===3});
 }));
 assert.equal(run.status,'failed');assert.equal(run.samples.length,6);assert.equal(reasoningSummaries(run)[0].accuracy,0);assert.equal(reasoningSummaries(run)[1].accuracy,50);assert.equal(run.samples[2].objective.score,0);
});
test('cancellation saves attempted responses and leaves remaining planned work incomplete',async()=>{
 const run=makeRun(),abort=new AbortController();let total=0;
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},abort.signal,e=>{save(run,e);if(e.type==='progress')total=e.progress.total;},adapter(async()=>{abort.abort();return result('',{status:'cancelled'});}));
 assert.equal(run.status,'cancelled');assert.equal(run.samples.length,1);assert.equal(total,18);assert.equal(reasoningSummaries(run)[0].expected,6);
});
test('retries retain original setting, prompt and repeat; report subset without duplicate attempts',async()=>{
 const old=makeRun();old.config.waves=1;
 await runEngine(old,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(old,e),adapter(async()=>result('',{status:'failed'})));
 const previous=old.samples[2],run=makeRun();run.config.retryOf=old.id;const seen:string[]=[];
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(run,e),adapter(async(_s,_i,prompt,_m,_t,_r,_sig,_im,setting)=>{seen.push(setting!.id);assert.equal(prompt,previous.prompt);return result(run.tests.find(t=>t.id===previous.testId)!.answerKey);}),[previous]);
 assert.deepEqual(seen,[previous.reasoningSetting!.id]);assert.equal(run.samples[0].retryOf,previous.id);assert.equal(reasoningSummaries(run)[0].expected,null);
 run.samples.unshift(previous);assert.equal(effectiveReasoningSamples(run).length,1);
});
test('answer comparison pairs question and repeat and identifies improvements and regressions',async()=>{
 const run=makeRun();run.config.waves=1;
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(run,e),adapter(async(_s,_i,prompt,_m,_t,_r,_sig,_im,setting)=>result(setting?.kind==='off'?'wrong':run.tests.find(t=>t.prompt===prompt)!.answerKey)));
 const changes=reasoningAnswerChanges(run,'fixture','off','budget-512');assert.equal(changes.length,2);assert.ok(changes.every(c=>c.change==='improved'&&c.answerChanged));assert.equal(reasoningSummaries(run)[1].delta,100);
 assert.ok(reasoningAnswerChanges(run,'fixture','budget-512','off').every(c=>c.change==='worsened'));
 const historical={...run,config:{...defaultConfig},samples:run.samples.map(s=>({...s,reasoningSetting:undefined}))};assert.deepEqual(reasoningSummaries(historical),[]);
});
test('reported active external context is validated rather than using the nominal run context',()=>{
 const run=makeRun(),m=model();m.loaded_instances=[{id:'fixture',config:{context_length:8192}}];
 assert.throws(()=>validateReasoningContext(run.config,m,false),/server-reported active/);
 assert.match(validateReasoningContext({...run.config,maxTokens:4096},m,false),/8192/);
 m.loaded_instances=[];assert.match(validateReasoningContext(run.config,m,false),/unconfirmed/);
});
test('truncated email answers cannot contradict aggregate comparison accuracy',()=>{
 const run=makeRun();run.tests=selectBenchmark({packId:'berkeley-enron',count:1,seed:42});run.config.modelKeys=['fixture'];
 run.samples=[{...result(run.tests[0].answerKey,{possibleTruncation:true}),id:'s',runId:run.id,modelKey:'fixture',modelName:'Fixture',testId:run.tests[0].id,testName:'Email',concurrency:1,waveId:'w',wave:0,slot:0,warmup:false,prompt:'',objective:{score:0,checks:[]},grades:[],created:'',reasoningSetting:settings[0]}];
 const row=benchmarkRows(run)[0];assert.equal(row.score,0);assert.equal(row.classification?.accuracy,0);assert.equal(row.classification?.invalid,1);
});
test('a failed request can retry its supported setting after its comparison partner disappears',async()=>{
 const old=makeRun();old.config.waves=1;
 await runEngine(old,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(old,e),adapter(async()=>result('',{status:'failed'})));
 const previous=old.samples[2],run=makeRun();run.config.retryOf=old.id;
 const a=adapter(async()=>result(run.tests.find(t=>t.id===previous.testId)!.answerKey));a.models=async()=>[{...model(),reasoningSupport:{...model().reasoningSupport!,off:false,unlimited:false}}];
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(run,e),a,[previous]);
 assert.equal(run.status,'completed');assert.equal(run.samples.length,1);assert.equal(run.samples[0].reasoningSetting?.id,'budget-512');
});
test('cancellation during capability discovery does not continue to further models',async()=>{
 const run=makeRun(),abort=new AbortController();run.config.modelKeys=['fixture','second'];let calls=0;
 const a=adapter(async()=>{throw Error('No inference permitted');});a.models=async()=>[model(),{...model(),key:'second'}];a.reasoningSupport=async()=>{calls++;abort.abort();return model().reasoningSupport!;};
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},abort.signal,e=>save(run,e),a);
 assert.equal(calls,1);assert.equal(run.status,'cancelled');assert.equal(run.samples.length,0);
});

test('new Unlimited removes output and timeout caps while capped partners retain limits',async()=>{
 const run=makeRun();run.config.waves=1;run.config.reasoningComparison!.unlimitedPolicy='unbounded';
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>save(run,e),adapter(async(s,_i,prompt,max,_t,_r,_a,_image,setting)=>{
  assert.equal(max,setting!.kind==='unlimited'?0:32768);assert.equal(s.timeoutSec,setting!.kind==='unlimited'?0:1200);
  return result(run.tests.find(t=>t.prompt===prompt)!.answerKey);
 }));
 assert.equal(run.status,'completed');const sample=run.samples.find(s=>s.reasoningSetting?.kind==='unlimited')!;
 assert.equal(sample.requestedOutputTokens,null);assert.equal(sample.requestedTimeoutSec,null);
});
test('consecutive mistakes reset after correct answers, stop independently and skip future repeats',async()=>{
 const run=makeRun();run.tests=selectBenchmark({packId:'token-efficiency',count:6,seed:42});run.config.reasoningComparison!.stopAfterConsecutiveMisses=2;
 const counts=new Map<string,number>();let total=0;
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},new AbortController().signal,e=>{save(run,e);if(e.type==='progress')total=e.progress.total;},adapter(async(_s,_i,prompt,_max,_t,_r,_a,_image,setting)=>{
  const n=(counts.get(setting!.id)??0)+1;counts.set(setting!.id,n);
  const correct=setting!.id==='unlimited'||(setting!.id==='off'&&n===2);
  return result(correct?run.tests.find(t=>t.prompt===prompt)!.answerKey:'wrong');
 }));
 assert.equal(counts.get('off'),4);assert.equal(counts.get('budget-512'),2);assert.equal(counts.get('unlimited'),18);assert.equal(total,24);
 assert.equal((run.modelInfo['reasoning-stop:fixture:off'] as any).reason,'consecutive-misses');
 assert.equal((run.modelInfo['reasoning-stop:fixture:unlimited'] as any).reason,'question-pool-exhausted');
 assert.equal(run.status,'completed');
});
test('invalid consecutive mistake thresholds fail validation',()=>{
 const run=makeRun();for(const threshold of [0,-1,1.5,101])assert.throws(()=>validateConfig({...run.config,reasoningComparison:{...run.config.reasoningComparison!,stopAfterConsecutiveMisses:threshold}}));
});
test('cancellation does not count towards the mistake streak',async()=>{
 const run=makeRun(),abort=new AbortController();run.config.reasoningComparison!.stopAfterConsecutiveMisses=1;
 await runEngine(run,{...defaultSettings,provider:'llamacpp'},abort.signal,e=>save(run,e),adapter(async()=>{abort.abort();return result('',{status:'cancelled'});}));
 assert.equal(run.status,'cancelled');assert.ok(!Object.keys(run.modelInfo).some(k=>k.startsWith('reasoning-stop:')));
});
