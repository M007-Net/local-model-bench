import type { GpuStats, Metrics, Sample, Wave } from '../src/types';
export const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export function metrics(stats:Record<string,unknown>,durationMs:number,start:number|null,end:number|null,firstContentMs:number|null):Metrics{
 const input=finite(stats.input_tokens),elapsed=start!==null&&end!==null&&end>start?end-start:null;
 return {inputTokens:input,outputTokens:finite(stats.total_output_tokens),reasoningTokens:finite(stats.reasoning_output_tokens),generationTps:finite(stats.tokens_per_second),prefillTps:input!==null&&input>0&&elapsed!==null&&elapsed>=5?input/(elapsed/1000):null,prefillMs:elapsed,ttftMs:finite(stats.time_to_first_token_seconds)===null?null:Number(stats.time_to_first_token_seconds)*1000,durationMs,firstContentMs,prefillMethod:elapsed!==null&&elapsed>=5?'Client-timed prompt-processing events (estimate)':'Unavailable: missing or too-short prompt-processing interval',cacheNote:'Input tokens include formatting; cache reuse and stream buffering are not observable. This is not engine-level uncached prefill speed.'};
}
export function waveMetrics(id:string,runId:string,modelKey:string,testId:string,concurrency:number,durationMs:number,samples:Sample[],gpu:GpuStats|null=null):Wave{
 const good=samples.filter(s=>s.status==='completed');const tokens=good.every(s=>s.metrics.outputTokens!==null)?good.reduce((n,s)=>n+s.metrics.outputTokens!,0):null;
 return {id,runId,modelKey,testId,concurrency,durationMs,outputTokens:tokens,throughput:tokens!==null&&durationMs>0?tokens/(durationMs/1000):null,completed:good.length,failed:samples.length-good.length,gpu};
}
export function percentile(values:number[],p:number){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];}
export function average(values:(number|null)[]){const xs=values.filter((v):v is number=>v!==null&&Number.isFinite(v));return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
