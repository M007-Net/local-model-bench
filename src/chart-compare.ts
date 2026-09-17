import type {ChartRow} from './charts';
import type {HistoryRow} from './history';
import {shortDate,unknownFacet} from './history';
import {unknownBackend} from '../electron/runtime';

// Putting saved measurements beside the run you are looking at.
//
// The graphs draw one line per modelKey, which is how the MTP sweep already shows several depths of
// one model at once: it relabels the key and the series separate themselves. The same trick carries
// a different engine, or a model measured in some other run, onto the same axes — so "is ROCm
// faster at prompt processing" becomes a line to look at rather than two screens to remember.
//
// Nothing here recomputes a measurement. Every overlaid point is a saved row from a finished run,
// relabelled so the legend says where it came from.

export type OverlayKind='backend'|'model';
export type OverlayOption={id:string;kind:OverlayKind;label:string;detail:string;points:number};

export const overlayId=(kind:OverlayKind,value:string)=>`${kind}:${value}`;
const parseId=(id:string):{kind:OverlayKind;value:string}|null=>{
 const at=id.indexOf(':');
 if(at<0)return null;
 const kind=id.slice(0,at);
 return kind==='backend'||kind==='model'?{kind,value:id.slice(at+1)}:null;
};

// One saved row per (model, test, concurrency, depth). Several runs can hold the same combination,
// and plotting all of them would draw one series through points taken weeks apart; the most recent
// run wins, which is also the one whose conditions are most likely to still apply.
function newestPerPoint(rows:HistoryRow[]):HistoryRow[]{
 const best=new Map<string,HistoryRow>();
 for(const r of rows){
  const key=JSON.stringify([r.modelKey,r.testId,r.concurrency,r.mtpDepth]);
  const prior=best.get(key);
  if(!prior||Date.parse(r.runCreated)>Date.parse(prior.runCreated))best.set(key,r);
 }
 return [...best.values()];
}

// What this run could usefully be compared against: the same test, measured somewhere else. A
// backend only appears when it has measurements of a model this run also measured, because an
// engine comparison against a different model would not be an engine comparison.
export function overlayOptions(history:HistoryRow[],runId:string,testId:string,currentBackend:string,currentModels:string[]):OverlayOption[]{
 const elsewhere=history.filter(r=>r.runId!==runId&&r.testId===testId);
 const models=new Set(currentModels);
 const out:OverlayOption[]=[];
 const backends=new Map<string,HistoryRow[]>();
 for(const r of elsewhere){
  if(r.backend===currentBackend||r.backend===unknownBackend||!models.has(r.modelKey))continue;
  backends.set(r.backend,[...(backends.get(r.backend)??[]),r]);
 }
 for(const [label,rows] of [...backends].sort((a,b)=>a[0].localeCompare(b[0]))){
  const points=newestPerPoint(rows);
  out.push({id:overlayId('backend',label),kind:'backend',label:`Compare with ${label}`,
   detail:`${[...new Set(points.map(p=>p.modelKey))].length} of this run's model(s), measured on ${label}`,points:points.length});
 }
 const others=new Map<string,HistoryRow[]>();
 for(const r of elsewhere){
  if(models.has(r.modelKey))continue;
  others.set(r.modelKey,[...(others.get(r.modelKey)??[]),r]);
 }
 for(const [key,rows] of [...others].sort((a,b)=>a[0].localeCompare(b[0]))){
  const points=newestPerPoint(rows);
  const last=points.map(p=>p.runCreated).sort().at(-1);
  out.push({id:overlayId('model',key),kind:'model',label:key,
   detail:`${points[0]?.backend&&points[0].backend!==unknownBackend?points[0].backend+' · ':''}last measured ${shortDate(last)}`,points:points.length});
 }
 return out;
}

// The chosen overlays as chart rows, with the key relabelled so the legend says where each line came
// from. A backend overlay keeps the model name and adds the engine; a model overlay names the model
// and the engine it was measured on, because the same model on two engines is two different lines.
export function overlayRows(history:HistoryRow[],ids:string[],runId:string,testId:string,currentModels:string[]):ChartRow[]{
 const models=new Set(currentModels);
 const out:ChartRow[]=[];
 for(const id of ids){
  const parsed=parseId(id);
  if(!parsed)continue;
  const matching=history.filter(r=>r.runId!==runId&&r.testId===testId&&(
   parsed.kind==='backend'?r.backend===parsed.value&&models.has(r.modelKey):r.modelKey===parsed.value));
  for(const r of newestPerPoint(matching))
   out.push({...r,modelKey:`${r.modelKey} · ${r.backend===unknownBackend?shortDate(r.runCreated):r.backend}`});
 }
 return out;
}

// The engines this run's measurements could be set beside: ones that measured a model this run also
// measured, in some other run. A run whose engine could not be determined is not offered, because
// "Unknown engine" is not a thing to compare against.
export function comparableBackends(history:HistoryRow[],runId:string,currentBackend:string,models:string[]):string[]{
 const set=new Set(models);
 const found=new Set<string>();
 for(const r of history)
  if(r.runId!==runId&&r.backend!==currentBackend&&r.backend!==unknownBackend&&set.has(r.modelKey))found.add(r.backend);
 return [...found].sort();
}

// Saved rows for the chosen engines, for models this run measured, newest run per measurement. Used
// by the comparison table, where the engine becomes a column rather than part of the series name.
export function backendRows(history:HistoryRow[],runId:string,backends:string[],models:string[]):HistoryRow[]{
 const want=new Set(backends),set=new Set(models);
 return newestPerPoint(history.filter(r=>r.runId!==runId&&want.has(r.backend)&&set.has(r.modelKey)));
}

// Whether an overlay is still on offer after the test changed. A selection kept for a test that has
// no such saved data would silently draw nothing, so the caller drops it instead.
export const stillOffered=(ids:string[],options:OverlayOption[]):string[]=>{
 const live=new Set(options.map(o=>o.id));
 return ids.filter(id=>live.has(id));
};
