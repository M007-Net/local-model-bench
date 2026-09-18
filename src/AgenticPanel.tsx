import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Play,Square,Download,Trash2,ChevronRight,Cpu,Gauge,Upload} from 'lucide-react';
import type {Model} from './types';
import {TYPICAL_TURN_MS,WORKLOAD_VERSION,agenticPresets,agenticWorkerChoices,axisMax,comparableWorkload,cpuReading,defaultAgenticConfig,estimateSweepMs,humanDuration,measuredTurnCost,modelCallLabel,peakPoint,presetName,stageColors,stageDescriptions,stageLabels,sweepColumns,sweepStats,sweepVerdict,validateAgenticConfig,type AgenticConfig,type AgenticProgress,type AgenticRun,type AgenticStage,type AgenticSummary} from './agentic';
import {scalingMetrics,scalingSvg,stageBreakdown,stageLegendHtml,timelineSvg,type ScalingMetric,type ScalingSeries} from './agentic-charts';
import {reasoningOptions} from './model-capabilities';

const api=()=>window.bench;
const n=(v:number|null|undefined,d=1)=>v===null||v===undefined||!Number.isFinite(v)?'—':v.toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:d});
const int=(v:number|null|undefined)=>v===null||v===undefined||!Number.isFinite(v)?'—':Math.round(v).toLocaleString();
const COMPARE_LIMIT=6;

function Tile({label,value,unit,accent,help}:{label:string;value:string;unit:string;accent?:boolean;help:string}){
 return <div className={'agent-tile'+(accent?' accent':'')} title={help}><span>{label}</span><b>{value}<small>{unit}</small></b></div>;
}
function Pills<T extends string|number>({label,options,value,onChange,format}:{label:string;options:T[];value:T;onChange:(v:T)=>void;format?:(v:T)=>string}){
 return <div className="pill-group"><span className="pill-label">{label}</span><div className="pills" role="group" aria-label={label}>{options.map(option=><button key={String(option)} type="button" className={option===value?'pill chosen':'pill'} aria-pressed={option===value} onClick={()=>onChange(option)}>{format?format(option):String(option)}</button>)}</div></div>;
}

