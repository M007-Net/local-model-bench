import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyMtpProbability,verifyMtpProbability} from '../electron/mtp-probability';
import {applyCacheQuant,cacheConfigPath} from '../electron/cache-quant';
import type {Model} from '../src/types';
test('draft threshold restores original settings after nested load overrides, and deletes a newly created config',()=>{
 const home=mkdtempSync(path.join(tmpdir(),'lmb-probability-'));
 const model={key:'test',format:'gguf',size_bytes:100,display_name:'Test',quantization:null,max_context_length:8192,type:'llm',loaded_instances:[]} as Model;
 const resource='publisher/model/weights.gguf',internal=path.join(home,'.lmstudio','.internal');
 mkdirSync(internal,{recursive:true});writeFileSync(path.join(internal,'model-index-cache.json'),JSON.stringify({models:[{defaultIdentifier:'test',format:'gguf',sizeBytes:100,indexedModelIdentifier:resource}]}));
 const file=cacheConfigPath(resource,home);
 try{
  for(const existing of [false,true]){
   const original='{ "preset": "mine", "load": {"fields":[{"key":"llm.load.llama.speculativeDecoding.draftMinContinueProbability","value":0.2}]}, "extra": 17 }\n';
   if(existing){mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,original);}
   const cache=applyCacheQuant(model,'q4_0','q4_0',true,home);
   const restore=applyMtpProbability(model,.8,home);
   const fields=JSON.parse(readFileSync(file,'utf8')).load.fields;
   assert.equal(fields.filter((f:any)=>f.key.endsWith('draftMinContinueProbability')).length,1);
   assert.equal(fields.find((f:any)=>f.key.endsWith('draftMinContinueProbability')).value,.8);
   assert.ok(fields.some((f:any)=>f.key.endsWith('flashAttention')));
   restore();restore();cache();
   assert.equal(existsSync(file),existing);if(existing)assert.equal(readFileSync(file,'utf8'),original);
  }
  assert.throws(()=>applyMtpProbability(model,NaN,home));
 }finally{rmSync(home,{recursive:true,force:true});}
});
test('load confirmation requires an explicit matching threshold including zero',()=>{
 verifyMtpProbability({speculative_draft_min_continue_probability:0},0);
 verifyMtpProbability({speculative_draft_min_continue_probability:.80000001},.8);
 for(const value of [undefined,'0.8',.7,NaN])assert.throws(()=>verifyMtpProbability({speculative_draft_min_continue_probability:value},.8),/No measurements/);
});
