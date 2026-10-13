import type {Model,Run,RunConfig,Sample} from './types';

export type ReasoningSetting = {id:string;kind:'budget';tokens:number}|{id:string;kind:'unlimited'|'off'|'default'}|{id:string;kind:'effort';value:string};
export type ReasoningControl = {transport:string;confirmation:'reported'|'requested'|'unsupported';note:string};
export type ReasoningSupport = ReasoningControl & {numeric:boolean;off:boolean;efforts:string[];unlimited:boolean};
export type ReasoningComparison = {settings:ReasoningSetting[];baselineId?:string;unlimitedPolicy?:'unbounded'|'shared-limits';stopAfterConsecutiveMisses?:number};
export type ReasoningStop = {modelKey:string;settingId:string;attempted:number;correct:number;consecutiveMisses:number;threshold:number;reason:'consecutive-misses'|'question-pool-exhausted'};
export const unboundedReasoning=(config:RunConfig,setting?:ReasoningSetting)=>setting?.kind==='unlimited'&&config.reasoningComparison?.unlimitedPolicy==='unbounded';
export const reasoningStop=(run:Run,modelKey:string,settingId:string)=>run.modelInfo[`reasoning-stop:${modelKey}:${settingId}`] as ReasoningStop|undefined;
export const reasoningStopDescription=(stop?:ReasoningStop)=>!stop?'':stop.reason==='consecutive-misses'?`Stopped after ${stop.threshold} consecutive mistakes at attempt ${stop.attempted}.`:`Question pool exhausted after ${stop.attempted} attempts; final mistake streak ${stop.consecutiveMisses}/${stop.threshold}.`;
export const unlimitedDescription=(config:RunConfig)=>config.reasoningComparison?.unlimitedPolicy==='unbounded'?'Unlimited has no app thinking, output-token, or request-time limit. LM Studio preserves the question while shifting older context; external servers control their own context and may impose limits.':'Legacy Unlimited removes the thinking cap only; shared output, context, and timeout limits still apply.';
export const defaultReasoningSettings:ReasoningSetting[]=[{id:'off',kind:'off'},...[512,1024,2048,4096].map(tokens=>({id:`budget-${tokens}`,kind:'budget' as const,tokens})),{id:'unlimited',kind:'unlimited'}];
export function settingLabel(s:ReasoningSetting):string{return s.kind==='budget'?`${s.tokens.toLocaleString()} thinking tokens`:s.kind==='effort'?`${s.value} effort`:s.kind==='off'?'No reasoning':s.kind==='default'?'Model default':'Unlimited';}
export function reasoningSupport(model:Model):ReasoningSupport{
 if(model.reasoningSupport)return model.reasoningSupport;
 const options=model.capabilities?.reasoning?.allowed_options??[];
 return {numeric:false,off:options.includes('off'),efforts:options.filter(s=>!['on','off','default'].includes(s)),unlimited:false,transport:'native reasoning modes',confirmation:options.length?'reported':'unsupported',note:options.length?'Numeric budget support has not been confirmed. Supported reasoning modes remain available.':'Reasoning control support has not been confirmed for this model.'};
}
export function resolveReasoningSettings(model:Model,comparison:ReasoningComparison){
 const support=reasoningSupport(model),unsupported:ReasoningSetting[]=[];
 let settings=comparison.settings.filter(s=>{const ok=s.kind==='default'||s.kind==='budget'&&support.numeric||s.kind==='off'&&support.off||s.kind==='unlimited'&&support.unlimited||s.kind==='effort'&&support.efforts.includes(s.value);if(!ok)unsupported.push(s);return ok;});
 // Numeric comparisons become a visibly different effort/on-off comparison, never a token-cap approximation.
 if(!support.numeric&&comparison.settings.some(s=>s.kind==='budget')){
  const options=model.capabilities?.reasoning?.allowed_options??[];
  const fallback:ReasoningSetting[]=[...(support.off?[{id:'off',kind:'off' as const}]:[]),...support.efforts.map(value=>({id:`effort-${value}`,kind:'effort' as const,value})),...(options.includes('on')?[{id:'effort-on',kind:'effort' as const,value:'on'}]:[])];
  settings=[...settings,...fallback];
 }
 settings=settings.filter((s,i,a)=>a.findIndex(t=>t.id===s.id)===i);
 const effortRank=(value:string)=>['none','minimal','low','medium','high','xhigh','max','on'].indexOf(value);
 const baselineId=settings.find(s=>s.id===comparison.baselineId)?.id??settings.find(s=>s.kind==='off')?.id??settings.filter((s):s is Extract<ReasoningSetting,{kind:'budget'}>=>s.kind==='budget').sort((a,b)=>a.tokens-b.tokens)[0]?.id??settings.filter((s):s is Extract<ReasoningSetting,{kind:'effort'}>=>s.kind==='effort').sort((a,b)=>effortRank(a.value)-effortRank(b.value))[0]?.id??settings[0]?.id;
 return {settings,baselineId,unsupported,note:support.note,support};
}
export function comparisonConfig(current:RunConfig):RunConfig{return {...current,mode:'quality',reasoningComparison:{settings:structuredClone(defaultReasoningSettings),baselineId:'off',unlimitedPolicy:'unbounded'},reasoning:'default',vision:'off',waves:3,loadProfile:'waves',concurrency:[1],temperature:0,maxTokens:32768,contextLength:Math.max(current.contextLength,65536),timeoutSec:1200,judgeModel:'',mtpSweep:undefined,mtpPMinSweep:undefined,mtpAutoFind:false,mtpPreflight:false,contextSweep:undefined};}
export function rotatedSettings(settings:ReasoningSetting[],repeat:number){const start=repeat%settings.length;return [...settings.slice(start),...settings.slice(0,start)];}
export function validateReasoningContext(config:RunConfig,model:Model,managed:boolean){
 const capacity=managed?config.contextLength:Number(model.loaded_instances[0]?.config?.context_length)||0;
 if(managed&&model.max_context_length>0&&capacity>model.max_context_length)throw Error(`${model.display_name}: requested context ${capacity} exceeds this model's reported capacity ${model.max_context_length}. Lower context and output limits.`);
 if(capacity>0&&config.maxTokens+512>capacity)throw Error(`${model.display_name}: the ${config.maxTokens}-token total output allowance plus prompt reserve exceeds ${managed?'requested':'server-reported active'} context ${capacity}. Lower the output limit or increase the server context.`);
 return capacity>0?`${managed?'Requested':'Server-reported active'} context: ${capacity} tokens.`:'Active server context is unreported. The selected context field cannot change an external server; output capacity is unconfirmed.';
}
export function effectiveReasoningSamples(run:Run):Sample[]{const replaced=new Set(run.samples.map(s=>s.retryOf).filter(Boolean));return run.samples.filter(s=>!s.warmup&&s.reasoningSetting&&!replaced.has(s.id));}
const mean=(ns:(number|null|undefined)[])=>{const valid=ns.filter((n):n is number=>typeof n==='number'&&Number.isFinite(n));return valid.length?valid.reduce((a,b)=>a+b,0)/valid.length:null;};
export const reasoningPassed=(s:Sample)=>s.status==='completed'&&!s.possibleTruncation&&s.objective.score===100;
export function reasoningSummaries(run:Run){
 const samples=effectiveReasoningSamples(run),groups=new Map<string,Sample[]>();
 for(const s of samples){const key=JSON.stringify([s.modelKey,s.reasoningSetting!.id]);groups.set(key,[...(groups.get(key)??[]),s]);}
 const rows=[...groups.values()].map(group=>{const first=group[0],setting=first.reasoningSetting!,info=run.modelInfo['reasoning:'+first.modelKey] as {baselineId?:string;settings?:ReasoningSetting[]}|undefined;
  const baselineId=info?.baselineId??run.config.reasoningComparison?.baselineId??'off';
  const repeats=[...new Set(group.map(s=>s.reasoningRepeat??s.wave))].sort((a,b)=>a-b);
  return {modelKey:first.modelKey,modelName:first.modelName,setting,baselineId,attempts:group.length,correct:group.filter(reasoningPassed).length,accuracy:100*group.filter(reasoningPassed).length/group.length,delta:null as number|null,reasoningTokens:mean(group.map(s=>s.metrics.reasoningTokens)),outputTokens:mean(group.map(s=>s.metrics.outputTokens)),durationMs:mean(group.map(s=>s.metrics.durationMs)),failures:group.filter(s=>s.status!=='completed').length,truncations:group.filter(s=>s.possibleTruncation).length,repeatScores:repeats.map(repeat=>{const ss=group.filter(s=>(s.reasoningRepeat??s.wave)===repeat);return {repeat,accuracy:100*ss.filter(reasoningPassed).length/ss.length,attempts:ss.length};}),stop:reasoningStop(run,first.modelKey,setting.id),expected:run.config.retryOf?null:run.tests.length*run.config.waves,reasoningCoverage:group.filter(s=>typeof s.metrics.reasoningTokens==='number').length,outputCoverage:group.filter(s=>typeof s.metrics.outputTokens==='number').length};
 });
 for(const row of rows){const base=rows.find(r=>r.modelKey===row.modelKey&&r.setting.id===row.baselineId);row.delta=base?row.accuracy-base.accuracy:null;}
 return rows;
}
export function reasoningAnswerChanges(run:Run,modelKey:string,baselineId:string,targetId:string){
 const samples=effectiveReasoningSamples(run).filter(s=>s.modelKey===modelKey);
 const base=new Map(samples.filter(s=>s.reasoningSetting?.id===baselineId).map(s=>[JSON.stringify([s.testId,s.reasoningRepeat??s.wave]),s]));
 return samples.filter(s=>s.reasoningSetting?.id===targetId).flatMap(target=>{const baseline=base.get(JSON.stringify([target.testId,target.reasoningRepeat??target.wave]));if(!baseline)return [];const before=reasoningPassed(baseline),after=reasoningPassed(target);return [{testId:target.testId,testName:target.testName,repeat:target.reasoningRepeat??target.wave,baseline,target,change:(!before&&after?'improved':before&&!after?'worsened':'unchanged') as 'improved'|'worsened'|'unchanged',answerChanged:baseline.output!==target.output}];});
}
