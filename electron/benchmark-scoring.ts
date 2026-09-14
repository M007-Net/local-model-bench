// Adapted from Google's Apache-2.0 IFEval checks, for the explicitly included
// subset. See vendor/benchmark-licenses/NOTICE.txt. Never run candidate code.
export type Instruction={kind:string;args:Record<string,any>};
// A grader that cannot run is not the same thing as a model that answered wrongly, and
// conflating them silently depresses a benchmark score with no way to tell from the
// number that anything went wrong. This type is what lets the two be told apart.
export class GraderError extends Error{}
// IFEval keywords are literal words, never patterns. Compiling them raw let a check
// like `(a+)+$` backtrack catastrophically against a long response, on the worker
// thread, where cancel cannot interrupt it.
const literal=(word:string)=>String(word).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function words(a:Record<string,any>,key:string):string[]{
 const list=a?.[key];
 if(!Array.isArray(list)||!list.length||list.some(w=>typeof w!=='string'||!w.trim()))throw new GraderError(`IFEval ${key} must be a non-empty list of words.`);
 return list;
}
export function finalNumber(output:string):number|null{
 const line=output.trim().split(/\r?\n/).at(-1)?.trim()??'';
 const raw=line.startsWith('####')?line.slice(4).trim():line;
 if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw))return null;
 const n=Number(raw.replaceAll(',',''));return Number.isFinite(n)?n:null;
}
// The exact set the switch below implements. Exported so a test can be rejected while
// it is being written rather than silently going unscored during a run.
export const supportedInstructions=new Set(['punctuation:no_comma','detectable_format:number_bullet_lists','detectable_format:json_format','keywords:existence','keywords:frequency','keywords:forbidden_words','combination:two_responses','combination:repeat_prompt','startend:end_checker','detectable_format:title','startend:quotation']);
export function checkInstruction(value:string,{kind,args:a}:Instruction):boolean{
 if(!value.trim())return false;
 switch(kind){
 case 'punctuation:no_comma':return !value.includes(',');
 case 'detectable_format:number_bullet_lists':return (value.match(/^\s*\*[^*].*$/gm)?.length??0)+(value.match(/^\s*-.*$/gm)?.length??0)===a.num_bullets;
 case 'detectable_format:json_format':try{JSON.parse(value.trim().replace(/^```(?:json|Json|JSON)?/,'').replace(/```$/,'').trim());return true;}catch{return false;}
 case 'keywords:existence':return words(a,'keywords').every((word:string)=>new RegExp(literal(word),'iu').test(value));
 case 'keywords:frequency':{if(typeof a?.keyword!=='string'||!a.keyword.trim())throw new GraderError('IFEval keyword must be a non-empty string.');const n=[...value.matchAll(new RegExp(literal(a.keyword.trim()),'giu'))].length;return a.relation==='less than'?n<a.frequency:a.relation==='at least'&&n>=a.frequency;}
 case 'keywords:forbidden_words':return words(a,'forbidden_words').every((word:string)=>!new RegExp(`(?<![\\p{L}\\p{N}_])(?:${literal(word)})(?![\\p{L}\\p{N}_])`,'iu').test(value));
 case 'combination:two_responses':{const all=value.split('******');if(all.slice(1,-1).some(s=>!s.trim()))return false;const parts=all.map(s=>s.trim()).filter(Boolean);return parts.length===2&&parts[0]!==parts[1];}
 case 'combination:repeat_prompt':return value.trim().toLowerCase().startsWith(a.prompt_to_repeat.trim().toLowerCase());
 case 'startend:end_checker':return value.trim().replace(/^"+|"+$/g,'').toLowerCase().endsWith(a.end_phrase.trim().toLowerCase());
 case 'detectable_format:title':return (value.match(/<<[^\n]+>>/g)??[]).some(s=>s.replace(/^<+|>+$/g,'').trim());
 case 'startend:quotation':return value.trim().length>1&&value.trim().startsWith('"')&&value.trim().endsWith('"');
 default:throw new GraderError(`Unsupported IFEval instruction: ${kind}`);
 }
}
export function scoreInstructions(output:string,checks:Instruction[]):{passed:boolean;detail:string}{
 const failed=checks.filter(check=>!checkInstruction(output,check));
 return {passed:checks.length>0&&failed.length===0,detail:failed.length?'Unmet constraints: '+failed.map(c=>c.kind+' '+JSON.stringify(c.args)).join('; '):'All '+checks.length+' required constraints passed'};
}
