import type {GpuStat,GpuStats,GpuTick} from './types';
const metricKeys=['tempCore','tempHotSpot','tempMemory','power','load','clockCore','fanRpm'] as const;
export type GpuMetricKey=typeof metricKeys[number];
export const gpuMetricLabels:Record<GpuMetricKey,string>={tempCore:'Core temperature',tempHotSpot:'Hot spot temperature',tempMemory:'Memory temperature',power:'Board power',load:'Core load',clockCore:'Core clock',fanRpm:'Fan speed'};
export const gpuMetricUnits:Record<GpuMetricKey,string>={tempCore:'°C',tempHotSpot:'°C',tempMemory:'°C',power:'W',load:'%',clockCore:'MHz',fanRpm:'rpm'};
export function statOf(values:(number|null|undefined)[]):GpuStat|null{
 let min=Infinity,max=-Infinity,sum=0,count=0;
 for(const v of values){if(typeof v!=='number'||!Number.isFinite(v))continue;if(v<min)min=v;if(v>max)max=v;sum+=v;count++;}
 return count?{min,avg:sum/count,max}:null;
}
export function statsFrom(ticks:GpuTick[],exact:boolean):GpuStats|null{
 if(!ticks.length)return null;
 const memory=statOf(ticks.map(t=>t.memoryUsed));
 return {samples:ticks.length,exact,tempCore:statOf(ticks.map(t=>t.tempCore)),tempHotSpot:statOf(ticks.map(t=>t.tempHotSpot)),tempMemory:statOf(ticks.map(t=>t.tempMemory)),power:statOf(ticks.map(t=>t.power)),load:statOf(ticks.map(t=>t.load)),clockCore:statOf(ticks.map(t=>t.clockCore)),fanRpm:statOf(ticks.map(t=>t.fanRpm)),memoryUsedMax:memory?memory.max:null};
}
// Requests shorter than one sampling interval can contain no reading of their own. Rather than
// reporting nothing, the nearest reading is used and flagged with exact=false so it is never
// mistaken for a measured window.
export function windowStats(ticks:GpuTick[],from:number,to:number,intervalMs:number):GpuStats|null{
 const inside=ticks.filter(t=>t.t>=from&&t.t<=to);
 if(inside.length)return statsFrom(inside,true);
 const middle=(from+to)/2,tolerance=Math.max(2000,intervalMs*2);
 let nearest:GpuTick|null=null,distance=Infinity;
 for(const tick of ticks){const d=Math.abs(tick.t-middle);if(d<distance){distance=d;nearest=tick;}}
 return nearest&&distance<=tolerance?statsFrom([nearest],false):null;
}
// Combines already-aggregated windows (per request) into one figure per model/test/concurrency.
// Averages stay weighted by how many readings each window contained.
export function combineStats(list:(GpuStats|null|undefined)[]):GpuStats|null{
 const parts=list.filter((g):g is GpuStats=>!!g);
 if(!parts.length)return null;
 const combined=(key:GpuMetricKey):GpuStat|null=>{
  let min=Infinity,max=-Infinity,sum=0,weight=0;
  for(const part of parts){const stat=part[key];if(!stat)continue;if(stat.min<min)min=stat.min;if(stat.max>max)max=stat.max;sum+=stat.avg*part.samples;weight+=part.samples;}
  return weight?{min,avg:sum/weight,max}:null;
 };
 const memory=parts.map(p=>p.memoryUsedMax).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
 return {samples:parts.reduce((n,p)=>n+p.samples,0),exact:parts.every(p=>p.exact),tempCore:combined('tempCore'),tempHotSpot:combined('tempHotSpot'),tempMemory:combined('tempMemory'),power:combined('power'),load:combined('load'),clockCore:combined('clockCore'),fanRpm:combined('fanRpm'),memoryUsedMax:memory.length?Math.max(...memory):null};
}
// Keeps stored runs small. Peaks are preserved for temperatures, clock, and fan; sustained values
// (power, load) are averaged, which is what those readings mean over a bucket.
export function downsample(ticks:GpuTick[],limit:number):GpuTick[]{
 if(ticks.length<=limit||limit<1)return ticks;
 const size=Math.ceil(ticks.length/limit),out:GpuTick[]=[];
 for(let i=0;i<ticks.length;i+=size){
  const bucket=ticks.slice(i,i+size),peak=(key:GpuMetricKey)=>statOf(bucket.map(t=>t[key]));
  const power=peak('power'),load=peak('load'),memory=statOf(bucket.map(t=>t.memoryUsed));
  out.push({t:bucket[bucket.length-1].t,tempCore:peak('tempCore')?.max??null,tempHotSpot:peak('tempHotSpot')?.max??null,tempMemory:peak('tempMemory')?.max??null,power:power?power.avg:null,load:load?load.avg:null,clockCore:peak('clockCore')?.max??null,fanRpm:peak('fanRpm')?.max??null,memoryUsed:memory?memory.max:null});
 }
 return out;
}
export const gpuMetrics=metricKeys;
