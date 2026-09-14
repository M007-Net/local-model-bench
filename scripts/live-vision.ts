// Live end-to-end check of the vision path against the real LM Studio server.
// Set LMB_MODEL_KEY to an exact identifier from the app's Models screen and
// LMB_VISION to auto, off or on. Nothing is chosen automatically.
import {liveModel} from './live-model';
import {runEngine} from '../electron/engine';
import {Store} from '../electron/store';
import {defaultConfig,defaultSettings,starterTests} from '../src/defaults';
import {listModels,cli} from '../electron/lmstudio';
import {exportText,visionRunNote} from '../electron/export';
import {visionTests} from '../electron/vision-image';
import {visionSupport,type VisionMode,type VisionState} from '../electron/vision';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import type {Run} from '../src/types';
import os from 'node:os';

const mode=(process.env.LMB_VISION??'on') as VisionMode;
if(!['auto','off','on'].includes(mode))throw Error('Set LMB_VISION to auto, off or on.');
// MTP is independent of vision; set LMB_MTP to exercise both controls in one run.
const mtp=(process.env.LMB_MTP??'off') as 'off'|'on';
if(!['off','on'].includes(mtp))throw Error('Set LMB_MTP to off or on.');
const settings={...defaultSettings,timeoutSec:180,loadTimeoutSec:600};
const models=await listModels(settings);
const model=liveModel(models);
console.log(`Model: ${model.display_name} (${model.key})`);
console.log(`Reported native MTP support: ${JSON.stringify(model.nativeMtp?.supported)}`);
console.log(`Reported vision capability: ${JSON.stringify(model.capabilities?.vision)} — ${visionSupport(model).reason}`);
const textTest=starterTests.find(t=>t.id==='instructions')!;
const tests=[textTest,...(mode==='on'?visionTests():[])];
const now=new Date().toISOString();
const run:Run={id:randomUUID(),created:now,updated:now,status:'running',
 config:{...structuredClone(defaultConfig),name:`Live vision validation · vision ${mode} · mtp ${mtp}`,vision:mode,mtp,modelKeys:[model.key],testIds:[textTest.id],mode:'quality',preset:'Custom',concurrency:[1],waves:1,maxTokens:192,contextLength:4096,reasoning:'default',judgeModel:'',timeoutSec:180},
 tests,modelInfo:{},environment:{cpu:os.cpus()[0]?.model,totalMemory:os.totalmem(),runtime:await cli(settings,['runtime','ls']),judgePrompt:settings.judgePrompt},logs:[],samples:[],waves:[]};
mkdirSync('work/live',{recursive:true});
const store=new Store('work/live/vision.sqlite');store.saveRun(run);
const controller=new AbortController();process.on('SIGINT',()=>controller.abort());
await runEngine(run,settings,controller.signal,e=>{
 if(e.type==='model'){run.modelInfo[e.key]=e.info;store.saveRun(run);}
 if(e.type==='sample'){run.samples.push(e.sample);store.saveSample(e.sample);
  if(!e.sample.warmup)console.log(`SAMPLE ${e.sample.testId}: ${e.sample.status}; objective ${e.sample.objective.score}; answer ${JSON.stringify(e.sample.output.slice(0,60))}`);}
 if(e.type==='wave'){run.waves.push(e.wave);store.saveWave(e.wave);}
 if(e.type==='log'){console.log('LOG '+e.message);run.logs.push(e.message);store.saveRun(run);}
 if(e.type==='finish'){run.status=e.status;run.error=e.error;run.updated=new Date().toISOString();store.saveRun(run);}
});
const state=(run.modelInfo[model.key] as {vision?:VisionState}|undefined)?.vision;
console.log('\nConfirmed vision state: '+JSON.stringify(state,null,1));
console.log('Run note: '+JSON.stringify(visionRunNote(run),null,1));
writeFileSync('work/live/vision.json',exportText(run,'json'));
writeFileSync('work/live/vision.md',exportText(run,'md'));
store.close();
console.log('FINAL '+run.status+(run.error?': '+run.error:''));
if(run.status!=='completed')process.exitCode=1;
