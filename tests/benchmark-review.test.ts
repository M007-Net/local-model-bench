import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {metrics} from '../electron/metrics';
import {defaultConfig,defaultSettings,performanceTest} from '../src/defaults';
import type {Run,Model} from '../src/types';

const model={key:'review',display_name:'Review fixture',size_bytes:0,quantization:null,max_context_length:0,type:'llm',loaded_instances:[]} as Model;
function makeRun(rate=2,durationSec=1):Run{
 const workload=performanceTest('short');
 return {id:'review',created:'',updated:'',status:'running',config:{...structuredClone(defaultConfig),modelKeys:[model.key],mode:'performance',testIds:[],concurrency:[1],waves:1,loadProfile:'arrival-rate',arrivalRatePerSecond:rate,durationSec,latencyTargetMs:300},tests:[workload],samples:[],waves:[],modelInfo:{},environment:{},logs:[]};
}
async function execute(run:Run,delayMs:number,controller=new AbortController(),onMeasured?:()=>void){
 const events:EngineEvent[]=[];
 const adapter:Adapter={models:async()=>[model],api:async()=>({}),cli:async()=>'',infer:async(_s,_id,prompt)=>{
  const warmup=prompt.includes('Reply with the word ready');
  if(!warmup){onMeasured?.();await new Promise(resolve=>setTimeout(resolve,delayMs));}
  return {output:'fixture',reasoning:'',rawStats:{},status:'completed',possibleTruncation:false,metrics:metrics({input_tokens:128,total_output_tokens:10,tokens_per_second:50},warmup?1:delayMs,null,null,1)};
 }};
 await runEngine(run,{...defaultSettings,provider:'openai'},controller.signal,event=>{
  events.push(event);
  if(event.type==='sample')run.samples.push(event.sample);
  if(event.type==='wave'){const index=run.waves.findIndex(w=>w.id===event.wave.id);if(index<0)run.waves.push(event.wave);else run.waves[index]=event.wave;}
 },adapter);
 return events;
}

test('review: fast arrival requests retain the entire offer interval',async()=>{
 const run=makeRun();await execute(run,5);
 assert.equal(run.waves.length,1);
 assert.ok(run.waves[0].durationMs>=1000,'fast last response must not shorten throughput denominator');
 assert.equal(run.waves[0].arrival?.planned,2);
 assert.ok(run.waves[0].arrival!.latencyTargetGoodputPerSecond<=2);
});

test('review: queued arrivals include client waiting in latency-target goodput',async()=>{
 const run=makeRun(10);await execute(run,180);
 const arrivals=run.waves[0].arrival!;
 assert.equal(arrivals.planned,10);assert.equal(arrivals.started,10);
 assert.ok(arrivals.meanQueueWaitMs!>100,'fixture should build a client queue');
 assert.ok(arrivals.latencyTargetGoodputRequests<10,'service time alone meets target; queued end-to-end time does not');
 assert.ok(arrivals.latencyTargetGoodputRequests>0);
 assert.ok(run.waves[0].durationMs>=1000);
});

test('review: cancelling a long arrival offer promptly releases future timers',async()=>{
 const run=makeRun(.5,60),controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const start=performance.now();
 const events=await execute(run,20,controller,()=>{timer??=setTimeout(()=>controller.abort(),25);});
 if(timer)clearTimeout(timer);
 assert.ok(performance.now()-start<1500,'cancellation must not wait for future scheduled arrivals');
 const finish=events.find(e=>e.type==='finish');assert.equal(finish?.type==='finish'?finish.status:null,'cancelled');
 assert.equal(run.samples.filter(s=>!s.warmup).length,1);
});
