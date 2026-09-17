import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {combineStats,downsample,statOf,statsFrom,windowStats} from '../src/gpu-stats';
import {idleSampler,type GpuSampler} from '../electron/gpu';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {metrics} from '../electron/metrics';
import {exportText,gpuReport,summaries} from '../electron/export';
import {starterTests,defaultConfig,defaultSettings} from '../src/defaults';
import type {GpuTick,Model,Run} from '../src/types';

const tick=(t:number,hotSpot:number,extra:Partial<GpuTick>={}):GpuTick=>({t,tempCore:hotSpot-4,tempHotSpot:hotSpot,tempMemory:hotSpot-2,power:100,load:99,clockCore:3000,fanRpm:1200,memoryUsed:13000,...extra});
const makeRun=():Run=>({id:'gpu-run',created:'2026-09-11',updated:'2026-09-11',status:'running',config:{...structuredClone(defaultConfig),modelKeys:['mock'],testIds:['reasoning'],mode:'quality',concurrency:[2],waves:1,maxTokens:64,contextLength:2048},tests:[starterTests.find(t=>t.id==='reasoning')!],modelInfo:{},environment:{},logs:[],samples:[],waves:[]});
function mockAdapter(){let instance='',capacity=0,ctx=0;const m:Model={key:'mock',display_name:'Mock',type:'llm',size_bytes:100,quantization:null,max_context_length:8192,loaded_instances:[]};
 const adapter:Adapter={cacheQuant:()=>()=>{},models:async()=>[{...m,loaded_instances:instance?[{id:instance,config:{context_length:ctx,parallel:capacity}}]:[]}],
  cli:async(_s,args)=>{instance=args[args.indexOf('--identifier')+1];capacity=Number(args[args.indexOf('--parallel')+1]);ctx=Number(args[args.indexOf('--context-length')+1]);return 'loaded';},
  api:async()=>{instance='';return {};},
  infer:async()=>{await new Promise(r=>setTimeout(r,5));return {output:'84',reasoning:'',rawStats:{},metrics:metrics({input_tokens:10,total_output_tokens:2,tokens_per_second:50},40,0,10,20),status:'completed' as const,possibleTruncation:false};}};
 return adapter;
}

test('statistics ignore readings a card does not expose',()=>{
 assert.deepEqual(statOf([50,null,undefined,NaN,70]),{min:50,avg:60,max:70});
 assert.equal(statOf([null,NaN]),null);
 assert.equal(statsFrom([],true),null);
});

test('a request window uses only its own readings',()=>{
 const ticks=[tick(1000,60),tick(2000,70),tick(3000,80)];
 const stats=windowStats(ticks,1500,3500,1000)!;
 assert.equal(stats.samples,2);
 assert.equal(stats.exact,true);
 assert.deepEqual(stats.tempHotSpot,{min:70,avg:75,max:80});
});

test('a request shorter than the sampling interval falls back to the nearest reading and says so',()=>{
 const ticks=[tick(1000,60),tick(2000,70),tick(3000,80)];
 const near=windowStats(ticks,3400,3600,1000)!;
 assert.equal(near.samples,1);
 assert.equal(near.exact,false);
 assert.equal(near.tempHotSpot!.max,80);
 assert.equal(windowStats(ticks,90000,90100,1000),null,'readings far outside the window are not reused');
});

test('combined windows weight averages by how many readings each held',()=>{
 const one=statsFrom([tick(1000,60)],true)!,two=statsFrom([tick(2000,80),tick(3000,90)],true)!;
 const combined=combineStats([one,two,null,undefined])!;
 assert.equal(combined.samples,3);
 assert.equal(combined.tempHotSpot!.min,60);
 assert.equal(combined.tempHotSpot!.max,90);
 assert.ok(Math.abs(combined.tempHotSpot!.avg-(60+80+90)/3)<1e-9);
 assert.equal(combineStats([null,undefined]),null);
});

test('an inexact window marks the combination inexact',()=>{
 const exact=statsFrom([tick(1000,60)],true)!,nearest=statsFrom([tick(2000,95)],false)!;
 assert.equal(combineStats([exact,nearest])!.exact,false);
});

test('stored chart data keeps temperature peaks while shrinking',()=>{
 const ticks=Array.from({length:20},(_,i)=>tick(1000*i,60+(i===7?35:0)));
 const reduced=downsample(ticks,5);
 assert.ok(reduced.length<=5);
 assert.equal(Math.max(...reduced.map(t=>t.tempHotSpot!)),95,'the spike survives downsampling');
 assert.deepEqual(downsample(ticks,50),ticks,'short series are stored as recorded');
});

