import {assertRetryEndpoint} from '../electron/run-endpoint';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {defaultConfig,defaultSettings,starterTests} from '../src/defaults';
import {metrics} from '../electron/metrics';
import type {Run,Sample,Model} from '../src/types';
const settings={...defaultSettings,provider:'llamacpp' as const};
const makeRun=():Run=>({id:'audit',created:'',updated:'',status:'running',config:{...defaultConfig,modelKeys:['mock'],judgeModel:'',mtp:undefined,concurrency:[1],waves:1},tests:[starterTests[0]],environment:{},modelInfo:{},logs:[],samples:[],waves:[]});
const sample=(run:Run):Sample=>({id:'old',runId:'old-run',modelKey:'mock',modelName:'Mock',testId:run.tests[0].id,testName:run.tests[0].name,concurrency:1,waveId:'old-wave',wave:0,slot:0,warmup:false,prompt:'Original',output:'Answer',reasoning:'',status:'failed',metrics:metrics({},1,null,null,null),objective:{score:null,checks:[]},grades:[],rawStats:{},created:'',possibleTruncation:false,mtpTokens:2});
function adapter():Adapter{return {models:async()=>[{key:'mock',display_name:'Mock',size_bytes:0,quantization:null,max_context_length:0,type:'llm',loaded_instances:[]} as Model],cli:async()=>{throw Error('must not call CLI');},api:async()=>{throw Error('must not manage server');},infer:async()=>({output:'{"criteria":[{"name":"correctness","score":90,"reason":"ok"},{"name":"completeness","score":90,"reason":"ok"},{"name":"clarity","score":90,"reason":"ok"},{"name":"instruction_following","score":90,"reason":"ok"}],"summary":"ok"}',reasoning:'',rawStats:{},metrics:metrics({},1,null,null,null),status:'completed',possibleTruncation:false})};}
test('retries require original provider and origin, allowing normalized v1 and legacy LM Studio',()=>{
 const run=makeRun();run.environment={endpoint:'http://127.0.0.1:1234/v1'};
 assert.doesNotThrow(()=>assertRetryEndpoint(run,defaultSettings));
 assert.throws(()=>assertRetryEndpoint(run,{...defaultSettings,baseUrl:'http://other:1234'}),/original endpoint/);
 assert.throws(()=>assertRetryEndpoint(run,settings),/original endpoint/);
 run.environment.provider='llamacpp';assert.doesNotThrow(()=>assertRetryEndpoint(run,settings));
 run.environment={};assert.throws(()=>assertRetryEndpoint(run,settings),/original endpoint/);
});test('external judge can grade historical MTP run without altering measured settings',async()=>{const run=makeRun();run.config.mtp='on';run.config.mtpSweep=[0,2];run.config.runtime='original-runtime';run.config.judgeModel='mock';run.samples=[{...sample(run),status:'completed'}];const original=structuredClone(run.config);const events:EngineEvent[]=[];await runEngine(run,settings,new AbortController().signal,e=>events.push(e),adapter(),undefined,true);const graded=events.find(e=>e.type==='grade');assert.ok(graded,JSON.stringify(events.filter(e=>e.type==='log')));assert.equal(graded.grade.endpoint,settings.baseUrl);assert.equal(graded.grade.provider,'llamacpp');assert.deepEqual(run.config,original);});
