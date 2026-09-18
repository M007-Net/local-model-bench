import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {WORKLOAD_VERSION,agenticStages,axisMax,comparableWorkload,cpuReading,defaultAgenticConfig,hostStages,modelCallLabel,peakPoint,pointStats,sweepColumns,sweepStats,sweepVerdict,validateAgenticConfig,validateAgenticRun,type AgenticConfig,type AgenticPoint,type AgenticRun,type AgenticTurn} from '../src/agentic';
import {scalingSvg,stageBreakdown,stageLegendHtml,timelineSvg} from '../src/agentic-charts';
import {runAgenticSweep,turnPrompt,hostPool,type AgenticAdapter,type AgenticEvent,type HostRunner} from '../electron/agentic-engine';
import {runStage} from '../electron/agentic-host';
import {agenticRows,agenticText,agenticReport} from '../electron/agentic-export';
import {Store} from '../electron/store';
import {defaultSettings} from '../src/defaults';
import type {Model} from '../src/types';

const turn=(index:number,lane:number,start:number,llm:number,host:number):AgenticTurn=>{
 const segments=[{stage:'llm' as const,start,end:start+llm},...hostStages.map((stage,i)=>({stage,start:start+llm+i*(host/hostStages.length),end:start+llm+(i+1)*(host/hostStages.length)}))];
 return {index,lane,start,end:start+llm+host,segments:llm>0?segments:segments.slice(1),status:'completed',llmMs:llm>0?llm:null,outputTokens:12,generationTps:40};
};
const point=(workers:number,wallMs:number,turns:AgenticTurn[],wallSamples=[wallMs]):AgenticPoint=>({workers,lanes:new Set(turns.map(t=>t.lane)).size,wallMs,wallSamples,completed:turns.filter(t=>t.status==='completed').length,failed:turns.filter(t=>t.status!=='completed').length,turns});

