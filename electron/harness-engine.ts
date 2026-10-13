import {randomUUID,createHash} from 'node:crypto';
import os from 'node:os';
import type {Settings,Model} from '../src/types';
import {HARNESS_PROTOCOL,validateHarnessConfig,validateHarnessModels,harnessReasoningWire,type HarnessRun,type HarnessTrial,type HarnessProgress,type TraceEvent} from '../src/harness';
import {api,cli,listModels} from './lmstudio';
import {harnessDiagnostics,runSandbox,verifySandbox} from './harness-sandbox';
import {relayBody,relayInference,recordUsage} from './harness-relay';
export type HarnessEvent={type:'run';run:HarnessRun}|{type:'trial';trial:HarnessTrial}|{type:'progress';progress:HarnessProgress};
export type HarnessAdapter={diagnostics:typeof harnessDiagnostics;models:typeof listModels;cli:typeof cli;api:typeof api;sandbox:typeof runSandbox;verify:typeof verifySandbox;infer:typeof relayInference};
const real:HarnessAdapter={diagnostics:harnessDiagnostics,models:listModels,cli,api,sandbox:runSandbox,verify:verifySandbox,infer:relayInference};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function classifyHarnessFailure(message:string){
 if(/cancel/i.test(message))return 'cancelled';if(/timeout|timed out|time.exceeded|wall.clock/i.test(message))return 'timeout';if(/Sandbox exited|Docker |Verifier infrastructure|cleanup failed/i.test(message))return 'infrastructure_error';if(/context|token.*limit/i.test(message))return 'context_limit';if(/budget|limit.*exceeded/i.test(message))return 'resource_limit';if(/format|invalid.*tool/i.test(message))return 'invalid_tool_use';if(/inference|HTTP|model identity/i.test(message))return 'inference_error';return 'infrastructure_or_harness_error';
}
export function toolMetrics(event:any){
 const state=event.event?.part?.state;
 if(state){const start=state.time?.start,end=state.time?.end,exit=state.metadata?.exit;return {failed:state.status==='error'||typeof exit==='number'&&exit!==0,ms:typeof start==='number'&&typeof end==='number'&&end>=start?end-start:null};}
 return {failed:!!event.result?.exception||typeof event.result?.returncode==='number'&&event.result.returncode!==0,ms:typeof event.durationMs==='number'&&Number.isFinite(event.durationMs)&&event.durationMs>=0?event.durationMs:null};
}
function artifacts(raw:unknown,task:HarnessRun['tasks'][number]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Missing file artifacts');const out:Record<string,string>={};
 for(const key of Object.keys(task.files)){const value=(raw as Record<string,unknown>)[key];if(typeof value!=='string'||Buffer.byteLength(value)>65536)throw Error('Missing or oversized artifact '+key);out[key]=value;}return out;
}
export async function runHarnessEvaluation(run:HarnessRun,settings:Settings,signal:AbortSignal,emit:(event:HarnessEvent)=>void,adapter:HarnessAdapter=real){
 const config=validateHarnessConfig(run.config),started=Date.now();let owned:string|null=null,completed=run.trials.length,successes=run.trials.filter(t=>t.status==='success').length;
 const update=()=>{run.updated=new Date().toISOString();emit({type:'run',run});};
 const total=config.modelKeys.length*config.harnesses.length*run.tasks.length*config.trials;
 const progress=(model='',harness='',task='',trial=0,message='Preparing evaluation')=>emit({type:'progress',progress:{runId:run.id,model,harness,task,trial,completed,total,successes,failures:completed-successes,elapsedMs:Date.now()-started,message}});
 try{
  progress();const diagnostic=await adapter.diagnostics();if(!diagnostic.ready||!diagnostic.imageId)throw Error(diagnostic.message);
  const models=await adapter.models(settings);
  // Validate the full grid before any attempt, with no silent substitution.
  validateHarnessModels(config,models);
  let runtimeInventory:string|null=null;
  try{runtimeInventory=(await adapter.cli(settings,['runtime','ls'],signal))||null;}catch(e){if(signal.aborted)throw e;run.logs.push('Runtime inventory unavailable: '+(e as Error).message);}
  run.environment={protocol:HARNESS_PROTOCOL,platform:os.platform(),cpu:os.cpus()[0]?.model,node:process.versions.node,imageId:diagnostic.imageId,versions:diagnostic.versions,endpoint:settings.baseUrl,runtimeInventory,runtimeProvenance:'Local LM Studio CLI selection/inventory; not server-side runtime attestation. Native effective load config recorded per model.',selectionSeed:config.seed,inferenceSeed:'unsupported; task selection seed does not seed generation',taskHash:hash(run.tasks),models:{}};update();
  for(const key of config.modelKeys){
   signal.throwIfAborted();const model=models.find(m=>m.key===key)!;progress(key,'','',0,'Preparing model');
   let instance=model.loaded_instances.find(i=>i.config.context_length===config.contextLength&&i.config.parallel===1);
   if(!instance){owned='lmb-harness-'+run.id.slice(0,8)+'-'+randomUUID().slice(0,8);await adapter.cli(settings,['load',key,'--identifier',owned,'--context-length',String(config.contextLength),'--parallel','1','--yes'],signal);
    const fresh=await adapter.models(settings);const loaded=fresh.find(m=>m.key===key);instance=loaded?.loaded_instances.find(i=>i.id===owned);
   }
   if(!instance||instance.config.context_length!==config.contextLength||instance.config.parallel!==1)throw Error('LM Studio did not confirm the requested effective load configuration');
   (run.environment.models as Record<string,unknown>)[key]={model,instance,weightsIdentity:{key,sizeBytes:model.size_bytes,quantization:model.quantization},contentHash:'unavailable; model resource identity is server-reported'};update();
   if(config.harnesses.includes('opencode')){
    progress(key,'opencode','',0,'Checking native tool calling');
    const probeSignal=AbortSignal.any([signal,AbortSignal.timeout(config.timeoutSec*1000)]);
    const probe=await adapter.infer(settings,{model:instance.id,messages:[{role:'user',content:'Call the readiness tool with ready=true.'}],tools:[{type:'function',function:{name:'readiness',description:'Check tool readiness',parameters:{type:'object',properties:{ready:{type:'boolean'}},required:['ready']}}}],tool_choice:'required',max_tokens:config.maxTokens,temperature:config.temperature,...(harnessReasoningWire(config.reasoning)!==undefined?{reasoning_effort:harnessReasoningWire(config.reasoning)}:{}),stream:false},probeSignal);
    if(!probe.choices?.[0]?.message?.tool_calls?.some((t:any)=>t.function?.name==='readiness'))throw Error(`OpenCode requires native tool calling; ${key} did not pass the probe. No harness was substituted.`);
   }
   for(const harness of config.harnesses)for(const task of run.tasks)for(let repeat=1;repeat<=config.trials;repeat++){
    if(signal.aborted)break;
    const trial:HarnessTrial={id:randomUUID(),runId:run.id,modelKey:key,harness,taskId:task.id,taskVersion:task.version,trial:repeat,status:'error',failure:null,metrics:{durationMs:0,startupMs:null,inferenceMs:null,toolMs:null,externalWaitMs:null,toolCalls:0,failedToolCalls:0,modelRequests:0,iterations:null,inputTokens:0,outputTokens:0,totalTokens:0,tokenSource:'measured'},effective:{model:instance.id,load:instance.config,temperature:config.temperature,maxTokens:config.maxTokens,reasoning:config.reasoning,taskHash:hash(task),versions:diagnostic.versions,modelSeed:'unavailable',network:'none; stdio OpenAI relay',tokenBudgetPolicy:'stop before next request after measured total reaches threshold; final request may cross threshold'},events:[],files:{},verification:{passed:null,output:'Not run'},traceTruncated:false};
    let traceBytes=0,proposedTools=0,responses=0,harnessError='',toolMs=0,toolTimingComplete=true;const begin=Date.now();const deadline=AbortSignal.timeout(config.timeoutSec*1000),attemptSignal=AbortSignal.any([signal,deadline]);
    const trace=(kind:TraceEvent['kind'],data:unknown)=>{const bytes=Buffer.byteLength(JSON.stringify(data));if(traceBytes+bytes>1_000_000||trial.events.length>=1000){trial.traceTruncated=true;return;}traceBytes+=bytes;trial.events.push({at:Date.now()-begin,kind,data});};
    progress(key,harness,task.id,repeat,'Running isolated task');
    try{
     await adapter.sandbox({image:diagnostic.imageId,config,runId:run.id,signal:attemptSignal,payload:{config,harness,model:instance.id,task:{id:task.id,description:task.description,files:task.files}},onEvent:async event=>{
      if(event.kind==='ready'){trial.metrics.startupMs=Date.now()-begin;trial.effective.initialGitCommit=event.initialCommit??'unavailable';}
      else if(event.kind==='configuration'){if(JSON.stringify({harness:event.harness,model:event.model}).length>200_000)throw Error('Harness configuration exceeded storage budget');trial.effective.harness=event.harness;trial.effective.adapterModel=event.model??null;trial.effective.harnessHash=hash({harness:event.harness,model:event.model});trial.effective.reasoningWire=harnessReasoningWire(config.reasoning)??'server default';trial.effective.generationAttestation='Relay-sent settings; server does not echo effective generation parameters';}
      else if(event.kind==='request'){
       if(config.maxTotalTokens!==null&&(trial.metrics.totalTokens===null||trial.metrics.totalTokens>=config.maxTotalTokens))throw Error('Measured model token budget reached or usage unavailable');
       const body=relayBody(event.body,instance!.id,config);trial.effective.systemPromptHash=hash((body.messages as any[]).filter(m=>m.role==='system'||m.role==='developer'));trace('request',body);trial.metrics.modelRequests++;
       progress(key,harness,task.id,repeat,`Model request ${trial.metrics.modelRequests}`);
       const start=Date.now();let response:any;try{response=await adapter.infer(settings,body,attemptSignal);}finally{trial.metrics.inferenceMs=(trial.metrics.inferenceMs??0)+Date.now()-start;}responses++;recordUsage(trial.metrics,response);trace('response',response);
       proposedTools+=(response.choices?.[0]?.message?.tool_calls??[]).length;if(proposedTools>config.maxToolCalls)throw Error('Tool call budget exceeded before delivery');
       return {status:200,body:response};
      }else if(event.kind==='tool'){
       trial.metrics.toolCalls!++;const measurement=toolMetrics(event);if(measurement.failed)trial.metrics.failedToolCalls!++;if(measurement.ms===null)toolTimingComplete=false;else toolMs+=measurement.ms;trace('tool',event);if(trial.metrics.toolCalls!>config.maxToolCalls)throw Error('Tool call budget exceeded');
      }else if(event.kind==='artifacts')trial.files=artifacts(event.files,task);
      else if(event.kind==='error'){harnessError=String(event.message).slice(0,8000);trace('error',harnessError);}
      else if(event.kind==='message'){trace('message',event);const result=event.result;if(result?.exit_status&&result.exit_status!=='Submitted')harnessError=String(result.exit_status);if(event.event?.type==='error')harnessError=JSON.stringify(event.event.error);}
     }});
     progress(key,harness,task.id,repeat,'Verifying in a fresh isolated container');
     const verification=await adapter.verify(diagnostic.imageId,config,run.id,{files:artifacts(trial.files,task),entry:task.entry,cases:task.cases},attemptSignal);
     if(verification.code!==0&&verification.code!==1)throw Error('Verifier infrastructure failure: '+verification.stderr);
     const lines=verification.stdout.trim().split('\n').map(line=>JSON.parse(line));if(lines.length!==task.cases.length||lines.some((v,i)=>v.case!==i+1||typeof v.passed!=='boolean'))throw Error('Verifier output incomplete');
     trial.verification={passed:verification.code===0&&lines.every(v=>v.passed),output:verification.stdout+verification.stderr};trace('verification',trial.verification);
     trial.status=harnessError?'error':trial.verification.passed?'success':'failure';trial.failure=harnessError?classifyHarnessFailure(harnessError):trial.status==='failure'?'verification_failed':null;
    }catch(e){const message=(e as Error).message;trial.failure=signal.aborted?'cancelled':deadline.aborted?'timeout':classifyHarnessFailure(message);trial.status=trial.failure==='cancelled'?'cancelled':trial.failure==='timeout'?'timeout':'error';trace('error',message);}
    trial.metrics.durationMs=Date.now()-begin;trial.metrics.toolMs=toolTimingComplete&&trial.metrics.startupMs!==null?toolMs:null;trial.metrics.iterations=trial.metrics.modelRequests;
    if(trial.metrics.startupMs===null){trial.metrics.toolCalls=null;trial.metrics.failedToolCalls=null;}
    // Parent-observed wall time includes startup, relay, tools, and verifier. Avoid deriving overlapping wait/inference components.
    if(trial.metrics.modelRequests===0||responses!==trial.metrics.modelRequests){trial.metrics.inputTokens=null;trial.metrics.outputTokens=null;trial.metrics.totalTokens=null;trial.metrics.tokenSource='unavailable';}
    completed++;if(trial.status==='success')successes++;run.trials.push(trial);emit({type:'trial',trial});progress(key,harness,task.id,repeat,'Attempt saved');
   }
   if(owned){await adapter.api(settings,'/api/v1/models/unload',{instance_id:owned});owned=null;}
   if(signal.aborted)break;
  }
  run.status=signal.aborted?'cancelled':'completed';
 }catch(e){run.status=signal.aborted?'cancelled':'failed';run.error=(e as Error).message;}
 finally{
  if(owned){try{await adapter.api(settings,'/api/v1/models/unload',{instance_id:owned});}catch(e){run.logs.push('Model cleanup failed: '+(e as Error).message);run.status='failed';}}
  update();
 }
}
