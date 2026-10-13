import {existsSync,mkdirSync,readFileSync,readdirSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {Model} from '../src/types';
import {cacheConfigPath,modelResource} from './cache-quant';

// Confirmed from the installed LM Studio schema. Like cache and sidecar settings, this
// is a load-time setting, temporarily layered over the user's per-model configuration.
const KEY='llm.load.llama.speculativeDecoding.draftMinContinueProbability';
export function applyMtpProbability(model:Model,pMin:number,home=homedir()):()=>void{
 if(!Number.isFinite(pMin)||pMin<0||pMin>1)throw Error('Minimum draft probability must be between 0 and 1.');
 const file=cacheConfigPath(modelResource(model,home),home),original=existsSync(file)?readFileSync(file):null;
 const config=original?JSON.parse(original.toString('utf8')):{preset:'',operation:{fields:[]},load:{fields:[]}};
 if(!config||typeof config!=='object'||Array.isArray(config))throw Error('LM Studio model settings are not a configuration object.');
 config.load={...config.load,fields:[...(Array.isArray(config.load?.fields)?config.load.fields:[]).filter((f:any)=>f?.key!==KEY),{key:KEY,value:pMin}]};
 mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(config,null,2));
 let done=false;
 return ()=>{
  if(done)return;done=true;
  if(original)writeFileSync(file,original);
  else{
   unlinkSync(file);
   const stop=path.join(home,'.lmstudio','.internal','user-concrete-model-default-config');
   for(let dir=path.dirname(file);dir.length>stop.length&&dir.startsWith(stop);dir=path.dirname(dir)){
    try{if(readdirSync(dir).length)break;rmdirSync(dir);}catch{break;}
   }
  }
 };
}
export function verifyMtpProbability(config:Record<string,unknown>,pMin:number):void{
 const got=config.speculative_draft_min_continue_probability;
 if(typeof got!=='number'||!Number.isFinite(got)||Math.abs(got-pMin)>1e-6)
  throw Error(`LM Studio reported minimum draft probability ${got??'unknown'}, not the requested ${pMin}. No measurements were taken.`);
}
