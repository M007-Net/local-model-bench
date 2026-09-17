import {useEffect,useMemo,useState} from 'react';
import {RefreshCw,ArrowRight,ChevronRight} from 'lucide-react';
import {chartRows,conditionFacets,defaultHistoryView,facetKeys,facetLabels,facetOptions,groupHistory,groupOptions,modelFacets,shortDate,sortGroups,type FacetKey,type HistoryGroup,type HistoryRow,type HistoryView,type SortKey,type Spread,matchesHistory} from './history';
import {ChartGrid} from './ChartsPanel';
import {scoreLabels,type ScoreSource} from './charts';
const api=window.bench;
const number=(n:number|null|undefined,d=1)=>n===null||n===undefined||!Number.isFinite(n)?'—':n.toLocaleString(undefined,{maximumFractionDigits:d});
// A pooled rate is reported with the spread it was pooled from, so a single figure never hides the fact that
// the underlying runs disagreed.
const spread=(s:Spread,d=1)=>s===null?'—':number(s.value,d)+(s.min===s.max?'':` (${number(s.min,d)}–${number(s.max,d)})`);
const seconds=(ms:number|null)=>ms===null?'—':number(ms/1000,2);
function Stat({label,value,sub}:{label:string;value:string;sub:string}){return <div className="stat"><span>{label}</span><b>{value}</b><small>{sub}</small></div>}
function Chips({label,options,selected,onChange}:{label:string;options:{value:string;count:number}[];selected:string[];onChange:(values:string[])=>void}){
 if(!options.length)return null;
 return <div className="chip-row"><span className="chip-label">{label}</span><div className="chips" role="group" aria-label={label}>
  <button type="button" className={'chip'+(selected.length?'':' on')} aria-pressed={selected.length===0} onClick={()=>onChange([])}>All</button>
  {options.map(o=><button type="button" key={o.value} className={'chip'+(selected.includes(o.value)?' on':'')} aria-pressed={selected.includes(o.value)} onClick={()=>onChange(selected.includes(o.value)?selected.filter(v=>v!==o.value):[...selected,o.value])}>{o.value}<small>{o.count}</small></button>)}
 </div></div>;
}
const columns:{key:SortKey;label:string}[]=[
 {key:'label',label:'Group'},{key:'runs',label:'Runs'},{key:'requests',label:'Requests'},
 {key:'generationTps',label:'Gen tok/s'},{key:'estimatedPrefillTps',label:'Prefill est.'},{key:'throughput',label:'Total tok/s'},
 {key:'medianMs',label:'Median / p95'},{key:'failureRate',label:'Failures'},
 {key:'objective',label:'Objective'},{key:'localJudge',label:'Local judge'},{key:'gpuHotSpotMax',label:'GPU hot spot'}];
