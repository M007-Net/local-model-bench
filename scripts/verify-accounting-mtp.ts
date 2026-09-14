import {liveModel} from './live-model';
import {accountingTests,accountingCases} from '../src/accounting';
import {defaultConfig,defaultSettings} from '../src/defaults';
import {runEngine} from '../electron/engine';
import {listModels,api} from '../electron/lmstudio';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {Run} from '../src/types';
const out=path.resolve(process.argv[2]);mkdirSync(out,{recursive:true});
writeFileSync(path.join(out,'accounting-questions.json'),JSON.stringify(accountingTests.map(({id,name,prompt,maxTokens})=>({id,name,prompt,maxTokens})),null,2));
writeFileSync(path.join(out,'accounting-answer-keys.json'),JSON.stringify(accountingCases.map(c=>({id:'accounting-'+c.id,answer:c.answer,verification:c.verification})),null,2));
writeFileSync(path.join(out,'accounting-suite.json'),JSON.stringify(accountingTests,null,2));
const models=await listModels(defaultSettings);
writeFileSync(path.join(out,'native-mtp-models.json'),JSON.stringify(models.map(m=>({key:m.key,quantization:m.quantization?.name,nativeMtp:m.nativeMtp})),null,2));
console.log('Compatibility:',models.map(m=>`${m.key}: ${m.nativeMtp?.supported??'unknown'}`).join('\n'));
const key=liveModel(models,true).key;
if(models.find(m=>m.key===key)?.nativeMtp?.supported!==true)throw Error('Expected live MTP model not confirmed');
for(const m of models)for(const i of m.loaded_instances)if(i.id==='lmb-mtp-verification')await api(defaultSettings,'/api/v1/models/unload',{instance_id:i.id});
for(const mtp of ['off','on'] as const){
 const now=new Date().toISOString();
 const run:Run={id:randomUUID(),created:now,updated:now,status:'running',config:{...defaultConfig,name:`Accounting native MTP ${mtp} verification`,modelKeys:[key],testIds:accountingTests.map(t=>t.id),mode:'quality',preset:'Custom',concurrency:[1],waves:1,maxTokens:1536,contextLength:4096,reasoning:'default',mtp,mtpDraftTokens:2},tests:accountingTests,modelInfo:{},environment:{purpose:'Integration check, not a statistically controlled speed comparison'},logs:[],samples:[],waves:[]};
 await runEngine(run,defaultSettings,new AbortController().signal,e=>{
  if(e.type==='model')run.modelInfo[e.key]=e.info;
  if(e.type==='sample'){run.samples.push(e.sample);console.log(mtp,e.sample.testId,e.sample.status,e.sample.objective.score);}
  if(e.type==='wave')run.waves.push(e.wave);
  if(e.type==='log'){run.logs.push(e.message);console.log(e.message);}
  if(e.type==='finish'){run.status=e.status;run.error=e.error;}
  writeFileSync(path.join(out,`live-accounting-mtp-${mtp}.json`),JSON.stringify(run,null,2));
 });
 if(run.status!=='completed'||run.samples.filter(s=>!s.warmup).length!==accountingTests.length)throw Error(`Live ${mtp} integration failed: ${run.error}`);
}
