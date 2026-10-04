import {isLoopbackUrl} from '../src/endpoint';
import {idleSampler} from './gpu';
import { parentPort, workerData } from 'node:worker_threads';
import { runEngine } from './engine';
import { startGpuSampler } from './gpu';
const controller=new AbortController();
parentPort!.on('message',(m)=>{if(m==='cancel')controller.abort();});
const gpu=!isLoopbackUrl(workerData.settings.baseUrl)?idleSampler('Remote endpoint GPU telemetry is unavailable; this computer is the benchmark client.'):startGpuSampler(workerData.vendorDir,workerData.gpuIntervalMs??1000,message=>parentPort!.postMessage({type:'log',message}));
runEngine(workerData.run,workerData.settings,controller.signal,e=>parentPort!.postMessage(e),undefined,workerData.retries,workerData.gradeOnly,gpu).finally(()=>{gpu.stop();parentPort!.close();});
