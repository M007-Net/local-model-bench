import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {defaultHarnessConfig,HARNESS_PROTOCOL,type HarnessRun} from '../src/harness';
import {harnessTasks} from '../electron/harness-tasks';
import {runHarnessEvaluation} from '../electron/harness-engine';
import {defaultSettings} from '../src/defaults';
import {Store} from '../electron/store';
import path from 'node:path';
import os from 'node:os';
const model=process.argv[process.argv.indexOf('--model')+1];
if(!process.argv.includes('--model')||!model)throw Error('Provide --model with an available LM Studio native model key. Preinstall the evaluation image with explicit approval.');
const settings={...defaultSettings,baseUrl:process.env.LMB_LIVE_URL??'http://127.0.0.1:1234',lmsPath:path.join(os.homedir(),'.lmstudio','bin','lms.exe'),token:process.env.LMB_LIVE_TOKEN??''};
const flag=(name:string,fallback:string)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const now=new Date().toISOString(),run:HarnessRun={id:randomUUID(),created:now,updated:now,status:'running',config:{...defaultHarnessConfig,name:'Live integration comparison',modelKeys:[model],taskCount:1,reasoning:flag('--reasoning','default') as 'default'|'off'|'on',contextLength:Number(flag('--context','8192')),maxTokens:Number(flag('--output','1024')),timeoutSec:Number(flag('--timeout','180'))},protocol:HARNESS_PROTOCOL,tasks:[harnessTasks[0]],trials:[],environment:{},logs:[]};
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
mkdirSync('work/harness-live',{recursive:true});const store=new Store('work/harness-live/bench.sqlite');store.saveHarnessRun(run);
try{await runHarnessEvaluation(run,settings,controller.signal,event=>{if(event.type==='progress')console.log(event.progress.message,event.progress.harness,event.progress.completed+'/'+event.progress.total);if(event.type==='trial')store.saveHarnessTrial(event.trial);if(event.type==='run')store.saveHarnessRun(event.run);});}finally{store.close();}
const file=`work/harness-live/${run.id}.json`;writeFileSync(file,JSON.stringify(run,null,2));
console.log('Evidence:',file);console.table(run.trials.map(t=>({harness:t.harness,status:t.status,requests:t.metrics.modelRequests,tools:t.metrics.toolCalls,durationMs:t.metrics.durationMs,failure:t.failure})));
if(run.status!=='completed'||run.trials.length!==2||run.trials.some(t=>!t.metrics.modelRequests||!t.metrics.toolCalls||t.verification.passed===null)){console.error(run.error??'Both harnesses must actually use the model, use tools and reach verification.');process.exitCode=1;}
