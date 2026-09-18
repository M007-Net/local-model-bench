// SVG builders for the agent sweep. They return plain strings so the desktop panel and the offline
// HTML report draw exactly the same picture from exactly the same numbers.
import {agenticStages,laneRows,peakPoint,stageColors,stageLabels,type AgenticPoint,type AgenticStage,type PointStats} from './agentic';
import {escapeHtml} from './charts';

const fmt=(n:number,d=1)=>n.toLocaleString('en-US',{maximumFractionDigits:d});
const seconds=(ms:number)=>`${fmt(ms/1000,ms<10000?2:1)} s`;
const AXIS_STYLE='<style>.ax{fill:#8b9aa0;font-size:11px}.pk{fill:#7fe7c4;font-size:12px}.scale-point{cursor:pointer}</style>';
const emptySvg=(width:number,height:number,label:string,message:string)=>
 `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}"><text x="${width/2}" y="${height/2}" text-anchor="middle" fill="#7d8c92" font-size="14">${escapeHtml(message)}</text></svg>`;

export function stageLegendHtml(active:AgenticStage[]){
 return agenticStages.map(stage=>{
  const picked=active.includes(stage);
  return `<button type="button" class="stage-chip${active.length&&!picked?' muted':''}${picked?' picked':''}" data-stage="${stage}" aria-pressed="${picked}"><i style="background:${stageColors[stage]}"></i>${escapeHtml(stageLabels[stage])}</button>`;
 }).join('');
}
export function staticStageLegendHtml(){
 return agenticStages.map(stage=>`<span><i style="background:${stageColors[stage]}"></i>${escapeHtml(stageLabels[stage])}</span>`).join('');
}

export type TimelineOptions={axisMaxMs:number;height?:number;highlight?:AgenticStage[];selectedTurn?:number|null};
export function timelineSvg(point:AgenticPoint|undefined,options:TimelineOptions){
 const width=1200,bottom=26,height=options.height??300,plot=height-bottom;
 if(!point||!point.turns.length)return emptySvg(width,height,'Worker timeline','No agent turns recorded for this worker count yet.');
 const rows=laneRows(point),axisMax=Math.max(1,options.axisMaxMs);
 const laneHeight=Math.max(3,Math.min(20,Math.floor(plot/Math.max(1,rows.length))));
 const gap=laneHeight>9?2:laneHeight>5?1:0,barHeight=Math.max(2,laneHeight-gap);
 const x=(ms:number)=>Math.max(0,Math.min(width,ms/axisMax*width));
 const grid=Array.from({length:21},(_,i)=>`<line x1="${(i/20*width).toFixed(1)}" x2="${(i/20*width).toFixed(1)}" y1="0" y2="${plot}" stroke="#1d2a31" stroke-width="1"/>`).join('');
 const highlight=options.highlight?.length?new Set(options.highlight):null;
 let bars='';
 rows.forEach((row,index)=>{
  const y=index*laneHeight;
  if(y+barHeight>plot)return;
  for(const turn of row.turns){
   const failed=turn.status!=='completed';
   const selected=options.selectedTurn===turn.index;
   for(const segment of turn.segments){
    const left=x(segment.start),right=x(segment.end),w=Math.max(0.7,right-left);
    const dim=highlight&&!highlight.has(segment.stage);
    const label=`Turn ${turn.index+1} · lane ${turn.lane+1} · ${stageLabels[segment.stage]} · ${seconds(segment.end-segment.start)} (starts ${seconds(segment.start)})`;
    bars+=`<rect class="turn-segment${dim?' dim':''}${selected?' picked':''}" x="${left.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="${barHeight}" fill="${stageColors[segment.stage]}" fill-opacity="${dim?0.16:failed?0.5:1}" data-turn="${turn.index}" data-stage="${segment.stage}" data-tooltip="${escapeHtml(label)}"><title>${escapeHtml(label)}</title></rect>`;
   }
   if(failed){const left=x(turn.start),right=x(turn.end);bars+=`<rect x="${left.toFixed(2)}" y="${y}" width="${Math.max(1,right-left).toFixed(2)}" height="${barHeight}" fill="none" stroke="#f87171" stroke-width="1"><title>${escapeHtml(`Turn ${turn.index+1} failed: ${turn.error??'unknown error'}`)}</title></rect>`;}
  }
 });
 const hidden=rows.length*laneHeight>plot?`<text class="ax" x="${width-6}" y="${plot-6}" text-anchor="end">${rows.length} lanes · some rows are outside this view</text>`:'';
 const axis=`<text class="ax" x="2" y="${height-8}">0 s</text><text class="ax" x="${width/2}" y="${height-8}" text-anchor="middle">${fmt(axisMax/2000,1)} s</text><text class="ax" x="${width-2}" y="${height-8}" text-anchor="end">${fmt(axisMax/1000,1)} s</text>`;
 return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Worker timeline of agent turns">${AXIS_STYLE}<g>${grid}</g>${bars}${hidden}${axis}</svg>`;
}

