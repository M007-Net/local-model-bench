import React,{useEffect,useState} from 'react';
import type {Run,RunConfig} from './types';
import {summaries} from '../electron/export';
import {performanceSummary} from './performance-summary';

const fmt=(v:number|null|undefined)=>v==null?'—':v.toLocaleString(undefined,{maximumFractionDigits:1});
export function LoadProfileControls({config:c,onChange,managed}:{config:RunConfig;onChange:(c:Partial<RunConfig>)=>void;managed:boolean}){
 const [targets,setTargets]=useState(c.contextSweep?.join(', ')??'');
 useEffect(()=>setTargets(c.contextSweep?.join(', ')??''),[c.contextSweep]);
 const parsed=targets.split(',').map(s=>Number(s.trim()));
 const valid=targets.trim()&&parsed.length<=8&&parsed.every(n=>Number.isInteger(n)&&n>=128&&n<=131072);
 const apply=()=>{if(valid)onChange({contextSweep:[...new Set(parsed)].sort((a,b)=>a-b)});};
 return <div className="load-profile">
  <div className="section-heading"><div><h3>Load pattern</h3><p className="hint">Use waves for a quick comparison or sustained load to find slowdowns over time.</p></div></div>
  <label className="field"><span>Load pattern</span><select aria-label="Load pattern" value={c.loadProfile??'waves'} onChange={e=>onChange({loadProfile:e.target.value as 'waves'|'sustained',...(e.target.value==='sustained'?{mode:'performance',benchmark:undefined,vision:'off'}:{})})}><option value="waves">Fixed request waves</option><option value="sustained">Sustained concurrency</option></select></label>
  {c.loadProfile==='sustained'&&<><label className="field"><span>Seconds per combination</span><input aria-label="Seconds per combination" type="number" min={1} max={3600} value={c.durationSec??30} onChange={e=>{if(e.target.value)onChange({durationSec:Number(e.target.value)});}}/></label><p className="hint">Each model, prompt size, concurrency level and MTP depth gets this duration. Finished requests are replaced immediately. New requests stop at the deadline; remaining requests finish under their normal timeout. Throughput includes this drain time. A point stops at 10,000 requests or about 100 MB of saved prompt text.</p></>}
  <label className="check"><input type="checkbox" checked={!!c.contextSweep?.length} onChange={e=>onChange({contextSweep:e.target.checked?[256,512,1024]:undefined,...(e.target.checked?{mode:'performance',benchmark:undefined,vision:'off',performanceLengths:['short']}:{})})}/>Sweep input context sizes</label>
  {!!c.contextSweep?.length&&<><label className="field"><span>Approximate input token targets</span><input aria-label="Approximate input token targets" value={targets} onChange={e=>setTargets(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();apply();}}}/><small>Comma-separated, up to eight sizes from 128 to 131,072. Applied targets: {c.contextSweep.join(', ')}.</small></label>{!valid&&<p role="alert" className="hint amber">Enter valid whole-number targets. The last valid targets remain applied.</p>}<p className="hint">Uses deterministic text at roughly four characters per token. Actual token counts depend on the model and are shown in results. This replaces the short/medium/long prompts. {managed?'Set the context length below large enough for the biggest prompt plus output.':'Set your endpoint’s per-request context large enough for the biggest prompt plus output; this app does not reconfigure it.'} Unique leading identifiers reduce prefix reuse but cannot guarantee an empty cache.</p></>}
 </div>;
}
export function LoadResults({run}:{run:Run}){
 const measured=run.samples.filter(s=>!s.warmup),timing=performanceSummary(measured),rows=summaries(run);
 if(!timing.streamingRequests&&!run.config.contextSweep?.length&&run.config.loadProfile!=='sustained')return null;
 return <section className="panel"><h2>Streaming and load behavior</h2><p className="hint">First output is measured at this client, including network, server queueing and prompt processing. Stream gaps measure arriving chunks, which can contain multiple tokens. They are not exact inter-token latency.</p>
  <div className="table-scroll"><table><thead><tr><th>Model / prompt</th><th>Concurrency</th><th>Completed</th><th>Actual input tokens</th><th>First output p50 / p95 / p99 (ms)</th><th>Response p99 (ms)</th><th>Mean / worst stream gap (ms)</th><th>Estimated ms/token</th></tr></thead><tbody>{rows.map(r=><tr key={[r.modelKey,r.testId,r.concurrency,r.mtpDepth].join('|')}><td>{r.model}<small className="block">{r.test}{r.mtpDepth!==null?` · MTP depth ${r.mtpDepth}`:''}</small></td><td>{r.concurrency}</td><td>{r.requests-r.failures} / {r.requests}</td><td>{fmt(r.inputTokensMean)}</td><td>{fmt(r.firstEventP50Ms)} / {fmt(r.firstEventP95Ms)} / {fmt(r.firstEventP99Ms)}<small className="block">{r.streamingRequests} timed responses</small></td><td>{fmt(r.requestP99Ms)}</td><td>{fmt(r.meanStreamGapMs)} / {fmt(r.worstStreamGapMs)}</td><td>{fmt(r.estimatedTpotMs)}</td></tr>)}</tbody></table></div>
  <p className="hint">Percentiles use successful measured requests; warm-ups and failures are excluded. Failures remain in the completion count. Small samples make p95 and p99 unstable. Estimated ms/token divides the first-to-last output interval by reported output tokens minus one; buffering and hidden reasoning can affect it. Unavailable timings stay blank.</p>
  {run.config.loadProfile==='sustained'&&<p className="hint">Sustained concurrency: {run.config.durationSec??30} seconds of new requests per combination, followed by drain. This is a fixed-concurrency test, not a fixed-arrival-rate simulation. Each saved wave records its actual elapsed time and throughput.</p>}
 </section>;
}
