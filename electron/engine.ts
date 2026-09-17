import { randomUUID, createHash } from 'node:crypto';
import type { Run, RunGpu, Sample, Settings, Model, Progress, TestCase, Grade } from '../src/types';
import { api, cli, infer, listModels } from './lmstudio';
import { objectiveScore, gradingPackage, parseGrade } from './scoring';
import { waveMetrics } from './metrics';
import { mtpArgs,verifyMtp } from './mtp';
import { applySidecar } from './mtp-sidecar';
import { draftModelsLoaded,settledDraftAcceptance,watchEngineLog } from './engine-log';
import { mtpDepthText,onSteps,preflightStep,sweepSteps,type MtpStep } from '../src/mtp-sweep';
import { visionArgs,verifyVision,visionSummary,type VisionMode } from './vision';
import { applyCacheQuant,verifyCacheQuant } from './cache-quant';
import { cacheQuantText } from '../src/cache-quant';
import { runtimeLabel,selectRuntime } from './runtime';
import { estimateLoad,loadAdvice,looksLikeMemory } from './load-estimate';
import { calibratePrefill,calibrationPrompt,calibrationRepeats,prefillText } from '../src/prefill';
import { serverContext } from '../src/defaults';
import { idleSampler, type GpuSampler } from './gpu';

