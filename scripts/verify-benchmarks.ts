import {liveModel} from './live-model';
import {benchmarkConfig,selectBenchmark,benchmarkRows} from '../src/benchmarks';
import {defaultConfig,defaultSettings} from '../src/defaults';
import {runEngine} from '../electron/engine';
import {listModels} from '../electron/lmstudio';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {Run} from '../src/types';
const out=path.resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const models=await listModels(defaultSettings),key=liveModel(models,true).key;
if(!models.some(m=>m.key===key))throw Error('Verification model unavailable');
for(const [packId,mtp] of [['gsm8k','off'],['gsm8k','on'],['ifeval','off'],['cruxeval','off']] as const){
 const selection={packId,count:2,seed:42},now=new Date().toISOString();
 const run:Run={id:randomUUID(),created:now,updated:now,status:'running',config:{...benchmarkConfig({...defaultConfig,modelKeys:[key]},selection),reasoning:'default',mtp,timeoutSec:180},tests:selectBenchmark(selection),modelInfo:{},environment:{purpose:'Two-question integration smoke check; not a model ability estimate'},logs:[],samples:[],waves:[]};
 await runEngine(run,defaultSettings,new AbortController().signal,e=>{
  if(e.type==='model')run.modelInfo[e.key]=e.info;
  if(e.type==='sample'){run.samples.push(e.sample);console.log(packId,mtp,e.sample.testId,e.sample.status,e.sample.objective.score);}
  if(e.type==='wave')run.waves.push(e.wave);
  if(e.type==='log'){run.logs.push(e.message);console.log(e.message);}
  if(e.type==='finish'){run.status=e.status;run.error=e.error;}
  writeFileSync(path.join(out,`${packId}-${mtp}.json`),JSON.stringify(run,null,2));
 });
 if(run.status!=='completed'||run.samples.filter(s=>!s.warmup).length!==2)throw Error(`Live integration failed: ${run.error}`);
 console.log(JSON.stringify(benchmarkRows(run)));
}
