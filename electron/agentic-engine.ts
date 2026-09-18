import {randomUUID,createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Model,RunGpu,Settings} from '../src/types';
import type {AgenticConfig,AgenticPoint,AgenticProgress,AgenticRun,AgenticSegment,AgenticTurn,HostStage} from '../src/agentic';
import {WORKLOAD_VERSION,hostStages,modelCallLabel,validateAgenticConfig} from '../src/agentic';
import {serverContext} from '../src/defaults';
import {api,cli,infer,listModels} from './lmstudio';
import {idleSampler,type GpuSampler} from './gpu';

export type AgenticEvent={type:'point';point:AgenticPoint}|{type:'progress';progress:AgenticProgress}|{type:'log';message:string}|{type:'environment';environment:Record<string,unknown>}|{type:'gpu';gpu:RunGpu}|{type:'finish';status:AgenticRun['status'];error?:string};
export type HostRunner={run(turnIndex:number,scale:number,stages:HostStage[]):Promise<number[]>;stop():void;note:string;threads:number};
export type AgenticAdapter={models:typeof listModels;cli:typeof cli;infer:typeof infer;api:typeof api};
const real:AgenticAdapter={models:listModels,cli,infer,api};
export const hostWorkerFile=(dir:string)=>path.join(dir,'agentic-host.cjs');

// Every host stage is dispatched to a pool of real threads. Without it the "parallel workers" of a
// sweep would share one JavaScript thread and the CPU side could never scale, which would make the
// whole measurement a lie. A missing stage worker is therefore a hard failure, not a quiet fallback:
// a sweep that silently ran single-threaded would still draw a scaling curve, and that curve would
// read as a verdict about the machine.
export function hostPool(file:string,threads:number):HostRunner{
 if(!existsSync(file))throw Error(`Host stage worker not found at ${file}. The application build is incomplete; no sweep was run, because host stages would not have been parallel.`);
 const size=Math.max(1,Math.min(threads,64));
 type Pending={resolve:(durations:number[])=>void;reject:(e:Error)=>void};
 const idle:Worker[]=[],busy=new Map<Worker,Pending>();
 const queue:({turnIndex:number;scale:number;stages:HostStage[]}&Pending)[]=[];
 let stopped=false;
 // `pump` hands a worker at most one job at a time and only returns it to `idle` on reply, so the
 // replying worker identifies its own job — no correlation ids are needed.
 const pump=()=>{
  while(!stopped&&queue.length&&idle.length){
   const job=queue.shift()!,worker=idle.pop()!;
   busy.set(worker,{resolve:job.resolve,reject:job.reject});
   worker.postMessage({turnIndex:job.turnIndex,scale:job.scale,stages:job.stages});
  }
 };
 const finish=(worker:Worker,durations:number[],error?:Error)=>{
  const pending=busy.get(worker);
  if(pending){busy.delete(worker);error?pending.reject(Object.assign(error,{durations})):pending.resolve(durations);}
  if(!error)idle.push(worker);
  pump();
 };
 for(let i=0;i<size;i++){
  const worker=new Worker(file);
  worker.on('message',(done:{durations:number[];error?:string})=>finish(worker,done.durations??[],done.error?Error(done.error):undefined));
  worker.on('error',e=>finish(worker,[],e));
  worker.unref();
  idle.push(worker);
 }
 return {
  run:(turnIndex,scale,stages)=>new Promise<number[]>((resolve,reject)=>{if(stopped)return reject(Error('Host stage pool stopped'));queue.push({turnIndex,scale,stages,resolve,reject});pump();}),
  stop(){stopped=true;queue.splice(0).forEach(j=>j.reject(Error('Cancelled')));[...idle,...busy.keys()].forEach(w=>{try{w.terminate();}catch{}});idle.length=0;},
  note:`Host stages ran on a pool of ${size} thread(s) on a machine reporting ${threads} available.`,
  threads:size
 };
}
// Every measured repeat starts from the same machine state: a short idle gap lets clocks and
// thermals settle after the previous burst, so a one-worker point is not measured on a chip that is
// still recovering from a thirty-two-worker one. Without it the baseline is inflated and every other
// point reports an efficiency above 1.00.
export const DEFAULT_SETTLE_MS=1200;
const settle=(ms:number,signal:AbortSignal)=>ms<=0?Promise.resolve():new Promise<void>(done=>{const t=setTimeout(done,ms);if(signal.aborted){clearTimeout(t);done();}else signal.addEventListener('abort',()=>{clearTimeout(t);done();},{once:true});});
export const turnPrompt=(prompt:string,turnIndex:number)=>`[Agent turn ${createHash('sha256').update('agentic/'+turnIndex).digest('hex').slice(0,20)}; ignore this turn identifier in your answer.]\n${prompt}`;

