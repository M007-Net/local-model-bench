import {LMStudioClient,type LLMPredictionConfig,type LLMRespondOpts,type ChatMessageInput} from '@lmstudio/sdk';
import type {Model,Settings} from '../src/types';
import type {ReasoningControl,ReasoningSetting,ReasoningSupport} from '../src/reasoning-comparison';
import {compatibleBaseUrl,isManagedEndpoint,validateUrl} from '../src/endpoint';
import {clientDecodeEstimate,metrics,StreamTiming,StreamTimelineTiming} from './metrics';
import type {Inference} from './lmstudio';

// A narrow factory also lets offline fixtures exercise the real adapter without a server.
export const reasoningSdk={create(settings:Settings){
 const address=new URL(validateUrl(settings.baseUrl));address.protocol=address.protocol==='https:'?'wss:':'ws:';
 return new LMStudioClient({baseUrl:address.toString().replace(/\/$/,''),...(settings.token?{apiToken:settings.token}:{}),logger:{info(){},debug(){},warn(){},error(){}}});
}};
const number=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const values=(value:unknown):string[]=>Array.isArray(value)?[...new Set(value.filter((v):v is string=>typeof v==='string'&&v.length>0))]:[];
const noSupport=(note:string,transport:string):ReasoningSupport=>({numeric:false,off:false,efforts:[],unlimited:false,confirmation:'unsupported',note,transport});
export function requestSignals(signal:AbortSignal,timeoutSec:number){
 const timed=timeoutSec>0?AbortSignal.timeout(timeoutSec*1000):new AbortController().signal;
 return {timed,combined:AbortSignal.any([signal,timed])};
}
function aborted<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)return Promise.reject(signal.reason??new DOMException('Aborted','AbortError'));
 return new Promise((resolve,reject)=>{const stop=()=>reject(signal.reason??new DOMException('Aborted','AbortError'));signal.addEventListener('abort',stop,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
}
async function dispose(client:LMStudioClient):Promise<void>{
 // Shutdown must not replace a completed result or hold cancellation indefinitely.
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([client[Symbol.asyncDispose]().catch(()=>{}),new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
function modeSupport(model:Model,transport:string,offOption='off'):ReasoningSupport{
 const options=values(model.capabilities?.reasoning?.allowed_options);
 return {...noSupport('The model does not report reasoning controls.',transport),off:options.includes(offOption),efforts:options.filter(v=>!['off','none','default'].includes(v)),confirmation:options.length?'reported':'unsupported',note:options.length?'Server-reported reasoning modes; numeric thinking-budget support is not confirmed.':'The model does not report reasoning controls.'};
}
// Presence of a config field by itself is not enough: structured budgets also need a
// runtime/template exposing delimiters. No architecture/model-name heuristic is used.
export function nativeBudgetRuntime(model:Model):boolean{
 const reasoning=record(model.capabilities?.reasoning),instance=model.loaded_instances[0];
 // The SDK fills defaults for missing keys. Require a separate server-reported
 // runtime field, rather than mistaking a bundled SDK default for a capability.
 return reasoning.supports_budget===true||reasoning.numeric_budget===true||typeof instance?.config.reasoning_budget_message==='string';
}
export function sdkBudgetSupported(config:LLMPredictionConfig,runtimeReportsBudget=false):boolean{
 const parsing=config.reasoningParsing;
 return runtimeReportsBudget&&(config.reasoningBudget===false||number(config.reasoningBudget)!==null)&&parsing?.enabled===true&&typeof parsing.startString==='string'&&parsing.startString.length>0&&typeof parsing.endString==='string'&&parsing.endString.length>0&&parsing.startString!==parsing.endString;
}
export function llamaPropsSupport(props:unknown,model:Model):ReasoningSupport{
 const data=record(props),caps=record(data.chat_template_caps),params=record(record(data.default_generation_settings).params),reported=modeSupport(model,'llama.cpp chat completions');
 const template=typeof data.chat_template==='string'?data.chat_template:'';
 const start=typeof params.reasoning_budget_start_tag==='string'?params.reasoning_budget_start_tag:'';
 const ends=values(params.reasoning_budget_end_tags);
 const delimiters=(start.length>0&&ends.some(end=>end!==start))||(template.includes('<think>')&&template.includes('</think>'));
 const budget=params.reasoning_budget_tokens??params.thinking_budget_tokens;
 const budgetKey=typeof budget==='number'&&Number.isInteger(budget)&&budget>=-1;
 const templateControl=caps.supports_enable_thinking===true||/\benable_thinking\b/.test(template);
 const numeric=delimiters&&(budgetKey||templateControl);
 const off=reported.off||templateControl;
 const efforts=reported.efforts.length?reported.efforts:values(caps.reasoning_effort_options??data.reasoning_effort_options);
 if(off&&!efforts.includes('on'))efforts.push('on');
 const unlimited=numeric&&budget===-1;
 const note=numeric?(budgetKey?'Server properties report a thinking-budget field and reasoning delimiters. Per-request controls are recorded as requested unless echoed; enforcement is not proven. ':'Numeric budgets use the documented upstream request field; this server does not report budget support or effective settings, so the requested budget is unverified. Upgrade the server if it ignores the control. ')+(unlimited?'The reported server default permits unrestricted reasoning.':budgetKey?'Unlimited is unavailable: llama.cpp resolves -1 to its finite server default.':'Unlimited is unavailable: llama.cpp resolves -1 to its server default, which was not reported.'):'Numeric budgets are unavailable: server properties must expose usable reasoning delimiters and a thinking-template control or a budget field. Supported on/off or effort modes remain available.';
 return {numeric,unlimited,off,efforts,transport:'llama.cpp reasoning_budget_tokens / chat_template_kwargs',confirmation:numeric&&!budgetKey?'requested':numeric||off||efforts.length?'reported':'unsupported',note};
}
export async function discoverReasoningSupport(settings:Settings,model:Model):Promise<ReasoningSupport>{
 if(!isManagedEndpoint(settings)){
  const existing=modeSupport(model,'OpenAI-compatible reasoning_effort',settings.provider==='llamacpp'?'off':'none');
  if(settings.provider!=='llamacpp')return existing;
  const base=new URL(compatibleBaseUrl(settings.baseUrl));base.pathname=base.pathname.replace(/\/v1\/?$/,'')+'/props';base.searchParams.set('model',model.loaded_instances[0]?.id??model.key);
  try{const response=await fetch(base.toString(),{redirect:'error',headers:{...(settings.token?{Authorization:`Bearer ${settings.token}`}:{})},signal:AbortSignal.timeout(Math.min(settings.loadTimeoutSec,10)*1000)});if(!response.ok)return {...existing,note:'Server properties were unavailable; numeric budgets are not confirmed.'};return llamaPropsSupport(await response.json(),model);}
  catch{return {...existing,note:'Server properties were unavailable; numeric budgets are not confirmed.'};}
 }
 const existing=modeSupport(model,'LM Studio native reasoning');
 const instance=model.loaded_instances[0]?.id;
 if(!instance)return {...existing,note:'Numeric budget support will be inspected after this model is loaded. '+existing.note};
 const client=reasoningSdk.create(settings),timed=AbortSignal.timeout(Math.min(settings.loadTimeoutSec,10)*1000);
 try{
  // createDynamicHandle never loads a model. The supplied instance is the exact
  // one owned by the caller; no unrelated loaded model is inspected or changed.
  const handle=client.llm.createDynamicHandle(instance);
  const config=await aborted(handle.getBasePredictionConfig(),timed);
  const supported=sdkBudgetSupported(config,nativeBudgetRuntime(model));
  return {...existing,numeric:supported,unlimited:supported,transport:supported?'LM Studio SDK reasoningBudget / native reasoning':existing.transport,confirmation:supported?'reported':existing.confirmation,note:supported?'Loaded runtime metadata reports the reasoning-budget path, and SDK configuration exposes enabled reasoning delimiters. Requested budgets and echoed configuration are recorded separately; this does not prove enforcement.':'The loaded runtime/template does not report usable numeric reasoning-budget support. SDK defaults alone are not capability evidence. '+existing.note};
 }catch{return {...existing,note:'The loaded SDK configuration could not be inspected; numeric reasoning budgets are unavailable. '+existing.note};}
 finally{await dispose(client);}
}
export function reasoningRequest(settings:Settings,setting?:ReasoningSetting):{body:Record<string,unknown>;control?:ReasoningControl}{
 if(!setting)return {body:{}};
 const control:ReasoningControl={transport:isManagedEndpoint(settings)?'LM Studio native reasoning':settings.provider==='llamacpp'?'llama.cpp chat completions':'OpenAI-compatible reasoning_effort',confirmation:'requested',note:'Requested control; API acceptance does not establish that it was enforced.'};
 if(setting.kind==='default')return {body:{},control:{...control,note:'Model default; no reasoning override was sent.'}};
 if(isManagedEndpoint(settings)){
  if(setting.kind==='off')return {body:{reasoning:'off'},control};
  if(setting.kind==='effort')return {body:{reasoning:setting.value},control};
  throw Error('Numeric LM Studio reasoning controls require the structured-chat SDK transport.');
 }
 if(settings.provider==='llamacpp'){
  if(setting.kind==='off')return {body:{chat_template_kwargs:{enable_thinking:false},reasoning_format:'deepseek'},control};
  if(setting.kind==='effort')return {body:setting.value==='on'?{chat_template_kwargs:{enable_thinking:true},reasoning_format:'deepseek'}:{reasoning_effort:setting.value,reasoning_format:'deepseek'},control};
  return {body:{reasoning_budget_tokens:setting.kind==='budget'?setting.tokens:-1,chat_template_kwargs:{enable_thinking:true},reasoning_format:'deepseek'},control:{...control,transport:'llama.cpp reasoning_budget_tokens',note:setting.kind==='unlimited'?'Requested -1; llama.cpp uses its server default. Unlimited is allowed only when discovery reports that default as -1. API acceptance is not enforcement evidence.':control.note}};
 }
 if(setting.kind==='off')return {body:{reasoning_effort:'none'},control};
 if(setting.kind==='effort')return {body:{reasoning_effort:setting.value},control};
 throw Error('This compatible endpoint has no confirmed numeric reasoning-budget control.');
}
export function compatibleReasoningEcho(setting:ReasoningSetting|undefined,data:unknown):Record<string,unknown>|null{
 if(!setting)return null;
 const response=record(data),config=record(response.generation_settings??record(response.__verbose).generation_settings);
 if(setting.kind==='budget'&&config.reasoning_budget_tokens===setting.tokens||setting.kind==='unlimited'&&config.reasoning_budget_tokens===-1)return config;
 if(setting.kind==='effort'&&config.reasoning_effort===setting.value)return config;
 if(setting.kind==='off'&&(config.enable_thinking===false||record(config.chat_template_kwargs).enable_thinking===false))return config;
 return null;
}
function echoedBudget(config:unknown,budget:number|false):boolean{
 const fields=record(config).fields;
 if(!Array.isArray(fields))return false;
 return fields.some(field=>{
  const f=record(field);if(!['llm.prediction.reasoning.budgetTokens','reasoning.budgetTokens'].includes(f.key))return false;
  const v=record(f.value);return budget===false?v.checked===false:v.checked===true&&v.value===budget;
 });
}
export async function inferReasoningSdk(settings:Settings,instance:string,prompt:string,maxTokens:number,temperature:number,signal:AbortSignal,setting:ReasoningSetting,image?:string):Promise<Inference>{
 const began=performance.now(),{timed,combined}=requestSignals(signal,settings.timeoutSec);
 const timing=new StreamTiming(),timeline=new StreamTimelineTiming();let output='',thought='',first:number|null=null,start:number|null=null,end:number|null=null,rawStats:Record<string,unknown>={},status:Inference['status']='completed',error:string|undefined,stopReason:string|undefined;
 let control:ReasoningControl={transport:'LM Studio SDK respond(reasoningBudget)',confirmation:'requested',note:'Requested control; API acceptance does not establish enforcement.'};
 const client=reasoningSdk.create(settings);let prediction:ReturnType<ReturnType<LMStudioClient['llm']['createDynamicHandle']>['respond']>|undefined;
 let cachedTokens:number|null=null;
 try{
  combined.throwIfAborted();
  const handle=client.llm.createDynamicHandle(instance),config=await aborted(handle.getBasePredictionConfig(),combined);
  const response=await fetch(validateUrl(settings.baseUrl)+'/api/v1/models',{redirect:'error',headers:{...(settings.token?{Authorization:`Bearer ${settings.token}`}:{})},signal:combined});
  if(!response.ok)throw Error('Could not inspect the loaded reasoning runtime: HTTP '+response.status);
  const metadata=await response.json();
  const candidates=Array.isArray(metadata?.models)?metadata.models.filter((candidate:any)=>Array.isArray(candidate?.loaded_instances)&&candidate.loaded_instances.some((loaded:any)=>loaded?.id===instance)):[];
  const candidate=candidates.length===1?candidates[0]:undefined;
  const exactModel=candidate?{...candidate,loaded_instances:candidate.loaded_instances.filter((loaded:any)=>loaded.id===instance)} as Model:undefined;
  if(!sdkBudgetSupported(config,!!exactModel&&nativeBudgetRuntime(exactModel))){control={...control,confirmation:'unsupported',note:'The loaded runtime/template does not expose a reported reasoning-budget path with usable reasoning delimiters. SDK defaults are not capability evidence.'};throw Error(control.note);}
  if(setting.kind!=='budget'&&setting.kind!=='unlimited')throw Error('Expected a numeric or unrestricted reasoning setting.');
  const budget=setting.kind==='budget'?setting.tokens:false;
  if(budget!==false&&(!Number.isSafeInteger(budget)||budget<0))throw Error('Reasoning budget must be a non-negative integer.');
  let message:ChatMessageInput={role:'user',content:prompt};
  if(image){const match=image.match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error('A benchmark image must be a local base64 image data URL.');message={...message,images:[await aborted(client.files.prepareImageBase64('benchmark.'+match[1],match[2]),combined)]};}
  const opts:LLMRespondOpts<unknown>={reasoningBudget:budget,maxTokens:maxTokens===0?false:maxTokens,temperature,contextOverflowPolicy:maxTokens===0?'truncateMiddle':'stopAtLimit',...(config.enableThinking!==undefined?{enableThinking:true}:{}),signal:combined,onPromptProcessingProgress(progress,details){const now=performance.now()-began;if(start===null)start=now;if(progress>=1)end=now;cachedTokens=number(details.cachedTokenCount);}};
  prediction=handle.respond([message],opts);
  const active=prediction;
  const consume=(async()=>{for await(const fragment of active){const content=fragment.content;if(!content)continue;const now=performance.now()-began;
   if(fragment.reasoningType==='reasoning'){thought+=content;timeline.record(now,'reasoning');}
   else if(fragment.reasoningType==='none'){output+=content;timeline.record(now,'text');}
   else continue;
   timing.record(now);if(first===null)first=now;
  }return active.result();})();
  const result=await aborted(consume,combined);
  output=result.nonReasoningContent;thought=result.reasoningContent;stopReason=result.stats.stopReason;
  rawStats={sdkStats:{...result.stats},predictionConfig:result.predictionConfig};
  if(echoedBudget(result.predictionConfig,budget))control={...control,confirmation:'reported',note:'The response echoed the requested thinking-budget configuration; token-level enforcement was not independently verified.'};
  if(stopReason==='failed'||stopReason==='modelUnloaded')throw Error('LM Studio stopped the prediction: '+stopReason);
  if(stopReason==='userStopped')throw Error('LM Studio stopped the prediction before completion.');
 }catch(e){status=signal.aborted?'cancelled':timed.aborted?'timeout':'failed';error=(e as Error).message;}
 finally{if(status!=='completed'&&prediction)void prediction.cancel().catch(()=>{});await dispose(client);}
 const sdk=record(rawStats.sdkStats);
 const stats={input_tokens:number(sdk.promptTokensCount),cached_input_tokens:cachedTokens,total_output_tokens:number(sdk.predictedTokensCount),reasoning_output_tokens:number(sdk.reasoningTokensCount),tokens_per_second:number(sdk.tokensPerSecond),time_to_first_token_seconds:number(sdk.timeToFirstTokenSec)};
 const measured=metrics(stats,performance.now()-began,start,end,first,timing.summary(stats.total_output_tokens,status==='completed',timeline.summary()));
 measured.clientGenerationTps=clientDecodeEstimate(measured.outputTokens,measured.streaming,status==='completed');
 measured.cacheNote='SDK-reported prediction counts include the complete response. Reasoning token counts remain unavailable when omitted by SDK statistics; fragment counts are approximate and are not substituted.';
 if(maxTokens===0)control={...control,note:control.note+' No app output-token or request-time limit; context shifts preserve the question.'};
 return {output,reasoning:thought,metrics:measured,rawStats,status,error,possibleTruncation:stopReason==='maxPredictedTokensReached'||stopReason==='contextLengthReached'||(maxTokens>0&&stats.total_output_tokens!==null&&stats.total_output_tokens>=maxTokens),reasoningControl:control};
}