test('sweep metrics come from the measured points, and speedup needs a one-worker baseline',()=>{
 const one=point(1,4000,[turn(0,0,0,1000,1000),turn(1,0,2000,1000,1000)]);
 const two=point(2,2000,[turn(0,0,0,1000,1000),turn(1,1,0,1000,1000)]);
 const [a,b]=sweepStats([two,one]);
 assert.equal(a.workers,1);
 assert.equal(a.speedup,1);
 assert.equal(a.efficiency,1);
 assert.equal(b.speedup,2);
 assert.equal(b.efficiency,1);
 assert.equal(Math.round(b.turnsPerMin!),60);
 assert.equal(a.meanTurnMs,2000);
 // Half of every turn was the model call, so half the turn time was off the GPU.
 assert.equal(Math.round(a.offGpuShare!),50);
 // Without a one-worker point there is no honest baseline, so speedup stays unavailable.
 const alone=sweepStats([two]);
 assert.equal(alone[0].speedup,null);
 assert.equal(alone[0].efficiency,null);
});
test('a host-only sweep reports every millisecond as off-GPU time',()=>{
 const only=point(1,2000,[turn(0,0,0,0,1000),turn(1,0,1000,0,1000)]);
 const s=pointStats(only,2000);
 assert.equal(s.offGpuShare,100);
 assert.equal(s.stageMs.llm,0);
 assert.equal(s.meanLlmMs,null);
});
test('empty and failed points do not invent numbers',()=>{
 const none=pointStats(point(4,0,[]),null);
 assert.equal(none.turnsPerMin,null);
 assert.equal(none.meanTurnMs,null);
 assert.equal(none.offGpuShare,null);
 const failedTurn:AgenticTurn={...turn(0,0,0,0,500),status:'failed',error:'compile: boom'};
 const bad=pointStats(point(1,500,[failedTurn]),500);
 assert.equal(bad.completed,0);
 assert.equal(bad.meanTurnMs,null);
});
test('peak is the highest measured throughput and the verdict says when it was still climbing',()=>{
 const stats=sweepStats([point(1,8000,[turn(0,0,0,0,8000)]),point(2,4000,[turn(0,0,0,0,4000),turn(1,1,0,0,4000)]),point(4,4100,[turn(0,0,0,0,4100)])]);
 assert.equal(peakPoint(stats)!.workers,2);
 assert.match(sweepVerdict(stats,'off'),/Peak at 2 workers/);
 assert.match(sweepVerdict(stats,'off'),/No model call/);
 assert.match(sweepVerdict(stats,'off'),/Peak measured throughput was/);
 const climbing=sweepStats([point(1,8000,[turn(0,0,0,0,8000)]),point(2,3000,[turn(0,0,0,0,3000),turn(1,1,0,0,3000)])]);
 assert.match(sweepVerdict(climbing,'on'),/still climbing at 2 workers/);
 assert.equal(sweepVerdict([],'off'),'No completed turns yet, so this sweep has no scaling reading.');
});
test('locking the axis uses the slowest worker count in the sweep',()=>{
 const points=[point(1,9000,[turn(0,0,0,0,9000)]),point(4,2000,[turn(0,0,0,0,2000)])];
 assert.equal(axisMax(points,4,false),2000);
 assert.equal(axisMax(points,4,true),9000);
 assert.equal(axisMax([],1,true),1);
});
test('configuration rejects impossible sweeps and normalises worker counts',()=>{
 const base=():AgenticConfig=>structuredClone({...defaultAgenticConfig,modelCall:'off' as const});
 assert.deepEqual(validateAgenticConfig({...base(),workers:[8,1,8,2]}).workers,[1,2,8]);
 assert.throws(()=>validateAgenticConfig({...base(),workers:[]}),/at least one worker count/);
 assert.throws(()=>validateAgenticConfig({...base(),workers:[0]}),/Worker count must be an integer from 1 to 256/);
 assert.throws(()=>validateAgenticConfig({...base(),turns:0}),/Agent turns/);
 assert.throws(()=>validateAgenticConfig({...base(),hostWorkScale:99}),/Host work scale/);
 assert.throws(()=>validateAgenticConfig({...base(),repeats:0}),/Repeats per worker count/);
 assert.throws(()=>validateAgenticConfig({...base(),modelCall:'on',modelKey:''}),/Choose a model/);
 assert.throws(()=>validateAgenticConfig({...base(),modelCall:'on',modelKey:'m',maxTokens:4096,contextLength:4096}),/smaller than context length/);
 assert.throws(()=>validateAgenticConfig({...base(),prompt:'  '}),/agent turn prompt/);
});
test('host stages do real, deterministic, model-independent work',()=>{
 for(const stage of hostStages){
  const a=runStage(stage,7,1),b=runStage(stage,7,1);
  assert.equal(a,b,`${stage} must be deterministic`);
  assert.notEqual(runStage(stage,8,1),a,`${stage} must differ per turn`);
 }
 assert.throws(()=>runStage('llm',1,1),/not a host stage/);
});
test('turn prompts carry a per-turn identifier so repeated turns are not one cached prefix',()=>{
 assert.notEqual(turnPrompt('do the thing',1),turnPrompt('do the thing',2));
 assert.equal(turnPrompt('do the thing',1),turnPrompt('do the thing',1));
 assert.match(turnPrompt('do the thing',1),/do the thing$/);
});

const finish=(events:AgenticEvent[])=>events.find(e=>e.type==='finish') as {type:'finish';status:string;error?:string};
const fakeHost=():HostRunner&{calls:string[]}=>{const calls:string[]=[];return {calls,run:async(turnIndex,_scale,stages)=>{calls.push(String(turnIndex));return stages.map(()=>1);},stop(){},note:'test pool',threads:2};};
const makeRun=(config:Partial<AgenticConfig>):AgenticRun=>({id:'sweep-1',created:'2026-09-18',updated:'2026-09-18',status:'running',config:{...defaultAgenticConfig,modelCall:'off',turns:4,workers:[1,2],repeats:1,hostWorkScale:1,...config},environment:{},logs:[],points:[]});

