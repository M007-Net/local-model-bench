import type { GpuStats, Metrics, Sample, Wave, StreamingMetrics } from '../src/types';
export type {StreamingMetrics} from '../src/types';
export const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;

export interface StreamTimelineBucket {
 /** Window start in milliseconds relative to the first recorded stream event. */
 startMs:number;
 textEvents:number;
 reasoningEvents:number;
}
export interface StreamTimeline {
 buckets:StreamTimelineBucket[];
 bucketWidthMs:1000;
 durationMs:number;
 truncatedEvents:number;
 method:string;
 provenance:string;
 uncertainty:string;
}

/** Counts client-observed text/reasoning events in 1-second windows. Retains at most
 * 512 windows; later events are counted as truncated instead of growing memory.
 */
export class StreamTimelineTiming {
 private first:number|null=null;
 private last:number|null=null;
 private buckets:StreamTimelineBucket[]=[];
 private truncated=0;
 record(atMs:number,kind:'text'|'reasoning'){
  if(!Number.isFinite(atMs)||atMs<0)return;
  if(this.first===null)this.first=atMs;
  if(this.last!==null&&atMs<this.last)return;
  this.last=atMs;
  const index=Math.floor((atMs-this.first)/1000);
  if(index>=512){this.truncated++;return;}
  while(this.buckets.length<=index)this.buckets.push({startMs:this.buckets.length*1000,textEvents:0,reasoningEvents:0});
  if(kind==='text')this.buckets[index].textEvents++;
  else this.buckets[index].reasoningEvents++;
 }
 summary():StreamTimeline{
  return {
   buckets:this.buckets.map(bucket=>({...bucket})),
   bucketWidthMs:1000,
   durationMs:this.first===null||this.last===null?0:this.last-this.first,
   truncatedEvents:this.truncated,
   method:'Client-observed SSE text/reasoning event counts grouped into 1-second windows relative to the first event; at most 512 buckets are retained.',
   provenance:'Client-side stream parser event observations.',
   uncertainty:'Counts stream events, not tokens or generated text volume. Provider buffering, chunk coalescing, and excluded or unrecognized event types can change counts. Events after the first 512 seconds are counted as truncated.',
  };
 }
}

