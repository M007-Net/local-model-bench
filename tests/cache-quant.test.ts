import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyCacheQuant,cacheConfigPath,modelResource,verifyCacheQuant} from '../electron/cache-quant';
import type {Model} from '../src/types';

const base:Model={key:'main@q4',display_name:'Main',format:'gguf',size_bytes:4,max_context_length:8192,type:'llm',loaded_instances:[],quantization:null};

// A library laid out the way LM Studio lays one out, with the index this app reads to turn a
// display key into the file path whose config `lms load` merges.
function library(over:{sizeBytes?:number;duplicate?:boolean}={}){
 const home=mkdtempSync(path.join(tmpdir(),'lmb-cache-'));
 const internal=path.join(home,'.lmstudio','.internal');mkdirSync(internal,{recursive:true});
 const entry={defaultIdentifier:base.key,sizeBytes:over.sizeBytes??base.size_bytes,format:'gguf',indexedModelIdentifier:'pub/repo/main.gguf'};
 writeFileSync(path.join(internal,'model-index-cache.json'),JSON.stringify({models:over.duplicate?[entry,{...entry}]:[entry]}));
 return {home,config:cacheConfigPath('pub/repo/main.gguf',home)};
}
const fields=(file:string)=>JSON.parse(readFileSync(file,'utf8')).load.fields as {key:string;value:any}[];
const valueOf=(file:string,key:string)=>fields(file).find(f=>f.key===key)?.value;
const K='llm.load.llama.kCacheQuantizationType',V='llm.load.llama.vCacheQuantizationType';

test('the cache type is written in LM Studio’s own shape and taken back out again',()=>{
 const {home,config}=library();
 assert.equal(existsSync(config),false,'nothing exists before the load');
 const restore=applyCacheQuant(base,'q8_0','q4_0',home);
 assert.deepEqual(valueOf(config,K),{checked:true,value:'q8_0'});
 assert.deepEqual(valueOf(config,V),{checked:true,value:'q4_0'});
 restore();
 // A file this app created is deleted again, so a load the user makes from LM Studio's own
 // window afterwards is not silently quantized by a benchmark that has already finished.
 assert.equal(existsSync(config),false,'the file this app created is gone again');
});

test('an existing configuration is restored byte for byte, and its other settings survive the load',()=>{
 const {home,config}=library();
 const original=JSON.stringify({preset:'mine',operation:{fields:[]},load:{fields:[
  {key:'llm.load.contextLength',value:4096},
  {key:K,value:{checked:true,value:'f16'}},
 ]}},null,2);
 mkdirSync(path.dirname(config),{recursive:true});writeFileSync(config,original);
 const restore=applyCacheQuant(base,'q4_0','q4_0',home);
 // The user's own unrelated settings are carried through rather than replaced wholesale.
 assert.equal(valueOf(config,'llm.load.contextLength'),4096);
 assert.deepEqual(valueOf(config,K),{checked:true,value:'q4_0'},'their stale cache field is replaced, not duplicated');
 assert.equal(fields(config).filter(f=>f.key===K).length,1);
 restore();
 assert.equal(readFileSync(config,'utf8'),original,'restored byte for byte');
});

// The whole point of measuring is that the run gets the setting the run asked for. A cache type
// left over in LM Studio's window would otherwise apply to a run that asked for an unquantized one.
test('asking for off writes the field off rather than leaving whatever was there',()=>{
 const {home,config}=library();
 mkdirSync(path.dirname(config),{recursive:true});
 writeFileSync(config,JSON.stringify({load:{fields:[{key:K,value:{checked:true,value:'q4_0'}}]}}));
 applyCacheQuant(base,'off','off',home);
 assert.deepEqual(valueOf(config,K),{checked:false,value:'f16'});
 assert.deepEqual(valueOf(config,V),{checked:false,value:'f16'});
});

test('a model the index cannot identify exactly is refused rather than guessed at',()=>{
 assert.throws(()=>modelResource(base,library({duplicate:true}).home),/exactly one file/);
 // A file whose size no longer matches the index is a stale index, not a match.
 assert.throws(()=>modelResource(base,library({sizeBytes:999}).home),/exactly one file/);
 assert.throws(()=>modelResource(base,mkdtempSync(path.join(tmpdir(),'lmb-empty-'))),/model index could not be read/);
});

test('a resource that is not a relative path cannot become a path this app writes to',()=>{
 for(const bad of ['../../escape.gguf','C:/windows/system32/x.gguf','/etc/passwd/..',''])
  assert.throws(()=>cacheConfigPath(bad,'/home'),/not a relative path/,`rejected: ${bad}`);
});

test('a cache setting LM Studio did not apply stops the run before anything is measured',()=>{
 // Nothing requested, nothing to confirm — including on an engine that reports no such field.
 assert.doesNotThrow(()=>verifyCacheQuant({},'off','off'));
 // An engine that does not report the fields is not proof of failure, so it is not treated as one.
 assert.doesNotThrow(()=>verifyCacheQuant({},'q8_0','q8_0'));
 assert.doesNotThrow(()=>verifyCacheQuant({k_cache_quantization_type:'q8_0',v_cache_quantization_type:'q4_0'},'q8_0','q4_0'));
 assert.throws(()=>verifyCacheQuant({k_cache_quantization_type:'f16'},'q8_0','q8_0'),/loaded the K cache as f16/);
 assert.throws(()=>verifyCacheQuant({v_cache_quantization_type:{checked:false,value:'f16'}},'off','q4_0'),/loaded the V cache as off/);
});
