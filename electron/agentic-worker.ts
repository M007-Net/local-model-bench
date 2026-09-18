import {parentPort,workerData} from 'node:worker_threads';
import os from 'node:os';
import {runAgenticSweep,hostPool,hostWorkerFile} from './agentic-engine';
import {startGpuSampler} from './gpu';
const controller=new AbortController();
parentPort!.on('message',m=>{if(m==='cancel')controller.abort();});
const gpu=startGpuSampler(workerData.vendorDir,workerData.gpuIntervalMs??1000,message=>parentPort!.postMessage({type:'log',message}));
// The stage worker is emitted beside this file by the same build step, so `__dirname` locates it.
// Never more threads than the sweep's largest worker count: past that they could only sit idle.
const threads=Math.min(os.availableParallelism?.()??os.cpus().length,Math.max(...workerData.run.config.workers));
try{
 const host=hostPool(hostWorkerFile(__dirname),threads);
 runAgenticSweep(workerData.run,workerData.settings,controller.signal,e=>parentPort!.postMessage(e),{host,gpu}).finally(()=>{gpu.stop();parentPort!.close();});
}catch(e){
 parentPort!.postMessage({type:'finish',status:'failed',error:(e as Error).message});
 gpu.stop();parentPort!.close();
}
