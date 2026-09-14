import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inferProfile,validateProfile,matchesProfile,defaultComparisonFilter,profilesFor} from '../src/model-profile';
import {Store} from '../electron/store';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Run} from '../src/types';
test('parameter labels and active name hints retain their units',()=>{
 assert.equal(inferProfile({params_string:'27000M'}).totalB,27);
 assert.deepEqual(inferProfile({key:'qwen-35b-a3b@q4',params_string:'35B'}),{totalB:35,activeB:3,kind:'moe',source:'LM Studio parameter label; architecture/name hints'});
 assert.equal(inferProfile({key:'mixtral-8x7b-q4'}).totalB,null);
 assert.equal(inferProfile({key:'model-27b'}).kind,'unknown');
});
test('a reported non-MoE architecture classifies a model as dense',()=>{
 assert.deepEqual(inferProfile({key:'qwen3.8-27b@iq3_s',display_name:'Qwen3.8 27B UD',params_string:'27B',architecture:'qwen35'}),{totalB:27,activeB:null,kind:'dense',source:'LM Studio parameter label; architecture/name hints'});
 assert.deepEqual(inferProfile({key:'qwen3.6-35b-a3b@iq4_xs',display_name:'Qwen3.6 35B A3B UD',params_string:'35B-A3B',architecture:'qwen35moe'}),{totalB:35,activeB:3,kind:'moe',source:'LM Studio parameter label; architecture/name hints'});
 assert.equal(inferProfile({key:'mixtral-8x7b-q4',architecture:'llama'}).kind,'moe');
 assert.equal(inferProfile({key:'model-27b',params_string:'27B'}).kind,'unknown');
});
test('ranges are inclusive; unknown sizes remain unknown; active filters only apply to MoE',()=>{
 const p={totalB:27,activeB:3,kind:'moe' as const,source:'test'};
 const f={...defaultComparisonFilter,min:'25',max:'35'};
 assert.equal(matchesProfile('m',p,f),true);
 assert.equal(matchesProfile('m',{...p,totalB:null},f),false);
 assert.equal(matchesProfile('m',{...p,totalB:35},f),true);
 assert.equal(matchesProfile('m',p,{...f,kind:'dense'}),false);
 assert.equal(matchesProfile('m',p,{...f,kind:'moe',basis:'activeB',min:'2',max:'4'}),true);
 assert.equal(matchesProfile('m',{...p,activeB:null},{...f,kind:'moe',basis:'activeB',min:'2',max:'4'}),false);
 assert.equal(matchesProfile('m',p,{...f,min:'40',max:'20'}),false);
});
test('invalid model metadata cannot enter the database',()=>{
 for(const totalB of [-1,0,NaN,Infinity])assert.throws(()=>validateProfile({totalB,activeB:null,kind:'dense',source:''}));
 assert.throws(()=>validateProfile({totalB:3,activeB:8,kind:'moe',source:''}));
 assert.equal(validateProfile({totalB:27,activeB:3,kind:'dense',source:''}).activeB,null);
});
test('database migration retains history and saves model profiles across reopen',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lmb-comparison-')),file=path.join(dir,'bench.sqlite');
 try{
 const old=new DatabaseSync(file);old.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,doc TEXT NOT NULL); PRAGMA user_version=1;');old.prepare('INSERT INTO runs VALUES (?,?)').run('saved',JSON.stringify({id:'saved',status:'completed'}));old.close();
 let store=new Store(file);store.saveProfile('m',{totalB:27,activeB:null,kind:'dense',source:''});store.close();
 store=new Store(file);assert.equal(store.getRun('saved').status,'completed');assert.equal(store.profiles().m.totalB,27);assert.equal(store.profiles().m.source,'User supplied');store.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('saved snapshots support offline filters and user corrections take precedence',()=>{
 const run={config:{modelKeys:['m']},samples:[],modelInfo:{m:{model:{params_string:'27B'}}}} as unknown as Run;
 assert.equal(profilesFor(run,[],{}).m.totalB,27);
 assert.equal(profilesFor(run,[],{m:{totalB:28,activeB:null,kind:'dense',source:'User supplied'}}).m.totalB,28);
});
