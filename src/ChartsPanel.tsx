import {useMemo,useState} from 'react';
import type {Run} from './types';
import {summaries} from '../electron/export';
import {chartSpecs,renderChart,legendHtml,scoreLabels,type ChartRow,type ScoreSource} from './charts';
import {measuredDepths,mtpDepthText} from './mtp-sweep';
import type {HistoryRow} from './history';
import {backendOf} from '../electron/runtime';
import {overlayOptions,overlayRows,stillOffered} from './chart-compare';
// A sweep names its series after the model and the depth ("qwen … · MTP 2 tokens"). Clicking a
// point still has to inspect the model, so this is what the depth is stripped back off with.
const depthSuffix=' · MTP ';
// The legend, graph grid, and hover tooltip are shared by the single-run graphs and the history overview,
// which feeds in pooled rows keyed by group label instead of by model key.
export function ChartGrid({rows,score,onModel,hint='Click a point to inspect its model and responses.'}:{rows:ChartRow[];score:ScoreSource;onModel?:(key:string)=>void;hint?:string}){
 const [tip,setTip]=useState('');
 const show=(target:EventTarget)=>{const point=(target as Element).closest?.('[data-tooltip]');setTip(point?.getAttribute('data-tooltip')??'');};
 return <><div className="legend chart-legend" dangerouslySetInnerHTML={{__html:legendHtml(rows)}}/>
 <div className="chart-grid" onMouseOver={e=>show(e.target)} onMouseLeave={()=>setTip('')} onFocus={e=>show(e.target)} onBlur={()=>setTip('')} onClick={e=>{const key=(e.target as Element).closest('[data-model]')?.getAttribute('data-model');if(key)onModel?.(key);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){const key=(e.target as Element).getAttribute('data-model');if(key){e.preventDefault();onModel?.(key);}}}}>{chartSpecs(score).map(spec=><section className="panel auto-chart" key={spec.key}><h3>{spec.title}</h3><p className="hint">{spec.description}</p><div dangerouslySetInnerHTML={{__html:renderChart(rows,spec,score)}}/></section>)}</div>
 {tip&&<div className="graph-tooltip" role="tooltip">{tip}<small>{hint}</small></div>}
 </>;
}
export function ChartsPanel({run,onModel,history=[]}:{run:Run;onModel?:(key:string)=>void;history?:HistoryRow[]}){
 const [testId,setTestId]=useState(''),[score,setScore]=useState<ScoreSource>('objective');
 // Which saved series are drawn beside this run. Ids rather than rows, so a selection survives the
 // history being reloaded underneath it.
 const [compare,setCompare]=useState<string[]>([]);
 const chosen=run.tests.some(t=>t.id===testId)?testId:run.tests[0]?.id;
 // A sweep measures one model at several prediction depths, so each depth becomes its own line.
 // Without this the graph would join points taken under different settings into one curve.
 const own=useMemo(()=>{
  const all=summaries(run).filter(r=>r.testId===chosen);
  return measuredDepths(run).length>1?all.map(r=>({...r,modelKey:`${r.modelKey} · ${mtpDepthText(r.mtpDepth)}`})):all;
 },[run,chosen]);
 const backend=useMemo(()=>backendOf(run).label,[run]);
 const models=useMemo(()=>[...new Set(summaries(run).map(r=>r.modelKey))],[run]);
 const options=useMemo(()=>overlayOptions(history,run.id,chosen??'',backend,models),[history,run.id,chosen,backend,models]);
 // Changing the test can leave a selection pointing at data that test never produced, which would
 // draw nothing and read as a bug rather than as a choice.
 const live=useMemo(()=>stillOffered(compare,options),[compare,options]);
 const rows=useMemo(()=>[...own,...overlayRows(history,live,run.id,chosen??'',models)],[own,history,live,run.id,chosen,models]);
 const backends=options.filter(o=>o.kind==='backend'),others=options.filter(o=>o.kind==='model');
 const toggle=(id:string)=>setCompare(c=>c.includes(id)?c.filter(x=>x!==id):[...c,id]);
 return <section className="automatic-charts"><div className="section-heading"><div><h2>Automatic graphs</h2><p className="hint">Updated as requests and grades arrive. Hover over a point for its values.</p></div><div className="chart-controls"><label>Test<select aria-label="Chart test" value={chosen} onChange={e=>setTestId(e.target.value)}>{run.tests.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Score source<select aria-label="Quality score source" value={score} onChange={e=>setScore(e.target.value as ScoreSource)}>{Object.entries(scoreLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
  {/* Saved measurements of the same test, drawn on the same axes. The control is absent entirely
      when nothing comparable is saved, rather than an empty menu that invites a click. */}
  {options.length>0&&<details className="compare-menu"><summary aria-label="Compare with saved measurements">Compare with{live.length?` · ${live.length}`:''}</summary>
   <div className="compare-panel">
    {backends.length>0&&<><b>Other engines</b>{backends.map(o=><label key={o.id}><input type="checkbox" checked={live.includes(o.id)} onChange={()=>toggle(o.id)}/><span>{o.label}<small>{o.detail}</small></span></label>)}</>}
    {others.length>0&&<><b>Other models</b>{others.map(o=><label key={o.id}><input type="checkbox" checked={live.includes(o.id)} onChange={()=>toggle(o.id)}/><span>{o.label}<small>{o.detail}</small></span></label>)}</>}
    {live.length>0&&<button onClick={()=>setCompare([])}>Clear comparisons</button>}
    <p className="hint">Saved rows from finished runs, drawn as their own lines. Nothing is recalculated, and conditions can differ between runs.</p>
   </div></details>}
 </div></div>
 <ChartGrid rows={rows} score={score} onModel={key=>onModel?.(key.split(depthSuffix)[0])}/>
 </section>;
}
