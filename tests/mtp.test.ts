import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {attachMtp,mtpArgs,verifyMtp} from '../electron/mtp';
import {visibleModels,defaultLibraryView,restoreLibraryView} from '../src/library';
import {validateConfig} from '../electron/validation';
import {defaultConfig} from '../src/defaults';
import type {Model} from '../src/types';
const model:Model={key:'exact@q4',display_name:'Model MTP',format:'gguf',size_bytes:4,max_context_length:8192,type:'llm',loaded_instances:[],quantization:null};
test('MTP is controlled by actual metadata, never a name or family',()=>{
 assert.throws(()=>mtpArgs(model,'on'),/not confirmed/);
 assert.throws(()=>mtpArgs({...model,nativeMtp:{supported:false,reason:'no heads'}},'on'));
 assert.deepEqual(mtpArgs({...model,nativeMtp:{supported:true,reason:'metadata'}},'on',3),['--speculative-draft-mtp','--speculative-draft-max-tokens','3']);
 assert.deepEqual(mtpArgs(model,'off'),['--no-speculative-draft-mtp']);
 assert.deepEqual(mtpArgs(model,undefined),[]);
});
test('MTP must be confirmed on AND off; draft settings and separate drafters cannot silently differ',()=>{
 verifyMtp({speculative_draft_mtp:true,speculative_draft_max_tokens:2},'on','gguf');
 verifyMtp({speculative_draft_mtp:false},'off','gguf');
 assert.throws(()=>verifyMtp({},'on','gguf'));
 assert.throws(()=>verifyMtp({},'off','gguf'));
 assert.throws(()=>verifyMtp({speculative_draft_mtp:true},'off','gguf'));
 assert.throws(()=>verifyMtp({speculative_draft_mtp:true,speculative_draft_max_tokens:4},'on','gguf',2));
 assert.throws(()=>verifyMtp({speculative_draft_mtp:false,speculative_draft_simple:true},'off','gguf'));
});
test('cached compatibility requires exact model identity, size and current file modification time',()=>{
 const home=mkdtempSync(path.join(tmpdir(),'lmb-mtp-'));try{
 const internal=path.join(home,'.lmstudio','.internal');mkdirSync(internal,{recursive:true});
 const file=path.join(home,'publisher','model','file.gguf');mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,'GGUF');const st=statSync(file);
 const indexed={defaultIdentifier:model.key,sizeBytes:4,format:'gguf',indexedModelIdentifier:'publisher/model/file.gguf'};
 writeFileSync(path.join(internal,'model-index-cache.json'),JSON.stringify({models:[indexed]}));
 writeFileSync(path.join(internal,'gguf-metadata-cache.json'),JSON.stringify({json:{map:[[file,{mtimeMs:st.mtimeMs,fileSizeBytes:st.size,metadata:{supportsMtp:true}}]]}}));
 assert.equal(attachMtp([model],home)[0].nativeMtp?.supported,true);
 assert.equal(attachMtp([{...model,key:'other@q4'}],home)[0].nativeMtp?.supported,null);
 assert.equal(attachMtp([{...model,size_bytes:8}],home)[0].nativeMtp?.supported,null);
 writeFileSync(file,'changed');assert.equal(attachMtp([model],home)[0].nativeMtp?.supported,null);
 }finally{rmSync(home,{recursive:true,force:true});}
});
test('native MTP library filter and saved preferences distinguish no support from unknown',()=>{
 const models=[{...model,key:'yes',nativeMtp:{supported:true,reason:''}},{...model,key:'no',nativeMtp:{supported:false,reason:''}},model];
 assert.deepEqual(visibleModels(models,{...defaultLibraryView,mtp:'yes'}).map(m=>m.key),['yes']);
 assert.deepEqual(visibleModels(models,{...defaultLibraryView,mtp:'no'}).map(m=>m.key),['no']);
 assert.deepEqual(visibleModels(models,{...defaultLibraryView,mtp:'unknown'}).map(m=>m.key),[model.key]);
 assert.equal(restoreLibraryView({mtp:'yes'}).mtp,'yes');assert.equal(restoreLibraryView({mtp:'garbage'}).mtp,'');
});
test('invalid MTP configuration is rejected',()=>{
 assert.throws(()=>validateConfig({...defaultConfig,modelKeys:['m'],mtp:'invalid' as any}));
 assert.throws(()=>validateConfig({...defaultConfig,modelKeys:['m'],mtpDraftTokens:0}));
});
