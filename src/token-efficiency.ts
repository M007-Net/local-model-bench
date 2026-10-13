import type {Sample} from './types';
// Completion counts include reasoning tokens when reported as a subset by the
// endpoint. Never add that subset again or estimate tokens from character counts.
export function tokenEfficiency(samples:Sample[],passed:number){
 const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 const outputKnown=samples.filter(s=>valid(s.metrics?.outputTokens));
 const totalKnown=samples.filter(s=>valid(s.metrics?.outputTokens)&&valid(s.metrics?.inputTokens));
 const outputTokens=outputKnown.reduce((n,s)=>n+s.metrics.outputTokens!,0);
 const totalTokens=totalKnown.reduce((n,s)=>n+s.metrics.outputTokens!+s.metrics.inputTokens!,0);
 const complete=samples.length>0&&outputKnown.length===samples.length;
 const totalComplete=samples.length>0&&totalKnown.length===samples.length;
 return {reported:outputKnown.length,attempted:samples.length,outputTokens:complete?outputTokens:null,
  totalTokens:totalComplete?totalTokens:null,averageOutput:complete?outputTokens/samples.length:null,
  correctPerThousandOutput:complete&&outputTokens>0?passed*1000/outputTokens:null,
  correctPerThousandTotal:totalComplete&&totalTokens>0?passed*1000/totalTokens:null};
}
