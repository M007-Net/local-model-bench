import type { RunConfig, TestCase } from './types';

const INPUT_FILLER='Service availability, access, monitoring, backups, and recovery procedures should be reviewed regularly. ';
const INPUT_HEAD='Read these operational notes and write a concise numbered review with recommendations.\n';
export type AdaptedInput={prompt:string;primePrompt?:string;targetTokens:number;probeTokens:number[];withinTolerance:boolean|null;tolerancePct:number;cacheMode:'cold-prompt'|'cached-prefix-followup'|'total-context'};

/** Keep the primed prefix byte-for-byte stable and vary only the suffix. */
export function cachedFollowupVariant(prompt:string,tag:string){
 const marker='\nFollow-up notes:\n';const at=prompt.indexOf(marker);
 if(at<0)return prompt;
 const end=at+marker.length;
 return prompt.slice(0,end)+`Follow-up request ${tag}. `+prompt.slice(end);
}

/** Build and adapt prompt text from endpoint-reported input token usage. At most three probes
 * are made by default. The final count remains an observation with a stated tolerance. */
export async function adaptInputPrompt(targetTokens:number,tolerancePct:number,measure:(prompt:string,index:number)=>Promise<number|null>,options:{cacheMode?:AdaptedInput['cacheMode'];prefixTokens?:number;maxProbes?:number}={}):Promise<AdaptedInput>{
 if(!Number.isInteger(targetTokens)||targetTokens<1||targetTokens>131072)throw new RangeError('Input target must be a whole number from 1 to 131,072 tokens.');
 if(!Number.isFinite(tolerancePct)||tolerancePct<1||tolerancePct>25)throw new RangeError('Input tolerance must be between 1 and 25 percent.');
 const cacheMode=options.cacheMode??'cold-prompt',prefixTokens=Math.max(0,options.prefixTokens??0),maxProbes=Math.min(3,Math.max(1,options.maxProbes??3));
 const prefixChars=cacheMode==='cached-prefix-followup'?Math.max(1,prefixTokens*4):0;
 const prefix=cacheMode==='cached-prefix-followup'?INPUT_HEAD+INPUT_FILLER.repeat(Math.ceil(prefixChars/INPUT_FILLER.length)).slice(0,prefixChars):'';
 const fixed=cacheMode==='cached-prefix-followup'?`${prefix}\nFollow-up notes:\n`:`${INPUT_HEAD}`;
 const targetNew=Math.max(1,targetTokens-(cacheMode==='cached-prefix-followup'?prefixTokens:0));
 const maxChars=Math.min(524_288,Math.max(256,targetTokens*4));let chars=Math.min(maxChars,Math.max(0,targetNew*4)),prompt='',tokens:number|null=null;const probeTokens:number[]=[];let prior:{chars:number;tokens:number}|null=null;
 for(let i=0;i<maxProbes;i++){
  prompt=(fixed+INPUT_FILLER.repeat(Math.ceil(chars/INPUT_FILLER.length)).slice(0,chars)).slice(0,maxChars);
  const observed=await measure(prompt,i);if(observed===null||!Number.isFinite(observed)||observed<=0){tokens=null;break;}tokens=observed;
  probeTokens.push(tokens);
  if(Math.abs(tokens-targetTokens)/targetTokens*100<=tolerancePct)break;
  const slope=prior?(tokens-prior.tokens)/(chars-prior.chars):Number.NaN;
  const corrected=Number.isFinite(slope)&&slope>0?chars+(targetTokens-tokens)/slope:prompt.length*targetTokens/tokens-fixed.length;
  prior={chars,tokens};chars=Math.min(maxChars,Math.max(0,Math.round(corrected)));
 }
 const withinTolerance=tokens===null?null:Math.abs(tokens-targetTokens)/targetTokens*100<=tolerancePct;
 return {prompt,primePrompt:cacheMode==='cached-prefix-followup'?prefix:undefined,targetTokens,probeTokens,withinTolerance,tolerancePct,cacheMode};
}

/**
 * Expand selected performance workloads into deterministic approximate input lengths.
 * The estimate targets prompt tokens; tokenizers differ, and this does not alter the
 * serving endpoint's configured context window.
 */
export function contextWorkloads(tests: TestCase[], config: RunConfig): TestCase[] {
  const targets = config.contextSweep;
  if (!targets?.length) return tests;
  const base = tests.find(test => test.kind === 'performance');
  if (!base) return tests;

  // Four characters per token is a deliberately rough text estimate. Use a fixed
  // compact prompt so switching the selected short/medium/long test does not change
  // the sweep's workload, then pad to the estimated target size.
  const charsPerToken = 4;
  const prompt = 'Read these operational notes and write a concise numbered review with recommendations.\n';
  return targets.map(target => {
    const wantedChars = Math.max(0, target * charsPerToken - prompt.length);
    const padding = INPUT_FILLER.repeat(Math.ceil(wantedChars / INPUT_FILLER.length)).slice(0, wantedChars);
    const cacheMode=config.cacheProtocol??'cold-prompt';
    const name=cacheMode==='cached-prefix-followup'?`Cached-prefix follow-up · ≈${target} total input tokens`:cacheMode==='total-context'?`Total context · ≈${target} input tokens`:`Cold prompt · ≈${target} input tokens`;
    return {
      ...base,
      id: `perf-context-${target}`,
      name,
      prompt: prompt + padding,
      contextTokens: target,
      contextTargetTokens:target,
      cacheMode,
      benchmark: undefined,
      image: undefined,
      imageDigest: undefined,
    };
  });
}
