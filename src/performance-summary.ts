import type {Sample} from './types';
const values=(xs:(number|null|undefined)[])=>xs.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0);
export function quantile(xs:number[],p:number){if(!xs.length)return null;return [...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];}
const mean=(xs:(number|null|undefined)[])=>{const ns=values(xs);return ns.length?ns.reduce((a,b)=>a+b,0)/ns.length:null;};
export function performanceSummary(samples:Sample[]){
 const ok=samples.filter(s=>!s.warmup&&s.status==='completed');
 const first=values(ok.map(s=>s.metrics.streaming?.firstEventMs));
 const streams=ok.flatMap(s=>s.metrics.streaming?[s.metrics.streaming]:[]);
 const gaps=streams.filter(s=>s.gapCount>0&&s.meanGapMs!==null),count=gaps.reduce((n,s)=>n+s.gapCount,0);
 const worst=values(streams.map(s=>s.maxGapMs));
 return {
  inputTokensMean:mean(ok.map(s=>s.metrics.inputTokens)),
  streamingRequests:first.length,
  firstEventP50Ms:quantile(first,.5),firstEventP95Ms:quantile(first,.95),firstEventP99Ms:quantile(first,.99),
  requestP99Ms:quantile(ok.map(s=>s.metrics.durationMs),.99),
  meanStreamGapMs:count?gaps.reduce((n,s)=>n+s.meanGapMs!*s.gapCount,0)/count:null,
  worstStreamGapMs:worst.length?Math.max(...worst):null,
  estimatedTpotMs:mean(streams.map(s=>s.tpotMs)),
 };
}