export type EngineEvent = {type:'sample';sample:Sample}|{type:'wave';wave:Run['waves'][number]}|{type:'progress';progress:Progress}|{type:'log';message:string}|{type:'model';key:string;info:unknown}|{type:'grade';sampleId:string;grade:Grade}|{type:'gpu';gpu:RunGpu}|{type:'finish';status:Run['status'];error?:string};
// The last four read and write LM Studio's own files rather than talking to its server, and are
// listed here so a test can exercise those paths without touching a real LM Studio.
export type Adapter = {models:typeof listModels;cli:typeof cli;infer:typeof infer;api:typeof api;sidecar?:typeof applySidecar;watchLog?:typeof watchEngineLog;draftModels?:typeof draftModelsLoaded;draftAcceptance?:typeof settledDraftAcceptance;cacheQuant?:typeof applyCacheQuant};
const real:Adapter={models:listModels,cli,infer,api,sidecar:applySidecar,watchLog:watchEngineLog,draftModels:draftModelsLoaded,draftAcceptance:settledDraftAcceptance,cacheQuant:applyCacheQuant};
export function variant(prompt:string,testId:string,concurrency:number,wave:number,slot:number){const tag=createHash('sha256').update(`${testId}/${concurrency}/${wave}/${slot}`).digest('hex').slice(0,24);return `[Benchmark record ${tag}; ignore this record identifier in your answer.]\n${prompt}`;}
export async function runEngine(run:Run,settings:Settings,signal:AbortSignal,emit:(e:EngineEvent)=>void,adapter:Adapter=real,retries?:Sample[],gradeOnly=false,gpu:GpuSampler=idleSampler('GPU telemetry was not started for this run.')){
 let completed=0,active=0,currentModel='',failures=0;const measured:Sample[]=[];
 // What could not be measured, named. A bare count said three things failed but never which, so a
 // sweep that lost one depth on one model read exactly like one that lost everything.
 const unmeasured:string[]=[];let owned:string|null=null;const runStart=Date.now();
 // MTP depth is a load-time setting, so each depth is its own load of the model and its own
 // pass over the whole workload. Without a sweep this is one step and nothing below changes.
 const steps=sweepSteps(run.config);let currentStep:MtpStep=steps[0];
 // mtpDepthText, never "MTP " + label: the label for depth 0 is already "MTP off", so the
 // shorter form read "MTP MTP off" on every baseline load and wave of a sweep.
 const stepNote=()=>steps.length>1?` · ${mtpDepthText(currentStep.depth)}`:'';
 const perStep=run.tests.length*run.config.waves*run.config.concurrency.reduce((a,b)=>a+b,0);
 let total=gradeOnly?0:retries?retries.length:steps.length*run.config.modelKeys.length*perStep;
 const progress=(phase:string,message:string)=>emit({type:'progress',progress:{runId:run.id,phase,message,completed,total,active,model:currentModel}});
 const log=(message:string)=>emit({type:'log',message});
 const cleanup=async()=>{if(owned){const id=owned;owned=null;try{await adapter.api(settings,'/api/v1/models/unload',{instance_id:id});log(`Unloaded ${id}`);}catch(e){log(`Cleanup could not unload ${id}: ${(e as Error).message}`);}}};
 const load=async(key:string,parallel:number,models:Model[],role='benchmark',step:MtpStep=steps[0])=>{
  if(signal.aborted)throw Error('Cancelled');const model=models.find(m=>m.key===key);if(!model)throw Error(`Downloaded model not found: ${key}`);
  // Parallel slots share one KV cache, so the instance needs room for every slot at once.
  const context=run.config.contextLength,total=serverContext(context,parallel);
  if(model.max_context_length>0&&total>model.max_context_length)throw Error(`${model.display_name} supports ${model.max_context_length} context tokens; ${parallel} parallel slots at ${context} tokens each need ${total}. Lower the context length or the highest concurrency.`);
  if(run.config.reasoning!=='default'&&!model.capabilities?.reasoning?.allowed_options?.includes(run.config.reasoning))throw Error(`${model.display_name} does not support reasoning setting ${run.config.reasoning}. Select Model default or another supported option.`);
  owned=`lmb-${run.id.slice(0,8)}-${randomUUID().slice(0,8)}`;
  progress('loading',`Loading ${model.display_name} with ${parallel} parallel slots and ${total} context tokens (${context} per slot)${role==='judge'?'':stepNote()}…`);
  // A judge takes no part in a sweep: it is loaded without MTP whatever the run asked for.
  const mode=role==='judge'?'off':step.mode,draftTokens=role==='judge'?2:step.tokens;
  // The judge only ever reads text, so it never requests vision.
  const visionMode:VisionMode|undefined=role==='judge'?'off':run.config.vision;
  const args=['load',key,'--identifier',owned,'--context-length',String(total),'--parallel',String(parallel),'--yes'];if(run.config.gpu!=='auto')args.push('--gpu',run.config.gpu);
  args.push(...mtpArgs(model,mode,draftTokens));
  args.push(...visionArgs(model,visionMode)); // Always empty: LM Studio has no projector flag. Validates the request first.
  // A model whose MTP heads are a separate file cannot carry them on the command line, so the
  // setting is written into LM Studio's own per-model config for the length of this one load
  // and taken straight back out again. The engine log is watched across the load either way:
  // at every other depth, including the sweep's MTP-off baseline, the point is to prove that
  // no head was loaded.
  const paired=model.nativeMtp?.kind==='sidecar',watch=paired&&mode!==undefined?(adapter.watchLog??watchEngineLog)():null;
  if(paired&&mode==='on')log(`Native MTP head: ${model.nativeMtp!.draftResource} · loaded as a separate file. LM Studio offers no command-line flag for this, so the setting is written to its per-model configuration for this load only and restored immediately afterwards.`);
  // The KV cache type goes through the same per-model config file as the MTP head, for the same
  // reason: LM Studio has no flag for it. Cache first, head second, so the head's snapshot of the
  // file already contains the cache fields; the two are undone in the opposite order, so whatever
  // the file held before this load is what it holds after it.
  const cacheK=run.config.cacheK??'off',cacheV=run.config.cacheV??'off';
  const quantising=cacheK!=='off'||cacheV!=='off';
  if(quantising)log(`KV cache: ${cacheQuantText(cacheK,cacheV)} · written to LM Studio's per-model configuration for this load only and restored immediately afterwards. The cache is the part of this run's memory that grows with concurrency, so quantizing it is what lets a bigger model or a higher concurrency stay on the GPU.`);
  const undoCache=quantising?(adapter.cacheQuant??applyCacheQuant)(model,cacheK,cacheV):null;
  const restore=paired&&mode==='on'?(adapter.sidecar??applySidecar)(model,draftTokens):null;
  const started=performance.now();let loadOutput:string;
  try{loadOutput=await adapter.cli(settings,args,signal);}
  catch(e){
   // LM Studio says it could not fit the model, in words that name none of the settings that
   // decided how much room it needed. The arithmetic this run already did is added here, where
   // someone reading the log is actually looking. Nothing is retried and nothing is changed.
   // Only when the failure actually looks like one of room. A load that failed for another reason
   // is passed through exactly as LM Studio reported it, because memory advice there would send
   // someone to change a setting that was never the problem.
   if(signal.aborted||!looksLikeMemory((e as Error).message))throw e;
   const estimate=await estimateLoad(settings,adapter.cli,key,total,parallel,signal);
   throw Error(`${(e as Error).message}\n\n${loadAdvice(model,context,parallel,cacheK,cacheV,estimate)}`);
  }
  finally{restore?.();undoCache?.();}
  const fresh=await adapter.models(settings);const owner=fresh.find(m=>m.loaded_instances.some(i=>i.id===owned));const instance=owner?.loaded_instances.find(i=>i.id===owned);
  if(owner&&owner.key!==key)throw Error('LM Studio resolved the model key to a different file. No measurements were taken.');
  if(!instance)throw Error('Loaded instance was not returned by LM Studio. Check that the CLI and API address use the same server.');
  if(instance.config.parallel!==parallel||instance.config.context_length!==total)throw Error(`Loaded settings differ: requested parallel=${parallel}, context=${total}; received parallel=${instance.config.parallel??'unknown'}, context=${instance.config.context_length}. No measurements were taken.`);
  // A depth LM Studio did not apply throws here, before a single request is measured, so no
  // saved response can be attributed to a depth the server was not actually running.
  verifyMtp(instance.config,mode,model.format,draftTokens,{...(paired?{kind:'sidecar' as const,draftPath:model.nativeMtp!.draftPath}:{}),draftersLoaded:watch?(adapter.draftModels??draftModelsLoaded)(watch):[]});
  // A cache type LM Studio did not apply would make the run report a memory saving it never got,
  // and compare against other runs as though it had. Checked here, before anything is measured.
  verifyCacheQuant(instance.config as Record<string,unknown>,cacheK,cacheV);
  // Vision is confirmed from the reloaded model entry's reported capability, the only
  // evidence LM Studio gives; a failure throws here, before any request is measured.
  const vision=verifyVision(owner,visionMode);
  log(visionSummary(vision));
  log(`Native MTP: ${mode??'legacy/default'}${mode==='on'?` · ${draftTokens} draft tokens · ${paired?'separate MTP head':'heads built into the model file'}`:''}${steps.length>1&&role!=='judge'?` (sweep step ${steps.indexOf(step)+1} of ${steps.length})`:''}`);
  log(`${model.display_name}: ${parallel} parallel slots share ${total} context tokens, ${context} per concurrent request.`);
  const info={model,instance,vision,loadMs:performance.now()-started,loadOutput,mtp:{depth:role==='judge'?null:step.depth,mode:mode??'legacy/default',draftTokens:mode==='on'?draftTokens:null,kind:mode==='on'?(model.nativeMtp?.kind??null):null,head:paired&&mode==='on'?model.nativeMtp!.draftResource:null},reasoning:run.config.reasoning==='default'?(model.capabilities?.reasoning?.default??'not exposed'):run.config.reasoning};
  // A preflight is a question, not a measurement, so it leaves no record of a model behind.
  if(role!=='preflight')emit({type:'model',key:role==='judge'?'judge:'+key:key,info});
  // A sweep loads the same model once per depth, so each depth also keeps its own record of
  // what LM Studio confirmed and how long the load took; the plain key stays as it was.
  if(steps.length>1&&role!=='judge'&&role!=='preflight')emit({type:'model',key:`${key} · MTP ${step.label}`,info});
  return {model,id:owned};
 };
 // Two requests, one short and one long, timed the same way every measured request is. Their
 // difference is the real per-token prompt-processing rate; see src/prefill.ts for why a single
 // request cannot give one. This runs once per loaded instance, costs two requests, and is
 // recorded beside the model rather than mixed in with the measured samples.
 const calibrate=async(model:Model,instance:string,key:string,step:MtpStep)=>{
  try{
   progress('warmup',`Calibrating prompt processing for ${model.display_name} (excluded from results)…`);
   const point=async(repeats:number)=>{
    // A unique prefix per request: LM Studio reuses a cached prompt prefix, and a second timing
    // served from that cache would measure the cache rather than the prefill.
    const prompt=`[Calibration ${randomUUID()}]\n${calibrationPrompt(repeats)}`;
    const r=await adapter.infer({...settings,timeoutSec:run.config.timeoutSec},instance,prompt,4,0,run.config.reasoning,signal);
    if(r.status!=='completed')throw Error(r.error||r.status);
    const ms=r.metrics.prefillMs??r.metrics.ttftMs;
    if(r.metrics.inputTokens===null||ms===null)throw Error('LM Studio returned no prompt timing.');
    return {tokens:r.metrics.inputTokens,ms};
   };
   const small=await point(calibrationRepeats.small),big=await point(calibrationRepeats.big);
   const calibration=calibratePrefill(small,big);
   log(`Prompt processing for ${model.display_name}: ${prefillText(calibration)}. ${calibration.note}`);
   emit({type:'model',key:`prefill:${key}${steps.length>1?` · MTP ${step.label}`:''}`,info:calibration});
  }catch(e){
   // A calibration that could not be taken costs the run nothing else: the per-request figures
   // are still recorded, they are simply left uncorrected.
   log(`Prompt-processing calibration skipped for ${model.display_name}: ${(e as Error).message}`);
  }
 };
 const request=async(model:Model,instance:string,test:TestCase,c:number,wave:number,slot:number,waveId:string,warmup=false,previous?:Sample)=>{
  const prompt=previous?.prompt??(test.benchmark?test.prompt:variant(test.prompt,test.id,c,wave,slot));active++;progress(warmup?'warmup':'benchmarking',warmup?'Warming up (excluded from results)…':`${test.name} · ${c} concurrent · wave ${wave+1}${stepNote()}`);
  const max=warmup?32:test.maxTokens>0?Math.min(test.maxTokens,run.config.maxTokens):run.config.maxTokens;
  let result:Awaited<ReturnType<typeof infer>>;const startedAt=Date.now();
  try{result=await adapter.infer({...settings,timeoutSec:run.config.timeoutSec},instance,prompt,max,run.config.temperature,run.config.reasoning,signal,test.image);}finally{active--;}
  const finishedAt=Date.now();
  // The depth is recorded on the measurement itself, not read back from the run's settings:
  // a sweep gives one run several depths, and every response has to say which one produced it.
  const sample:Sample={...result,...(currentStep.depth===null?{}:{mtpTokens:currentStep.depth}),id:randomUUID(),runId:run.id,modelKey:model.key,modelName:model.display_name,testId:test.id,testName:test.name,concurrency:c,waveId,wave,slot,warmup,prompt,objective:result.status==='completed'&&!warmup?objectiveScore(result.output,test):{score:null,checks:[]},grades:[],created:new Date().toISOString(),retryOf:previous?.id,gpu:gpu.window(startedAt,finishedAt)};
  if(!warmup){completed++;measured.push(sample);if(sample.status!=='completed')failures++;}
  emit({type:'sample',sample});progress('benchmarking',`${test.name} · ${completed} of ${total} finished`);return sample;
 };
 const wave=async(model:Model,instance:string,test:TestCase,c:number,index:number,previous?:Sample[])=>{
  const id=randomUUID(),start=performance.now(),startedAt=Date.now();
  // How much of the drafting was kept is printed per finished request by llama.cpp and offered
  // by no API, so a wave with MTP on reads it out of the log it wrote while the wave ran. One
  // line per request, pooled over the wave: under concurrency that is exactly the granularity
  // the number belongs at, because the slots share a batch and draft against each other.
  const speculating=currentStep.mode==='on';
  const acceptance=speculating?(adapter.watchLog??watchEngineLog)():null;
  const results=await Promise.all(Array.from({length:c},(_,slot)=>request(model,instance,test,c,index,slot,id,false,previous?.[slot])));
  const elapsed=performance.now()-start,window=gpu.window(startedAt,Date.now());
  const draft=acceptance?await (adapter.draftAcceptance??settledDraftAcceptance)(acceptance,results.filter(s=>s.status==='completed').length):null;
  emit({type:'wave',wave:waveMetrics(id,run.id,model.key,test.id,c,elapsed,results,window,draft)});
 };
 // Which llama.cpp build runs this. LM Studio has one selected engine at a time and no per-load
 // flag, so a run that names one selects it here and puts the previous choice back in the finally
 // below — whatever else happens to the run. Naming none keeps LM Studio exactly as the user left
 // it, which is what every run made before this field existed did.
 let restoreRuntime:(()=>Promise<void>)|null=null;
 try{
  if(run.config.runtime&&!gradeOnly){
   restoreRuntime=await selectRuntime(settings,adapter.cli,run.config.runtime,signal);
   log(`Runtime: ${runtimeLabel(run.config.runtime.split('@')[0])} · ${run.config.runtime}. LM Studio's engine selection is global, so it is switched for this run and restored afterwards.`);
  }
  // Which engine was selected is already recorded in run.environment.runtime, captured when the
  // run was created. Nothing is asked here, so a run that names no runtime issues no extra
  // command and behaves exactly as it did before this field existed.
  const models=await adapter.models(settings);
  const other=models.flatMap(m=>m.loaded_instances.map(i=>`${m.display_name} (${i.id})`));if(other.length)log('Other loaded instances may affect memory and speed: '+other.join(', '));
  if(!gradeOnly){
   // Whether a model can attach its MTP head at all is answered by one load, before anything is
   // measured. Without this, a sweep finds out that a depth is impossible only after it has spent
   // the time measuring the MTP-off baseline it meant to compare that depth against, and that
   // baseline is then left with nothing to compare to. The probe loads at the same parallel slots
   // and context the run itself will use, so a head that only fails to fit under the run's real
   // pressure fails here too rather than passing a gentler test than the run.
   const blocked=new Map<string,string>();
   const probe=run.config.mtpPreflight&&!retries?preflightStep(steps):null;
   if(probe){
    const depths=onSteps(steps);
    for(const key of run.config.modelKeys){
     if(signal.aborted)break;currentModel=key;currentStep=probe;
     progress('preflight',`Checking ${key} can load its MTP head…`);
     try{
      await load(key,Math.max(...run.config.concurrency),models,'preflight',probe);
      log(`MTP preflight: ${key} loaded its MTP head.`);
     }catch(e){
      // One model that cannot draft at all is one failure, not one per depth it would have run.
      blocked.set(key,(e as Error).message);failures++;
      unmeasured.push(`${key} · MTP ${depths.map(s=>s.label).join(', ')} (the MTP head would not load)`);
      total-=depths.length*perStep;
      log(`MTP preflight: ${key} cannot load its MTP head, so its MTP depths were skipped before anything was measured: ${(e as Error).message}`);
     }finally{await cleanup();}
    }
    currentStep=steps[0];
   }
   for(const key of run.config.modelKeys){
    if(signal.aborted)break;currentModel=key;
    for(const step of steps){
     if(signal.aborted)break;currentStep=step;
     // Already counted and named by the preflight that could not load this model's head.
     if(step.mode==='on'&&blocked.has(key))continue;
     // A retry re-runs each failed request at the depth it was originally measured at, so a
     // depth with nothing to retry is never loaded and never warmed up.
     const mine=retries?retries.filter(s=>s.modelKey===key&&(s.mtpTokens??null)===step.depth):null;
     if(mine&&!mine.length)continue;
     try{
      const {model,id}=await load(key,Math.max(...run.config.concurrency),models,'benchmark',step);
      const warmupTest={...run.tests[0],prompt:'Reply with the word ready.',rules:[],image:undefined};const warm=await request(model,id,warmupTest,1,-1,0,randomUUID(),true);
      if(warm.status!=='completed')throw Error(`Warm-up failed: ${warm.error}`);
      await calibrate(model,id,key,step);
      if(mine){
       const groups=new Map<string,Sample[]>();for(const s of mine){const list=groups.get(s.waveId)??[];list.push(s);groups.set(s.waveId,list);}
       for(const group of groups.values()){if(signal.aborted)break;const test=run.tests.find(t=>t.id===group[0].testId)!;await wave(model,id,test,group.length,group[0].wave,group);}
      }else{
       for(const test of run.tests){for(const c of run.config.concurrency){for(let i=0;i<run.config.waves;i++){if(signal.aborted)break;await wave(model,id,test,c,i);}if(signal.aborted)break;}if(signal.aborted)break;}
      }
     }catch(e){if(!signal.aborted){failures++;unmeasured.push(`${key}${stepNote()}`);log(`Model failed: ${key}${stepNote()}: ${(e as Error).message}`);}}finally{await cleanup();}
    }
   }
  }
  const judgeKey=run.config.judgeModel;
  const candidates=(gradeOnly?run.samples:measured).filter(s=>!s.warmup&&s.status==='completed'&&run.tests.find(t=>t.id===s.testId)?.kind==='quality');
  if(judgeKey&&candidates.length&&!signal.aborted){
   currentModel=judgeKey;completed=0;total=candidates.length;progress('grading','Loading local judge after benchmark measurements…');
   try{
    // Judge reasoning is independent of the benchmarked models.
    const judgeReasoning=models.find(m=>m.key===judgeKey)?.capabilities?.reasoning?.allowed_options?.includes('off')?'off':'default';
    const savedReasoning=run.config.reasoning;run.config.reasoning=judgeReasoning;let loaded;try{loaded=await load(judgeKey,1,models,'judge');}finally{run.config.reasoning=savedReasoning;}
    for(const sample of candidates){if(signal.aborted)break;const test=run.tests.find(t=>t.id===sample.testId)!;progress('grading',`Grading ${sample.testName} (${completed+1}/${total})`);
     const prompt=gradingPackage(sample,test,String(run.environment.judgePrompt||settings.judgePrompt));
     const result=await adapter.infer({...settings,timeoutSec:run.config.timeoutSec},loaded.id,prompt,Math.min(2048,Math.floor(run.config.contextLength/2)),0,judgeReasoning,signal);
     try{if(result.status!=='completed')throw Error(result.error||result.status);const grade=parseGrade(result.output,'local',judgeKey,test.version);emit({type:'grade',sampleId:sample.id,grade});}catch(e){log(`Ungraded ${sample.id}: ${(e as Error).message}. Raw judge output: ${result.output}`);}completed++;
    }
   }catch(e){log(`Judge unavailable: ${(e as Error).message}`);}finally{await cleanup();}
  }
  emit({type:'finish',status:signal.aborted?'cancelled':failures?'failed':'completed',...(failures?{error:`${failures} request/model failure(s). Not measured: ${[...new Set(unmeasured)].join('; ')||'see the run log'}. Everything else in this run was measured and saved. See the run log and saved responses.`}:{})});
 }catch(e){emit({type:'finish',status:signal.aborted?'cancelled':'failed',error:(e as Error).message});}finally{await cleanup();if(restoreRuntime){try{await restoreRuntime();log('Runtime: LM Studio’s previous engine selection restored.');}catch(e){log(`Runtime: could not restore LM Studio’s previous engine selection: ${(e as Error).message}`);}}try{emit({type:'gpu',gpu:gpu.summary(runStart,Date.now())});}catch{}gpu.stop();}
}