export function AgenticPanel({models,runs,progress,busy,host,onStart,onCancel,onDelete,onExport,onImport,onError}:{
 models:Model[];runs:AgenticSummary[];progress:AgenticProgress|null;busy:boolean;host:{cpu:string;threads:number};
 onStart:(c:AgenticConfig)=>Promise<void>;onCancel:()=>void;onDelete:(id:string)=>Promise<void>;onExport:(id:string,format:string)=>Promise<void>;onImport:()=>Promise<string|null>;onError:(message:string)=>void;
}){
 // Only the user's raw picks are state. Which sweep, worker count and turn are actually shown is
 // derived below, so a sweep that finishes or a worker count that has no measurements cannot leave
 // the view pointing at something that is not there.
 const [pickedRun,setPickedRun]=useState('');
 const [pickedWorkers,setPickedWorkers]=useState(0);
 const [selection,setSelection]=useState<{workers:number;index:number}|null>(null);
 const [run,setRun]=useState<AgenticRun|null>(null);
 const [others,setOthers]=useState<AgenticRun[]>([]);
 const [locked,setLocked]=useState(true);
 const [stageFilter,setStageFilter]=useState<AgenticStage[]>([]);
 const [metric,setMetric]=useState<ScalingMetric>('turnsPerMin');
 const [playing,setPlaying]=useState(false);
 const [tip,setTip]=useState('');
 const [showForm,setShowForm]=useState(false);
 const cache=useRef(new Map<string,AgenticRun>());

 const active=progress?.runId??'';
 const runId=active||(runs.some(r=>r.id===pickedRun)?pickedRun:runs[0]?.id??'');

 // The selected sweep is polled while it is running so the timeline fills in worker count by
 // worker count, exactly as it was measured. A finished sweep is fetched once.
 useEffect(()=>{
  if(!runId){setRun(null);return;}
  let alive=true;
  const load=()=>api().getAgenticRun(runId).then(r=>{if(alive){setRun(r);cache.current.set(r.id,r);}}).catch(e=>{if(alive)onError((e as Error).message);});
  load();
  if(active!==runId)return()=>{alive=false;};
  const timer=setInterval(load,1500);
  return()=>{alive=false;clearInterval(timer);};
 },[runId,active]);

 // Comparison sweeps are fetched once each and kept, so switching the sweep pill costs one request
 // rather than reloading every other sweep's full trace.
 useEffect(()=>{
  let alive=true;
  const wanted=runs.filter(r=>r.id!==runId).slice(0,COMPARE_LIMIT).map(r=>r.id);
  const settle=()=>{if(alive)setOthers(wanted.map(id=>cache.current.get(id)).filter((r):r is AgenticRun=>!!r));};
  const missing=wanted.filter(id=>!cache.current.has(id));
  if(!missing.length)settle();
  else Promise.all(missing.map(id=>api().getAgenticRun(id).then(r=>cache.current.set(id,r)).catch(()=>{}))).then(settle);
  return()=>{alive=false;};
 },[runId,runs.length]);

 const stats=useMemo(()=>run?sweepStats(run.points):[],[run]);
 const available=useMemo(()=>stats.map(s=>s.workers),[stats]);
 const workers=available.includes(pickedWorkers)?pickedWorkers:available[0]??0;
 const chooseWorkers=(value:number)=>{setPlaying(false);setPickedWorkers(value);};

 useEffect(()=>{
  if(!playing||available.length<2)return;
  const timer=setInterval(()=>setPickedWorkers(current=>available[(available.indexOf(current)+1)%available.length]),1100);
  return()=>clearInterval(timer);
 },[playing,available]);

 const point=run?.points.find(p=>p.workers===workers);
 const current=stats.find(s=>s.workers===workers)??null;
 const peak=peakPoint(stats);
 // The open turn carries the worker count it belongs to, so changing worker count closes it without
 // a separate effect whose only job is to invalidate other state.
 const turn=selection&&selection.workers===workers?point?.turns.find(t=>t.index===selection.index)??null:null;
 const axis=useMemo(()=>run?axisMax(run.points,workers,locked):1,[run,workers,locked]);
 // The plot keeps one height for the whole sweep, so stepping through worker counts with the
 // playhead compares like with like instead of resizing the picture under the cursor.
 const timelineHeight=useMemo(()=>{
  const maxLanes=Math.max(1,...(run?.points.map(p=>p.lanes)??[1]));
  return Math.max(150,Math.min(440,maxLanes*(maxLanes>24?7:16)+48));
 },[run]);
 // The comparison aggregates depend only on the other sweeps, so a poll tick on the live run does
 // not re-derive them.
 // A sweep recorded under a different workload version measured different work, so it is listed
 // but never drawn on the same axes as this one.
 const otherSeries=useMemo(()=>others.filter(comparableWorkload).map(other=>({id:other.id,label:other.config.name,stats:sweepStats(other.points),active:false})),[others]);
 const series:ScalingSeries[]=useMemo(()=>run?[...otherSeries,{id:run.id,label:run.config.name,stats,active:true}]:otherSeries,[otherSeries,run,stats]);

 // Each drawing is rebuilt only when its own inputs change: moving the pointer along the timeline
 // sets tooltip state on every segment, and that must not re-serialise thousands of rects.
 const timeline=useMemo(()=>timelineSvg(point,{axisMaxMs:axis,height:timelineHeight,highlight:stageFilter,selectedTurn:turn?.index??null}),[point,axis,timelineHeight,stageFilter,turn]);
 const scaling=useMemo(()=>scalingSvg(series,metric),[series,metric]);
 const breakdown=useMemo(()=>stageBreakdown(current),[current]);
 const legend=useMemo(()=>stageLegendHtml(stageFilter),[stageFilter]);

 // Hover and keyboard focus both raise the tooltip, matching the graphs on the Results screen.
 const raise=(e:React.SyntheticEvent)=>setTip((e.target as Element).closest?.('[data-tooltip]')?.getAttribute('data-tooltip')??'');
 const clear=()=>setTip('');
 const tipHandlers={onMouseOver:raise,onFocus:raise,onMouseLeave:clear,onBlur:clear};
 const onTimelineClick=(e:React.MouseEvent)=>{
  const node=(e.target as Element).closest('[data-turn]');
  if(node)setSelection({workers,index:Number(node.getAttribute('data-turn'))});
 };
 const onLegendClick=(e:React.MouseEvent)=>{
  const node=(e.target as Element).closest('[data-stage]');if(!node)return;
  const stage=node.getAttribute('data-stage') as AgenticStage;
  setStageFilter(list=>list.includes(stage)?list.filter(s=>s!==stage):[...list,stage]);
 };
 const onScaleClick=(e:React.MouseEvent)=>{
  const node=(e.target as Element).closest('[data-workers]');
  if(node)chooseWorkers(Number(node.getAttribute('data-workers')));
 };

 const turnCost=useMemo(()=>run?measuredTurnCost(run.points,run.config.hostWorkScale)??TYPICAL_TURN_MS:TYPICAL_TURN_MS,[run]);
 // The six headline tiles, each able to say what it means without leaving the page.
 const sweepTiles=[
  {label:'WALL CLOCK',value:n(current&&current.wallMs/1000,2),unit:'s',accent:true,help:'Seconds to finish the whole fixed set of agent turns at this worker count, taken as the median of the repeats.'},
  {label:'THROUGHPUT',value:int(current?.turnsPerMin),unit:'turns/min',accent:false,help:'Completed agent turns per minute. The worker count where this is highest is the machine’s ceiling for this workload.'},
  {label:'SPEEDUP',value:n(current?.speedup,2),unit:'× vs 1 worker',accent:false,help:'How many times faster this worker count is than one worker. Needs a one-worker point in the same sweep.'},
  {label:'EFFICIENCY',value:n(current?.efficiency,2),unit:'per worker',accent:false,help:'Speedup divided by worker count. 1.00 means every worker you added still paid for itself; falling towards 0 means they are queueing.'},
  {label:'MEAN TURN',value:int(current?.meanTurnMs),unit:'ms',accent:false,help:'Average time one agent turn took start to finish, including any time it waited for a free host thread.'},
  {label:'OFF-GPU SHARE',value:int(current?.offGpuShare),unit:'% of turn',accent:true,help:'Share of turn time that was not the model call. With the model call off this is always 100%: every millisecond was the CPU.'}
 ];
 const environment=run?.environment??{};
 const specs:[string,string][]=[
  ['CPU',String(environment.cpu??'CPU not recorded')],
  ['Threads',environment.logicalCpus?String(environment.logicalCpus):'—'],
  ['Host pool',environment.hostThreads?`${environment.hostThreads} thread${environment.hostThreads===1?'':'s'}`:'—'],
  ['RAM',typeof environment.totalMemory==='number'?`${(environment.totalMemory/1e9).toFixed(1)} GB`:'—'],
  ['Model call',run?modelCallLabel(run.config):'—'],
  ['Workload',run?`v${run.environment.workloadVersion??'unknown'} · scale ${run.config.hostWorkScale} · ${run.config.turns}×${run.config.repeats}`:'—']
 ];
 const imported=run?.environment.importedFrom;
 const mismatch=!!run&&!comparableWorkload(run);

 return <>
  <div className="page-heading agent-heading">
   <div>
    <div className="eyebrow">AGENTIC WORKLOAD · HOST-SIDE EXECUTION TRACE</div>
    <h1>The GPU thinks. The CPU does everything else.</h1>
    <p>Every bar is one agent turn. The cyan sliver is the model call. Everything after it is this machine actually doing the work — scaffolding files, compiling, running the checks, walking the syntax tree, hashing, packaging.</p>
   </div>
   <div className="button-row">
    {progress&&<button className="danger" onClick={onCancel}><Square size={14}/>Cancel sweep</button>}
    <button className="primary" disabled={!!progress||busy} onClick={()=>setShowForm(v=>!v)}><Play size={16}/>{showForm?'Hide sweep setup':'New agent sweep'}</button>
   </div>
  </div>

  {mismatch&&<div className="banner error"><span>This sweep recorded workload version {String(run?.environment.workloadVersion??'unknown')}, but this build runs version {WORKLOAD_VERSION}. Its stages did different work, so it is shown on its own and left out of the comparison lines.</span></div>}
  {!!imported&&<div className="banner success"><span>Imported from {String(imported)} — measured on {String(run?.environment.cpu??'another machine')}. Nothing was re-run here.</span></div>}
  {run&&<div className="spec-row">{specs.map(([label,value])=><span key={label}><small>{label}</small><b title={value}>{value}</b></span>)}</div>}

  {progress&&<div className="panel live-panel">
   <div className="section-heading"><div><div className="eyebrow">{progress.phase==='warmup'?'WARM-UP · NOT MEASURED':progress.phase==='settling'?'SETTLING · NOT MEASURED':progress.phase.toUpperCase()}</div><h3>{progress.message}</h3></div><small>worker count {progress.pointIndex+1} of {progress.pointCount}</small></div>
   <div className="progress-track"><div style={{width:`${progress.totalTurns?Math.min(100,progress.completedTurns/progress.totalTurns*100):3}%`}}/></div>
   <div className="progress-meta"><span>{progress.completedTurns} / {progress.totalTurns} agent turns</span><span>{progress.workers} parallel worker{progress.workers===1?'':'s'}</span></div>
   <p className="hint">Warm-up passes and the idle gaps between repeats are excluded from every result. Completed worker counts are saved as they finish, so cancelling keeps what has already been measured.</p>
  </div>}

  {showForm&&<SweepForm models={models} host={host} turnCost={turnCost} busy={busy||!!progress} onStart={async config=>{await onStart(config);setShowForm(false);}} onError={onError}/>}

  {!runs.length&&!progress&&!showForm&&<section className="panel first-run">
   <div className="section-heading"><div><div className="eyebrow">START HERE</div><h2>Measure what this machine does for an agent</h2></div><Gauge size={28}/></div>
   <ol className="steps">
    <li><b>Run a host-only sweep.</b> Leave the model call off. Nothing is loaded and LM Studio is not contacted — you get this machine’s own ceiling for agent work in about a minute.</li>
    <li><b>Read the two numbers.</b> How long one worker takes per turn is per-core speed; the peak turns per minute is what the whole chip can do.</li>
    <li><b>Compare.</b> Run the same sweep on another PC, export it as JSON, and <b>Import</b> it here to draw both curves together. Or turn the model call on to see where the GPU becomes the limit.</li>
   </ol>
   <div className="button-row">
    <button className="primary" disabled={busy} onClick={()=>setShowForm(true)}><Play size={16}/>Set up my first sweep</button>
    <button className="ghost" disabled={busy} onClick={()=>onImport().then(id=>{if(id)setPickedRun(id);})}><Upload size={14}/>Import a sweep from another PC</button>
   </div>
  </section>}

  {!!runs.length&&<>
   <section className="panel control-bar">
    <div className="control-row">
     <div className="pill-group grow">
      <span className="pill-label">SWEEP</span>
      <div className="pills" role="group" aria-label="Saved agent sweeps">
       {runs.map(saved=>{
        const from=saved.environment.importedFrom,machine=String(saved.environment.cpu??'');
        const mark=saved.id===active?'live':from?'imported':saved.status==='completed'?'':saved.status;
        return <button key={saved.id} type="button" className={saved.id===runId?'pill chosen':'pill'} aria-pressed={saved.id===runId} onClick={()=>{setPlaying(false);setPickedRun(saved.id);}}
         title={[machine||'This machine',`${saved.config.turns} turns \u00d7 ${saved.config.repeats} repeats`,`model call ${saved.config.modelCall}`,saved.status,from?`imported from ${from}`:''].filter(Boolean).join(' \u00b7 ')}>
         {saved.config.name}{mark&&<span className="pill-mark">{mark}</span>}
        </button>;
       })}
      </div>
     </div>
     {available.length>0&&<Pills label="PARALLEL AGENT WORKERS" options={available} value={workers} onChange={chooseWorkers} format={v=>`${v}w`}/>}
    </div>
    <div className="control-row">
     <label className="check-inline"><input type="checkbox" aria-label="Lock time axis to slowest run" checked={locked} onChange={e=>setLocked(e.target.checked)}/>LOCK TIME AXIS TO SLOWEST RUN</label>
     <button type="button" className="ghost" disabled={available.length<2} onClick={()=>setPlaying(v=>!v)}>{playing?'■ Stop playhead':'▶ Sweep playhead'}</button>
     <div className="button-row push">
      <button className="ghost" disabled={busy||!!progress} onClick={()=>onImport().then(id=>{if(id)setPickedRun(id);})}><Upload size={13}/>Import</button>
      {['html','csv','json','md'].map(format=><button key={format} className="ghost" disabled={!run||busy} onClick={()=>onExport(runId,format)}><Download size={13}/>{format==='html'?'Report':format.toUpperCase()}</button>)}
      <button className="ghost danger" disabled={!run||busy||runId===active} onClick={()=>{onDelete(runId).then(()=>setPickedRun(''));}}><Trash2 size={13}/>Delete</button>
     </div>
    </div>
   </section>

   <div className="agent-tiles">
    {sweepTiles.map(t=><Tile key={t.label} label={t.label} value={t.value} unit={t.unit} accent={t.accent} help={t.help}/>)}
   </div>

   <section className="panel timeline-panel">
    <div className="section-heading">
     <div><h2>Worker timeline</h2><p className="hint">{point?`${point.lanes} worker lane${point.lanes===1?'':'s'} · ${point.turns.length} agent turns · axis ${locked?'locked across worker counts':'scaled to this worker count'}`:'Choose a worker count with measurements.'}</p></div>
     {stageFilter.length>0&&<button className="text-button" onClick={()=>setStageFilter([])}>Show every stage</button>}
    </div>
    <div className="chart-surface" {...tipHandlers} onClick={onTimelineClick} dangerouslySetInnerHTML={{__html:timeline}}/>
    <div className="stage-legend" onClick={onLegendClick} {...tipHandlers} dangerouslySetInnerHTML={{__html:legend}}/>
    <details className="read-this"><summary>How to read this</summary>
     <ul>
      <li><b>One row is one worker</b> — an agent working in parallel with the others.</li>
      <li><b>One bar is one agent turn</b>, split into its stages by colour. The cyan sliver is the model call; everything after it is this machine.</li>
      <li><b>A bar that starts further right</b> waited for a free host thread. That gap is queued time, and it is where extra workers go once the machine is full.</li>
      <li><b>Lock time axis</b> keeps the same seconds-per-pixel across worker counts, so the picture shrinking means the machine is keeping up.</li>
     </ul>
    </details>
    <p className="hint">Click a stage to isolate it, click a bar to open that turn. Each stage is timed on the thread that ran it, so a segment is that stage’s own cost; a turn that waited for a free thread starts further right, and that gap is its queued time.</p>
   </section>

   {turn&&<section className="panel turn-detail">
    <div className="section-heading"><div><div className="eyebrow">AGENT TURN {turn.index+1}</div><h3>Lane {turn.lane+1} · {n((turn.end-turn.start)/1000,2)} s · {turn.status}</h3></div><button className="text-button" onClick={()=>setSelection(null)}>Close turn</button></div>
    {turn.error&&<div className="banner error">{turn.error}</div>}
    <div className="turn-stages">{turn.segments.map((segment,i)=><div key={i} className="turn-stage" title={stageDescriptions[segment.stage]}><i style={{background:stageColors[segment.stage]}}/><b>{stageLabels[segment.stage]}</b><span>{int(segment.end-segment.start)} ms</span><small>starts {n(segment.start/1000,2)} s</small></div>)}</div>
    {turn.llmMs!==null&&<p className="hint">Model call {int(turn.llmMs)} ms · {turn.outputTokens===null?'output tokens unavailable':`${turn.outputTokens} output tokens`}{turn.generationTps===null?'':` · ${n(turn.generationTps)} generation tok/s`}.</p>}
    {!!turn.queuedMs&&<p className="hint">Waited {int(turn.queuedMs)} ms for a free host thread before its first stage ran.</p>}
    <p className="hint">Hover a stage for what it does. Each time is the stage’s own cost on the thread that ran it.</p>
   </section>}

   <section className="panel">
    <div className="section-heading">
     <div><h2>Throughput vs worker count</h2><p className="hint">Where the curve flattens is where this machine stops converting cores into agent throughput. {scalingMetrics[metric].description}</p></div>
     <label className="inline-field">Measurement<select aria-label="Scaling measurement" value={metric} onChange={e=>setMetric(e.target.value as ScalingMetric)}>{Object.entries(scalingMetrics).map(([key,spec])=><option key={key} value={key}>{spec.title}</option>)}</select></label>
    </div>
    <div className="chart-surface" {...tipHandlers} onClick={onScaleClick} dangerouslySetInnerHTML={{__html:scaling}}/>
    {others.length>0&&<p className="hint">Dashed lines are your other saved sweeps, drawn for comparison. Click a point on the solid line to jump the timeline to that worker count.</p>}
   </section>

   <section className="panel">
    <h2>All sweep points</h2>
    <div className="table-scroll"><table className="sweep-table">
     <thead><tr>{sweepColumns.map(c=><th key={c.header} title={c.help}><abbr title={c.help}>{c.header}</abbr></th>)}</tr></thead>
     <tbody>{stats.map(s=><tr key={s.workers} className={s.workers===workers?'picked':''} onClick={()=>chooseWorkers(s.workers)} tabIndex={0} role="button" aria-label={`Show the ${s.workers} worker timeline`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseWorkers(s.workers);}}}>
      {sweepColumns.map((column,i)=>{const value=column.value(s);return <td key={column.header}>{i===0?<><b>{s.workers}</b>{peak?.workers===s.workers&&<span className="peak-flag">peak</span>}</>:n(value,column.digits)+(value===null?'':column.suffix??'')}</td>;})}
     </tr>)}</tbody>
    </table></div>
    {!stats.length&&<p className="hint">Sweep points appear here as each worker count finishes.</p>}
    {!!stats.length&&<><p className="verdict">{cpuReading(stats)}</p><p className="verdict">{sweepVerdict(stats,run?.config.modelCall??'off')}</p></>}
   </section>

   {current&&<section className="panel">
    <h2>Where the time went at {workers} worker{workers===1?'':'s'}</h2>
    <p className="hint">Total stage time across every completed turn at this worker count, excluding time spent queued. Asking for more workers than the machine has threads does not make these stages cost more — it shows up in the Queued ms column instead{current.meanQueuedMs?`, currently ${Math.round(current.meanQueuedMs).toLocaleString()} ms per turn`:''}.</p>
    <div className="stage-bars">{breakdown.map(row=><div key={row.stage} className="stage-bar" title={stageDescriptions[row.stage]}>
     <span className="stage-bar-label"><i style={{background:stageColors[row.stage]}}/>{stageLabels[row.stage]}</span>
     <div className="stage-bar-track"><div style={{width:`${row.share??0}%`,background:stageColors[row.stage]}}/></div>
     <span className="stage-bar-value">{row.share===null?'—':n(row.share)+' %'}<small>{int(row.ms)} ms</small></span>
    </div>)}</div>
   </section>}

   <details className="panel"><summary>Sweep settings, environment and log</summary>{run&&<SweepDetails run={run}/>}</details>
  </>}

  {tip&&<div className="graph-tooltip" role="tooltip">{tip}</div>}
 </>;
}
// Kept as its own component so a long run log is only serialised when the disclosure is opened.
function SweepDetails({run}:{run:AgenticRun}){
 return <><pre>{JSON.stringify({config:run.config,environment:run.environment},null,2)}</pre><pre>{run.logs.join('\n')||'No additional messages.'}</pre></>;
}

