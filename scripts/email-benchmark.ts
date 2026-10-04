import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {builtInPacks,selectBenchmark,benchmarkConfig,benchmarkRows} from '../src/benchmarks';
import {defaultSettings,defaultConfig} from '../src/defaults';
import {listModels} from '../electron/lmstudio';
import {runEngine} from '../electron/engine';
import {validateConfig} from '../electron/validation';
import {benchmarkReport} from '../electron/benchmark-report';
import {emailPrediction} from '../src/email-classification';
import {resumeEmailRun} from '../src/email-resume';
import type {Run} from '../src/types';
const out=process.argv[2];if(!out)throw Error('Usage: npm run benchmark:email -- output-directory');
const baseUrl=process.env.LMB_BASE_URL,modelKey=process.env.LMB_MODEL_KEY;
if(!baseUrl||!modelKey)throw Error('Set LMB_BASE_URL and LMB_MODEL_KEY to the exact endpoint and model.');
const count=Number(process.env.LMB_COUNT??60),seed=Number(process.env.LMB_SEED??42);
const settings={...defaultSettings,provider:'openai' as const,baseUrl,token:process.env.LMB_API_TOKEN??''};
const pack=builtInPacks.find(p=>p.id===(process.env.LMB_PACK_ID??'berkeley-enron-challenge'));
if(!pack||!pack.id.startsWith('berkeley-enron'))throw Error('Choose berkeley-enron or berkeley-enron-challenge.');
const selection={packId:pack.id,count,seed},config={...benchmarkConfig({...defaultConfig,modelKeys:[modelKey]},selection,pack.id.endsWith('challenge')?'Berkeley email challenge':'Berkeley email classification'),timeoutSec:Number(process.env.LMB_TIMEOUT_SEC??(pack.id.endsWith('challenge')?600:180))};
validateConfig(config);
const models=await listModels(settings);if(!models.some(m=>m.key===modelKey))throw Error('Requested model is absent from the endpoint inventory.');
const now=new Date().toISOString();
let run:Run={id:randomUUID(),created:now,updated:now,status:'running',config,tests:selectBenchmark(selection),samples:[],waves:[],logs:[],modelInfo:{},environment:{purpose:pack.id.endsWith('challenge')?'Balanced complexity-selected real emails; local challenge protocol, not representative inbox accuracy':'Human-labeled real emails; local adapted evaluation',endpoint:baseUrl,provider:'openai'}};
mkdirSync(out,{recursive:true});
let pending=run.tests;
if(process.env.LMB_RESUME_FILE){
 const previous=JSON.parse(readFileSync(process.env.LMB_RESUME_FILE,'utf8')) as Run;
 const resumed=resumeEmailRun(previous,config,run.tests,baseUrl);run=resumed.run;pending=resumed.pending;
 console.log(run.logs.at(-1));
}
const save=()=>{run.updated=new Date().toISOString();writeFileSync(path.join(out,'email-run.json'),JSON.stringify(run,null,2));};
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
if(pending.length)await runEngine({...run,tests:pending,samples:[],waves:[]},settings,controller.signal,e=>{
 if(e.type==='sample'){run.samples.push(e.sample);console.log(e.sample.warmup?'warmup':`${run.samples.filter(s=>!s.warmup).length}/${count} ${e.sample.testId}`,e.sample.status,e.sample.objective.score);}
 if(e.type==='wave')run.waves.push(e.wave);
 if(e.type==='model')run.modelInfo[e.key]=e.info;
 if(e.type==='log'){run.logs.push(e.message);console.log(e.message);}
 if(e.type==='finish'){run.status=e.status;run.error=e.error;}
 save();
});
else {run.status='completed';save();}
const rows=benchmarkRows(run);writeFileSync(path.join(out,'email-result.json'),JSON.stringify(rows,null,2));
writeFileSync(path.join(out,'email-report.txt'),benchmarkReport(run));
writeFileSync(path.join(out,'email-mistakes.json'),JSON.stringify(run.samples.filter(s=>!s.warmup&&(s.status!=='completed'||s.objective.score!==100)).map(s=>({testId:s.testId,gold:emailPrediction(run.tests.find(t=>t.id===s.testId)!.answerKey),predicted:emailPrediction(s.output),status:s.status,error:s.error,possibleTruncation:s.possibleTruncation,prompt:s.prompt,output:s.output})),null,2));
console.log(JSON.stringify(rows.map(({classification,...r})=>({...r,classification:classification&&{...classification,perCategory:undefined}}))));
if(run.status!=='completed'||run.samples.filter(s=>!s.warmup).length!==count||run.samples.some(s=>s.status!=='completed'))throw Error(`Email run failed: ${run.error??'request failure; inspect email-run.json'}`);
