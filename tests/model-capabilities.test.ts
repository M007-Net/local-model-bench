import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeModels,reasoningOptions} from '../src/model-capabilities';
import {listModels} from '../electron/lmstudio';
import {defaultSettings} from '../src/defaults';
import {liveModel} from '../scripts/live-model';
test('discovery accepts arbitrary future model names and formats without a family allowlist',()=>{
 const models=normalizeModels([{type:'llm',key:'new-publisher/unseen-architecture@new-quant',format:'future-format'}, {type:'llm',key:'custom/private-finetune'}, {type:'embedding',key:'vectors'}]);
 assert.equal(models.length,2);assert.equal(models[0].display_name,models[0].key);assert.equal(models[0].format,'future-format');assert.deepEqual(models[0].loaded_instances,[]);assert.equal(models[0].quantization,null);assert.equal(models[0].max_context_length,0);assert.equal(models[0].capabilities?.vision,undefined);
});
test('partial metadata and malformed optional capabilities cannot crash discovery',()=>{
 const [m]=normalizeModels([{type:'llm',key:'arbitrary',display_name:null,loaded_instances:[null,{id:'instance',config:null}],quantization:{name:null},capabilities:{vision:null,reasoning:{allowed_options:null}}}]);
 assert.deepEqual(m.capabilities?.reasoning?.allowed_options,[]);assert.deepEqual(m.loaded_instances[0].config,{});assert.deepEqual(reasoningOptions([m],['arbitrary']),[]);
});
test('reasoning menu uses the intersection, including previously unknown settings',()=>{
 const models=normalizeModels([{type:'llm',key:'a',capabilities:{reasoning:{allowed_options:['off','future-level','future-level']}}},{type:'llm',key:'b',capabilities:{reasoning:{allowed_options:['on','future-level']}}},{type:'llm',key:'c'}]);
 assert.deepEqual(reasoningOptions(models,['a','b']),['future-level']);assert.deepEqual(reasoningOptions(models,['a','c']),[]);assert.deepEqual(reasoningOptions(models,['missing']),[]);assert.deepEqual(reasoningOptions(models,[]),[]);
});
test('missing and duplicate identifiers fail explicitly rather than loading the wrong model',()=>{
 assert.throws(()=>normalizeModels({}));assert.throws(()=>normalizeModels([{type:'llm'}]));assert.throws(()=>normalizeModels([{type:'llm',key:'same'},{type:'llm',key:'same'}]));
});
test('refresh discovers newly downloaded models through the server',async()=>{
 const old=global.fetch;let key='unknown-one';global.fetch=async()=>new Response(JSON.stringify({models:[{type:'llm',key}]}));
 try{assert.equal((await listModels(defaultSettings))[0].key,'unknown-one');key='another-new-model';assert.equal((await listModels(defaultSettings))[0].key,key);}finally{global.fetch=old;}
});
test('live scripts require the user-selected identifier and validate optional MTP',()=>{
 const old=process.env.LMB_MODEL_KEY,models=normalizeModels([{type:'llm',key:'test-selected'}]);
 try{delete process.env.LMB_MODEL_KEY;assert.throws(()=>liveModel(models),/Set LMB_MODEL_KEY/);process.env.LMB_MODEL_KEY='test-selected';assert.equal(liveModel(models).key,'test-selected');assert.throws(()=>liveModel(models,true),/confirmed/);process.env.LMB_MODEL_KEY='missing';assert.throws(()=>liveModel(models),/current/);}finally{if(old===undefined)delete process.env.LMB_MODEL_KEY;else process.env.LMB_MODEL_KEY=old;}
});