test('a host-only sweep runs every turn at every worker count without touching LM Studio',async()=>{
 const host=fakeHost();const events:AgenticEvent[]=[];
 const adapter={models:async()=>{throw Error('LM Studio must not be contacted');},cli:async()=>{throw Error('no cli');},infer:async()=>{throw Error('no infer');},api:async()=>{throw Error('no api');}} as unknown as AgenticAdapter;
 await runAgenticSweep(makeRun({}),defaultSettings,new AbortController().signal,e=>events.push(e),{adapter,host,settleMs:0});
 const points=events.filter(e=>e.type==='point').map(e=>(e as {point:AgenticPoint}).point);
 assert.equal(points.length,2);
 assert.deepEqual(points.map(p=>p.workers),[1,2]);
 for(const p of points){assert.equal(p.completed,4);assert.equal(p.failed,0);assert.equal(p.turns.length,4);}
 assert.equal(points[1].lanes,2);
 // One dispatch per turn: a discarded warm-up pass, then four turns at each of two worker counts,
 // and no model segment anywhere.
 assert.equal(host.calls.length,4+4*2);
 assert.ok(points.every(p=>p.turns.every(t=>t.segments.length===hostStages.length)));
 assert.ok(points.every(p=>p.turns.every(t=>t.segments.every(s=>s.stage!=='llm'))));
 assert.equal(finish(events).status,'completed');
});
test('a failing host stage fails only its own turn and is still drawn on the timeline',async()=>{
 // The worker reports the stages it got through before the failure, so the turn is still drawn.
 const host:HostRunner={run:async(turnIndex,_scale,stages)=>{
  if(turnIndex!==1)return stages.map(()=>1);
  throw Object.assign(Error('compile: compiler exploded'),{durations:[1,1]});
 },stop(){},note:'',threads:1};
 const events:AgenticEvent[]=[];
 await runAgenticSweep(makeRun({workers:[1]}),defaultSettings,new AbortController().signal,e=>events.push(e),{host,settleMs:0});
 const point=(events.find(e=>e.type==='point') as {point:AgenticPoint}).point;
 assert.equal(point.completed,3);
 assert.equal(point.failed,1);
 const failed=point.turns.find(t=>t.status==='failed')!;
 assert.match(failed.error!,/compile: compiler exploded/);
 assert.ok(failed.segments.some(s=>s.stage==='compile'));
 assert.ok(!failed.segments.some(s=>s.stage==='package'));
 assert.equal(failed.segments.length,2,'only the stages that ran are drawn');
 assert.match(finish(events).error!,/1 agent turn\(s\) failed/);
});
test('cancelling stops scheduling further worker counts',async()=>{
 const controller=new AbortController();
 const host:HostRunner={run:async(_t,_s,stages)=>{controller.abort();return stages.map(()=>1);},stop(){},note:'',threads:1};
 const events:AgenticEvent[]=[];
 await runAgenticSweep(makeRun({turns:8,workers:[1,2,4]}),defaultSettings,controller.signal,e=>events.push(e),{host,settleMs:0});
 assert.equal(finish(events).status,'cancelled');
 assert.ok(events.filter(e=>e.type==='point').length<3);
});
test('a model-call sweep records the call as its own segment and keeps a failed call out of the host stages',async()=>{
 const model={key:'m',display_name:'Mock',size_bytes:1,quantization:null,max_context_length:0,type:'llm',loaded_instances:[] as any[]} as unknown as Model;
 let identifier='',calls=0;
 const adapter={
  models:async()=>identifier?[{...model,loaded_instances:[{id:identifier,config:{context_length:4096*2,parallel:2}}]} as unknown as Model]:[model],
  cli:async(_s:unknown,args:string[])=>{identifier=args[args.indexOf('--identifier')+1];return '';},
  infer:async()=>{calls++;return calls===3?{output:'',reasoning:'',rawStats:{},metrics:{outputTokens:null,generationTps:null} as any,status:'failed' as const,error:'context exhausted',possibleTruncation:false}:{output:'ok',reasoning:'',rawStats:{},metrics:{outputTokens:9,generationTps:33} as any,status:'completed' as const,possibleTruncation:false};},
  api:async()=>({})
 } as unknown as AgenticAdapter;
 const events:AgenticEvent[]=[];
 await runAgenticSweep(makeRun({modelCall:'on',modelKey:'m',modelName:'Mock',turns:2,workers:[2],contextLength:4096,maxTokens:64}),defaultSettings,new AbortController().signal,e=>events.push(e),{adapter,host:fakeHost(),settleMs:0});
 const point=(events.find(e=>e.type==='point') as {point:AgenticPoint}).point;
 assert.equal(point.turns.length,2);
 assert.ok(point.turns.every(t=>t.segments[0].stage==='llm'));
 const failed=point.turns.find(t=>t.status==='failed')!;
 assert.equal(failed.segments.length,1,'a failed model call must not be followed by host stages');
 assert.equal(failed.error,'context exhausted');
 const ok=point.turns.find(t=>t.status==='completed')!;
 assert.equal(ok.outputTokens,9);
 assert.equal(ok.segments.length,1+hostStages.length);
});
test('a model that cannot hold the requested slots stops the sweep before any measurement',async()=>{
 const model={key:'m',display_name:'Mock',size_bytes:1,quantization:null,max_context_length:4096,type:'llm',loaded_instances:[] as any[]} as unknown as Model;
 const adapter={models:async()=>[model],cli:async()=>'',infer:async()=>{throw Error('unreachable');},api:async()=>({})} as unknown as AgenticAdapter;
 const events:AgenticEvent[]=[];
 await runAgenticSweep(makeRun({modelCall:'on',modelKey:'m',workers:[8],contextLength:4096,maxTokens:64}),defaultSettings,new AbortController().signal,e=>events.push(e),{adapter,host:fakeHost(),settleMs:0});
 const done=finish(events);
 assert.equal(done.status,'failed');
 assert.match(done.error!,/supports 4096 context tokens/);
 assert.equal(events.filter(e=>e.type==='point').length,0);
});
test('a missing stage worker refuses to run rather than quietly measuring one thread',()=>{
 // A single-threaded sweep would still draw a scaling curve, and that curve would read as a
 // verdict about the machine. So this is a hard failure, not a fallback.
 assert.throws(()=>hostPool(path.join(tmpdir(),'no-such-agentic-host.cjs'),8),/build is incomplete/);
});

