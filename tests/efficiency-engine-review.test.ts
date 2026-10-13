import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngine,type Adapter} from '../electron/engine';
import {metrics} from '../electron/metrics';
import {objectiveScore} from '../electron/scoring';
import {selectBenchmark,benchmarkConfig,benchmarkRows} from '../src/benchmarks';
import {contextWorkloads} from '../src/load-profile';
import {defaultConfig,defaultSettings,performanceTest} from '../src/defaults';
import {exportText} from '../electron/export';
import type {Run,Model} from '../src/types';
function makeRun(packId='token-efficiency',maxTokens=4096):Run{
 const selection={packId,count:6,seed:42};
 return {id:'fixture-engine-review',created:'',updated:'',status:'running',config:{...benchmarkConfig({...defaultConfig,modelKeys:['fixture']},selection,'Fixture'),maxTokens,contextLength:16384},tests:selectBenchmark(selection),samples:[],waves:[],modelInfo:{},logs:[],environment:{}};
}
test('engine honors efficiency output budgets above and below default, with bounded warmup',async()=>{
 for(const budget of [32,4096,8192]){
  const run=makeRun('token-efficiency',budget),seen:{prompt:string;max:number}[]=[];
  const adapter:Adapter={models:async()=>[{key:'fixture',display_name:'Fixture',loaded_instances:[]} as unknown as Model],cli:async()=>{throw Error('No CLI permitted');},api:async()=>{throw Error('No native calls permitted');},infer:async(_settings,_id,prompt,max)=>{
   seen.push({prompt,max});const t=run.tests.find(t=>t.prompt===prompt);
   return {output:t?.answerKey??'ready',reasoning:'',rawStats:{},status:'completed',possibleTruncation:t===run.tests[1],metrics:metrics({input_tokens:100,total_output_tokens:20},1,null,null,1)};
  }};
  await runEngine(run,{...defaultSettings,provider:'openai'},new AbortController().signal,e=>{
   if(e.type==='sample')run.samples.push(e.sample);if(e.type==='wave')run.waves.push(e.wave);if(e.type==='finish')run.status=e.status;
  },adapter);
  assert.equal(run.status,'completed');assert.equal(seen.filter(s=>s.max===256).length,1);
  assert.ok(seen.filter(s=>!s.prompt.includes('Reply with the word ready')).every(s=>s.max===budget));
  const measured=run.samples.filter(s=>!s.warmup);assert.equal(measured.length,6);
  assert.equal(measured[1].objective.score,0);assert.match(measured[1].objective.checks[0].detail,/Output limit reached/);
  assert.equal(benchmarkRows(run)[0].passed,5);assert.equal(benchmarkRows(run)[0].efficiency.outputTokens,120);
  const exported=JSON.parse(exportText(run,'json'));assert.equal(exported.samples.filter((s:any)=>!s.warmup&&s.objective.score===100).length,5);
 }
});
test('strict truncation scoring agrees for both authored packs without changing other graders',()=>{
 for(const id of ['token-efficiency','infrastructure-reasoning']){const [t]=selectBenchmark({packId:id,count:1,seed:42});assert.equal(objectiveScore(t.answerKey,t,true).score,0);assert.equal(objectiveScore(t.answerKey,t,false).score,100);}
 const [t]=selectBenchmark({packId:'gsm8k',count:1,seed:42});assert.equal(objectiveScore(t.answerKey,t,true).score,100);
});
test('selecting a benchmark resets inherited duration-based load',()=>{
 const c=benchmarkConfig({...defaultConfig,loadProfile:'sustained',durationSec:300},{packId:'token-efficiency',count:6,seed:42},'Fixture');assert.equal(c.loadProfile,'waves');
});
test('planned counts follow arrival-rate and sustained scheduling rather than wave settings',()=>{
 const run=makeRun();run.status='completed';run.config.loadProfile='arrival-rate';run.config.durationSec=2;run.config.arrivalRatePerSecond=1.5;run.config.waves=10;run.config.concurrency=[2];
 run.samples=run.tests.flatMap(t=>Array.from({length:3},()=>({testId:t.id,modelKey:'fixture',concurrency:2,status:'completed',warmup:false,objective:{score:100},metrics:metrics({input_tokens:100,total_output_tokens:20},1,null,null,1),possibleTruncation:false} as Run['samples'][number])));
 assert.equal(benchmarkRows(run)[0].expected,18);assert.equal(benchmarkRows(run)[0].provisional,false);
 run.config.loadProfile='sustained';assert.equal(benchmarkRows(run)[0].expected,null);assert.equal(benchmarkRows(run)[0].provisional,false);
 run.status='running';assert.equal(benchmarkRows(run)[0].provisional,true);
});
test('context sweeps preserve selected benchmark questions in combined runs',()=>{
 const run=makeRun(),config={...run.config,mode:'combined' as const,contextSweep:[256,512]};
 const expanded=contextWorkloads([performanceTest('short'),...run.tests],config);
 assert.deepEqual(expanded.filter(t=>t.benchmark),run.tests);assert.equal(expanded.filter(t=>t.kind==='performance').length,2);
});
