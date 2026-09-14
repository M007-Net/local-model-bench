// Verifies GPU telemetry on this machine without touching LM Studio: starts the real sampler,
// collects a few seconds of readings, and prints what a run would record.
import path from 'node:path';
import {startGpuSampler} from '../electron/gpu';
const seconds=Number(process.argv[2]||6);
const started=Date.now();
const sampler=startGpuSampler(path.join(import.meta.dirname,'..','vendor'),1000,message=>console.log('log:',message));
await new Promise(resolve=>setTimeout(resolve,seconds*1000));
const window=sampler.window(started+1000,Date.now());
const summary=sampler.summary(started,Date.now());
sampler.stop();
console.log('\nDetected devices:',summary.devices.join(', ')||'none');
console.log('Recorded device:',summary.device??'none');
console.log('Readings:',summary.stats?.samples??0,'· available:',summary.available);
console.log('Note:',summary.note);
if(summary.stats)for(const [key,value] of Object.entries(summary.stats))if(value&&typeof value==='object'&&'min' in value)console.log(` ${key.padEnd(13)} min ${value.min.toFixed(1)} · avg ${value.avg.toFixed(1)} · max ${value.max.toFixed(1)}`);
console.log('Sample-sized window:',window?`${window.samples} reading(s), hot spot max ${window.tempHotSpot?.max ?? 'unavailable'}`:'no readings');
if(!summary.available){console.error('\nGPU telemetry is NOT working on this machine.');process.exit(1);}
console.log('\nGPU telemetry is working.');
process.exit(0);
