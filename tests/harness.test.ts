import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HARNESS_PROTOCOL,defaultHarnessConfig,validateHarnessConfig,validateHarnessModels,selectHarnessTasks,aggregateHarness,comparisonIssues,type HarnessRun} from '../src/harness';
import {harnessTasks} from '../electron/harness-tasks';
import {runHarnessEvaluation,classifyHarnessFailure,toolMetrics,type HarnessAdapter} from '../electron/harness-engine';
import {relayBody,recordUsage,relayInference} from '../electron/harness-relay';
import {sandboxArgs,harnessDiagnostics,runSandbox,dockerCommand} from '../electron/harness-sandbox';
import {harnessText} from '../electron/harness-export';
import {Store} from '../electron/store';
import {defaultSettings} from '../src/defaults';
import type {Model} from '../src/types';
import {createServer} from 'node:http';

const config=()=>({...structuredClone(defaultHarnessConfig),modelKeys:['fixture'],taskCount:1});
const run=():HarnessRun=>({id:'test-run',created:'2026-10-13',updated:'2026-10-13',status:'running',config:config(),protocol:HARNESS_PROTOCOL,tasks:[structuredClone(harnessTasks[0])],trials:[],environment:{},logs:[]});
const response=(model:string)=>({model,choices:[{message:{role:'assistant',content:'test',tool_calls:[{function:{name:'readiness'}}]}}],usage:{prompt_tokens:100,completion_tokens:20}});
function mock():HarnessAdapter{
 const model:Model={key:'fixture',display_name:'Fixture',size_bytes:100,quantization:{name:'Q4'},max_context_length:8192,type:'llm',loaded_instances:[{id:'fixture-instance',config:{context_length:8192,parallel:1}}]};
 return {diagnostics:async()=>({ready:true,imageId:'sha256:fixture',message:'mock',versions:{}}),models:async()=>[model],cli:async()=>'',api:async()=>({}),infer:async(_s,b)=>response(String(b.model)),sandbox:async o=>{await o.onEvent({kind:'ready'});await o.onEvent({kind:'configuration',harness:{prompt:'fixture'}});await o.onEvent({kind:'request',body:{model:'fixture-instance',messages:[{role:'user',content:'repair'}]}});await o.onEvent({kind:'tool',result:{returncode:0},durationMs:5});await o.onEvent({kind:'artifacts',files:{'solution.py':'def solve(values):\n    return sum(values)/len(values) if values else 0\n'}});},verify:async()=>({code:0,stdout:harnessTasks[0].cases.map((_,i)=>JSON.stringify({case:i+1,passed:true})).join('\n'),stderr:''})};
}
test('harness configuration validates supported harnesses, budgets and distinct models',()=>{
 assert.deepEqual(validateHarnessConfig(config()),config());for(const patch of [{harnesses:['hermes']},{modelKeys:[]},{modelKeys:['fixture','fixture']},{taskCount:9},{seed:-1},{trials:0},{contextLength:1024},{maxTokens:8192},{maxToolCalls:0},{timeoutSec:0},{maxTotalTokens:10},{temperature:NaN},{reasoning:'low'},{cpus:9},{memoryMb:256},{pack:'unknown'}])assert.throws(()=>validateHarnessConfig({...config(),...patch} as any));
});
test('task selection is seeded, unique, repeatable and detached from initial assets',()=>{
 const a=selectHarnessTasks(harnessTasks,8,42),b=selectHarnessTasks(harnessTasks,8,42);assert.deepEqual(a,b);assert.equal(new Set(a.map(t=>t.id)).size,8);assert.notDeepEqual(a,selectHarnessTasks(harnessTasks,8,43));a[0].files['solution.py']='changed';assert.notDeepEqual(a,b);assert.throws(()=>selectHarnessTasks(harnessTasks,9,42));
});
test('relay pins the instance and settings and drops unrecognized upstream controls',()=>{
 const body=relayBody({model:'fixture',messages:[],temperature:1,max_tokens:999,api_key:'secret',base_url:'http://attacker',stream:true,seed:999},'fixture',config());assert.equal(body.temperature,0);assert.equal(body.max_tokens,1024);assert.equal(body.stream,false);assert.equal(body.api_key,undefined);assert.equal(body.base_url,undefined);assert.equal(body.seed,undefined);assert.throws(()=>relayBody({model:'another',messages:[]},'fixture',config()));
});
test('native reasoning off is explicitly mapped to OpenAI none, with no automatic retry',()=>{
 const body=relayBody({model:'fixture',messages:[]},'fixture',{...config(),reasoning:'off'});assert.equal(body.reasoning_effort,'none');
});
test('model compatibility rejects unsupported reasoning and context before execution',async()=>{
 const models=await mock().models(defaultSettings);validateHarnessModels(config(),models);assert.throws(()=>validateHarnessModels({...config(),reasoning:'on'},models),/reasoning/i);assert.throws(()=>validateHarnessModels({...config(),contextLength:16384},models),/Context/);assert.throws(()=>validateHarnessModels({...config(),modelKeys:['missing']},models),/unavailable/);
});
test('Docker sandbox cannot mount host files, expose network, or gain capabilities',()=>{
 const args=sandboxArgs('test','sha256:fixture',config(),'run');assert.ok(args.includes('--network=none'));assert.ok(args.includes('--read-only'));assert.ok(args.includes('--cap-drop=ALL'));assert.ok(args.includes('--security-opt=no-new-privileges'));assert.ok(!args.some(a=>/privileged|host\.docker|--volume|--mount|docker\.sock/.test(a)));for(const flag of ['--cpus','--memory','--memory-swap','--pids-limit','--user'])assert.ok(args.includes(flag));assert.ok(args.includes('--pull=never'));
});
test('mock adapter contract produces individual attempts and reproducible records',async()=>{
 const r=run();await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},mock());assert.equal(r.status,'completed');assert.equal(r.trials.length,2);assert.ok(r.trials.every(t=>t.status==='success'));assert.ok(r.trials.every(t=>t.metrics.toolCalls===1));assert.equal(r.trials[0].metrics.totalTokens,120);assert.equal(r.trials[0].metrics.toolMs,5);assert.deepEqual(JSON.parse(JSON.stringify(r)),r);
});
test('SQLite harness records are separate and recovery preserves completed trials',async()=>{
 const r=run();await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},mock());const store=new Store(':memory:');r.status='running';store.saveHarnessRun(r);for(const t of r.trials)store.saveHarnessTrial(t);store.recover();assert.equal(store.getHarnessRun(r.id).status,'interrupted');assert.deepEqual(store.getHarnessRun(r.id).trials,r.trials);assert.deepEqual(store.listAgentic(),[]);assert.deepEqual(store.list(),[]);store.deleteHarnessRun(r.id);assert.deepEqual(store.listHarness(),[]);store.db.close();
});
test('aggregation excludes unknown metrics and keeps all failures in quality denominator',async()=>{
 const r=run();await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},mock());const t=structuredClone(r.trials[0]);t.status='failure';t.metrics.totalTokens=null;t.metrics.toolCalls=null;r.trials.push(t);const g=aggregateHarness(r.trials).find(g=>g.harness==='mini-swe-agent')!;assert.equal(g.rate,0.5);assert.equal(g.totalTokens,null);assert.equal(g.usageCoverage,0.5);assert.equal(g.toolsPerSuccess,1);assert.ok(g.interval[0]<0.5&&g.interval[1]>0.5);
});
test('usage coverage stays unavailable after one missing response; reasoning is not double counted',async()=>{
 const r=run();await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},mock());const m=r.trials[0].metrics;recordUsage(m,{usage:{prompt_tokens:3,completion_tokens:7,completion_tokens_details:{reasoning_tokens:4}}});assert.equal(m.totalTokens,130);recordUsage(m,{});recordUsage(m,response('fixture'));assert.equal(m.totalTokens,null);assert.equal(m.tokenSource,'unavailable');
});
test('failed model requests report unknown token usage instead of fabricated zero consumption',async()=>{
 const r=run(),a=mock();r.config.harnesses=['mini-swe-agent'];a.infer=async()=>{throw Error('Inference unavailable');};await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},a);assert.equal(r.trials[0].metrics.modelRequests,1);assert.equal(r.trials[0].metrics.totalTokens,null);assert.equal(r.trials[0].metrics.tokenSource,'unavailable');
});
test('measured token threshold denies the next request without silently dropping its budget',async()=>{
 const r=run(),a=mock();r.config.harnesses=['mini-swe-agent'];r.config.maxTokens=32;r.config.maxTotalTokens=100;
 a.sandbox=async o=>{for(let i=0;i<2;i++)await o.onEvent({kind:'request',body:{model:'fixture-instance',messages:[]}});};
 await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},a);assert.equal(r.trials[0].metrics.modelRequests,1);assert.equal(r.trials[0].metrics.totalTokens,120);assert.equal(r.trials[0].failure,'resource_limit');
});
test('exports preserve protocol, attempts and null metrics',async()=>{
 const r=run();await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},mock());assert.equal(JSON.parse(harnessText(r,'json')).trials.length,2);assert.match(harnessText(r,'csv'),/lmb-harness-v1/);assert.match(harnessText(r,'md'),/not official SWE-bench/);assert.throws(()=>harnessText(r,'exe'));
});
test('cancellation saves an active cancelled attempt and prevents subsequent attempts',async()=>{
 const r=run(),a=mock(),controller=new AbortController();a.sandbox=async()=>{controller.abort();throw Error('Cancelled');};await runHarnessEvaluation(r,defaultSettings,controller.signal,()=>{},a);assert.equal(r.status,'cancelled');assert.equal(r.trials.length,1);assert.equal(r.trials[0].status,'cancelled');
});
test('timeout, sandbox failure, and verifier failure are never scored as success',async()=>{
 for(const message of ['Task wall-clock timeout','Docker unavailable']){const r=run(),a=mock();a.sandbox=async()=>{throw Error(message);};await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},a);assert.ok(r.trials.every(t=>t.status!=='success'));assert.equal(r.trials[0].failure,classifyHarnessFailure(message));}
 const r=run(),a=mock();a.verify=async()=>({code:1,stdout:r.tasks[0].cases.map((_,i)=>JSON.stringify({case:i+1,passed:false})).join('\n'),stderr:''});await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},a);assert.equal(r.trials[0].status,'failure');assert.equal(r.trials[0].failure,'verification_failed');
});
test('missing dependencies and failed native tool probe disable execution without substitution',async()=>{
 const r=run(),a=mock();a.diagnostics=async()=>({ready:false,imageId:null,message:'missing image',versions:{}});await runHarnessEvaluation(r,defaultSettings,new AbortController().signal,()=>{},a);assert.equal(r.status,'failed');assert.equal(r.trials.length,0);
 const b=mock(),s=run();b.infer=async(_s,body)=>({model:body.model,choices:[{message:{content:'No tool'}}]});await runHarnessEvaluation(s,defaultSettings,new AbortController().signal,()=>{},b);assert.equal(s.status,'failed');assert.equal(s.trials.length,0);
});
test('comparison identifies task changes, budget differences and runtime provenance',()=>{
 const a=run(),b=run();assert.deepEqual(comparisonIssues(a,b),[]);b.config.timeoutSec++;b.tasks[0].version++;b.environment={imageId:'different'};assert.equal(comparisonIssues(a,b).length,3);
});
test('comparison ignores ephemeral instance IDs while retaining effective load-setting differences',()=>{
 const a=run(),b=run();const identity={key:'fixture',quantization:{name:'Q4'},sizeBytes:100};
 a.environment={models:{fixture:{weightsIdentity:identity,instance:{id:'instance-a',config:{context_length:8192,parallel:1}},model:{loaded_instances:[]}}}};
 b.environment={models:{fixture:{weightsIdentity:identity,instance:{id:'instance-b',config:{context_length:8192,parallel:1}},model:{loaded_instances:[{id:'old-instance'}]}}}};
 assert.deepEqual(comparisonIssues(a,b),[]);(b.environment.models as any).fixture.instance.config.context_length=4096;assert.equal(comparisonIssues(a,b).length,1);
});
test('tool adapter recognizes OpenCode errors and durations without inventing zero timings',()=>{
 assert.deepEqual(toolMetrics({event:{part:{state:{status:'error',time:{start:1,end:4}}}}}),{failed:true,ms:3});assert.equal(toolMetrics({event:{part:{state:{status:'completed'}}}}).ms,null);
 assert.equal(toolMetrics({event:{part:{state:{status:'completed',metadata:{exit:2}}}}}).failed,true);
});
test('relay does not follow redirects or accept response identity substitution',async()=>{
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response('wrong-model')));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const addr=server.address() as {port:number};try{await assert.rejects(relayInference({...defaultSettings,baseUrl:`http://127.0.0.1:${addr.port}`},{model:'fixture'},new AbortController().signal),/identity/);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('optional installed image diagnostic (requires explicitly preinstalled dependencies)',{skip:process.env.LMB_HARNESS_INTEGRATION!=='1'},async()=>{const d=await harnessDiagnostics();assert.equal(d.ready,true,d.message);});
test('optional actual Docker cancellation removes the active sandbox without model inference',{skip:process.env.LMB_HARNESS_INTEGRATION!=='1'},async()=>{
 const d=await harnessDiagnostics();assert.equal(d.ready,true,d.message);const controller=new AbortController(),runId='cancellation-integration-test';let ready=false;
 await assert.rejects(runSandbox({image:d.imageId!,config:config(),runId,payload:{config:config(),harness:'mini-swe-agent',model:'fixture',task:{files:harnessTasks[0].files,description:harnessTasks[0].description}},signal:controller.signal,onEvent:async e=>{if(e.kind==='ready'){ready=true;controller.abort();}}}),/Cancelled/);
 assert.equal(ready,true);const remaining=await dockerCommand(['ps','-aq','--filter',`label=local.model.bench.run=${runId}`]);assert.equal(remaining.stdout.trim(),'');
});
test('optional actual Docker wall-clock timeout cleans a sandbox with a held relay response',{skip:process.env.LMB_HARNESS_INTEGRATION!=='1'},async()=>{
 const d=await harnessDiagnostics();assert.equal(d.ready,true,d.message);const runId='timeout-integration-test';let requested=false;
 await assert.rejects(runSandbox({image:d.imageId!,config:{...config(),timeoutSec:10},runId,payload:{config:config(),harness:'mini-swe-agent',model:'fixture',task:{files:harnessTasks[0].files,description:harnessTasks[0].description}},signal:new AbortController().signal,onEvent:async e=>{if(e.kind==='request'){requested=true;return await new Promise(()=>{});}}}),/wall-clock timeout/);
 assert.equal(requested,true);const remaining=await dockerCommand(['ps','-aq','--filter',`label=local.model.bench.run=${runId}`]);assert.equal(remaining.stdout.trim(),'');
});
