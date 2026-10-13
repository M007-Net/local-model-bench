import {harnessReasoningWire,type HarnessConfig,type TrialMetrics} from '../src/harness';
import type {Settings} from '../src/types';
import {validateUrl} from '../src/endpoint';
export function relayBody(raw:unknown,model:string,c:HarnessConfig){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid inference request');const r=raw as Record<string,unknown>;
 if(r.model!==model&&r.model!==`openai/${model}`)throw Error('Harness requested a different model');
 if(!Array.isArray(r.messages)||r.messages.length>1000)throw Error('Invalid message list');
 if(JSON.stringify(r).length>2_000_000)throw Error('Inference request too large');
 // No user-controlled endpoint, credentials, fallback models, or proxy headers.
 const body:Record<string,unknown>={model,messages:r.messages,temperature:c.temperature,max_tokens:c.maxTokens,stream:false};
 for(const key of ['tools','tool_choice','parallel_tool_calls','response_format'] as const)if(r[key]!==undefined)body[key]=r[key];
 const reasoning=harnessReasoningWire(c.reasoning);if(reasoning!==undefined)body.reasoning_effort=reasoning;
 return body;
}
export function recordUsage(m:TrialMetrics,data:any){
 const u=data?.usage;
 if(!u||!Number.isSafeInteger(u.prompt_tokens)||u.prompt_tokens<0||!Number.isSafeInteger(u.completion_tokens)||u.completion_tokens<0){m.inputTokens=null;m.outputTokens=null;m.totalTokens=null;m.tokenSource='unavailable';return;}
 if(m.tokenSource==='unavailable')return;
 m.inputTokens!+=u.prompt_tokens;m.outputTokens!+=u.completion_tokens;m.totalTokens=m.inputTokens!+m.outputTokens!;
}
export async function relayInference(settings:Settings,body:Record<string,unknown>,signal:AbortSignal){
 const res=await fetch(validateUrl(settings.baseUrl)+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',...(settings.token?{Authorization:`Bearer ${settings.token}`}:{})},body:JSON.stringify(body),redirect:'error',signal});
 const reader=res.body?.getReader();if(!reader)throw Error('Missing inference response body');const chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2_000_000){await reader.cancel();throw Error('Inference response too large');}chunks.push(value);}}finally{reader.releaseLock();}
 const text=Buffer.concat(chunks).toString('utf8');
 if(!res.ok)throw Error(`Inference HTTP ${res.status}: ${text.slice(0,1000)}`);
 const result=JSON.parse(text);
 if(result.model!==body.model)throw Error('Inference response model identity differs from selected instance');
 if(!Array.isArray(result.choices)||!result.choices[0]?.message)throw Error('Invalid OpenAI chat response');return result;
}