function SweepForm({models,host,turnCost,busy,onStart,onError}:{models:Model[];host:{cpu:string;threads:number};turnCost:number;busy:boolean;onStart:(c:AgenticConfig)=>Promise<void>;onError:(message:string)=>void}){
 const [config,setConfig]=useState<AgenticConfig>(()=>structuredClone(defaultAgenticConfig));
 const set=<K extends keyof AgenticConfig>(key:K,value:AgenticConfig[K])=>setConfig(c=>({...c,[key]:value}));
 const allowed=useMemo(()=>reasoningOptions(models,config.modelKey?[config.modelKey]:[]),[models,config.modelKey]);
 const toggleWorker=(w:number)=>set('workers',config.workers.includes(w)?config.workers.filter(x=>x!==w):[...config.workers,w].sort((a,b)=>a-b));
 // Validation clones because it normalises the worker list in place; memoised so typing a name does
 // not clone and re-check the whole configuration on every keystroke.
 const problem=useMemo(()=>{try{validateAgenticConfig(structuredClone(config));return '';}catch(e){return (e as Error).message;}},[config]);
 const highest=config.workers.length?Math.max(...config.workers):0;
 const preset=presetName(config);
 const estimate=config.workers.length?estimateSweepMs(config,turnCost,host.threads):0;
 const pastThreads=config.workers.some(w=>w>host.threads);
 const modelOn=config.modelCall==='on';
 return <section className="panel sweep-form">
  <div className="section-heading"><div><div className="eyebrow">SWEEP SETUP</div><h2>Replay the same agent turns at every worker count</h2></div></div>

  <div className="segmented wide">{(['off','on'] as const).map(mode=><button key={mode} type="button" className={config.modelCall===mode?'chosen':''} onClick={()=>set('modelCall',mode)}>{mode==='off'?'Model call off · this machine only':'Model call on · use a model in LM Studio'}</button>)}</div>
  <p className="hint">{modelOn
   ?'Each turn sends one real request to the selected model, then does the host-side work. Use this to see where the GPU becomes the limit.'
   :'No model is loaded and LM Studio is not contacted. Every millisecond measured is this machine doing agent work — the right choice for comparing two CPUs.'}</p>

  <div className="presets">{[...Object.keys(agenticPresets),'Custom'].map(name=>{
   const spec=agenticPresets[name];
   return <button key={name} type="button" className={preset===name?'chosen':''} disabled={!spec} title={spec?`${spec.shape.turns} turns × ${spec.shape.repeats} repeats at ${spec.shape.workers.join('/')} workers`:'Shown when your settings do not match a preset'} onClick={()=>spec&&setConfig(c=>({...c,...spec.shape}))}>
    <b>{name}</b><small>{spec?spec.blurb:'Your own settings'}</small>
   </button>;
  })}</div>

  <div className="sweep-layout">
   <div>
    <div className="form-grid">
     <label className="field"><span>Sweep name</span><input aria-label="Sweep name" placeholder={host.cpu||'e.g. This workstation'} value={config.name} onChange={e=>set('name',e.target.value)}/><small>Name it after the machine — this is the label on the comparison lines.</small></label>
     <label className="field"><span>Agent turns per worker count</span><input aria-label="Agent turns" type="number" min="1" max="4096" value={config.turns} onChange={e=>set('turns',+e.target.value)}/><small>The same fixed set of turns is replayed at every worker count.</small></label>
     <label className="field"><span>Repeats per worker count</span><input aria-label="Repeats per worker count" type="number" min="1" max="10" value={config.repeats} onChange={e=>set('repeats',+e.target.value)}/><small>The median is reported with the spread between repeats. One repeat cannot tell a real difference from noise.</small></label>
     <label className="field"><span>Host work scale</span><input aria-label="Host work scale" type="number" min="1" max="40" value={config.hostWorkScale} onChange={e=>set('hostWorkScale',+e.target.value)}/><small>How much CPU work each turn does after the model answers — about {int(turnCost*config.hostWorkScale)} ms per turn on one core here.</small></label>
    </div>

    {modelOn&&<div className="form-grid">
     <label className="field"><span>Model</span><select aria-label="Sweep model" value={config.modelKey} onChange={e=>set('modelKey',e.target.value)}><option value="">Choose a downloaded model…</option>{models.map(m=><option key={m.key} value={m.key}>{m.display_name}</option>)}</select>{!models.length&&<small className="amber">No models found. Refresh the library on the Models screen, or leave the model call off.</small>}</label>
     <label className="field"><span>Output tokens per turn</span><input aria-label="Output tokens per turn" type="number" min="1" value={config.maxTokens} onChange={e=>set('maxTokens',+e.target.value)}/><small>Keep this small: the sweep is about how often turns happen, not how long each answer is.</small></label>
     <label className="field"><span>Context per turn</span><input aria-label="Context per turn" type="number" min="512" step="512" value={config.contextLength} onChange={e=>set('contextLength',+e.target.value)}/><small>The instance loads with this times the highest worker count: {highest?(config.contextLength*highest).toLocaleString():'—'} tokens.</small></label>
     <label className="field"><span>Reasoning</span><select aria-label="Sweep reasoning" value={config.reasoning} onChange={e=>set('reasoning',e.target.value)}><option value="default">Model default</option>{allowed.map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    </div>}
    {modelOn&&<label className="field"><span>Agent turn prompt</span><textarea aria-label="Agent turn prompt" rows={3} value={config.prompt} onChange={e=>set('prompt',e.target.value)}/><small>Every turn sends this prompt with its own turn identifier, so repeated turns are not served from one cached prefix.</small></label>}

    <div className="pill-group"><span className="pill-label">WORKER COUNTS TO SWEEP</span><div className="pills" role="group" aria-label="Worker counts to sweep">{agenticWorkerChoices.map(w=><button key={w} type="button" className={config.workers.includes(w)?'pill chosen':'pill'} aria-pressed={config.workers.includes(w)} title={w<=host.threads?`${w} of this machine's ${host.threads} threads`:`More workers than this machine's ${host.threads} threads — turns will queue`} onClick={()=>toggleWorker(w)}>{w}w</button>)}</div></div>
    <p className="hint">This machine reports <b>{host.threads} threads</b>. Counts above that are where turns start queueing, which is the point of the sweep — include at least one.</p>
   </div>

   <aside className="sweep-preview">
    <div className="eyebrow">BEFORE YOU START</div>
    <div className="big-number">{humanDuration(estimate)}<span>estimated{modelOn?', plus model time':''}</span></div>
    <dl>
     <dt>Preset</dt><dd>{preset}</dd>
     <dt>Worker counts</dt><dd>{config.workers.join(' / ')||'—'}</dd>
     <dt>Measured turns</dt><dd>{(config.turns*config.repeats*config.workers.length).toLocaleString()}</dd>
     <dt>Model call</dt><dd>{modelOn?(models.find(m=>m.key===config.modelKey)?.display_name??'Not chosen'):'Off'}</dd>
     <dt>One-worker baseline</dt><dd>{config.workers.includes(1)?'Included':'Missing'}</dd>
    </dl>
    {!config.workers.includes(1)&&<p className="hint amber">Without a 1w point, speedup and efficiency stay unavailable rather than being estimated.</p>}
    {!pastThreads&&<p className="hint">Every chosen count fits in this machine's threads, so you will not see where it tops out. Add a larger one to find the ceiling.</p>}
    {modelOn&&<p className="hint">The estimate covers host work only. Model time depends on the model and the server.</p>}
    {problem&&<p className="hint amber">{problem}</p>}
    <button className="primary full" disabled={busy||!!problem} onClick={()=>onStart(config).catch(e=>onError((e as Error).message))}><Cpu size={16}/>Start agent sweep <ChevronRight size={15}/></button>
    <p className="hint">Nothing is written outside this app's local database. A sweep can be cancelled at any time and keeps the worker counts it already finished.</p>
   </aside>
  </div>
 </section>;
}
