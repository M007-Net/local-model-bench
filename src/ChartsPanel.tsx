import {useMemo,useState} from 'react';
import type {Run} from './types';
import {summaries} from '../electron/export';
import {chartSpecs,renderChart,legendHtml,scoreLabels,type ChartRow,type ScoreSource} from './charts';
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
export function ChartsPanel({run,onModel}:{run:Run;onModel?:(key:string)=>void}){
 const [testId,setTestId]=useState(''),[score,setScore]=useState<ScoreSource>('objective');
 const chosen=run.tests.some(t=>t.id===testId)?testId:run.tests[0]?.id;
 const rows=useMemo(()=>summaries(run).filter(r=>r.testId===chosen),[run,chosen]);
 return <section className="automatic-charts"><div className="section-heading"><div><h2>Automatic graphs</h2><p className="hint">Updated as requests and grades arrive. Hover over a point for its values.</p></div><div className="chart-controls"><label>Test<select aria-label="Chart test" value={chosen} onChange={e=>setTestId(e.target.value)}>{run.tests.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Score source<select aria-label="Quality score source" value={score} onChange={e=>setScore(e.target.value as ScoreSource)}>{Object.entries(scoreLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div></div>
 <ChartGrid rows={rows} score={score} onModel={onModel}/>
 </section>;
}
