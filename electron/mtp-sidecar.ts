import {existsSync,mkdirSync,readFileSync,readdirSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {Model} from '../src/types';

// Loading a separate MTP head. Proving one was loaded is engine-log.ts's job.
//
// LM Studio has no command-line flag and no REST field for a sidecar MTP head (see mtp.ts).
// The one route in is the per-model default config LM Studio keeps for itself under
// .lmstudio/.internal, which `lms load` merges into every load of that exact file. So the
// setting is written immediately before a load and the file is put back byte for byte
// immediately after it, whether the load succeeded or failed; a file this app created is
// deleted again, along with any folders it had to make. Nothing is left behind for LM Studio
// to apply to a load this app did not make.
//
// LM Studio's key names, read from its own load-config schema (llmLlamaMoeLoadConfigSchematics).
const SIDECAR='llm.load.llama.speculativeDecoding.draftMtpSidecar';
const DRAFT_MODEL='llm.load.llama.speculativeDecoding.draftModel';
const MAX_TOKENS='llm.load.llama.speculativeDecoding.draftMaxTokens';
// LM Studio refuses a load with more than one speculative mode enabled, so the others are
// written off rather than left at whatever was last chosen in its own window.
const EXCLUSIVE=['llm.load.llama.speculativeDecoding.draftMtp','llm.load.llama.speculativeDecoding.draftSimple','llm.load.llama.speculativeDecoding.draftDflashSidecar','llm.load.llama.speculativeDecoding.draftDsparkSidecar'];
const CONFIG_ROOT=['.lmstudio','.internal','user-concrete-model-default-config'];

// The resource comes from LM Studio's index rather than from a user, but it still becomes a
// path this app writes to, so it is checked like one.
export function sidecarConfigPath(resource:string,home=homedir()):string{
 const parts=String(resource).split(/[\\/]/).filter(Boolean);
 if(!parts.length||parts.some(p=>p==='.'||p==='..'||/^[A-Za-z]:$/.test(p)))throw Error('LM Studio returned a model resource that is not a relative path, so its MTP settings cannot be written safely.');
 return path.join(home,...CONFIG_ROOT,...parts.slice(0,-1),parts[parts.length-1]+'.json');
}
function shape(bytes:Buffer){
 const value=JSON.parse(bytes.toString('utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('LM Studio’s stored settings for this model are not a configuration object. No measurements were taken.');
 const load=value.load&&typeof value.load==='object'?value.load:{};
 return {...value,operation:value.operation??{fields:[]},load:{...load,fields:Array.isArray(load.fields)?load.fields:[]}};
}
function pruneEmpty(dir:string,stop:string){
 for(let at=dir;at.length>stop.length&&at.startsWith(stop);at=path.dirname(at)){
  try{if(readdirSync(at).length)return;rmdirSync(at);}catch{return;}
 }
}
export type Restore=()=>void;
export function applySidecar(model:Model,tokens:number,home=homedir()):Restore{
 const mtp=model.nativeMtp;
 if(mtp?.kind!=='sidecar'||!mtp.resource||!mtp.draftResource)throw Error(`${model.display_name}: no paired MTP head to load.`);
 const file=sidecarConfigPath(mtp.resource,home),existed=existsSync(file),original=existed?readFileSync(file):null;
 const config=original?shape(original):{preset:'',operation:{fields:[]},load:{fields:[]}};
 const keep=(config.load.fields as {key?:unknown}[]).filter(f=>f&&typeof f.key==='string'&&f.key!==SIDECAR&&f.key!==DRAFT_MODEL&&f.key!==MAX_TOKENS&&!EXCLUSIVE.includes(f.key));
 config.load.fields=[...keep,...EXCLUSIVE.map(key=>({key,value:false})),{key:SIDECAR,value:true},{key:DRAFT_MODEL,value:mtp.draftResource},{key:MAX_TOKENS,value:tokens}];
 mkdirSync(path.dirname(file),{recursive:true});
 writeFileSync(file,JSON.stringify(config,null,2));
 let done=false;
 return ()=>{
  if(done)return;done=true;
  if(original)writeFileSync(file,original);
  else{try{unlinkSync(file);}catch{}pruneEmpty(path.dirname(file),path.join(home,...CONFIG_ROOT));}
 };
}

