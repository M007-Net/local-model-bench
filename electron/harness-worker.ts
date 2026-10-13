import {parentPort,workerData} from 'node:worker_threads';
import {runHarnessEvaluation} from './harness-engine';
const controller=new AbortController();
parentPort!.on('message',message=>{if(message==='cancel')controller.abort();});
runHarnessEvaluation(workerData.run,workerData.settings,controller.signal,event=>parentPort!.postMessage(event)).catch(error=>{parentPort!.postMessage({type:'fatal',message:error.message});}).finally(()=>parentPort!.close());
