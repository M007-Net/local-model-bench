import {liveModel} from './live-model';
import {runEngine} from '../electron/engine';
import {Store} from '../electron/store';
import {defaultConfig,defaultSettings,starterTests} from '../src/defaults';
import {listModels,cli} from '../electron/lmstudio';
import {exportText} from '../electron/export';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Run} from '../src/types';
import os from 'node:os';
const settings={...defaultSettings,timeoutSec:180,loadTimeoutSec:300};
const models=await listModels(settings);
const keys=[liveModel(models).key];
const tests=[starterTests.find(t=>t.id==='instructions')!];
const now=new Date().toISOString();
const run:Run={id:randomUUID(),created:now,updated:now,status:'running',config:{...structuredClone(defaultConfig),name:'Live validation · selected model · concurrency 1 & 2',modelKeys:keys,testIds:tests.map(t=>t.id),mode:'quality',preset:'Custom',concurrency:[1,2],waves:1,maxTokens:128,contextLength:4096,reasoning:'default',judgeModel:'',timeoutSec:180},tests,modelInfo:{},environment:{cpu:os.cpus()[0]?.model,totalMemory:os.totalmem(),runtime:await cli(settings,['runtime','ls']),judgePrompt:settings.judgePrompt},logs:[],samples:[],waves:[]};
mkdirSync('work/live',{recursive:true});const store=new Store('work/live/bench.sqlite');store.saveRun(run);const controller=new AbortController();process.on('SIGINT',()=>controller.abort());
await runEngine(run,settings,controller.signal,e=>{
 if(e.type==='progress')console.log(e.progress.phase+': '+e.progress.message);
 if(e.type==='model'){run.modelInfo[e.key]=e.info;store.saveRun(run);}
 if(e.type==='sample'){run.samples.push(e.sample);store.saveSample(e.sample);console.log(`SAMPLE ${e.sample.modelKey} c=${e.sample.concurrency} warmup=${e.sample.warmup}: ${e.sample.status}; ${e.sample.metrics.generationTps} tok/s; objective ${e.sample.objective.score}`);}
 if(e.type==='wave'){run.waves.push(e.wave);store.saveWave(e.wave);}
 if(e.type==='grade'){const s=run.samples.find(s=>s.id===e.sampleId)!;s.grades.push(e.grade);store.saveSample(s);console.log('GRADE '+e.grade.score);}
 if(e.type==='log'){console.log(e.message);run.logs.push(e.message);store.saveRun(run);}
 if(e.type==='finish'){run.status=e.status;run.error=e.error;run.updated=new Date().toISOString();store.saveRun(run);}
});
writeFileSync('work/live/result.json',exportText(run,'json'));writeFileSync('work/live/result.md',exportText(run,'md'));store.close();
console.log('FINAL '+run.status);if(run.status!=='completed')process.exitCode=1;
