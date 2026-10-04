import type {Run,RunConfig,TestCase} from './types';
export function resumeEmailRun(previous:Run,config:RunConfig,tests:TestCase[],endpoint:string){
 if(!['interrupted','cancelled','failed'].includes(previous.status))throw Error('Resume only a stopped email run.');
 const withoutTimeout=(c:RunConfig)=>{const {timeoutSec:_timeout,...rest}=c;return rest;};
 if(JSON.stringify(withoutTimeout(previous.config))!==JSON.stringify(withoutTimeout(config))||JSON.stringify(previous.tests)!==JSON.stringify(tests)||previous.environment.endpoint!==endpoint)throw Error('Resume requires identical model, endpoint, questions, and generation settings; only the timeout may change.');
 const completed=previous.samples.filter(s=>!s.warmup&&s.status==='completed');
 const ids=new Set(completed.map(s=>s.testId));
 if(ids.size!==completed.length||completed.some(s=>!tests.some(t=>t.id===s.testId)))throw Error('Resume requires one completed attempt per selected email.');
 const pending=tests.filter(t=>!ids.has(t.id));
 const run:Run={...structuredClone(previous),config,tests,status:'running',error:undefined,
  samples:previous.samples.filter(s=>s.status==='completed'),waves:previous.waves.filter(w=>ids.has(w.testId)),
  environment:{...previous.environment,timeoutResume:{priorTimeoutSec:previous.config.timeoutSec,timeoutSec:config.timeoutSec,retainedCompleted:completed.length,retriedFailed:previous.samples.filter(s=>!s.warmup&&s.status!=='completed').length,pending:pending.length}},
  logs:[...previous.logs,`Resumed with ${config.timeoutSec}s timeout. Retained all ${completed.length} completed answers, including wrong answers; ${pending.length} emails remain.`]};
 return {run,pending};
}