test('waiting for a free host thread is reported as queued time, not added to a stage',async()=>{
 // The worker reports 10 ms of real stage work; the dispatch took 60 ms because the turn sat in a
 // queue. The stages must still read 10 ms in total and the 50 ms must land in queued time.
 const host:HostRunner={run:async(_t,_s,stages)=>{await new Promise(r=>setTimeout(r,60));return stages.map(()=>10/stages.length);},stop(){},note:'',threads:1};
 const events:AgenticEvent[]=[];
 await runAgenticSweep(makeRun({turns:1,workers:[1],repeats:1}),defaultSettings,new AbortController().signal,e=>events.push(e),{host,settleMs:0});
 const t=(events.find(e=>e.type==='point') as {point:AgenticPoint}).point.turns[0];
 const worked=t.segments.reduce((a,s)=>a+(s.end-s.start),0);
 assert.ok(Math.abs(worked-10)<1,`stage segments should total the worker's own 10 ms, got ${worked.toFixed(1)}`);
 assert.ok(t.queuedMs!>=40,`queued time should hold the wait, got ${t.queuedMs}`);
 assert.ok(t.segments[0].start>=t.queuedMs!,'stages are drawn after the wait, so queueing shows as a gap');
 const s=pointStats((events.find(e=>e.type==='point') as {point:AgenticPoint}).point,null);
 assert.ok(s.meanQueuedMs!>=40);
 assert.equal(pointStats(point(1,10,[turn(0,0,0,0,10)]),null).meanQueuedMs,null,'older sweeps without queued time stay unavailable');
});