const conditionText=(g:HistoryGroup)=>[`concurrency ${g.conditions.concurrency.join(', ')||'—'}`,g.conditions.promptSizes.join(', '),`MTP ${g.conditions.mtpDepth.join(' / ')||'—'}`,`reasoning ${g.conditions.reasoning.join(' / ')||'—'}`].filter(Boolean).join(' · ');
export function HistoryPanel({view,onChange,onOpenRun,signature}:{view:HistoryView;onChange:(v:HistoryView)=>void;onOpenRun:(id:string)=>void;signature:string}){
 const [rows,setRows]=useState<HistoryRow[]|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [score,setScore]=useState<ScoreSource>('objective'),[open,setOpen]=useState('');
 const [reloads,setReloads]=useState(0);
 const load=()=>setReloads(n=>n+1);
 // history() re-reads every saved run, so it gets slower as the database grows and two
 // in-flight calls can finish out of order. Without the guard a Refresh press landing
 // after a run finishes could overwrite the newer rows with older ones - wrong data
 // with no visible symptom - and both would fight over the spinner.
 useEffect(()=>{let alive=true;setLoading(true);setError('');
  api.history().then(r=>{if(alive)setRows(r);}).catch(e=>{if(alive)setError((e as Error).message);}).finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false;};},[signature,reloads]);
 // Grouping and the eleven chip rows each walk every measurement, and a chip row walks it once per facet. They
 // depend only on the rows and the current view, so typing in the search box does not redo all of it per key.
 const groups=useMemo(()=>sortGroups(groupHistory(rows??[],view),view),[rows,view]);
 const chartData=useMemo(()=>chartRows(groupHistory(rows??[],view,{splitConcurrency:true})),[rows,view]);
 const options=useMemo(()=>Object.fromEntries(facetKeys.map(key=>[key,facetOptions(rows??[],view,key)])) as Record<FacetKey,{value:string;count:number}[]>,[rows,view]);
 const visible=useMemo(()=>(rows??[]).filter(r=>matchesHistory(r,view)),[rows,view]);
 if(error)return <div role="alert" className="banner error">{error}</div>;
 if(!rows)return <p className="hint">Reading every saved run…</p>;
 if(!rows.length)return <div className="panel"><h2>Nothing measured yet</h2><p className="hint">Finish a benchmark and this overview starts accumulating. It never discards a run, so the picture keeps filling in as you test more models.</p></div>;
 const runCount=new Set(visible.map(r=>r.runId)).size,modelCount=new Set(visible.map(r=>r.modelKey)).size;
 const requests=groups.reduce((n,g)=>n+g.requests,0),mixed=groups.filter(g=>g.mixed).length;
 const dates=visible.map(r=>r.runCreated).sort();
 const sortBy=(key:SortKey)=>onChange({...view,sort:key,descending:view.sort===key?!view.descending:key!=='label'});
 const setFacet=(key:FacetKey,values:string[])=>onChange({...view,[key]:values});
 return <>
 <section className="panel history-facets"><div className="section-heading"><div><h2>What to include</h2><p className="hint">Every saved run, pooled. Press a value to narrow; press All to widen again. Choices inside one row are alternatives, choices across rows all have to match.</p></div><div className="button-row"><button onClick={load} disabled={loading}><RefreshCw size={14}/>{loading?'Reading…':'Refresh history'}</button><button onClick={()=>onChange({...defaultHistoryView})}>Reset overview</button></div></div>
  {modelFacets.map(key=><Chips key={key} label={facetLabels[key]} options={options[key]} selected={view[key]} onChange={v=>setFacet(key,v)}/>)}
  <label className="field history-search"><span>Find a model or run</span><input type="search" aria-label="Search history" placeholder="Model name, quantization, run name…" value={view.search} onChange={e=>onChange({...view,search:e.target.value})}/></label>
 </section>
 <section className="panel history-facets"><div className="section-heading"><div><h2>Conditions</h2><p className="hint">Runs were measured under different settings. Pin a condition here when you want a controlled read rather than a general one.</p></div></div>
  {conditionFacets.map(key=><Chips key={key} label={facetLabels[key]} options={options[key]} selected={view[key]} onChange={v=>setFacet(key,v)}/>)}
 </section>
 <div className="stats-row four"><Stat label="Models covered" value={modelCount.toString()} sub="Distinct model entries in view"/><Stat label="Runs covered" value={runCount.toString()} sub="Saved runs contributing measurements"/><Stat label="Measured requests" value={number(requests,0)} sub="Warm-ups excluded"/><Stat label="Measured between" value={dates.length?shortDate(dates[0]):'—'} sub={dates.length?'through '+shortDate(dates[dates.length-1]):'No measurements in view'}/></div>
 <section className="panel"><div className="section-heading"><div><h2>Pooled measurements</h2><p className="hint">Rates are averaged across runs weighted by how many requests stood behind each one; median and p95 are recomputed from the pooled request durations. Scores count only responses that were actually scored.</p></div><label className="field history-group"><span>Group by</span><select aria-label="Group by" value={view.groupBy} onChange={e=>onChange({...view,groupBy:e.target.value as HistoryView['groupBy']})}>{Object.entries(groupOptions).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div>
  {mixed>0&&<p className="hint amber">{mixed} of {groups.length} rows pool more than one condition, so they describe a range of settings rather than a controlled comparison. The Conditions column says which, and the chips above can hold one constant.</p>}
  <div className="table-scroll"><table className="history-table"><thead><tr>{columns.map(c=><th key={c.key} aria-sort={view.sort===c.key?(view.descending?'descending':'ascending'):'none'}><button type="button" className="th-sort" onClick={()=>sortBy(c.key)}>{c.label}{view.sort===c.key&&<span aria-hidden="true">{view.descending?' ▾':' ▴'}</span>}</button></th>)}<th>Conditions</th></tr></thead>
  {groups.map(g=><tbody key={g.key}><tr className={g.mixed?'mixed':''}>
   <td><b>{g.label}</b>{g.models.length>1&&<small>{g.models.length} models</small>}<small>{shortDate(g.first)} – {shortDate(g.last)}</small></td>
   <td><button type="button" className="text-button" aria-expanded={open===g.key} aria-label={g.runs.length+' runs behind '+g.label} onClick={()=>setOpen(open===g.key?'':g.key)}>{g.runs.length}<ChevronRight size={12}/></button></td>
   <td>{number(g.requests,0)}</td><td>{spread(g.generationTps)}</td><td>{spread(g.estimatedPrefillTps)}</td><td>{spread(g.throughput)}</td>
   <td>{seconds(g.medianMs)} / {seconds(g.p95Ms)} s</td><td>{g.failures}/{g.requests}</td>
   <td>{number(g.objective)}</td><td>{number(g.localJudge)}</td><td>{number(g.gpuHotSpotAvg)} / {number(g.gpuHotSpotMax)} °C</td>
   <td className="conditions">{conditionText(g)}{g.mixed&&<small>Mixed conditions</small>}</td></tr>
   {open===g.key&&<tr className="history-runs"><td colSpan={columns.length+1}><span className="chip-label">Runs behind this row</span><div className="response-list">{g.runs.map(r=><button key={r.id} type="button" onClick={()=>onOpenRun(r.id)}><div><b>{r.name}</b><small>{new Date(r.created).toLocaleString()} · {r.status}</small></div>Open this run<ArrowRight size={14}/></button>)}</div></td></tr>}
  </tbody>)}</table></div>
  {!groups.length&&<p className="hint">No saved measurement matches these choices. Press All on a row, or reset the overview.</p>}
 </section>
 {groups.length>0&&<section className="automatic-charts"><div className="section-heading"><div><h2>Automatic graphs</h2><p className="hint">One line per group across concurrency, pooled from every run in view. Hover over a point for its values.</p></div><div className="chart-controls"><label>Score source<select aria-label="Quality score source" value={score} onChange={e=>setScore(e.target.value as ScoreSource)}>{Object.entries(scoreLabels).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label></div></div>
  <ChartGrid rows={chartData} score={score} hint="Points pool every matching run at that concurrency."/>
 </section>}
 <p className="hint">This overview describes what your machine actually produced, not a controlled experiment. Two runs of the same model can differ because of context length, output limit, reasoning, native MTP, vision, what else was loaded, or thermals. Pin those conditions above before reading a difference as a property of the model.</p>
 </>;
}
