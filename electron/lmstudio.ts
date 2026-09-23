import {normalizeModels} from '../src/model-capabilities';
import { execFile } from 'node:child_process';
import { readableCliError } from './cli-output';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Settings, Model, Metrics } from '../src/types';
import { attachMtp } from './mtp';
import { metrics, StreamTiming } from './metrics';

// lmsPath is the one setting that becomes argv[0] of a real process, so a bare type
// check is not enough: any string that happens to exist on disk would otherwise be
// launched, including one on a network share. Empty means "use the default location",
// which is what almost everyone wants.
export function validateLmsPath(p:string){
 if(typeof p!=='string')throw Error('Invalid settings');
 if(!p)return;
 if(p.length>32767||/[\u0000-\u001f"<>|*?]/.test(p))throw Error('The LM Studio CLI path contains characters a path cannot hold.');
 if(p.startsWith('\\\\')||/^[a-z][a-z0-9+.-]*:\/\//i.test(p))throw Error('The LM Studio CLI must be a local file, not a network share or a URL.');
 if(!/^[A-Za-z]:[\\/]/.test(p))throw Error('Give the full path to lms.exe, starting with a drive letter.');
 if(p.split(/[\\/]/).includes('..'))throw Error('The LM Studio CLI path cannot contain "..".');
 if(!/\.(exe|cmd|bat)$/i.test(p))throw Error('The LM Studio CLI path must point at lms.exe.');
}
// Re-checked on the way out, not only on the way in: a settings file written by an
// older build, or edited by hand, reaches execFile through exactly this function.
export function resolveLms(settings:Settings){if(!canManageLocally(settings))throw Error('Local model management requires a loopback LM Studio endpoint. Use OpenAI-compatible mode for a remote LM Studio server.');validateLmsPath(settings.lmsPath);const p=settings.lmsPath||path.join(homedir(),'.lmstudio','bin','lms.exe');if(!existsSync(p))throw Error('LM Studio command-line tool not found. Set its path in Settings.');return p;}
export function cli(settings:Settings,args:string[],signal?:AbortSignal):Promise<string>{return new Promise((resolve,reject)=>execFile(resolveLms(settings),args,{windowsHide:true,timeout:settings.loadTimeoutSec*1000,maxBuffer:8*1024*1024,signal},(error,stdout,stderr)=>error?reject(new Error(readableCliError(`${error.message}\n${stderr}\n${stdout}`))):resolve(stdout.trim())));}
// The endpoint rules live in src/endpoint.ts so the window can use them too; that module is free
// of node: imports, which this one is not.
import {validateUrl,isManagedEndpoint,canManageLocally,providerLabel} from '../src/endpoint';
export {isLoopbackUrl,loopbackHosts,validateUrl} from '../src/endpoint';
// fetch rejects with a bare "TypeError: fetch failed" and keeps the real errno one
// level down in .cause. For an app whose entire job is talking to LM Studio, that is
// the least useful thing it could show, and it hides the single most common cause:
// LM Studio running with its server not started.
export function connectionError(url:string,error:unknown):Error{
 const name=(error as Error)?.name;
 const code=(error as {cause?:{code?:string}})?.cause?.code??(error as {code?:string})?.code;
 if(name==='TimeoutError')return Error(`LM Studio did not answer ${url} in time. It may be busy loading a model; raise the load timeout in Settings if that is expected.`);
 if(code==='ECONNREFUSED')return Error(`LM Studio is not answering at ${url}. Open LM Studio, start its local server, and check the port in Settings.`);
 if(code==='ENOTFOUND'||code==='EAI_AGAIN')return Error(`The address ${url} could not be resolved (${code}). Use http://127.0.0.1:1234 rather than a host name.`);
 // localhost resolves to ::1 first on Windows; LM Studio bound to IPv4 only is then
 // unreachable under a name that looks correct.
 if(code==='EADDRNOTAVAIL'||code==='EHOSTUNREACH'||code==='ECONNABORTED')return Error(`Nothing accepted the connection to ${url} (${code}). If LM Studio is listening on IPv4 only, use 127.0.0.1 rather than localhost.`);
 if(code==='ECONNRESET'||code==='EPIPE')return Error(`The connection to LM Studio at ${url} closed unexpectedly (${code}).`);
 return Error(`Could not reach LM Studio at ${url}: ${(error as Error)?.message||String(error)}`);
}
export async function api(settings:Settings,endpoint:string,body?:unknown,signal?:AbortSignal){
 const url=validateUrl(settings.baseUrl);
 // The user's configured patience applies here too. This branch used to be a hardcoded
 // 10 s, which listModels always took, so a large model library timed out with no
 // setting that could raise it.
 const timed=AbortSignal.timeout(settings.loadTimeoutSec*1000);
 let res:Response;
 try{res=await fetch(url+endpoint,{redirect:'error',method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(settings.token?{Authorization:`Bearer ${settings.token}`}:{})},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,timed]):timed});}
 catch(error){if(signal?.aborted)throw error;throw isManagedEndpoint(settings)?connectionError(url,error):Error(`${providerLabel(settings.provider)} could not answer at ${url}: ${(error as Error).message}`);}
 if(!res.ok)throw Error(`${providerLabel(settings.provider)} HTTP ${res.status}: ${(await res.text()).slice(0,1200)}`);
 try{return await res.json();}catch{throw Error(`${providerLabel(settings.provider)} replied to ${endpoint} with something that is not JSON. Check the endpoint address ${url}.`);}
}
export async function listModels(settings:Settings):Promise<Model[]>{
 if(isManagedEndpoint(settings)){const data=await api(settings,'/api/v1/models');return canManageLocally(settings)?attachMtp(normalizeModels(data.models)):normalizeModels(data.models);}
 const data=await api(settings,'/v1/models');
 if(!Array.isArray(data?.data))throw Error('The endpoint did not return an OpenAI-compatible model list.');
 const seen=new Set<string>();
 const positiveInteger=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?value:0;
 return data.data.filter((m:any)=>{
  if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.id!=='string'||!m.id.trim()||seen.has(m.id))return false;
  seen.add(m.id);return true;
 }).map((m:any)=>{
  // llama.cpp optionally exposes GGUF metadata here. Absence is not evidence of
  // a capability, and the configured context is distinct from the training limit.
  const meta=m.meta&&typeof m.meta==='object'&&!Array.isArray(m.meta)?m.meta:{};
  const quantization=typeof meta.ftype==='string'&&meta.ftype.trim()?{name:meta.ftype.trim()}:null;
  return {key:m.id,display_name:m.id,size_bytes:positiveInteger(meta.size),quantization,max_context_length:positiveInteger(meta.n_ctx_train),type:'llm',loaded_instances:[{id:m.id,config:{context_length:positiveInteger(meta.n_ctx)}}],nativeMtp:{supported:null,reason:'Configured by the endpoint server; not inspected or changed by this app.'}};
 });
}