test('repeats report the median wall clock and how far the repeats spread',async()=>{
 // Three repeats with deliberately different wall clocks: the middle one must be what is reported,
 // and the spread must describe the gap a real difference has to beat.
 const s=pointStats(point(4,200,[turn(0,0,0,0,200)],[180,200,260]),null);
 assert.equal(s.wallMs,200);
 assert.equal(Math.round(s.wallSpread!),40);
 assert.equal(pointStats(point(4,200,[turn(0,0,0,0,200)]),null).wallSpread,null,'a single repeat reports no spread rather than zero');
});
test('a sweep replays every worker count once per repeat and keeps the median trace',async()=>{
 const host=fakeHost();const events:AgenticEvent[]=[];
 await runAgenticSweep(makeRun({turns:3,workers:[2],repeats:3}),defaultSettings,new AbortController().signal,e=>events.push(e),{host,settleMs:0});
 const p=(events.find(e=>e.type==='point') as {point:AgenticPoint}).point;
 assert.equal(p.wallSamples.length,3);
 assert.equal(p.turns.length,3,'the stored trace is one repeat, not all of them concatenated');
 assert.equal(p.completed,3);
 assert.equal(host.calls.length,3+3*3,'a warm-up pass plus every repeat ran the whole turn set');
 const sorted=[...p.wallSamples].sort((a,b)=>a-b);
 assert.equal(p.wallMs,sorted[1],'the reported wall clock is the median repeat');
 const progress=events.filter(e=>e.type==='progress').at(-1) as {progress:{totalTurns:number}};
 assert.equal(progress.progress.totalTurns,9,'progress counts every repeat');
});
test('the CPU reading names per-core speed and the whole-chip ceiling, and admits when it cannot',()=>{
 const stats=sweepStats([point(1,8000,[turn(0,0,0,0,8000)],[7900,8000,8200]),point(4,2500,[turn(0,0,0,0,2500),turn(1,1,0,0,2500)],[2400,2500,2600])]);
 const reading=cpuReading(stats);
 assert.match(reading,/One worker finishes an agent turn in/);
 assert.match(reading,/whole CPU tops out at/);
 assert.match(reading,/3\.20\u00d7 one worker/);
 assert.match(reading,/±\d/,'each claim carries the spread of the point it came from');
 assert.match(reading,/smaller than those bands as a tie/);
 const single=cpuReading(sweepStats([point(4,2500,[turn(0,0,0,0,2500)])]));
 assert.match(single,/No single-worker point/);
 assert.match(single,/run-to-run variation is unknown/);
 assert.equal(cpuReading([]),'');
});
test('an imported sweep is validated field by field and never repaired',()=>{
 const good:AgenticRun={...makeRun({turns:1,workers:[1]}),environment:{workloadVersion:WORKLOAD_VERSION,cpu:'Other machine'},points:[point(1,1000,[turn(0,0,0,0,1000)])]};
 const round=validateAgenticRun(JSON.parse(JSON.stringify(good)));
 assert.equal(round.points.length,1);
 assert.ok(comparableWorkload(round));
 const broken=(mutate:(r:any)=>void,pattern:RegExp)=>{const r=JSON.parse(JSON.stringify(good));mutate(r);assert.throws(()=>validateAgenticRun(r),pattern);};
 assert.throws(()=>validateAgenticRun(null),/does not contain an agent sweep/);
 assert.throws(()=>validateAgenticRun([]),/does not contain an agent sweep/);
 broken(r=>{r.id='';},/no identifier/);
 broken(r=>{r.status='wat';},/unknown status/);
 broken(r=>{r.logs=[1];},/log is malformed/);
 broken(r=>{r.environment=null;},/no environment record/);
 broken(r=>{r.config.turns=0;},/Agent turns/);
 broken(r=>{r.points=null;},/no measurements/);
 broken(r=>{r.points[0].workers=0;},/worker count/);
 broken(r=>{r.points.push(JSON.parse(JSON.stringify(r.points[0])));},/two points for the same worker count/);
 broken(r=>{r.points[0].wallMs=-1;},/no wall clock/);
 broken(r=>{r.points[0].wallSamples=['x'];},/malformed repeat timings/);
 broken(r=>{r.points[0].turns[0].segments[0].stage='mine';},/unknown stage/);
 broken(r=>{r.points[0].turns[0].status='maybe';},/unknown status/);
 broken(r=>{r.points[0].turns[0].end='soon';},/no timing/);
 // A sweep from a build that measured different work is accepted but flagged, not silently compared.
 const other={...good,environment:{workloadVersion:WORKLOAD_VERSION+1}};
 assert.ok(!comparableWorkload(validateAgenticRun(JSON.parse(JSON.stringify(other)))));
 assert.ok(comparableWorkload({environment:{}}),'sweeps recorded before versioning are not rejected');
});

