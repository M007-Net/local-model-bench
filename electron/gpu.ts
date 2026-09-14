import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { GpuStats, GpuTick, RunGpu } from '../src/types';
import { downsample, statsFrom, windowStats } from '../src/gpu-stats';

export type GpuSampler={window(from:number,to:number):GpuStats|null;summary(from:number,to:number):RunGpu;stop():void};
type Device={ticks:GpuTick[];memoryTotal:number|null;peakPower:number};
const SERIES_LIMIT=3000,TICK_LIMIT=43200;
const finite=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)?v:null;
const unavailable=(note:string,intervalMs:number):RunGpu=>({available:false,device:null,devices:[],intervalMs,note,stats:null,perDevice:{},series:[],seriesNote:''});
export function idleSampler(note:string,intervalMs=0):GpuSampler{return {window:()=>null,summary:()=>unavailable(note,intervalMs),stop(){}};}

// Reads GPU sensors through LibreHardwareMonitor in a separate PowerShell process. Sampling is
// best effort: a run is never failed or delayed because telemetry is missing, and every value the
// card does not expose stays unavailable rather than being estimated.
export function startGpuSampler(vendorDir:string|undefined,intervalMs:number,log:(message:string)=>void):GpuSampler{
 if(process.platform!=='win32')return idleSampler('GPU telemetry is only collected on Windows.',intervalMs);
 if(!vendorDir)return idleSampler('GPU telemetry was not started: sensor files were not located.',intervalMs);
 const devices=new Map<string,Device>();
 let order:string[]=[],note='GPU telemetry is starting…',child:ChildProcess|null=null,stopped=false,failed='',buffer='',interval=intervalMs;
 const fail=(message:string)=>{if(failed||stopped)return;failed=message;note=message;log(message);};
 const record=(payload:{t:number;g:{n:string;tc:number|null;th:number|null;tm:number|null;p:number|null;l:number|null;ck:number|null;f:number|null;mu:number|null;mt:number|null}[]})=>{
  const t=finite(payload.t);if(t===null||!Array.isArray(payload.g))return;
  for(const entry of payload.g){
   if(!entry||typeof entry.n!=='string')continue;
   let device=devices.get(entry.n);
   if(!device){device={ticks:[],memoryTotal:null,peakPower:0};devices.set(entry.n,device);order.push(entry.n);}
   const power=finite(entry.p);
   device.memoryTotal=finite(entry.mt)??device.memoryTotal;
   if(power!==null&&power>device.peakPower)device.peakPower=power;
   device.ticks.push({t,tempCore:finite(entry.tc),tempHotSpot:finite(entry.th),tempMemory:finite(entry.tm),power,load:finite(entry.l),clockCore:finite(entry.ck),fanRpm:finite(entry.f),memoryUsed:finite(entry.mu)});
   // Very long runs are thinned rather than left to grow without limit.
   if(device.ticks.length>TICK_LIMIT){device.ticks=device.ticks.filter((_,i)=>i%2===0);interval*=2;}
  }
 };
 const line=(text:string)=>{
  const trimmed=text.trim();if(!trimmed.startsWith('{'))return;
  let payload:Record<string,unknown>;try{payload=JSON.parse(trimmed);}catch{return;}
  if(typeof payload.error==='string')return fail('GPU telemetry unavailable: '+payload.error);
  if(payload.ready===true){const names=Array.isArray(payload.devices)?payload.devices.filter((d):d is string=>typeof d==='string'):[];note=`Sampled every ${interval} ms with LibreHardwareMonitor. Detected: ${names.join(', ')||'none'}.`;log(`GPU telemetry started (${interval} ms interval): ${names.join(', ')||'no GPU detected'}.`);return;}
  if(typeof payload.t==='number')record(payload as never);
 };
 try{
  // Named absolutely. CreateProcess searches the application directory before System32,
  // and a per-user install lives under %LOCALAPPDATA%, so a bare "powershell.exe" would
  // resolve to anything dropped beside the app.
  const shell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  if(!existsSync(shell))return idleSampler('GPU telemetry unavailable: Windows PowerShell was not found at '+shell+'.',intervalMs);
  child=spawn(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(vendorDir,'gpu-sampler.ps1'),'-Dll',path.join(vendorDir,'LibreHardwareMonitorLib.dll'),'-IntervalMs',String(intervalMs)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 }catch(e){return idleSampler('GPU telemetry unavailable: '+(e as Error).message,intervalMs);}
 child.stdout?.setEncoding('utf8');
 child.stdout?.on('data',(chunk:string)=>{buffer+=chunk;const parts=buffer.split('\n');buffer=parts.pop()??'';for(const part of parts)line(part);});
 child.stderr?.setEncoding('utf8');
 // A warning on stderr is not a failure. Treating it as one used to pin the run note to
 // "telemetry unavailable" permanently while readings kept arriving, so the report
 // denied having the data it was showing. Only error and non-zero exit decide that.
 child.stderr?.on('data',(chunk:string)=>{const first=String(chunk).trim().split('\n')[0];if(first)log('GPU sampler: '+first);});
 child.on('error',e=>fail('GPU telemetry unavailable: '+e.message));
 child.on('exit',code=>{if(!stopped&&code!==0&&!failed)fail(`GPU telemetry stopped unexpectedly (exit code ${code}).`);});
 const primary=()=>{
  let best='',bestMemory=-1,bestPower=-1;
  for(const name of order){const device=devices.get(name)!;const memory=device.memoryTotal??-1;
   if(memory>bestMemory||(memory===bestMemory&&device.peakPower>bestPower)){best=name;bestMemory=memory;bestPower=device.peakPower;}}
  return best;
 };
 const ticksOf=(name:string)=>devices.get(name)?.ticks??[];
 return {
  window(from,to){const name=primary();return name?windowStats(ticksOf(name),from,to,interval):null;},
  summary(from,to){
   const name=primary();
   if(!name)return unavailable(failed||'GPU telemetry produced no readings for this run.',interval);
   const within=(list:GpuTick[])=>list.filter(t=>t.t>=from&&t.t<=to);
   const series=within(ticksOf(name));
   const perDevice=Object.fromEntries(order.map(device=>[device,statsFrom(within(ticksOf(device)),true)]));
   const reduced=downsample(series,SERIES_LIMIT);
   return {available:series.length>0,device:name,devices:[...order],intervalMs:interval,
    note:series.length?`${note} Readings cover the whole run, including model loading and idle gaps between requests; per-request figures use only each request's own window.`:(failed||'GPU telemetry produced no readings for this run.'),
    stats:statsFrom(series,true),perDevice,series:reduced,
    seriesNote:reduced.length<series.length?`Chart data reduced from ${series.length} readings to ${reduced.length} buckets: temperatures, clock, and fan show each bucket's peak; power and load show its average.`:''};
  },
  stop(){stopped=true;try{child?.kill();}catch{}}
 };
}