// Streaming decoder retains incomplete UTF-8, lines, and multi-line SSE payloads.
export class SSEDecoder {
 private buffer='';private decoder=new TextDecoder();
 feed(chunk:Uint8Array,final=false):{event:string;data:any}[]{this.buffer+=this.decoder.decode(chunk,{stream:!final});this.buffer=this.buffer.replace(/\r\n/g,'\n');const out:{event:string;data:any}[]=[];let at:number;while((at=this.buffer.indexOf('\n\n'))>=0){const block=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+2);let event='',data:string[]=[];for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();if(line.startsWith('data:'))data.push(line.slice(5).trimStart());}if(data.length&&data.join('\n')!=='[DONE]'){const value=JSON.parse(data.join('\n'));out.push({event:event||value.type,data:value});}}if(final&&this.buffer.trim())throw Error('Incomplete SSE event at end of response');return out;}
}
export type Inference={output:string;reasoning:string;metrics:Metrics;rawStats:Record<string,unknown>;error?:string;status:'completed'|'failed'|'cancelled'|'timeout';possibleTruncation:boolean};
// The v1 chat input is a plain string for text-only requests, which keeps every existing
// run byte-identical, and becomes a content-item array only when an image is attached.
// Item shapes are the ones the server accepts: {type:'text',content} and
// {type:'image',data_url}; it rejects any other key and refuses non-data URLs outright.
export function chatInput(prompt:string,image?:string){
 if(image===undefined)return prompt;
 if(!image.startsWith('data:image/'))throw Error('A benchmark image must be a local data URL. LM Studio does not accept remote image URLs.');
 return [{type:'text',content:prompt},{type:'image',data_url:image}];
}
export async function infer(settings:Settings,instance:string,prompt:string,maxTokens:number,temperature:number,reasoning:string,signal:AbortSignal,image?:string):Promise<Inference>{
 if(!isManagedEndpoint(settings))return inferCompatible(settings,instance,prompt,maxTokens,temperature,reasoning,signal,image);
 const began=performance.now();let start:number|null=null,end:number|null=null,first:number|null=null;const streamTiming=new StreamTiming();let output='',thought='',rawStats:Record<string,unknown>={},ended=false,error:string|undefined;
 const timed=AbortSignal.timeout(settings.timeoutSec*1000);const combined=AbortSignal.any([signal,timed]);let status:Inference['status']='completed';
 try {
  const response=await fetch(validateUrl(settings.baseUrl)+'/api/v1/chat',{redirect:'error',method:'POST',headers:{'Content-Type':'application/json',...(settings.token?{Authorization:`Bearer ${settings.token}`}:{})},body:JSON.stringify({model:instance,input:chatInput(prompt,image),stream:true,store:false,integrations:[],temperature,max_output_tokens:maxTokens,...(reasoning!=='default'?{reasoning}:{})}),signal:combined});
  if(!response.ok)throw Error(`HTTP ${response.status}: ${(await response.text()).slice(0,1600)}`);
  if(!response.body)throw Error('Missing response stream');
  const decoder=new SSEDecoder();const reader=response.body.getReader();
  const accept=({event,data}:{event:string;data:any})=>{const now=performance.now()-began;
   if(event==='prompt_processing.start')start=now;
   if(event==='prompt_processing.end')end=now;
   if(event==='message.delta'){const content=typeof data.content==='string'?data.content:'';output+=content;if(content){streamTiming.record(now);if(first===null)first=now;}}
   if(event==='reasoning.delta'){const content=typeof data.content==='string'?data.content:'';thought+=content;if(content){streamTiming.record(now);if(first===null)first=now;}}
   if(event==='error')error=data.error?.message||'LM Studio stream error';
   if(event==='chat.end'){ended=true;const result=data.result;rawStats=result?.stats??{};if(Array.isArray(result?.output)){output=result.output.filter((x:any)=>x.type==='message').map((x:any)=>x.content).join('\n');thought=result.output.filter((x:any)=>x.type==='reasoning').map((x:any)=>x.content).join('\n');}}
  };
  try{while(true){const {done,value}=await reader.read();if(done){decoder.feed(new Uint8Array(),true).forEach(accept);break;}decoder.feed(value).forEach(accept);}}finally{reader.releaseLock();}
  if(error)throw Error(error);
  if(!ended)throw Error(`Stream disconnected before final statistics after ${output.length+thought.length} characters. LM Studio ended the response early; when this happens on every slot of a concurrency level, the shared context budget ran out. See the LM Studio server log.`);
 }catch(e){status=signal.aborted?'cancelled':timed.aborted?'timeout':'failed';error=(e as Error).message;}
 const measured=metrics(rawStats,performance.now()-began,start,end,first,streamTiming.summary(typeof rawStats.total_output_tokens==='number'?rawStats.total_output_tokens:null,status==='completed'));
 return {output,reasoning:thought,rawStats,metrics:measured,status,error,possibleTruncation:typeof rawStats.total_output_tokens==='number'&&rawStats.total_output_tokens>=maxTokens};
}
// Compatible servers own model loading and report only statistics they expose.
async function inferCompatible(settings:Settings,instance:string,prompt:string,maxTokens:number,temperature:number,reasoning:string,signal:AbortSignal,image?:string):Promise<Inference>{
 const began=performance.now(),timed=AbortSignal.timeout(settings.timeoutSec*1000),combined=AbortSignal.any([signal,timed]);
 let output='',thought='',first:number|null=null,ended=false,finish:string|null=null,error:string|undefined,status:Inference['status']='completed';const streamTiming=new StreamTiming();
 let usage:Record<string,any>={},timings:Record<string,unknown>={};
 try{
  if(reasoning!=='default')throw Error('This endpoint uses its server reasoning defaults. Select Model default.');
  if(image&&!image.startsWith('data:image/'))throw Error('A benchmark image must be a local data URL.');
  const content=image?[{type:'text',text:prompt},{type:'image_url',image_url:{url:image}}]:prompt;
  const response=await fetch(validateUrl(settings.baseUrl)+'/v1/chat/completions',{redirect:'error',method:'POST',headers:{'Content-Type':'application/json',...(settings.token?{Authorization:`Bearer ${settings.token}`}:{})},body:JSON.stringify({model:instance,messages:[{role:'user',content}],stream:true,stream_options:{include_usage:true},temperature,max_tokens:maxTokens}),signal:combined});
  if(!response.ok)throw Error(`${providerLabel(settings.provider)} HTTP ${response.status}: ${(await response.text()).slice(0,1600)}`);
  if(!response.body)throw Error('Missing response stream');
  const decoder=new SSEDecoder(),reader=response.body.getReader();
  const accept=({data}:{data:any})=>{
   if(data.error)throw Error(data.error.message||'Endpoint stream error');
   if(data.usage)usage=data.usage;
   if(data.timings)timings=data.timings;
   for(const choice of data.choices??[]){
    if(choice.index!==undefined&&choice.index!==0)continue;
    const delta=choice.delta??{};
    if(typeof delta.content==='string')output+=delta.content;
    const reasoningText=delta.reasoning_content??delta.reasoning;
    if(typeof reasoningText==='string')thought+=reasoningText;
    if((typeof delta.content==='string'&&delta.content.length>0)||(typeof reasoningText==='string'&&reasoningText.length>0)){
     const now=performance.now()-began;streamTiming.record(now);if(first===null)first=now;
    }
    if(choice.finish_reason){ended=true;finish=choice.finish_reason;}
   }
  };
  try{while(true){const {done,value}=await reader.read();if(done){decoder.feed(new Uint8Array(),true).forEach(accept);break;}decoder.feed(value).forEach(accept);}}finally{reader.releaseLock();}
  if(!ended)throw Error('The endpoint stream disconnected before a finish reason was received.');
 }catch(e){status=signal.aborted?'cancelled':timed.aborted?'timeout':'failed';error=(e as Error).message;}
 const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 const stats={input_tokens:number(usage.prompt_tokens),total_output_tokens:number(usage.completion_tokens),reasoning_output_tokens:number(usage.completion_tokens_details?.reasoning_tokens),tokens_per_second:number(timings.predicted_per_second)};
 const measured=metrics(stats,performance.now()-began,null,null,first,streamTiming.summary(number(usage.completion_tokens),status==='completed'));
 measured.ttftMs=first;
 measured.prefillMs=number(timings.prompt_ms);
 measured.prefillTps=number(timings.prompt_per_second);
 measured.prefillMethod=measured.prefillMs===null?'Unavailable: endpoint did not report prompt processing timing':'Server-reported prompt processing timing';
 measured.cacheNote='TTFT is client-observed first content (including reasoning). Server caching, queueing, and stream buffering may affect timings. Missing token counts and generation speed remain unavailable.';
 return {output,reasoning:thought,metrics:measured,rawStats:{usage,timings,finish_reason:finish},status,error,possibleTruncation:finish==='length'};
}