test('an unavailable sampler never blocks a run and reports why',()=>{
 const sampler=idleSampler('No sensor library.');
 assert.equal(sampler.window(0,1),null);
 const summary=sampler.summary(0,1);
 assert.equal(summary.available,false);
 assert.equal(summary.note,'No sensor library.');
 assert.deepEqual(summary.series,[]);
});

test('the runner records thermals per request, per wave, and for the whole run',async()=>{
 const ticks=[tick(0,55),tick(1000,72)];
 const sampler:GpuSampler={window:(from,to)=>windowStats(ticks,from,to,1000)??statsFrom(ticks,false),
  summary:()=>({available:true,device:'Test GPU',devices:['Test GPU'],intervalMs:1000,note:'Test sampler.',stats:statsFrom(ticks,true),perDevice:{'Test GPU':statsFrom(ticks,true)},series:ticks,seriesNote:''}),stop(){}};
 const events:EngineEvent[]=[];
 await runEngine(makeRun(),defaultSettings,new AbortController().signal,e=>events.push(e),mockAdapter(),undefined,false,sampler);
 const samples=events.filter(e=>e.type==='sample');
 assert.ok(samples.length>0);
 assert.ok(samples.every(e=>e.type==='sample'&&e.sample.gpu&&e.sample.gpu.tempHotSpot!==null),'every request carries its own thermals');
 const wave=events.find(e=>e.type==='wave');
 assert.ok(wave&&wave.type==='wave'&&wave.wave.gpu,'waves carry thermals');
 const gpu=events.find(e=>e.type==='gpu');
 assert.ok(gpu&&gpu.type==='gpu'&&gpu.gpu.device==='Test GPU'&&gpu.gpu.stats!.tempHotSpot!.max===72);
 assert.ok(events.findIndex(e=>e.type==='gpu')>events.findIndex(e=>e.type==='finish'),'thermals are summarised after the run finishes');
});

test('a run without telemetry still completes and exports',async()=>{
 const events:EngineEvent[]=[];
 const run=makeRun();
 await runEngine(run,defaultSettings,new AbortController().signal,e=>events.push(e),mockAdapter());
 assert.equal((events.findLast(e=>e.type==='finish') as {status:string}).status,'completed');
 run.samples=events.filter(e=>e.type==='sample').map(e=>(e as {sample:Run['samples'][number]}).sample);
 run.waves=events.filter(e=>e.type==='wave').map(e=>(e as {wave:Run['waves'][number]}).wave);
 const row=summaries(run)[0];
 assert.equal(row.gpuHotSpotMax,null);
 assert.equal(row.gpuReadings,0);
 assert.match(exportText(run,'md'),/GPU thermals/);
 assert.match(gpuReport(undefined),/not recorded/);
});

test('exported rows carry thermal columns for the CSV',async()=>{
 const run=makeRun();
 const stats=statsFrom([tick(0,70),tick(1000,80)],true);
 run.samples=[{id:'s1',runId:run.id,modelKey:'mock',modelName:'Mock',testId:'reasoning',testName:'Reasoning',concurrency:1,waveId:'w',wave:0,slot:0,warmup:false,prompt:'p',output:'84',reasoning:'',status:'completed',metrics:metrics({input_tokens:10,total_output_tokens:2,tokens_per_second:50},40,0,10,20),objective:{score:100,checks:[]},grades:[],rawStats:{},created:'2026-09-11',possibleTruncation:false,gpu:stats}];
 const row=summaries(run)[0];
 assert.equal(row.gpuHotSpotMax,80);
 assert.equal(row.gpuHotSpotAvg,75);
 assert.equal(row.gpuReadings,2);
 const csv=exportText(run,'csv');
 assert.match(csv,/"gpuHotSpotMax"/);
 assert.match(csv,/"80"/);
});

test('the sensor files the sampler needs are present and packaged',()=>{
 const root=path.join(import.meta.dirname,'..');
 for(const file of ['gpu-sampler.ps1','LibreHardwareMonitorLib.dll'])assert.ok(existsSync(path.join(root,'vendor',file)),file+' is missing from vendor/');
 const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 assert.ok(pkg.build.extraResources.some((r:{from:string})=>r.from==='vendor'),'vendor/ must ship outside the asar archive');
});