test('charts render the measured trace and stay readable with nothing measured',()=>{
 const p=point(2,4000,[turn(0,0,0,500,1500),turn(1,1,0,500,1500)]);
 const svg=timelineSvg(p,{axisMaxMs:4000,highlight:['llm'],selectedTurn:0});
 assert.match(svg,/data-turn="0"/);
 assert.match(svg,/data-stage="llm"/);
 assert.match(svg,/class="turn-segment dim"/,'stages outside the filter are dimmed, not removed');
 assert.match(svg,/class="turn-segment picked"/);
 assert.match(timelineSvg(undefined,{axisMaxMs:1}),/No agent turns recorded/);
 assert.match(timelineSvg(point(1,0,[]),{axisMaxMs:1}),/No agent turns recorded/);
 const stats=sweepStats([point(1,8000,[turn(0,0,0,0,8000)]),p]);
 const scaling=scalingSvg([{id:'a',label:'This sweep',stats,active:true}],'turnsPerMin');
 assert.match(scaling,/data-workers="2"/);
 assert.match(scaling,/peak /);
 assert.match(scalingSvg([],'speedup'),/No completed worker counts/);
 assert.match(scalingSvg([{id:'a',label:'x',stats:sweepStats([p]),active:true}],'speedup'),/No completed worker counts/,'speedup with no baseline plots nothing rather than zero');
 const legend=stageLegendHtml(['llm']);
 assert.match(legend,/aria-pressed="true"/);
 assert.match(legend,/class="stage-chip muted" data-stage="scaffold"/);
 assert.equal(stageBreakdown(null).length,0);
 assert.equal(stageBreakdown(pointStats(p,8000)).length,agenticStages.length);
 assert.equal(stageBreakdown(pointStats(point(1,0,[]),null))[0].share,null);
});
test('exports carry every sweep point, the caveats, and no invented values',()=>{
 const run:AgenticRun={...makeRun({turns:1,workers:[1,2]}),points:[point(1,8000,[turn(0,0,0,0,8000)]),point(2,4000,[turn(0,0,0,0,4000),turn(1,1,0,0,4000)])]};
 const rows=agenticRows(run);
 assert.equal(rows.length,2);
 assert.equal(rows[0].speedup,1);
 assert.equal(rows[0].offGpuSharePercent,100);
 const csv=agenticText(run,'csv');
 assert.match(csv,/"workers"/);
 assert.match(csv,/﻿/);
 const html=agenticReport(run);
 const md=agenticText(run,'md');
 assert.match(md,/never include or execute model output/);
 assert.match(md,/\| 2 \| 4.00 \|/);
 // Every renderer takes its columns from one list, so the table cannot drift between them.
 assert.ok(sweepColumns.every(c=>md.includes(c.header)&&html.includes(c.header)));
 assert.equal(modelCallLabel(run.config),'disabled (host-side work only)');
 assert.ok(md.includes(modelCallLabel(run.config))&&html.includes(modelCallLabel(run.config)));
 assert.match(agenticText({...run,points:[]},'md'),/no scaling reading/);
 assert.match(html,/All sweep points/);
 assert.match(html,/Worker timelines/);
 assert.match(html,/default-src 'none'/);
 assert.throws(()=>agenticText(run,'xml'),/Unsupported export format/);
 assert.equal(JSON.parse(agenticText(run,'json')).points.length,2);
});
test('sweeps survive a restart: saved points reload and an unfinished sweep is marked interrupted',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'lmb-agentic-'));
 try{
  const store=new Store(path.join(dir,'bench.sqlite'));
  const run:AgenticRun=makeRun({turns:1,workers:[1,2]});
  store.saveAgenticRun(run);
  store.saveAgenticPoint(run.id,point(2,4000,[turn(0,0,0,0,4000)]));
  store.saveAgenticPoint(run.id,point(1,8000,[turn(0,0,0,0,8000)]));
  const loaded=store.getAgenticRun(run.id);
  assert.deepEqual(loaded.points.map(p=>p.workers),[1,2],'points reload in worker order');
  const [summary]=store.listAgentic();
  assert.equal(summary.id,run.id);
  assert.equal(summary.config.name,run.config.name);
  store.recover();
  assert.equal(store.getAgenticRun(run.id).status,'interrupted');
  assert.deepEqual(store.getAgenticRun(run.id).points.map(p=>p.workers),[1,2],'recovery must not drop the measured points');
  store.deleteAgenticRun(run.id);
  assert.equal(store.listAgentic().length,0);
  assert.throws(()=>store.getAgenticRun(run.id),/not found/);
  store.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
