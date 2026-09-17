import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {exportText,summaries} from '../electron/export';
import {historyRows} from '../electron/history';
import {assertMtpPlan} from '../electron/mtp';
import {metrics} from '../electron/metrics';
import {validateConfig} from '../electron/validation';
import {benchmarkRows} from '../src/benchmarks';
import {defaultConfig,defaultSettings,starterTests} from '../src/defaults';
import {measuredDepths,mtpDepthLabel,mtpDepthText,normalizeSweep,onSteps,preflightStep,sweepRows,sweepSteps,sweepVerdicts} from '../src/mtp-sweep';
import type {Model,Run,RunConfig,Sample} from '../src/types';

const textTest=starterTests.find(t=>t.id==='reasoning')!;
const makeRun=(config:Partial<RunConfig>):Run=>({id:'sweep-run',created:'2026-09-14T00:00:00.000Z',updated:'2026-09-14T00:00:00.000Z',status:'running',
 config:{...structuredClone(defaultConfig),modelKeys:['mock'],testIds:['reasoning'],mode:'quality',concurrency:[1],waves:2,maxTokens:128,contextLength:2048,judgeModel:'',mtp:'on',...config},
 tests:[textTest],modelInfo:{},environment:{},logs:[],samples:[],waves:[]});

// Mirrors the real adapter closely enough to exercise what a sweep depends on: the depth is
// carried on the load command line, and the loaded instance reports back what it applied, which
// is the only thing the engine will accept as confirmation.
function mockAdapter(opts:{supported?:boolean|null;rates?:Record<number,number[]>;misreportAt?:number;failMtp?:boolean}={}){
 const loads:{args:string[];depth:number}[]=[];const counters=new Map<number,number>();
 let instance='',instanceConfig:Record<string,unknown>={},depth=0,parallel=1,context=2048;
 const model={key:'mock',display_name:'Mock',format:'gguf',type:'llm',size_bytes:100,quantization:null,max_context_length:8192,loaded_instances:[],
  nativeMtp:{supported:opts.supported===undefined?true:opts.supported,reason:'test fixture'}} as unknown as Model;
 const adapter:Adapter={
  models:async()=>[{...model,loaded_instances:instance?[{id:instance,config:{context_length:context,parallel,...instanceConfig}}]:[]}],
  cli:async(_s,args)=>{
   // Stands in for a runtime that can load the model but not its prediction heads.
   if(opts.failMtp&&args.includes('--speculative-draft-mtp'))throw Error('Failed to load model. Cause: failed to load draft model: invalid vector subscript');
   instance=args[args.indexOf('--identifier')+1];
   parallel=Number(args[args.indexOf('--parallel')+1]);context=Number(args[args.indexOf('--context-length')+1]);
   const on=args.includes('--speculative-draft-mtp');
   const asked=args.includes('--speculative-draft-max-tokens')?Number(args[args.indexOf('--speculative-draft-max-tokens')+1]):null;
   depth=on?(asked??0):0;loads.push({args:[...args],depth});
   instanceConfig=on?{speculative_draft_mtp:true,speculative_draft_max_tokens:opts.misreportAt===depth?depth+1:asked}:{speculative_draft_mtp:false};
   return 'loaded';
  },
  api:async()=>{instance='';instanceConfig={};return {};},
  // Stands in for llama.cpp's own per-request acceptance line: a fixed rate per depth, so a
  // row can be checked for carrying the right one rather than for any particular number.
  watchLog:()=>({root:'',sizes:new Map()}),
  draftAcceptance:async()=>depth>0?{tasks:1,accepted:depth*10,generated:100,acceptance:depth/10,meanLen:depth}:null,
  infer:async(_s,_id,prompt)=>{
   const warm=prompt==='Reply with the word ready.';
   const series=opts.rates?.[depth]??[40];
   const index=counters.get(depth)??0;if(!warm)counters.set(depth,index+1);
   return {output:'84',reasoning:'',rawStats:{},metrics:metrics({input_tokens:10,total_output_tokens:20,tokens_per_second:warm?10:series[index%series.length]},1000,0,10,20),
    status:'completed' as const,possibleTruncation:false};
  }
 };
 return {adapter,loads,model};
}
const runIt=async(run:Run,mock:ReturnType<typeof mockAdapter>,retries?:Sample[])=>{
 const events:EngineEvent[]=[];
 await runEngine(run,defaultSettings,new AbortController().signal,e=>{
  events.push(e);
  if(e.type==='model')run.modelInfo[e.key]=e.info;
  if(e.type==='sample')run.samples.push(e.sample);
  if(e.type==='wave')run.waves.push(e.wave);
 },mock.adapter,retries);
 const finish=events.findLast(e=>e.type==='finish') as Extract<EngineEvent,{type:'finish'}>;
 return {events,finish,logs:events.filter(e=>e.type==='log').map(e=>(e as Extract<EngineEvent,{type:'log'}>).message),
  total:(events.filter(e=>e.type==='progress').at(-1) as Extract<EngineEvent,{type:'progress'}>|undefined)?.progress.total??0};
};

