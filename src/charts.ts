import type { summaries } from '../electron/export';
import type { GpuTick } from './types';
export type ChartRow = ReturnType<typeof summaries>[number];
export type ScoreSource = 'objective'|'localJudge'|'externalJudge';
export const scoreLabels:Record<ScoreSource,string>={objective:'Objective score',localJudge:'Local judge score',externalJudge:'External review score'};
export const escapeHtml=(s:unknown)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fmt=(n:number)=>n.toLocaleString('en-US',{maximumFractionDigits:n<1?2:1});
export function colorFor(key:string){let hash=0;for(const c of key)hash=(Math.imul(hash,31)+c.charCodeAt(0))|0;return `hsl(${Math.abs(hash)%360}, 65%, 72%)`;}
type Metric='generationTps'|'estimatedPrefillTps'|'throughput'|'ttftMs'|'medianMs'|'p95Ms'|'failureRate'|ScoreSource;
export type ChartSpec={key:Metric|'scatter';title:string;unit:string;description:string;scale?:number;fixedMax?:number};
// What the horizontal axis counts. Concurrency is the historical answer and stays the default, but
// an MTP sweep at a single concurrency level has nothing to spread along it: every depth lands on
// the same x and the series stack on one vertical line. Depth is the axis that run varies.
export type XAxis='concurrency'|'mtpDepth';
export const xAxisLabels:Record<XAxis,string>={concurrency:'Concurrent requests',mtpDepth:'Maximum predictions (0 = MTP off)'};
// A row from a run that measured no depth sits at 0, which is where "MTP off" belongs anyway.
export const xValueOf=(r:ChartRow,axis:XAxis):number=>axis==='mtpDepth'?(r.mtpDepth??0):r.concurrency;
export function chartSpecs(score:ScoreSource):ChartSpec[]{return [
 {key:'generationTps',title:'Generation speed',unit:'Tokens / second',description:'Average speed per successful request. Higher is faster.'},
 {key:'estimatedPrefillTps',title:'Estimated prefill speed',unit:'Tokens / second',description:'Client-timed prompt processing; caching and buffering can affect this estimate.'},
 {key:'throughput',title:'Total throughput',unit:'Tokens / second',description:'Average completed output tokens per wave second, including time spent on failures.'},
 {key:score,title:scoreLabels[score],unit:'Score / 100',description:'Average of scored responses only. Unscored responses are not counted as zero.',fixedMax:100},
 {key:'ttftMs',title:'Time to first token',unit:'Seconds',description:'Average server-reported wait for the first token. Lower is faster.',scale:.001},
 {key:'medianMs',title:'Typical response time',unit:'Seconds',description:'Median successful request duration at each concurrency. Lower is faster.',scale:.001},
 {key:'p95Ms',title:'Slow response time (p95)',unit:'Seconds',description:'95th-percentile successful request duration. Small sample sizes make this unstable.',scale:.001},
 {key:'failureRate',title:'Request failure rate',unit:'Failed requests (%)',description:'Failed, timed-out, or cancelled measured requests. Lower is better.',scale:100,fixedMax:100},
 {key:'scatter',title:'Speed vs. quality',unit:scoreLabels[score],description:'Generation speed versus the selected quality score; each point is a model/concurrency pair.'}
];}
const start=(label:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 290" role="img" aria-label="${escapeHtml(label)}"><style>text{font:12px 'Segoe UI',sans-serif;fill:#aab9bf}.grid{stroke:#334149;stroke-dasharray:3 5}.point{cursor:help}</style>`;
const empty=(label:string)=>`${start(label)}<text x="300" y="132" text-anchor="middle">No measurements available yet</text><text x="300" y="158" text-anchor="middle">Missing values are not plotted as zero.</text></svg>`;
export function renderChart(rows:ChartRow[],spec:ChartSpec,score:ScoreSource='objective',xAxis:XAxis='concurrency'):string{
 const scatter=spec.key==='scatter';
 const val=(r:ChartRow):number|null=>{const n=scatter?r[score]:r[spec.key as Metric];return typeof n==='number'&&Number.isFinite(n)?n*(spec.scale??1):null;};
 const usable=rows.filter(r=>val(r)!==null&&(!scatter||r.generationTps!==null));
 if(!usable.length)return empty(spec.title);
 const yMax=scatter?100:spec.fixedMax??Math.max(1,...usable.map(r=>val(r)!*1.08));
 const allXs=[...new Set(rows.map(r=>xValueOf(r,xAxis)))].sort((a,b)=>a-b);
 const xMin=scatter?0:Math.min(...allXs),xMax=scatter?Math.max(1,...usable.map(r=>r.generationTps!))*1.08:Math.max(...allXs);
 const x=(v:number)=>xMax===xMin?320:72+(v-xMin)/(xMax-xMin)*496;
 const y=(v:number)=>230-v/yMax*184;
 let svg=start(spec.title)+`<text x="72" y="20">${escapeHtml(scatter?scoreLabels[score]:spec.unit)}</text>`;
 for(const t of [0,.25,.5,.75,1])svg+=`<line class="grid" x1="72" x2="568" y1="${y(t*yMax)}" y2="${y(t*yMax)}"/><text x="60" y="${y(t*yMax)+4}" text-anchor="end">${fmt(t*yMax)}</text>`;
 // Limit labels to a readable subset without changing numeric axis spacing.
 const ticks=scatter?[0,.25,.5,.75,1].map(t=>t*xMax):allXs.filter((_,i)=>allXs.length<=8||i===allXs.length-1||i%Math.ceil(allXs.length/7)===0);
 for(const t of ticks)svg+=`<text x="${x(t)}" y="250" text-anchor="middle">${fmt(t)}</text>`;
 svg+=`<text x="320" y="278" text-anchor="middle">${scatter?'Generation tokens / second':xAxisLabels[xAxis]}</text>`;
 const keys=[...new Set(rows.map(r=>r.modelKey))].sort();
 keys.forEach((key,i)=>{
  const rs=rows.filter(r=>r.modelKey===key).sort((a,b)=>xValueOf(a,xAxis)-xValueOf(b,xAxis)),color=colorFor(key);
  let segment:string[]=[];
  const flush=()=>{if(segment.length>1)svg+=`<polyline points="${segment.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" ${i%2?'stroke-dasharray="7 3"':''}/>`;segment=[];};
  if(!scatter){for(const r of rs){const v=val(r);if(v===null){flush();continue;}segment.push(`${x(xValueOf(r,xAxis))},${y(v)}`);}flush();}
  for(const r of rs){const v=val(r);if(v===null||(scatter&&r.generationTps===null))continue;const cx=x(scatter?r.generationTps!:xValueOf(r,xAxis)),cy=y(v);const title=`${r.modelKey} • ${xAxis==='mtpDepth'?(r.mtpDepth?`${r.mtpDepth} draft token${r.mtpDepth===1?'':'s'}`:'MTP off')+` • concurrency ${r.concurrency}`:`concurrency ${r.concurrency}`} • ${scatter?fmt(r.generationTps!)+' tok/s • ':''}${fmt(v)} ${scatter?'score':spec.unit} • ${r.requests} requests, ${r.failures} failures`;
   svg+=`<circle class="point" cx="${cx}" cy="${cy}" r="${scatter?6:4.5}" fill="${color}" stroke="#141c20" stroke-width="1.5" tabindex="0" role="button" data-model="${escapeHtml(r.modelKey)}" data-concurrency="${r.concurrency}" data-mtp-depth="${r.mtpDepth??''}" data-tooltip="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title></circle>`;
  }
 });return svg+'</svg>';
}
export function legendHtml(rows:ChartRow[]){return [...new Set(rows.map(r=>r.modelKey))].sort().map(key=>`<span><i style="background:${colorFor(key)}"></i>${escapeHtml(key)}</span>`).join('');}

export const gpuSeriesColors:Record<string,string>={tempHotSpot:'hsl(14, 78%, 68%)',tempCore:'hsl(192, 72%, 66%)',tempMemory:'hsl(276, 58%, 74%)',load:'hsl(152, 45%, 62%)'};
// Temperatures and core load share one 0-100 axis: both are percentages of a comparable ceiling,
// which keeps throttling visible against load without a second scale. Board power stays in the table.
export function gpuTimelineChart(series:GpuTick[]){
 const points=series.filter(p=>Number.isFinite(p.t));
 if(points.length<2)return '<p class="hint">Not enough GPU readings to draw a timeline.</p>';
 const width=1200,height=260,left=48,right=18,top=16,bottom=32;
 const first=points[0].t,last=points[points.length-1].t,span=Math.max(1,last-first);
 const observed=points.flatMap(p=>[p.tempCore,p.tempHotSpot,p.tempMemory]).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 const maxY=Math.max(100,Math.ceil((Math.max(0,...observed)+5)/10)*10);
 const x=(t:number)=>left+(t-first)/span*(width-left-right);
 const y=(v:number)=>top+(1-Math.min(v,maxY)/maxY)*(height-top-bottom);
 const path=(key:'tempCore'|'tempHotSpot'|'tempMemory'|'load',dashed=false)=>{
  const segments:string[][]=[];let current:string[]=[];
  for(const point of points){const value=point[key];
   if(typeof value==='number'&&Number.isFinite(value))current.push(`${x(point.t).toFixed(1)},${y(value).toFixed(1)}`);
   else if(current.length){segments.push(current);current=[];}}
  if(current.length)segments.push(current);
  return segments.filter(s=>s.length>1).map(s=>`<polyline points="${s.join(' ')}" fill="none" stroke="${gpuSeriesColors[key]}" stroke-width="${dashed?1.4:2}" stroke-linejoin="round" stroke-linecap="round"${dashed?' stroke-dasharray="4 4"':''}/>`).join('');
 };
 const ticks=[0,0.25,0.5,0.75,1].map(f=>{const value=maxY*f,cy=y(value);return `<line x1="${left}" x2="${width-right}" y1="${cy}" y2="${cy}" stroke="#344048" stroke-width="1"/><text x="${left-8}" y="${cy+4}" text-anchor="end" font-size="11" fill="#8fa3ab">${Math.round(value)}</text>`;}).join('');
 const minutes=(last-first)/60000;
 const axis=`<text x="${left}" y="${height-8}" font-size="11" fill="#8fa3ab">Run start</text><text x="${width-right}" y="${height-8}" text-anchor="end" font-size="11" fill="#8fa3ab">${minutes>=1?minutes.toFixed(minutes<10?1:0)+' min':Math.round((last-first)/1000)+' s'}</text>`;
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="GPU temperature and load over the run"><title>GPU temperature and load over the run</title>${ticks}${axis}${path('load',true)}${path('tempMemory')}${path('tempCore')}${path('tempHotSpot')}</svg>`;
}
export function gpuLegendHtml(){return [['tempHotSpot','Hot spot °C'],['tempCore','Core °C'],['tempMemory','Memory °C'],['load','Core load %']].map(([key,label])=>`<span><i style="background:${gpuSeriesColors[key]}"></i>${escapeHtml(label)}</span>`).join('');}
