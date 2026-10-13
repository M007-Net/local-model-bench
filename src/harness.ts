import {integer} from './validate';
export const HARNESS_PROTOCOL='lmb-harness-v1';
export const HARNESS_IMAGE='local-model-bench-harness:1';
export type HarnessId='mini-swe-agent'|'opencode'|'hermes';
export const harnesses:{id:HarnessId;name:string;available:boolean;version:string}[]=[
 {id:'mini-swe-agent',name:'Mini-SWE-Agent',available:true,version:'2.4.6'},
 {id:'opencode',name:'OpenCode',available:true,version:'1.19.0'},
 {id:'hermes',name:'Hermes Agent (adapter unavailable)',available:false,version:'unavailable'}
];
export type HarnessConfig={name:string;modelKeys:string[];harnesses:HarnessId[];pack:'python-repairs-v1';taskCount:number;seed:number;trials:number;contextLength:number;maxTokens:number;temperature:number;reasoning:'default'|'off'|'on';maxToolCalls:number;timeoutSec:number;maxTotalTokens:number|null;cpus:number;memoryMb:number};
export const defaultHarnessConfig:HarnessConfig={name:'',modelKeys:[],harnesses:['mini-swe-agent','opencode'],pack:'python-repairs-v1',taskCount:5,seed:42,trials:1,contextLength:8192,maxTokens:1024,temperature:0,reasoning:'default',maxToolCalls:30,timeoutSec:180,maxTotalTokens:null,cpus:2,memoryMb:2048};
export type HarnessTask={id:string;version:number;category:string;description:string;files:Record<string,string>;entry:string;cases:{args:unknown[];expected:unknown}[]};
export type TraceEvent={at:number;kind:'request'|'response'|'tool'|'message'|'error'|'verification';data:unknown};
export type TrialMetrics={durationMs:number;startupMs:number|null;inferenceMs:number|null;toolMs:number|null;externalWaitMs:number|null;toolCalls:number|null;failedToolCalls:number|null;modelRequests:number;iterations:number|null;inputTokens:number|null;outputTokens:number|null;totalTokens:number|null;tokenSource:'measured'|'unavailable'};
export type HarnessTrial={id:string;runId:string;modelKey:string;harness:HarnessId;taskId:string;taskVersion:number;trial:number;status:'success'|'failure'|'timeout'|'cancelled'|'error';failure:string|null;metrics:TrialMetrics;effective:Record<string,unknown>;events:TraceEvent[];files:Record<string,string>;verification:{passed:boolean|null;output:string};traceTruncated:boolean};
export type HarnessRun={id:string;created:string;updated:string;status:'running'|'completed'|'cancelled'|'failed'|'interrupted';config:HarnessConfig;protocol:string;tasks:HarnessTask[];environment:Record<string,unknown>;trials:HarnessTrial[];logs:string[];error?:string};
export type HarnessSummary=Omit<HarnessRun,'trials'>;
export type HarnessProgress={runId:string;model:string;harness:string;task:string;trial:number;completed:number;total:number;successes:number;failures:number;elapsedMs:number;message:string};
export type HarnessDiagnostics={ready:boolean;imageId:string|null;message:string;versions:Record<string,string>};
export function validateHarnessConfig(c:HarnessConfig):HarnessConfig{
 if(!c||typeof c!=='object')throw Error('Invalid harness configuration');
 if(typeof c.name!=='string'||c.name.length>200)throw Error('Invalid evaluation name');
 if(!Array.isArray(c.modelKeys)||!c.modelKeys.length||c.modelKeys.length>16||c.modelKeys.some(k=>typeof k!=='string'||!k.trim()||k.length>4096)||new Set(c.modelKeys).size!==c.modelKeys.length)throw Error('Select distinct available models');
 if(!Array.isArray(c.harnesses)||!c.harnesses.length||new Set(c.harnesses).size!==c.harnesses.length||c.harnesses.some(id=>!harnesses.some(h=>h.id===id&&h.available)))throw Error('Selected harness adapter is unavailable');
 if(c.pack!=='python-repairs-v1')throw Error('Unknown task pack');
 integer(c.taskCount,1,8,'Tasks');integer(c.seed,0,4294967295,'Seed');integer(c.trials,1,10,'Trials');integer(c.contextLength,2048,1048576,'Context');integer(c.maxTokens,32,131072,'Output limit');integer(c.maxToolCalls,1,200,'Tool calls');integer(c.timeoutSec,10,3600,'Task timeout');integer(c.memoryMb,512,8192,'Memory');
 if(c.maxTokens>=c.contextLength)throw Error('Leave context space for prompts and tools');
 if(c.maxTotalTokens!==null)integer(c.maxTotalTokens,c.maxTokens,10000000,'Total token budget');
 if(!Number.isFinite(c.temperature)||c.temperature<0||c.temperature>1)throw Error('Temperature must be between 0 and 1');
 if(!Number.isFinite(c.cpus)||c.cpus<0.5||c.cpus>8)throw Error('CPU budget must be between 0.5 and 8');
 if(!['default','off','on'].includes(c.reasoning))throw Error('Unsupported reasoning setting');
 return structuredClone(c);
}
export function validateHarnessModels(c:HarnessConfig,models:import('./types').Model[]){
 if(c.reasoning==='on')throw Error('Explicit reasoning-on mapping is unverified for the OpenAI endpoint. Choose model default or off.');
 for(const key of c.modelKeys){const model=models.find(m=>m.key===key);if(!model||model.type!=='llm')throw Error('Selected text model unavailable: '+key);
  if(model.max_context_length>0&&c.contextLength>model.max_context_length)throw Error('Context exceeds model limit: '+key);
  if(c.reasoning!=='default'&&!model.capabilities?.reasoning?.allowed_options.includes(c.reasoning))throw Error('Reasoning setting unsupported by '+key);
 }
}
export function harnessReasoningWire(reasoning:HarnessConfig['reasoning']){if(reasoning==='on')throw Error('Explicit reasoning-on mapping is unverified for the OpenAI endpoint');return reasoning==='off'?'none':undefined;}
export function selectHarnessTasks(tasks:HarnessTask[],count:number,seed:number){
 integer(count,1,tasks.length,'Tasks');integer(seed,0,4294967295,'Seed');
 const out=[...tasks];let s=seed>>>0;
 const next=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
 for(let i=out.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return structuredClone(out.slice(0,count));
}
const mean=(a:number[])=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function aggregateHarness(trials:HarnessTrial[]){
 const groups=new Map<string,HarnessTrial[]>();for(const t of trials){const key=JSON.stringify([t.modelKey,t.harness]);groups.set(key,[...(groups.get(key)??[]),t]);}
 return [...groups.values()].map(ts=>{const successes=ts.filter(t=>t.status==='success'),n=ts.length,p=successes.length/n,z=1.96,d=1+z*z/n,center=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 const completeUsage=ts.every(t=>t.metrics.totalTokens!==null),tokens=completeUsage?ts.reduce((s,t)=>s+t.metrics.totalTokens!,0):null;
 return {model:ts[0].modelKey,harness:ts[0].harness,attempts:n,successes:successes.length,rate:p,interval:[Math.max(0,center-half),Math.min(1,center+half)],averageMs:mean(ts.map(t=>t.metrics.durationMs)),averageTools:ts.every(t=>t.metrics.toolCalls!==null)?mean(ts.map(t=>t.metrics.toolCalls!)):null,successfulMs:mean(successes.map(t=>t.metrics.durationMs)),durationSd:ts.length>1?Math.sqrt(ts.reduce((s,t)=>s+(t.metrics.durationMs-mean(ts.map(t=>t.metrics.durationMs))!)**2,0)/(ts.length-1)):null,toolsPerSuccess:successes.every(t=>t.metrics.toolCalls!==null)?mean(successes.map(t=>t.metrics.toolCalls!)):null,totalTokens:tokens,tokensPerSuccess:successes.length&&tokens!==null?tokens/successes.length:null,usageCoverage:ts.filter(t=>t.metrics.totalTokens!==null).length/n};});
}
export function comparisonIssues(a:HarnessRun,b:HarnessRun){
 const issues:string[]=[];if(a.protocol!==b.protocol)issues.push('Protocol differs');
 if(JSON.stringify(a.tasks)!==JSON.stringify(b.tasks))issues.push('Task state, versions or order differ');
 for(const key of ['contextLength','maxTokens','temperature','reasoning','maxToolCalls','timeoutSec','maxTotalTokens','cpus','memoryMb','trials'] as const)if(a.config[key]!==b.config[key])issues.push(`${key} differs`);
 const comparableEnvironment=(env:Record<string,unknown>)=>{
  const models=env.models;if(!models||typeof models!=='object')return env;
  return {...env,models:Object.fromEntries(Object.entries(models).map(([key,value])=>{const m=value as any;
   if(!m?.weightsIdentity||!m?.instance?.config)return [key,value];
   return [key,{weightsIdentity:m.weightsIdentity,load:m.instance.config,architecture:m.model?.architecture,reasoningCapability:m.model?.capabilities?.reasoning}];
  }))};
 };
 if(JSON.stringify(comparableEnvironment(a.environment))!==JSON.stringify(comparableEnvironment(b.environment)))issues.push('Runtime, model identity or harness provenance differs');return issues;
}