// A fixed logarithmic histogram keeps stream timing bounded even for very long generations.
// Mean and maximum are exact; percentile values are approximate to a 1/32-octave bucket.
const GAP_BUCKETS=2048, GAP_BUCKET_OFFSET=1024, GAP_BUCKET_STEPS=32;
export class StreamTiming {
 private first:number|null=null; private last:number|null=null; private events=0; private gaps=0;
 private gapTotal=0; private gapMax:number|null=null; private buckets=new Uint32Array(GAP_BUCKETS);
 record(atMs:number){
  if(!Number.isFinite(atMs))return;
  if(this.first===null)this.first=atMs;
  if(this.last!==null){const gap=Math.max(0,atMs-this.last);this.gaps++;this.gapTotal+=gap;this.gapMax=this.gapMax===null?gap:Math.max(this.gapMax,gap);
   const raw=Math.floor(Math.log2(Math.max(gap,Number.MIN_VALUE))*GAP_BUCKET_STEPS)+GAP_BUCKET_OFFSET;
   this.buckets[Math.max(0,Math.min(GAP_BUCKETS-1,raw))]++;
  }
  this.last=atMs;this.events++;
 }
 private percentile(p:number){if(!this.gaps)return null;if(this.gapMax===0)return 0;const target=Math.ceil(p*this.gaps);let seen=0;for(let i=0;i<this.buckets.length;i++){seen+=this.buckets[i];if(seen>=target)return Math.min(this.gapMax!,2**((i-GAP_BUCKET_OFFSET+0.5)/GAP_BUCKET_STEPS));}return this.gapMax;}
 summary(outputTokens:number|null,completed:boolean,timeline?:StreamTimeline):StreamingMetrics{
  const rateEstimate=completed&&outputTokens!==null&&outputTokens>1&&this.events>=2&&this.first!==null&&this.last!==null
   ?(this.last-this.first)/(outputTokens-1):null;
  return {firstEventMs:this.first,lastEventMs:this.last,eventCount:this.events,gapCount:this.gaps,
   meanGapMs:this.gaps?this.gapTotal/this.gaps:null,p95GapMs:this.percentile(.95),p99GapMs:this.percentile(.99),maxGapMs:this.gapMax,tpotMs:rateEstimate,
   method:'Client-observed generated-text/reasoning SSE event gaps; mean/max exact, p95/p99 approximate from a bounded 1/32-octave histogram. Events may contain multiple tokens, so gaps are not exact token inter-token latency. TPOT estimates from event span divided by reported output tokens minus one; reasoning-token inclusion depends on provider accounting.',...(timeline?{timeline}:{})};
 }
}
export function clientDecodeEstimate(tokens:number|null,stream:StreamingMetrics|undefined,completed:boolean):number|null{
 if(!completed||tokens===null||tokens<=1||!stream||stream.eventCount<2||stream.firstEventMs===null||stream.lastEventMs===null)return null;
 const elapsed=stream.lastEventMs-stream.firstEventMs;
 return elapsed>0?(tokens-1)/(elapsed/1000):null;
}
export function metrics(stats:Record<string,unknown>,durationMs:number,start:number|null,end:number|null,firstContentMs:number|null,streaming?:StreamingMetrics):Metrics{
 const input=finite(stats.input_tokens),cached=finite(stats.cached_input_tokens)??finite(stats.cached_prompt_tokens),elapsed=start!==null&&end!==null&&end>start?end-start:null;
 const decode=finite(stats.tokens_per_second);
 return {inputTokens:input,cachedInputTokens:cached,newInputTokens:input!==null&&cached!==null&&cached<=input?input-cached:null,cacheAccountingMethod:cached===null?'Unavailable: endpoint did not report cached input tokens':'Endpoint-reported cached input tokens',outputTokens:finite(stats.total_output_tokens),reasoningTokens:finite(stats.reasoning_output_tokens),generationTps:decode,generationMethod:decode===null?'Unavailable: endpoint did not report decode speed':'Endpoint-reported decode speed',prefillTps:input!==null&&input>0&&elapsed!==null&&elapsed>=5?input/(elapsed/1000):null,prefillMs:elapsed,ttftMs:finite(stats.time_to_first_token_seconds)===null?null:Number(stats.time_to_first_token_seconds)*1000,durationMs,firstContentMs,prefillMethod:elapsed!==null&&elapsed>=5?'Client-timed prompt-processing events (estimate; includes request overhead)':'Unavailable: missing or too-short prompt-processing interval',cacheNote:'Input tokens include formatting; cache reuse and stream buffering are not observable unless cached-input usage is explicitly reported. This is not engine-level uncached prefill speed.',...(streaming?{streaming}:{})};
}
export function waveMetrics(id:string,runId:string,modelKey:string,testId:string,concurrency:number,durationMs:number,samples:Sample[],gpu:GpuStats|null=null,draft:Wave['draft']=null):Wave{
 const good=samples.filter(s=>s.status==='completed');const tokens=good.every(s=>s.metrics.outputTokens!==null)?good.reduce((n,s)=>n+s.metrics.outputTokens!,0):null;
 // The MTP depth comes from the requests the wave is made of rather than being passed in, so a
 // wave can never disagree with the responses it summarises about which depth produced them.
 const depth=samples[0]?.mtpTokens;
 return {id,runId,modelKey,testId,concurrency,durationMs,outputTokens:tokens,throughput:tokens!==null&&durationMs>0?tokens/(durationMs/1000):null,completed:good.length,failed:samples.length-good.length,gpu,...(draft?{draft}:{}),...(typeof depth==='number'?{mtpTokens:depth}:{})};
}
export function percentile(values:number[],p:number){if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(p*sorted.length)-1)];}
export function average(values:(number|null)[]){const xs=values.filter((v):v is number=>v!==null&&Number.isFinite(v));return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;}
