import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planTextOnlySwap,textOnlyIncomplete,textOnlySummary} from '../src/text-only-swap';
import type {Model} from '../src/types';
import type {Twin} from '../electron/text-only';

const model=(key:string,vision:boolean,name=key):Model=>({
 key,display_name:name,size_bytes:12040883104,format:'gguf',max_context_length:8192,type:'llm',
 loaded_instances:[],quantization:null,capabilities:{vision},
} as unknown as Model);
const twin=(sourceKey:string,key:string|null):Twin=>({folder:'/m/x - Text only',source:'/m/x',sourceKey,created:'',key});

const vis=model('qwen - vision@iq3_s',true,'Qwen 27B Vision');
const txt=model('qwen - text only@iq3_s',false,'Qwen 27B Text only');
const plain=model('qwen@iq3_s',false,'Qwen 27B');

test('a selection with no projector is already text-only and nothing is proposed',()=>{
 const p=planTextOnlySwap(['qwen@iq3_s'],[plain],[]);
 assert.deepEqual(p.projectored,[]);
 assert.deepEqual(p.nextKeys,['qwen@iq3_s'],'the selection is untouched');
 assert.equal(textOnlyIncomplete(p),false);
 assert.match(textOnlySummary(p),/already text-only/);
});

test('a vision model with an indexed twin is swapped to the twin',()=>{
 const p=planTextOnlySwap(['qwen - vision@iq3_s'],[vis,txt],[twin('qwen - vision@iq3_s','qwen - text only@iq3_s')]);
 assert.deepEqual(p.nextKeys,['qwen - text only@iq3_s']);
 assert.deepEqual(p.swappable,[{from:'qwen - vision@iq3_s',to:'qwen - text only@iq3_s',name:'Qwen 27B Vision'}]);
 assert.deepEqual(p.needTwin,[]);
 assert.equal(textOnlyIncomplete(p),false);
});

test('a vision model with no twin is named rather than silently left as it was',()=>{
 const p=planTextOnlySwap(['qwen - vision@iq3_s'],[vis],[]);
 assert.deepEqual(p.nextKeys,['qwen - vision@iq3_s'],'nothing is swapped to a key that does not exist');
 assert.deepEqual(p.needTwin.map(m=>m.key),['qwen - vision@iq3_s']);
 assert.equal(textOnlyIncomplete(p),true,'the toggle cannot keep its promise yet, and says so');
 assert.match(textOnlySummary(p),/need a text-only copy making first/);
});

// A twin LM Studio has not indexed has no key to select, and one whose key it has since forgotten
// would fail to load. Both are treated as missing rather than swapped to.
test('a twin without a usable key counts as missing',()=>{
 const unindexed=planTextOnlySwap(['qwen - vision@iq3_s'],[vis],[twin('qwen - vision@iq3_s',null)]);
 assert.equal(unindexed.needTwin.length,1);
 assert.deepEqual(unindexed.nextKeys,['qwen - vision@iq3_s']);
 const stale=planTextOnlySwap(['qwen - vision@iq3_s'],[vis],[twin('qwen - vision@iq3_s','gone@iq3_s')]);
 assert.equal(stale.needTwin.length,1,'a key LM Studio no longer lists is not selected');
 assert.deepEqual(stale.nextKeys,['qwen - vision@iq3_s']);
});

test('a mixed selection swaps what it can and reports the rest',()=>{
 const other=model('gemma - vision@q4',true,'Gemma Vision');
 const p=planTextOnlySwap(['qwen@iq3_s','qwen - vision@iq3_s','gemma - vision@q4'],[plain,vis,txt,other],
  [twin('qwen - vision@iq3_s','qwen - text only@iq3_s')]);
 assert.deepEqual(p.nextKeys,['qwen@iq3_s','qwen - text only@iq3_s','gemma - vision@q4'],'order is preserved');
 assert.equal(p.swappable.length,1);
 assert.deepEqual(p.needTwin.map(m=>m.key),['gemma - vision@q4']);
 assert.match(textOnlySummary(p),/2 selected models would still load a projector/);
 assert.match(textOnlySummary(p),/1 can be swapped.*1 need/);
});
