import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {defaultHarnessConfig,HARNESS_PROTOCOL,harnesses,selectHarnessTasks,type HarnessId,type HarnessRun} from '../src/harness';
import {tasksForHarnessPack} from '../electron/harness-tasks';
import {runHarnessEvaluation} from '../electron/harness-engine';
import {defaultSettings} from '../src/defaults';
import {Store} from '../electron/store';
import path from 'node:path';
import os from 'node:os';
const model=process.argv[process.argv.indexOf('--model')+1];
if(!process.argv.includes('--model')||!model)throw Error('Provide --model with an available LM Studio native model key. Preinstall the evaluation image with explicit approval.');
const settings={...defaultSettings,baseUrl:process.env.LMB_LIVE_URL??'http://127.0.0.1:1234',lmsPath:path.join(os.homedir(),'.lmstudio','bin','lms.exe'),token:process.env.LMB_LIVE_TOKEN??''};
const flag=(name:string,fallback:string)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const selected=flag('--harnesses',harnesses.filter(h=>h.available).map(h=>h.id).join(',')).split(',') as HarnessId[];
const count=Number(flag('--tasks','1'));
const pack=flag('--pack','python-repairs-v2') as typeof defaultHarnessConfig.pack;if(!['python-repairs-v1','python-repairs-v2'].includes(pack))throw Error('Unknown task pack');const harnessTasks=tasksForHarnessPack(pack);
const taskId=flag('--task','');if(taskId&&(count!==1||!harnessTasks.some(t=>t.id===taskId)))throw Error('An explicit --task must name one existing task and use --tasks 1');
const selectedTasks=taskId?[harnessTasks.find(t=>t.id===taskId)!]:count===1?[harnessTasks[0]]:selectHarnessTasks(harnessTasks,count,42);
const now=new Date().toISOString(),run:HarnessRun={id:randomUUID(),created:now,updated:now,status:'running',config:{...defaultHarnessConfig,name:'Live integration comparison',modelKeys:[model],pack,harnesses:selected,taskCount:count,reasoning:flag('--reasoning','default') as 'default'|'off'|'on',contextLength:Number(flag('--context',selected.includes('hermes')?'65536':'8192')),maxTokens:Number(flag('--output','1024')),timeoutSec:Number(flag('--timeout','180'))},protocol:HARNESS_PROTOCOL,tasks:selectedTasks,trials:[],environment:{},logs:[]};
const controller=new AbortController();process.once('SIGINT',()=>controller.abort());
mkdirSync('work/harness-live',{recursive:true});const store=new Store('work/harness-live/bench.sqlite');store.saveHarnessRun(run);
try{await runHarnessEvaluation(run,settings,controller.signal,event=>{if(event.type==='progress')console.log(event.progress.message,event.progress.harness,event.progress.completed+'/'+event.progress.total);if(event.type==='trial')store.saveHarnessTrial(event.trial);if(event.type==='run')store.saveHarnessRun(event.run);});}finally{store.close();}
const file=`work/harness-live/${run.id}.json`;writeFileSync(file,JSON.stringify(run,null,2));
console.log('Evidence:',file);console.table(run.trials.map(t=>({harness:t.harness,status:t.status,requests:t.metrics.modelRequests,tools:t.metrics.toolCalls,durationMs:t.metrics.durationMs,failure:t.failure})));
if(run.status!=='completed'||run.trials.length!==selected.length*count||run.trials.some(t=>!t.metrics.modelRequests||!t.metrics.toolCalls||t.verification.passed===null)){console.error(run.error??'Every selected harness must actually use the model, use tools and reach verification.');process.exitCode=1;}
