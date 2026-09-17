import {existsSync,mkdirSync,readFileSync,readdirSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {Model} from '../src/types';
import {needsFlashAttention} from '../src/cache-quant';
import type {CacheQuant} from '../src/cache-quant';

// Quantizing the KV cache. The context is what actually fills a 16 GB card: a run loaded with
// `--context-length C --parallel P` holds C*P tokens of keys and values at f16, and that is the
// part that grows with concurrency rather than with the weights. Storing them at q8_0 halves it
// and at q4_0 quarters it, which is often the difference between a model that fits and a model
// that silently spills into system RAM at a third of the speed.
//
// Like the MTP sidecar, LM Studio exposes no command-line flag and no REST field for this, so the
// one route in is the per-model default config under .lmstudio/.internal, which `lms load` merges
// into every load of that exact file. The same discipline applies here and for the same reason:
// the setting is written immediately before a load and the file is put back byte for byte
// immediately after it, whether the load succeeded or failed. A file this app created is deleted
// again along with any folders it had to make, so nothing is left behind to change a load the
// user makes from LM Studio's own window later.
//
// LM Studio's key names and value shape, read from its own stored configs:
//   {"key":"llm.load.llama.kCacheQuantizationType","value":{"checked":true,"value":"q8_0"}}
const K_CACHE='llm.load.llama.kCacheQuantizationType';
const V_CACHE='llm.load.llama.vCacheQuantizationType';
// llama.cpp cannot use a quantized KV cache without flash attention, and LM Studio refuses the load
// outright rather than falling back: "V Cache Quantization requires flash attention to be enabled."
// Its default is not dependable — it varies by engine and by whatever the model was last loaded
// with — so a run that asks for a quantized cache writes the flag that makes it possible, in the
// same file and for the same single load. Nothing is written when the cache is left alone, so a
// run that did not ask for this never touches the user's own flash-attention setting.
const FLASH='llm.load.llama.flashAttention';
const CONFIG_ROOT=['.lmstudio','.internal','user-concrete-model-default-config'];

// Resolved from LM Studio's own index rather than built from the model key, because the key is a
// display identifier and the config path is keyed by the file. Ambiguity is an error rather than
// a guess: writing the wrong file would change a load this app is not making.
export function modelResource(model:Model,home=homedir()):string{
 let index:any;
 try{index=JSON.parse(readFileSync(path.join(home,'.lmstudio','.internal','model-index-cache.json'),'utf8'));}
 catch{throw Error('LM Studio’s model index could not be read, so cache quantization cannot be applied. Run with cache quantization off.');}
 const matches=(index?.models??[]).filter((m:any)=>m.defaultIdentifier===model.key&&m.sizeBytes===model.size_bytes&&m.format===model.format);
 if(matches.length!==1)throw Error(`${model.display_name}: LM Studio’s index does not identify exactly one file for this model, so cache quantization cannot be applied safely.`);
 return matches[0].indexedModelIdentifier;
}

// The resource comes from LM Studio's index rather than from a user, but it still becomes a path
// this app writes to, so it is checked like one.
export function cacheConfigPath(resource:string,home=homedir()):string{
 const parts=String(resource).split(/[\\/]/).filter(Boolean);
 if(!parts.length||parts.some(p=>p==='.'||p==='..'||/^[A-Za-z]:$/.test(p)))throw Error('LM Studio returned a model resource that is not a relative path, so its cache settings cannot be written safely.');
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

// `off` leaves both keys written as unchecked rather than absent, so a cache type the user last
// picked in LM Studio's own window cannot leak into a run that asked for an unquantized cache.
// That is the whole point of measuring: the run gets the setting the run asked for.
//
// Flash attention is written on every load for the same reason, and because leaving it to whatever
// LM Studio happened to have set is not a neutral choice. Measured on Gemma 4 26B A4B at f16 cache,
// changing nothing else: with it off, prompt processing fell from 1281 to 260 tok/s on ROCm and from
// 1822 to 277 on Vulkan, and a fixed cost of 7.1 s and 9.2 s respectively appeared before the first
// token of every request. A run that does not say otherwise gets it on.
export function applyCacheQuant(model:Model,k:CacheQuant,v:CacheQuant,flash:boolean,home=homedir()):Restore{
 const file=cacheConfigPath(modelResource(model,home),home),existed=existsSync(file),original=existed?readFileSync(file):null;
 const config=original?shape(original):{preset:'',operation:{fields:[]},load:{fields:[]}};
 const keep=(config.load.fields as {key?:unknown}[]).filter(f=>f&&typeof f.key==='string'&&f.key!==K_CACHE&&f.key!==V_CACHE&&f.key!==FLASH);
 const field=(key:string,q:CacheQuant)=>({key,value:q==='off'?{checked:false,value:'f16'}:{checked:true,value:q}});
 config.load.fields=[...keep,{key:FLASH,value:flash},field(K_CACHE,k),field(V_CACHE,v)];
 mkdirSync(path.dirname(file),{recursive:true});
 writeFileSync(file,JSON.stringify(config,null,2));
 let done=false;
 return ()=>{
  if(done)return;done=true;
  if(original)writeFileSync(file,original);
  else{try{unlinkSync(file);}catch{}pruneEmpty(path.dirname(file),path.join(home,...CONFIG_ROOT));}
 };
}

// What LM Studio reports back after the load, so a run can refuse to measure a cache setting that
// was asked for and not applied. LM Studio reports the instance config with the same value shape.
export function verifyCacheQuant(config:Record<string,unknown>,k:CacheQuant,v:CacheQuant,flash?:boolean):void{
 // Flash attention is always requested now, so it is always checked — a load that came back without
 // the setting the run asked for would be measuring something else entirely, and the difference is
 // large enough (five times the prompt processing) to invalidate the numbers rather than dent them.
 const flashGot=(config as any).flash_attention;
 if(flash!==undefined&&typeof flashGot==='boolean'&&flashGot!==flash)
  throw Error(`LM Studio loaded the model with flash attention ${flashGot?'on':'off'}, not ${flash?'on':'off'} as the run asked. No measurements were taken.`);
 if(k==='off'&&v==='off')return; // No cache type was requested, so there is nothing more to confirm.
 const got=(key:string):string=>{
  const raw=(config as any)[key];
  if(raw===undefined||raw===null)return 'unreported';
  if(typeof raw==='string')return raw;
  if(typeof raw==='object'&&'checked' in raw)return raw.checked?String(raw.value):'off';
  return 'unreported';
 };
 // LM Studio reports these under snake_case names in the instance config it returns.
 const kGot=got('k_cache_quantization_type'),vGot=got('v_cache_quantization_type');
 // Without flash attention a quantized cache cannot be in use, whatever the cache fields say.
 if(needsFlashAttention(k,v)&&(config as any).flash_attention===false)
  throw Error('LM Studio loaded the model without flash attention, which a quantized KV cache requires. No measurements were taken.');
 // An engine that does not report the fields at all is not proof of failure, so it is not treated
 // as one; anything it does report has to match, or the numbers would describe another setting.
 if(kGot!=='unreported'&&kGot!==k)throw Error(`LM Studio loaded the K cache as ${kGot}, not the requested ${k}. No measurements were taken.`);
 if(vGot!=='unreported'&&vGot!==v)throw Error(`LM Studio loaded the V cache as ${vGot}, not the requested ${v}. No measurements were taken.`);
}