type TurnContext={adapter:AgenticAdapter;settings:Settings;config:AgenticConfig;signal:AbortSignal;host:HostRunner;instance:string|null;pointStart:number};
// One agent turn: the model call, then every host stage in order. A failed model call ends the turn
// there — the host stages exist to process an answer, and there is no answer.
async function runTurn(ctx:TurnContext,index:number,lane:number,hostOnly=false):Promise<AgenticTurn>{
 const at=()=>performance.now()-ctx.pointStart;
 const start=at(),segments:AgenticSegment[]=[];
 let status:AgenticTurn['status']='completed',error:string|undefined,llmMs:number|null=null,outputTokens:number|null=null,generationTps:number|null=null;
 if(ctx.instance&&!hostOnly){
  const from=at();
  const result=await ctx.adapter.infer({...ctx.settings,timeoutSec:ctx.config.timeoutSec},ctx.instance,turnPrompt(ctx.config.prompt,index),ctx.config.maxTokens,ctx.config.temperature,ctx.config.reasoning,ctx.signal);
  const to=at();
  segments.push({stage:'llm',start:from,end:to});llmMs=to-from;
  if(result.status!=='completed'){status='failed';error=result.error||result.status;}
  else{outputTokens=result.metrics.outputTokens;generationTps=result.metrics.generationTps;}
 }
 let queuedMs=0;
 if(status==='completed'){
  const requested=at();
  let durations:number[]=[];
  try{durations=await ctx.host.run(index,ctx.config.hostWorkScale,hostStages);}
  catch(e){status='failed';error=(e as Error).message;durations=(e as {durations?:number[]}).durations??[];}
  // The worker timed each stage itself, so the time the turn spent queued for a free thread is
  // whatever is left over. It is reported on its own instead of being spread across the stages.
  const finished=at(),worked=durations.reduce((a,b)=>a+b,0);
  queuedMs=Math.max(0,finished-requested-worked);
  let at_=requested+queuedMs;
  durations.forEach((ms,i)=>{segments.push({stage:hostStages[i],start:at_,end:at_+ms});at_+=ms;});
 }
 return {index,lane,start,end:at(),segments,status,error,llmMs,outputTokens,generationTps,queuedMs};
}