test('a sweep is an ordered, de-duplicated list of depths, and no sweep is still one step',()=>{
 assert.deepEqual(normalizeSweep([4,2,2,0]),[0,2,4]);
 assert.deepEqual(normalizeSweep([1.5,-1,9,'2',null,NaN]),[]);
 assert.deepEqual(normalizeSweep(undefined),[]);
 // Without a sweep the single step keeps a null depth, so runs saved before sweeping existed
 // are never relabelled as though they had been measured at some particular depth.
 assert.deepEqual(sweepSteps({}),[{depth:null,mode:undefined,tokens:2,label:'Legacy/default'}]);
 assert.deepEqual(sweepSteps({mtp:'on',mtpDraftTokens:3}),[{depth:null,mode:'on',tokens:3,label:'Legacy/default'}]);
 // A sweep needs MTP on: the switch is what asserts every selected model can do it at all.
 assert.equal(sweepSteps({mtp:'off',mtpSweep:[0,2]}).length,1);
 assert.deepEqual(sweepSteps({mtp:'on',mtpSweep:[2,0]}),[
  {depth:0,mode:'off',tokens:2,label:'MTP off'},{depth:2,mode:'on',tokens:2,label:'2 tokens'}]);
 assert.equal(mtpDepthLabel(1),'1 token');
 assert.equal(mtpDepthLabel(0),'MTP off');
 assert.equal(mtpDepthLabel(null),'Legacy/default');
 assert.deepEqual([0,1,2,null].map(d=>mtpDepthText(d)),['MTP off','MTP 1 token','MTP 2 tokens','MTP legacy/default']);
});

test('sweep depths are validated and normalized before a run is accepted',()=>{
 const base={...defaultConfig,modelKeys:['m'],mtp:'on' as const};
 const config={...base,mtpSweep:[4,0,0,2]};validateConfig(config);
 assert.deepEqual(config.mtpSweep,[0,2,4]);
 assert.throws(()=>validateConfig({...base,mtp:'off',mtpSweep:[0,2]}),/Turn native MTP on/);
 assert.throws(()=>validateConfig({...base,mtpSweep:[9]}),/MTP sweep depth/);
 assert.throws(()=>validateConfig({...base,mtpSweep:[1.5]}),/MTP sweep depth/);
 assert.throws(()=>validateConfig({...base,mtpSweep:[]}),/at least one MTP depth/);
 assert.throws(()=>validateConfig({...base,mtpSweep:'0,2' as unknown as number[]}),/list of whole numbers/);
});