export type ScalingMetric='turnsPerMin'|'speedup'|'efficiency'|'wallMs'|'meanTurnMs';
export const scalingMetrics:Record<ScalingMetric,{title:string;unit:string;digits:number;scale:number;description:string}>={
 turnsPerMin:{title:'Throughput',unit:'agent turns / minute',digits:0,scale:1,description:'Completed turns per minute. The highest point is this machine’s ceiling for this workload.'},
 speedup:{title:'Speedup',unit:'× versus one worker',digits:2,scale:1,description:'Wall clock at one worker divided by wall clock here. Needs a one-worker point in the same sweep.'},
 efficiency:{title:'Efficiency',unit:'speedup per worker',digits:2,scale:1,description:'Speedup divided by worker count. 1.00 means every added worker still paid for itself. Slightly above 1.00 is real, not an error: with several workers busy, a large shared cache keeps the generated sources resident that a lone worker has to fetch from memory again.'},
 wallMs:{title:'Wall clock',unit:'seconds',digits:1,scale:0.001,description:'Time to finish the whole fixed set of agent turns.'},
 meanTurnMs:{title:'Mean turn',unit:'seconds',digits:2,scale:0.001,description:'Average time one agent turn took, including any time it spent queued behind other workers.'}
};
export type ScalingSeries={id:string;label:string;stats:PointStats[];active:boolean};
export function scalingSvg(series:ScalingSeries[],metric:ScalingMetric){
 const width=1200,height=360,left=66,right=150,top=28,bottom=46;
 const spec=scalingMetrics[metric];
 const value=(s:PointStats)=>{const raw=s[metric];return typeof raw==='number'&&Number.isFinite(raw)?raw*spec.scale:null;};
 const workers=[...new Set(series.flatMap(s=>s.stats.map(p=>p.workers)))].sort((a,b)=>a-b);
 const values=series.flatMap(s=>s.stats.map(value)).filter((v):v is number=>v!==null);
 if(!workers.length||!values.length)return emptySvg(width,height,`${spec.title} against worker count`,'No completed worker counts to plot yet.');
 const yMax=Math.max(...values)*1.15,yMin=0;
 const x=(w:number)=>workers.length<2?left:left+workers.indexOf(w)/(workers.length-1)*(width-left-right);
 const y=(v:number)=>top+(1-(v-yMin)/Math.max(1e-9,yMax-yMin))*(height-top-bottom);
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(spec.title)} against worker count">${AXIS_STYLE}`;
 svg+=`<text class="ax" x="${left}" y="16">${escapeHtml(spec.unit)}</text>`;
 for(const t of [0,0.25,0.5,0.75,1]){const v=yMin+(yMax-yMin)*t;svg+=`<line x1="${left}" x2="${width-right}" y1="${y(v)}" y2="${y(v)}" stroke="#25323a" stroke-width="1"/><text class="ax" x="${left-10}" y="${y(v)+4}" text-anchor="end">${fmt(v,spec.digits)}</text>`;}
 for(const w of workers)svg+=`<text class="ax" x="${x(w)}" y="${height-24}" text-anchor="middle">${w}w</text>`;
 svg+=`<text class="ax" x="${(left+width-right)/2}" y="${height-6}" text-anchor="middle">parallel agent workers</text>`;
 // Comparison sweeps are drawn first so the active one is never hidden underneath them.
 for(const line of [...series.filter(s=>!s.active),...series.filter(s=>s.active)]){
  const pts=line.stats.map(s=>({s,v:value(s)})).filter((p):p is {s:PointStats;v:number}=>p.v!==null).sort((a,b)=>a.s.workers-b.s.workers);
  if(!pts.length)continue;
  const path=pts.map(p=>`${x(p.s.workers).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  if(line.active){
   svg+=`<polygon points="${x(pts[0].s.workers).toFixed(1)},${y(yMin).toFixed(1)} ${path} ${x(pts[pts.length-1].s.workers).toFixed(1)},${y(yMin).toFixed(1)}" fill="${stageColors.llm}" fill-opacity="0.09"/>`;
   svg+=`<polyline points="${path}" fill="none" stroke="${stageColors.llm}" stroke-width="2.6" stroke-linejoin="round"/>`;
   const peak=peakPoint(line.stats);
   // After the peak the curve is drawn in red: those workers cost more and returned no more turns.
   if(peak&&metric==='turnsPerMin'){
    const after=pts.filter(p=>p.s.workers>=peak.workers);
    if(after.length>1)svg+=`<polyline points="${after.map(p=>`${x(p.s.workers).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')}" fill="none" stroke="#f87171" stroke-width="2.6" stroke-linejoin="round"/>`;
    const at=pts.find(p=>p.s.workers===peak.workers);
    if(at)svg+=`<text class="pk" x="${x(peak.workers)}" y="${y(at.v)-14}" text-anchor="middle">peak ${fmt(at.v,spec.digits)} at ${peak.workers}w</text>`;
   }
   for(const p of pts)svg+=`<circle class="scale-point" cx="${x(p.s.workers).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="5" fill="${stageColors.llm}" stroke="#0c1417" stroke-width="2" tabindex="0" role="button" data-workers="${p.s.workers}" data-tooltip="${escapeHtml(`${line.label} · ${p.s.workers} workers · ${fmt(p.v,spec.digits)} ${spec.unit}`)}"><title>${escapeHtml(`${p.s.workers} workers: ${fmt(p.v,spec.digits)} ${spec.unit}`)}</title></circle>`;
  }else{
   svg+=`<polyline points="${path}" fill="none" stroke="#66798a" stroke-width="1.4" stroke-dasharray="5 5" stroke-linejoin="round"/>`;
   const end=pts[pts.length-1];
   svg+=`<text x="${x(end.s.workers)+8}" y="${y(end.v)+4}" fill="#7d8c92" font-size="11">${escapeHtml(line.label.slice(0,26))}</text>`;
  }
 }
 return svg+'</svg>';
}

export function stageBreakdown(stats:PointStats|null){
 if(!stats)return [];
 const total=agenticStages.reduce((a,s)=>a+stats.stageMs[s],0);
 return agenticStages.map(stage=>({stage,ms:stats.stageMs[stage],share:total>0?stats.stageMs[stage]/total*100:null}));
}
