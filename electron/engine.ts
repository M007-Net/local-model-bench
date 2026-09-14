import { randomUUID, createHash } from 'node:crypto';
import type { Run, RunGpu, Sample, Settings, Model, Progress, TestCase, Grade } from '../src/types';
import { api, cli, infer, listModels } from './lmstudio';
import { objectiveScore, gradingPackage, parseGrade } from './scoring';
import { waveMetrics } from './metrics';
import { mtpArgs,verifyMtp } from './mtp';
import { visionArgs,verifyVision,visionSummary,type VisionMode } from './vision';
import { serverContext } from '../src/defaults';
import { idleSampler, type GpuSampler } from './gpu';

export type EngineEvent = {type:'sample';sample:Sample}|{type:'wave';wave:Run['waves'][number]}|{type:'progress';progress:Progress}|{type:'log';message:string}|{type:'model';key:string;info:unknown}|{type:'grade';sampleId:string;grade:Grade}|{type:'gpu';gpu:RunGpu}|{type:'finish';status:Run['status'];error?:string};
export type Adapter = {models:typeof listModels;cli:typeof cli;infer:typeof infer;api:typeof api};
const real:Adapter={models:listModels,cli,infer,api};
export function variant(prompt:string,testId:string,concurrency:number,wave:number,slot:number){const tag=createHash('sha256').update(`${testId}/${concurrency}/${wave}/${slot}`).digest('hex').slice(0,24);return `[Benchmark record ${tag}; ignore this record identifier in your answer.]\n${prompt}`;}
export async function runEngine(run:Run,settings:Settings,signal:AbortSignal,emit:(e:EngineEvent)=>void,adapter:Adapter=real,retries?:Sample[],gradeOnly=false,gpu:GpuSampler=idleSampler('GPU telemetry was not started for this run.')){
 let completed=0,active=0,currentModel='',failures=0;const measured:Sample[]=[];let owned:string|null=null;const runStart=Date.now();
 let total=gradeOnly?0:retries?retries.length:run.config.modelKeys.length*run.tests.length*run.config.waves*run.config.concurrency.reduce((a,b)=>a+b,0);
 const progress=(phase:string,message:string)=>emit({type:'progress',progress:{runId:run.id,phase,message,completed,total,active,model:currentModel}});
 const log=(message:string)=>emit({type:'log',message});
 const cleanup=async()=>{if(owned){const id=owned;owned=null;try{await adapter.api(settings,'/api/v1/models/unload',{instance_id:id});log(`Unloaded ${id}`);}catch(e){log(`Cleanup could not unload ${id}: ${(e as Error).message}`);}}};
 const load=async(key:string,parallel:number,models:Model[],role='benchmark')=>{
  if(signal.aborted)throw Error('Cancelled');const model=models.find(m=>m.key===key);if(!model)throw Error(`Downloaded model not found: ${key}`);
  // Parallel slots share one KV cache, so the instance needs room for every slot at once.
  const context=run.config.contextLength,total=serverContext(context,parallel);
  if(model.max_context_length>0&&total>model.max_context_length)throw Error(`${model.display_name} supports ${model.max_context_length} context tokens; ${parallel} parallel slots at ${context} tokens each need ${total}. Lower the context length or the highest concurrency.`);
  if(run.config.reasoning!=='default'&&!model.capabilities?.reasoning?.allowed_options?.includes(run.config.reasoning))throw Error(`${model.display_name} does not support reasoning setting ${run.config.reasoning}. Select Model default or another supported option.`);
  owned=`lmb-${run.id.slice(0,8)}-${randomUUID().slice(0,8)}`;
  progress('loading',`Loading ${model.display_name} with ${parallel} parallel slots and ${total} context tokens (${context} per slot)…`);
  const mode=role==='judge'?'off':run.config.mtp;
  // The judge only ever reads text, so it never requests vision.
  const visionMode:VisionMode|undefined=role==='judge'?'off':run.config.vision;
  const args=['load',key,'--identifier',owned,'--context-length',String(total),'--parallel',String(parallel),'--yes'];if(run.config.gpu!=='auto')args.push('--gpu',run.config.gpu);
  args.push(...mtpArgs(model,mode,run.config.mtpDraftTokens??2));
  args.push(...visionArgs(model,visionMode)); // Always empty: LM Studio has no projector flag. Validates the request first.
  const started=performance.now();const loadOutput=await adapter.cli(settings,args,signal);
  const fresh=await adapter.models(settings);const owner=fresh.find(m=>m.loaded_instances.some(i=>i.id===owned));const instance=owner?.loaded_instances.find(i=>i.id===owned);
  if(owner&&owner.key!==key)throw Error('LM Studio resolved the model key to a different file. No measurements were taken.');
  if(!instance)throw Error('Loaded instance was not returned by LM Studio. Check that the CLI and API address use the same server.');
  if(instance.config.parallel!==parallel||instance.config.context_length!==total)throw Error(`Loaded settings differ: requested parallel=${parallel}, context=${total}; received parallel=${instance.config.parallel??'unknown'}, context=${instance.config.context_length}. No measurements were taken.`);
  verifyMtp(instance.config,mode,model.format,run.config.mtpDraftTokens??2);
  // Vision is confirmed from the reloaded model entry's reported capability, the only
  // evidence LM Studio gives; a failure throws here, before any request is measured.
  const vision=verifyVision(owner,visionMode);
  log(visionSummary(vision));
  log(`Native MTP: ${mode??'legacy/default'}${mode==='on'?' · '+(run.config.mtpDraftTokens??2)+' draft tokens':''}`);
  log(`${model.display_name}: ${parallel} parallel slots share ${total} context tokens, ${context} per concurrent request.`);
  const info={model,instance,vision,loadMs:performance.now()-started,loadOutput,reasoning:run.config.reasoning==='default'?(model.capabilities?.reasoning?.default??'not exposed'):run.config.reasoning};emit({type:'model',key:role==='judge'?'judge:'+key:key,info});return {model,id:owned};
 };
 const request=async(model:Model,instance:string,test:TestCase,c:number,wave:number,slot:number,waveId:string,warmup=false,previous?:Sample)=>{
  const prompt=previous?.prompt??(test.benchmark?test.prompt:variant(test.prompt,test.id,c,wave,slot));active++;progress(warmup?'warmup':'benchmarking',warmup?'Warming up (excluded from results)…':`${test.name} · ${c} concurrent · wave ${wave+1}`);
  const max=warmup?32:test.maxTokens>0?Math.min(test.maxTokens,run.config.maxTokens):run.config.maxTokens;
  let result:Awaited<ReturnType<typeof infer>>;const startedAt=Date.now();
  try{result=await adapter.infer({...settings,timeoutSec:run.config.timeoutSec},instance,prompt,max,run.config.temperature,run.config.reasoning,signal,test.image);}finally{active--;}
  const finishedAt=Date.now();
  const sample:Sample={...result,id:randomUUID(),runId:run.id,modelKey:model.key,modelName:model.display_name,testId:test.id,testName:test.name,concurrency:c,waveId,wave,slot,warmup,prompt,objective:result.status==='completed'&&!warmup?objectiveScore(result.output,test):{score:null,checks:[]},grades:[],created:new Date().toISOString(),retryOf:previous?.id,gpu:gpu.window(startedAt,finishedAt)};
  if(!warmup){completed++;measured.push(sample);if(sample.status!=='completed')failures++;}
  emit({type:'sample',sample});progress('benchmarking',`${test.name} · ${completed} of ${total} finished`);return sample;
 };
 const wave=async(model:Model,instance:string,test:TestCase,c:number,index:number,previous?:Sample[])=>{
  const id=randomUUID(),start=performance.now(),startedAt=Date.now();
  const results=await Promise.all(Array.from({length:c},(_,slot)=>request(model,instance,test,c,index,slot,id,false,previous?.[slot])));
  emit({type:'wave',wave:waveMetrics(id,run.id,model.key,test.id,c,performance.now()-start,results,gpu.window(startedAt,Date.now()))});
 };
 try{
  const models=await adapter.models(settings);
  const other=models.flatMap(m=>m.loaded_instances.map(i=>`${m.display_name} (${i.id})`));if(other.length)log('Other loaded instances may affect memory and speed: '+other.join(', '));
  if(!gradeOnly){
   for(const key of run.config.modelKeys){
    if(signal.aborted)break;currentModel=key;
    try{
     const {model,id}=await load(key,Math.max(...run.config.concurrency),models);
     const warmupTest={...run.tests[0],prompt:'Reply with the word ready.',rules:[],image:undefined};const warm=await request(model,id,warmupTest,1,-1,0,randomUUID(),true);
     if(warm.status!=='completed')throw Error(`Warm-up failed: ${warm.error}`);
     if(retries){
      const groups=new Map<string,Sample[]>();for(const s of retries.filter(s=>s.modelKey===key)){const list=groups.get(s.waveId)??[];list.push(s);groups.set(s.waveId,list);}
      for(const group of groups.values()){if(signal.aborted)break;const test=run.tests.find(t=>t.id===group[0].testId)!;await wave(model,id,test,group.length,group[0].wave,group);}
     }else{
      for(const test of run.tests){for(const c of run.config.concurrency){for(let i=0;i<run.config.waves;i++){if(signal.aborted)break;await wave(model,id,test,c,i);}if(signal.aborted)break;}if(signal.aborted)break;}
     }
    }catch(e){if(!signal.aborted){failures++;log(`Model failed: ${key}: ${(e as Error).message}`);}}finally{await cleanup();}
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
  emit({type:'finish',status:signal.aborted?'cancelled':failures?'failed':'completed',...(failures?{error:`${failures} request/model failure(s). See run log and saved responses.`}:{})});
 }catch(e){emit({type:'finish',status:signal.aborted?'cancelled':'failed',error:(e as Error).message});}finally{await cleanup();try{emit({type:'gpu',gpu:gpu.summary(runStart,Date.now())});}catch{}gpu.stop();}
}
