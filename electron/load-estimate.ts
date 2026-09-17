import type {Model,Settings} from '../src/types';
import type {cli} from './lmstudio';
import {cacheScalePair} from '../src/cache-quant';
import type {CacheQuant} from '../src/cache-quant';
import {readableCliError} from './cli-output';

// Why a load failed, in terms of the settings that caused it.
//
// When LM Studio cannot fit a model it says so in its own words, which name no setting this app
// controls. A run that asked for four concurrent requests at 8192 context was really asking for a
// 32768-token cache, and the message that comes back does not mention concurrency, context, or the
// cache at all — so the obvious reading is "this model is too big", when the model was fine and
// the highest concurrency level was what did not fit.
//
// None of this changes whether a load succeeds. It changes what the run log says when one does not.

export type LoadEstimate={gpuGiB:number|null;totalGiB:number|null;confidence:string;verdict:string};

// `lms load --estimate-only` prints a short block rather than JSON. Anything it does not print is
// left null rather than defaulted, because a wrong number here would be worse than no number.
export function parseEstimate(text:string):LoadEstimate{
 const clean=readableCliError(text);
 const gib=(label:string)=>{
  const m=clean.match(new RegExp(label+'\\s*:?\\s*([\\d.,]+)\\s*(GiB|MiB|GB|MB)','i'));
  if(!m)return null;
  const n=Number(m[1].replace(/,/g,''));
  if(!Number.isFinite(n))return null;
  return /MiB|MB/i.test(m[2])?n/1024:n;
 };
 return {
  gpuGiB:gib('Estimated GPU Memory'),
  totalGiB:gib('Estimated Total Memory'),
  confidence:(clean.match(/Confidence:\s*([A-Za-z]+)/i)?.[1]??'unreported').toUpperCase(),
  verdict:clean.match(/Estimate:\s*([^.]+\.)/i)?.[1]?.trim()??'',
 };
}

// Whether a failed load looks like it ran out of room, as opposed to the many other reasons a load
// fails — a missing prediction head, a bad flag, a model LM Studio cannot parse. Memory advice on
// one of those would be confidently wrong, and would send someone to lower a context length that
// was never the problem. When in doubt this says no and the error is passed through untouched.
export function looksLikeMemory(message:string):boolean{
 const text=String(message??'');
 if(/draft model|draft mtp|projector|mmproj|unknown option|unrecognized/i.test(text))return false;
 return /out of memory|insufficient|not enough|no ?t? ?fit|does not fit|cannot fit|too large|allocat\w*fail|failed to allocate|vram|guardrail|resource/i.test(text);
}

export async function estimateLoad(settings:Settings,run:typeof cli,key:string,context:number,parallel:number,signal?:AbortSignal):Promise<LoadEstimate|null>{
 try{return parseEstimate(await run(settings,['load',key,'--context-length',String(context),'--parallel',String(parallel),'--estimate-only','--yes'],signal));}
 catch{return null;} // A diagnostic that cannot be taken is not itself a failure.
}

const gib=(bytes:number)=>bytes/1024**3;

// The arithmetic the run already did, said out loud, plus the three levers that change it. The
// cache figure is the one most worth naming: it is the only term that grows with concurrency, and
// it is the one nobody expects, because the run asked for 8192 and got four times that.
export function loadAdvice(model:Model,context:number,parallel:number,cacheK:CacheQuant='off',cacheV:CacheQuant='off',estimate?:LoadEstimate|null):string{
 const total=context*parallel;
 const parts:string[]=[];
 parts.push(`This load asked for ${total.toLocaleString()} context tokens: ${context.toLocaleString()} per request × ${parallel} parallel slot${parallel===1?'':'s'}, because LM Studio serves every slot from one shared cache and the run's highest concurrency level is ${parallel}.`);
 if(model.size_bytes>0)parts.push(`The weights are ${gib(model.size_bytes).toFixed(2)} GiB; the key/value cache is on top of that and is the part that grows with concurrency.`);
 if(estimate?.gpuGiB!=null)parts.push(`LM Studio estimated ${estimate.gpuGiB.toFixed(2)} GiB of GPU memory for it${estimate.confidence!=='unreported'?` (its own confidence: ${estimate.confidence.toLowerCase()})`:''}.`);
 const quantised=cacheK!=='off'||cacheV!=='off';
 parts.push('Three things change it: lower the context length, drop the highest concurrency level'
  +(quantised
   ?`, or quantize the cache further — it is currently at about ${Math.round(cacheScalePair(cacheK,cacheV)*100)}% of an f16 cache.`
   :', or quantize the context (KV cache) — q8_0 roughly halves it and q4_0 roughly quarters it, which is often the difference between a model that fits and one that spills into system RAM at a fraction of the speed.'));
 return parts.join(' ');
}
