import type {Sample} from './types';
const values=(xs:(number|null|undefined)[])=>xs.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0);
export function quantile(xs:number[],p:number){if(!xs.length)return null;return [...xs].sort((a,b)=>a-b)[Math.max(0,Math.ceil(xs.length*p)-1)];}
const mean=(xs:(number|null|undefined)[])=>{const ns=values(xs);return ns.length?ns.reduce((a,b)=>a+b,0)/ns.length:null;};
const spread=(xs:(number|null|undefined)[])=>{const ns=values(xs);if(ns.length<2)return {n:ns.length,missing:xs.length-ns.length,mean:ns.length?mean(ns):null,sd:null as number|null,cv:null as number|null};const m=mean(ns)!;const sd=Math.sqrt(ns.reduce((s,x)=>s+(x-m)**2,0)/(ns.length-1));return {n:ns.length,missing:xs.length-ns.length,mean:m,sd,cv:m!==0?sd/Math.abs(m):null};};
export function performanceSummary(samples:Sample[]){
 const ok=samples.filter(s=>!s.warmup&&s.status==='completed');
 const first=values(ok.map(s=>s.metrics.streaming?.firstEventMs));
 const streams=ok.flatMap(s=>s.metrics.streaming?[s.metrics.streaming]:[]);
 const gen=spread(ok.map(s=>s.metrics.generationTps)),clientGen=spread(ok.map(s=>s.metrics.clientGenerationTps)),prefill=spread(ok.map(s=>s.metrics.prefillTps)),latency=spread(ok.map(s=>s.metrics.durationMs));
 const sources=(kind:'generation'|'prefill')=>{const counts=new Map<string,number>();for(const s of ok){const m=s.metrics,label=kind==='generation'?(m.generationMethod??(m.generationTps!==null?'Legacy saved result: source unspecified':'Unavailable')):m.prefillMethod|| (m.prefillTps!==null?'Legacy saved result: source unspecified':'Unavailable');counts.set(label,(counts.get(label)??0)+1);}return [...counts].map(([label,n])=>`${label} (n=${n})`).join('; ')||'Unavailable';};
 const gaps=streams.filter(s=>s.gapCount>0&&s.meanGapMs!==null),count=gaps.reduce((n,s)=>n+s.gapCount,0);
 const worst=values(streams.map(s=>s.maxGapMs));
 return {
  generationN:gen.n,generationMissing:gen.missing,generationMean:gen.mean,generationSd:gen.sd,generationCv:gen.cv,
  generationMethods:sources('generation'),
  clientGenerationN:clientGen.n,clientGenerationMissing:clientGen.missing,clientGenerationMean:clientGen.mean,clientGenerationSd:clientGen.sd,clientGenerationCv:clientGen.cv,
  prefillN:prefill.n,prefillMissing:prefill.missing,prefillMean:prefill.mean,prefillSd:prefill.sd,prefillCv:prefill.cv,
  prefillMethods:sources('prefill'),
  latencyN:latency.n,latencyMissing:latency.missing,latencyMean:latency.mean,latencySd:latency.sd,latencyCv:latency.cv,
  inputTokensMean:mean(ok.map(s=>s.metrics.inputTokens)),
  streamingRequests:first.length,
  firstEventP50Ms:quantile(first,.5),firstEventP95Ms:quantile(first,.95),firstEventP99Ms:quantile(first,.99),
  requestP99Ms:quantile(ok.map(s=>s.metrics.durationMs),.99),
  meanStreamGapMs:count?gaps.reduce((n,s)=>n+s.meanGapMs!*s.gapCount,0)/count:null,
  worstStreamGapMs:worst.length?Math.max(...worst):null,
  estimatedTpotMs:mean(streams.map(s=>s.tpotMs)),
 };
}