test('each depth is loaded separately, with the flags that depth means, and tags its own responses',async()=>{
 const run=makeRun({mtpSweep:[0,1,3]});const mock=mockAdapter();
 const result=await runIt(run,mock);
 assert.equal(result.finish.status,'completed');
 assert.equal(mock.loads.length,3,'one load per depth');
 assert.ok(mock.loads[0].args.includes('--no-speculative-draft-mtp'),'depth 0 loads with MTP off');
 assert.ok(!mock.loads[0].args.includes('--speculative-draft-mtp'));
 for(const [i,depth] of [1,3].entries()){
  const args=mock.loads[i+1].args;
  assert.ok(args.includes('--speculative-draft-mtp'));
  assert.equal(args[args.indexOf('--speculative-draft-max-tokens')+1],String(depth));
 }
 const measured=run.samples.filter(s=>!s.warmup);
 assert.deepEqual(measuredDepths(run),[0,1,3]);
 assert.equal(measured.length,6,'every depth runs the whole workload');
 for(const depth of [0,1,3])assert.equal(measured.filter(s=>s.mtpTokens===depth).length,2);
 // The count the progress bar is measured against has to include the extra passes, or a sweep
 // would report itself as finished three times over.
 assert.equal(result.total,6);
 assert.deepEqual([...new Set(run.waves.map(w=>w.mtpTokens))].sort(),[0,1,3]);
 assert.ok(result.logs.some(m=>m.includes('sweep step 1 of 3')));
});

test('a sweep is refused for a model whose native MTP support is not confirmed',async()=>{
 const config={...defaultConfig,modelKeys:['mock'],mtp:'on' as const,mtpSweep:[0,2]};
 // Refused before anything is loaded, so an unsupported model cannot cost an hour of loading
 // only to fail on a later depth.
 assert.throws(()=>assertMtpPlan(mockAdapter({supported:false}).model,config),/not confirmed/);
 assert.throws(()=>assertMtpPlan(mockAdapter({supported:null}).model,config),/not confirmed/);
 // Depth 0 alone asks nothing of the model that is not already true of any GGUF.
 assert.doesNotThrow(()=>assertMtpPlan(mockAdapter({supported:false}).model,{...config,mtpSweep:[0]}));
 const run=makeRun({mtpSweep:[0,2]});const mock=mockAdapter({supported:false});
 const result=await runIt(run,mock);
 assert.equal(result.finish.status,'failed');
 assert.equal(run.samples.filter(s=>!s.warmup&&s.mtpTokens===2).length,0,'no depth 2 measurements exist');
 assert.equal(run.samples.filter(s=>!s.warmup&&s.mtpTokens===0).length,2,'the baseline still measured');
});

test('a depth LM Studio did not apply produces no measurements at that depth',async()=>{
 const run=makeRun({mtpSweep:[0,2,4]});const mock=mockAdapter({misreportAt:2});
 const result=await runIt(run,mock);
 assert.equal(result.finish.status,'failed');
 assert.deepEqual(measuredDepths(run),[0,4],'the misreported depth saved nothing');
 assert.ok(result.logs.some(m=>m.includes('MTP 2 tokens')&&m.includes('draft-token count')));
});

test('depths are never pooled together by summaries, history, or benchmark scoring',async()=>{
 const run=makeRun({mtpSweep:[0,2]});
 await runIt(run,mockAdapter({rates:{0:[30],2:[60]}}));
 const rows=summaries(run);
 assert.equal(rows.length,2,'one row per depth, not one row averaging both');
 assert.deepEqual(rows.map(r=>r.mtpDepth).sort(),[0,2]);
 assert.deepEqual(rows.map(r=>[r.mtp,r.mtpDraftTokens]).sort(),[['off',null],['on',2]]);
 assert.deepEqual(rows.map(r=>r.generationTps).sort((a,b)=>a!-b!),[30,60]);
 // The history overview matches its pooled rows back to the responses behind them by the same
 // key, so a depth that did not match would silently report zero completed requests.
 const history=historyRows([run],{});
 assert.equal(history.length,2);
 for(const row of history)assert.equal(row.completed,2);
 const packed={...run,tests:run.tests.map(t=>({...t,benchmark:{packId:'p',itemId:'i',datasetHash:'h',protocol:'x'}}))} as Run;
 const cards=benchmarkRows(packed);
 assert.equal(cards.length,2);
 assert.deepEqual(cards.map(c=>c.mtp),['MTP off','MTP 2 tokens']);
 for(const card of cards)assert.equal(card.expected,2,'each depth expects its own pass, not both');
});