export async function runAgenticSweep(run:AgenticRun,settings:Settings,signal:AbortSignal,emit:(e:AgenticEvent)=>void,options:{adapter?:AgenticAdapter;host:HostRunner;gpu?:GpuSampler;settleMs?:number}){
 const adapter=options.adapter??real;
 const gpu=options.gpu??idleSampler('GPU telemetry was not started for this run.');
 const host=options.host;
 const settleMs=options.settleMs??DEFAULT_SETTLE_MS;
 const config=validateAgenticConfig(run.config);
 const runStart=Date.now();
 let owned:string|null=null,completedTurns=0,pointIndex=0,failures=0;
 const totalTurns=config.turns*config.workers.length*config.repeats;
 const log=(message:string)=>emit({type:'log',message});
 const progress=(phase:string,message:string,workers:number)=>emit({type:'progress',progress:{runId:run.id,phase,message,workers,completedTurns,totalTurns,pointIndex,pointCount:config.workers.length}});
 const cleanup=async()=>{if(owned){const id=owned;owned=null;try{await adapter.api(settings,'/api/v1/models/unload',{instance_id:id});log(`Unloaded ${id}`);}catch(e){log(`Cleanup could not unload ${id}: ${(e as Error).message}`);}}};
 try{
  log(host.note);
  let instance:string|null=null,model:Model|null=null;
  if(config.modelCall==='on'){
   const models=await adapter.models(settings);
   model=models.find(m=>m.key===config.modelKey)??null;
   if(!model)throw Error('Downloaded model not found: '+config.modelKey);
   const parallel=Math.max(...config.workers),total=serverContext(config.contextLength,parallel);
   if(model.max_context_length>0&&total>model.max_context_length)throw Error(`${model.display_name} supports ${model.max_context_length} context tokens; ${parallel} parallel slots at ${config.contextLength} tokens each need ${total}. Lower the context length or the highest worker count.`);
   owned=`lmb-agents-${run.id.slice(0,8)}-${randomUUID().slice(0,8)}`;
   progress('loading',`Loading ${model.display_name} with ${parallel} parallel slots and ${total} context tokens…`,parallel);
   await adapter.cli(settings,['load',config.modelKey,'--identifier',owned,'--context-length',String(total),'--parallel',String(parallel),'--yes'],signal);
   const fresh=await adapter.models(settings);
   const loadedInstance=fresh.find(m=>m.loaded_instances.some(i=>i.id===owned))?.loaded_instances.find(i=>i.id===owned);
   if(!loadedInstance)throw Error('Loaded instance was not returned by LM Studio. Check that the CLI and API address use the same server.');
   if(loadedInstance.config.parallel!==parallel||loadedInstance.config.context_length!==total)throw Error(`Loaded settings differ: requested parallel=${parallel}, context=${total}; received parallel=${loadedInstance.config.parallel??'unknown'}, context=${loadedInstance.config.context_length}. No measurements were taken.`);
   instance=owned;
   log(`${model.display_name}: ${parallel} parallel slots share ${total} context tokens, ${config.contextLength} per concurrent turn.`);
   progress('warmup','Warming up the model (excluded from the sweep)…',parallel);
   const warm=await adapter.infer({...settings,timeoutSec:config.timeoutSec},instance,'Reply with the word ready.',32,0,config.reasoning,signal);
   if(warm.status!=='completed')throw Error(`Warm-up failed: ${warm.error}`);
  }else log('Model call off: this sweep measures host-side agent work only. Nothing was loaded and no GPU work was requested.');

  // Each worker count replays the same fixed turn set `repeats` times. One measurement cannot tell a
  // real difference between two machines from ordinary run-to-run noise, so the reported wall clock
  // is the median repeat and the spread between repeats travels with it.
  // `label` null marks a warm-up pass: it runs the same work but is not counted or reported.
  const runRepeat=async(workers:number,label:string|null)=>{
   const pointStart=performance.now();
   const ctx:TurnContext={adapter,settings,config,signal,host,instance,pointStart};
   const turns:AgenticTurn[]=[];
   let nextTurn=0;
   const lane=async(laneIndex:number)=>{
    while(!signal.aborted){
     const index=nextTurn++;if(index>=config.turns)return;
     turns.push(await runTurn(ctx,index,laneIndex,label===null));
     if(label){completedTurns++;progress('sweeping',`${workers} worker${workers===1?'':'s'} · ${label} · ${turns.length} of ${config.turns} agent turns`,workers);}
    }
   };
   await Promise.all(Array.from({length:workers},(_,i)=>lane(i)));
   return {wallMs:performance.now()-pointStart,turns:turns.sort((a,b)=>a.index-b.index)};
  };
  // One discarded pass at the highest worker count, so every pool thread has JIT-compiled the stage
  // code and the machine has left its idle clocks before anything is measured. Without it the first
  // measured worker count carries that one-off cost and reads as a slower machine.
  if(!signal.aborted){
   const warmWorkers=Math.max(...config.workers);
   // Host stages only: the model already had its own warm-up request, and replaying the whole turn
   // set through it again would spend real inference on measurements nobody keeps.
   progress('warmup',`Warming up host stages at ${warmWorkers} workers (excluded from the sweep)…`,warmWorkers);
   const warm=await runRepeat(warmWorkers,null);
   if(settleMs>0)log(`Each measured repeat is preceded by a ${settleMs} ms idle gap so every point is measured from the same machine state.`);
   log(`Warm-up: ${config.turns} turns at ${warmWorkers} workers in ${(warm.wallMs/1000).toFixed(2)} s, excluded from every measurement.`);
  }
  for(const workers of config.workers){
   if(signal.aborted)break;
   const samples:{wallMs:number;turns:AgenticTurn[]}[]=[];
   for(let repeat=0;repeat<config.repeats;repeat++){
    if(signal.aborted)break;
    const label=`repeat ${repeat+1} of ${config.repeats}`;
    if(settleMs>0)progress('settling',`${workers} worker${workers===1?'':'s'} · letting the machine settle before ${label}…`,workers);
    await settle(settleMs,signal);
    if(signal.aborted)break;
    progress('sweeping',`${workers} worker${workers===1?'':'s'} · ${label} · starting ${config.turns} agent turns`,workers);
    samples.push(await runRepeat(workers,label));
    failures+=samples[samples.length-1].turns.filter(t=>t.status!=='completed').length;
   }
   if(!samples.length)break;
   const ordered=[...samples].sort((a,b)=>a.wallMs-b.wallMs);
   const median=ordered[Math.floor((ordered.length-1)/2)];
   const failed=median.turns.filter(t=>t.status!=='completed').length;
   // The point is handed straight to the caller to persist; the sweep keeps only the failure count,
   // so a long sweep does not accumulate every turn of every worker count in memory.
   emit({type:'point',point:{workers,lanes:new Set(median.turns.map(t=>t.lane)).size,wallMs:median.wallMs,wallSamples:samples.map(s=>s.wallMs),completed:median.turns.length-failed,failed,turns:median.turns}});
   pointIndex++;
   const spread=ordered.length>1?` (${ordered.length} repeats spanning ${(ordered[0].wallMs/1000).toFixed(2)}–${(ordered[ordered.length-1].wallMs/1000).toFixed(2)} s)`:'';
   log(`${workers} worker(s): ${median.turns.length-failed} of ${config.turns} turns completed, median ${(median.wallMs/1000).toFixed(2)} s${spread}.`);
  }
  emit({type:'environment',environment:{platform:os.platform(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,availableParallelism:os.availableParallelism?.()??os.cpus().length,hostThreads:host.threads,totalMemory:os.totalmem(),node:process.versions.node,workloadVersion:WORKLOAD_VERSION,modelCall:modelCallLabel(config),hostWorkNote:'Host stage workloads are seeded from the turn index and never include model output. No generated code is executed.'}});
  emit({type:'finish',status:signal.aborted?'cancelled':failures?'failed':'completed',...(failures?{error:`${failures} agent turn(s) failed. See the run log.`}:{})});
 }catch(e){emit({type:'finish',status:signal.aborted?'cancelled':'failed',error:(e as Error).message});}
 finally{await cleanup();host.stop();try{emit({type:'gpu',gpu:gpu.summary(runStart,Date.now())});}catch{}gpu.stop();}
}
