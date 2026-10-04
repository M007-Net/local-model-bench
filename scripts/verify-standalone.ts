import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {defaultSettings,defaultConfig} from '../src/defaults';
import {defaultAgenticConfig,type AgenticRun} from '../src/agentic';
import {listModels,infer} from '../electron/lmstudio';
import {runEngine} from '../electron/engine';
import {runAgenticSweep,hostPool,hostWorkerFile} from '../electron/agentic-engine';
import {exportText} from '../electron/export';
import type {Run,TestCase} from '../src/types';
const out=path.resolve('work/standalone/verification-'+Date.now());mkdirSync(out,{recursive:true});
const settings={...defaultSettings,provider:'llamacpp' as const,baseUrl:'http://127.0.0.1:8080',timeoutSec:60,loadTimeoutSec:30};
const models=await listModels(settings),model=models.find(m=>m.key==='gemma-4-12b-qa');assert.ok(model);assert.ok(model.size_bytes>0);assert.match(model.quantization!.name,/IQ3_XXS/);
const tests:TestCase[]=[{id:'arithmetic',name:'Arithmetic',category:'QA',version:1,prompt:'Return only the number that equals 6 times 7.',answerKey:'42',rubric:'Correct arithmetic',maxTokens:64,rules:[{id:'answer',label:'Answer',type:'exact',expected:'42',weight:1}],kind:'quality'},{id:'json',name:'JSON structure',category:'QA',version:1,prompt:'Return exactly this JSON object and nothing else: {"ok":true,"count":3}',answerKey:'{"ok":true,"count":3}',rubric:'Exact JSON',maxTokens:64,rules:[{id:'json',label:'JSON answer',type:'json-equal',expected:'{"ok":true,"count":3}',weight:1}],kind:'quality'}];
const run:Run={id:'standalone-quality',created:new Date().toISOString(),updated:'',status:'running',config:{...defaultConfig,mtp:undefined,name:'Standalone llama.cpp quality',modelKeys:[model.key],testIds:tests.map(t=>t.id),mode:'quality',concurrency:[1,2,4],waves:1,maxTokens:64,timeoutSec:60},tests,environment:{provider:'llamacpp',endpoint:settings.baseUrl},modelInfo:{},logs:[],samples:[],waves:[]};
await runEngine(run,settings,new AbortController().signal,event=>{switch(event.type){case 'sample':run.samples.push(event.sample);break;case 'wave':run.waves.push(event.wave);break;case 'model':run.modelInfo[event.key]=event.info;break;case 'log':run.logs.push(event.message);break;case 'finish':run.status=event.status;run.error=event.error;break;}});
writeFileSync(path.join(out,'quality.json'),JSON.stringify(run,null,2));assert.equal(run.status,'completed',run.error);const measured=run.samples.filter(s=>!s.warmup);assert.equal(measured.length,14);assert.ok(measured.every(s=>s.status==='completed'));assert.ok(measured.every(s=>s.metrics.outputTokens!==null&&s.metrics.generationTps!==null));
console.log('PASS 14 standalone quality requests; scores: '+measured.map(s=>s.objective.score).join(','));
for(const format of ['json','csv','md']){const text=exportText(run,format);assert.ok(text.includes(model.key));writeFileSync(path.join(out,'quality.'+format),text);}
const sweep:AgenticRun={id:'standalone-agents',created:new Date().toISOString(),updated:'',status:'running',config:{...defaultAgenticConfig,name:'Standalone agent sweep',modelCall:'on',modelKey:model.key,modelName:model.display_name,instance:'loaded',instanceId:model.key,turns:3,workers:[1,2,4],repeats:1,hostWorkScale:1,maxTokens:32,prompt:'Reply only with the word ready.'},environment:{},logs:[],points:[]};
const host=hostPool(hostWorkerFile(path.resolve('dist-electron')),4);
// hostPool workers are intentionally unref'ed for application use. Keep this standalone
// process alive while awaiting the sweep, with a watchdog so a stuck harness cannot linger.
const keepAlive=setInterval(()=>{},1_000);
let timeout:NodeJS.Timeout;
const watchdog=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('Standalone agent sweep exceeded its 10 minute harness limit')),10*60*1_000);});
try{
 await Promise.race([runAgenticSweep(sweep,settings,new AbortController().signal,event=>{switch(event.type){case 'point':sweep.points.push(event.point);break;case 'log':sweep.logs.push(event.message);break;case 'environment':sweep.environment=event.environment;break;case 'finish':sweep.status=event.status;sweep.error=event.error;break;}},{host,settleMs:100}),watchdog]);
}finally{
 clearInterval(keepAlive);
 clearTimeout(timeout!);
 host.stop();
}
writeFileSync(path.join(out,'agents.json'),JSON.stringify(sweep,null,2));assert.equal(sweep.status,'completed',sweep.error);assert.equal(sweep.points.length,3);assert.ok(sweep.points.every(p=>p.completed===3));console.log('PASS 9 model-backed agent turns with 1,2,4 workers');
const controller=new AbortController();const pending=infer(settings,model.key,'Write a long detailed essay about computer networks.',1024,0,'default',controller.signal);setTimeout(()=>controller.abort(),150);assert.equal((await pending).status,'cancelled');
const after=await infer(settings,model.key,'Return only 42.',16,0,'default',new AbortController().signal);assert.equal(after.status,'completed');assert.equal(after.output.trim(),'42');assert.equal((await listModels(settings))[0].key,model.key);console.log('PASS cancellation recovery and server remains loaded');
writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,qualityRequests:14,qualityScores:measured.map(s=>s.objective.score),agentTurns:9,cancellationRecovery:true,model},null,2));console.log('Evidence: '+out);