test('the fastest depth is named, and a gap inside the measurement spread is not called a win',async()=>{
 const clear=makeRun({mtpSweep:[0,2]});
 await runIt(clear,mockAdapter({rates:{0:[30,30],2:[60,60]}}));
 const [won]=sweepVerdicts(clear);
 assert.equal(won.best?.depth,2);
 assert.equal(won.baseline?.depth,0);
 assert.equal(Math.round(won.gainPercent!),100);
 assert.equal(won.withinNoise,false);
 assert.match(won.summary,/2 tokens was fastest/);

 const noisy=makeRun({mtpSweep:[0,2]});
 await runIt(noisy,mockAdapter({rates:{0:[30,50],2:[32,52]}}));
 const [unclear]=sweepVerdicts(noisy);
 assert.equal(unclear.best?.depth,2);
 assert.equal(unclear.withinNoise,true,'a 2 tok/s gap over a 20 tok/s spread is not a result');
 assert.match(unclear.summary,/spread of the measurements/);

 const flat=makeRun({mtpSweep:[0,2]});
 await runIt(flat,mockAdapter({rates:{0:[40,40],2:[30,30]}}));
 const [clearBaseline]=sweepVerdicts(flat);
 assert.equal(clearBaseline.withinNoise,false);
 assert.match(clearBaseline.summary,/Nothing beat MTP off: it was the fastest/);

 // The baseline coming out marginally ahead is not a verdict on MTP, and must not read as one.
 const deadHeat=makeRun({mtpSweep:[0,2]});
 await runIt(deadHeat,mockAdapter({rates:{0:[40,60],2:[38,58]}}));
 const [tied]=sweepVerdicts(deadHeat);
 assert.equal(tied.best?.depth,0);
 assert.equal(tied.withinNoise,true);
 assert.match(tied.summary,/does not separate them/);

 const rows=sweepRows(clear);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(r=>[r.label,r.requests,r.completed,r.failures]),[['MTP off',2,2,0],['2 tokens',2,2,0]]);
 assert.equal(rows[0].generationSd,0);
});

test('a retry reloads only the depths that actually have something to retry',async()=>{
 const run=makeRun({mtpSweep:[0,2,4]});
 const failed=(depth:number):Sample=>({mtpTokens:depth,id:`s${depth}`,runId:run.id,modelKey:'mock',modelName:'Mock',testId:textTest.id,testName:textTest.name,
  concurrency:1,waveId:`w${depth}`,wave:0,slot:0,warmup:false,prompt:'Six identical machines…',output:'',reasoning:'',status:'timeout',
  metrics:metrics({},0,null,null,null),objective:{score:null,checks:[]},grades:[],rawStats:{},created:run.created,possibleTruncation:false});
 const mock=mockAdapter();
 const result=await runIt(run,mock,[failed(0),failed(4)]);
 assert.equal(result.finish.status,'completed');
 assert.deepEqual(mock.loads.map(l=>l.depth),[0,4],'depth 2 had nothing failed and was never loaded');
 assert.deepEqual(measuredDepths(run),[0,4]);
 assert.equal(result.total,2,'a retry counts the requests being retried, not a whole sweep');
});

test('exports describe the sweep, and a run without one gains nothing to explain',async()=>{
 const swept=makeRun({mtpSweep:[0,2]});
 await runIt(swept,mockAdapter({rates:{0:[30,30],2:[60,60]}}));
 const report=exportText(swept,'md');
 assert.match(report,/## Native MTP sweep/);
 assert.match(report,/swept depths: MTP off, 2 tokens/);
 assert.match(report,/\/ MTP 2 tokens/,'each measurement says which depth produced it');
 assert.match(report,/2 tokens was fastest/);
 const csv=exportText(swept,'csv');
 assert.match(csv.split('\r\n')[0],/"mtpDepth"/);

 const plain=makeRun({mtp:'off',mtpSweep:undefined});
 await runIt(plain,mockAdapter());
 assert.equal(plain.samples.every(s=>s.mtpTokens===undefined),true,'no depth is invented for an ordinary run');
 assert.doesNotMatch(exportText(plain,'md'),/Native MTP sweep/);
 assert.equal(summaries(plain).length,1);
 assert.equal(summaries(plain)[0].mtpDepth,null);
});

test('a sweep under load keeps every concurrency level apart instead of pooling them',async()=>{
 const run=makeRun({mtpSweep:[0,1,2],concurrency:[1,2],waves:1,mode:'performance',testIds:[]});
 const mock=mockAdapter();
 await runIt(run,mock);
 const rows=sweepRows(run);
 // Three depths at two concurrency levels is six rows for one model, not three.
 assert.equal(rows.length,6);
 assert.deepEqual([...new Set(rows.map(r=>r.concurrency))].sort(),[1,2]);
 for(const level of [1,2])assert.deepEqual(rows.filter(r=>r.concurrency===level).map(r=>r.depth),[0,1,2]);
 // Each row counts only its own level's requests: one wave of one, and one wave of two.
 assert.deepEqual(rows.filter(r=>r.concurrency===1).map(r=>r.requests),[1,1,1]);
 assert.deepEqual(rows.filter(r=>r.concurrency===2).map(r=>r.requests),[2,2,2]);
 // A verdict compares depths measured under the same load, never across two loads.
 const verdicts=sweepVerdicts(run);
 assert.equal(verdicts.length,2);
 assert.deepEqual(verdicts.map(v=>v.concurrency).sort(),[1,2]);
 for(const v of verdicts)assert.deepEqual(v.rows.map(r=>r.concurrency),[v.concurrency,v.concurrency,v.concurrency]);
});
test('accepted-draft figures ride with the depth that produced them, and MTP off reports none',async()=>{
 const run=makeRun({mtpSweep:[0,2,4],concurrency:[1],waves:2});
 await runIt(run,mockAdapter());
 const byDepth=Object.fromEntries(sweepRows(run).map(r=>[r.depth,r.draft]));
 assert.equal(byDepth[0],null,'nothing is drafted with MTP off, which is not a rate of zero');
 assert.equal(byDepth[2]!.acceptance,0.2);
 assert.equal(byDepth[4]!.acceptance,0.4);
 // Two waves at that depth, pooled: totals add up rather than the rates being averaged.
 assert.equal(byDepth[4]!.accepted,80);
 assert.equal(byDepth[4]!.generated,200);
 assert.equal(byDepth[4]!.tasks,2);
 assert.match(exportText(run,'md'),/drafted tokens accepted 40\.0% \(80 of 200 drafted/);
 assert.match(exportText(run,'md'),/drafted tokens accepted not applicable/);
 assert.ok(exportText(run,'csv').includes('draftAcceptance'),'the comparison table keeps a column for it');
});

test('a sweep step is named once, so the baseline is never announced as “MTP MTP off”',async()=>{
 const run=makeRun({mtpSweep:[0,2],concurrency:[1],waves:1});
 const {events}=await runIt(run,mockAdapter());
 const said=events.filter(e=>e.type==='progress').map(e=>(e as Extract<EngineEvent,{type:'progress'}>).progress.message);
 assert.ok(said.some(m=>m.includes('MTP off')),'the baseline step is named in progress');
 assert.ok(said.some(m=>m.includes('MTP 2 tokens')),'and so is every other depth');
 assert.equal(said.filter(m=>m.includes('MTP MTP')).length,0);
});

test('a preflight answers the MTP question with one load, before anything is measured',()=>{
 assert.equal(preflightStep(sweepSteps({mtp:'on',mtpSweep:[0,1,2,3]}))?.depth,1,'the shallowest on-depth stands for the rest');
 assert.equal(preflightStep(sweepSteps({mtp:'on',mtpSweep:[0]})),null,'a sweep with nothing to draft has nothing to check');
 assert.equal(preflightStep(sweepSteps({mtp:'off'})),null);
 assert.deepEqual(onSteps(sweepSteps({mtp:'on',mtpSweep:[0,2,4]})).map(s=>s.depth),[2,4]);
});
test('a model that cannot load its MTP head loses only its MTP depths, and is named',async()=>{
 const run=makeRun({mtpSweep:[0,1,2],mtpPreflight:true}),mock=mockAdapter({failMtp:true});
 const {finish,logs,events}=await runIt(run,mock);
 const measured=events.filter(e=>e.type==='sample'&&!(e as Extract<EngineEvent,{type:'sample'}>).sample.warmup)
  .map(e=>(e as Extract<EngineEvent,{type:'sample'}>).sample.mtpTokens);
 assert.deepEqual([...new Set(measured)],[0],'the MTP-off baseline is still measured');
 assert.ok(measured.length>0,'skipping a depth must not skip the whole run');
 // One model that cannot draft at all is one failure, not one for each depth it would have run.
 assert.match(finish.error!,/^1 request\/model failure/);
 assert.match(finish.error!,/mock · MTP 1 token, 2 tokens \(the MTP head would not load\)/);
 assert.ok(logs.some(l=>/MTP preflight: mock cannot load its MTP head/.test(l)),'the reason is logged where it happened');
 assert.equal(mock.loads.length,1,'only the baseline was ever loaded');
 assert.equal(mock.loads.filter(l=>l.depth>0).length,0,'no drafting load succeeded');
 // The point of the option, stated as a comparison: without it the same run discovers the same
 // impossibility once per depth, and only after it has measured the baseline each time.
 const late=await runIt(makeRun({mtpSweep:[0,1,2]}),mockAdapter({failMtp:true}));
 assert.match(late.finish.error!,/^2 request\/model failure/,'unchecked, each depth fails separately');
 assert.ok(!Object.keys(run.modelInfo).some(k=>/MTP 1 token|MTP 2 tokens/.test(k)),'a preflight leaves no record of a model behind');
});
test('a preflight that passes costs one load and changes nothing that is measured',async()=>{
 const checked=mockAdapter(),plain=mockAdapter();
 const a=await runIt(makeRun({mtpSweep:[0,1],mtpPreflight:true}),checked);
 const b=await runIt(makeRun({mtpSweep:[0,1]}),plain);
 assert.equal(a.finish.status,'completed');assert.equal(b.finish.status,'completed');
 const samples=(r:typeof a)=>r.events.filter(e=>e.type==='sample').length;
 assert.equal(samples(a),samples(b),'the same measurements either way');
 assert.equal(checked.loads.length,plain.loads.length+1,'the check is exactly one extra load');
});
test('the check is off unless asked for, and a retry never pays for it',async()=>{
 const off=mockAdapter();await runIt(makeRun({mtpSweep:[0,1]}),off);
 assert.equal(off.loads.length,2,'two depths, two loads, no probe');
 const retried=mockAdapter({failMtp:true});
 const run=makeRun({mtpSweep:[0,1],mtpPreflight:true});
 const sample={id:'s',runId:run.id,modelKey:'mock',testId:'reasoning',waveId:'w',wave:0,mtpTokens:0} as unknown as Sample;
 const {finish}=await runIt(run,retried,[sample]);
 assert.ok(!/would not load/.test(finish.error??''),'a retry re-runs saved requests rather than re-checking the model');
});
