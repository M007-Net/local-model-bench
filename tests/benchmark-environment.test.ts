import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBenchmarkEnvironment} from '../src/benchmark-environment';

const client={platform:'win32',release:'10.0',architecture:'x64',cpu:'Client CPU',logicalCpus:16,availableParallelism:14,totalMemoryBytes:64_000_000_000,node:'22.0',electron:'44.0',appVersion:'1.20.0'};

test('remote endpoint facts never inherit the client hardware or operating system',()=>{
 const env=createBenchmarkEnvironment({client,provider:'openai',endpoint:'http://10.0.0.2:8000',models:[{id:'remote/model',model:{key:'remote/model',display_name:'Remote Model'}}]});
 assert.equal(env.client.cpu.value,'Client CPU');
 assert.equal(env.client.platform.value,'win32');
 assert.equal(env.inferenceServer.hostCpu.value,null);
 assert.equal(env.inferenceServer.hostOperatingSystem.value,null);
 assert.equal(env.inferenceServer.hostMemoryBytes.value,null);
 assert.equal(env.inferenceServer.version.source,'not exposed by endpoint');
 assert.equal(env.inferenceServer.modelIdentityByKey['remote/model'].name.value,'Remote Model');
});

test('model metadata is per key, accepts only positive reported size, and keeps hash unknown when absent',()=>{
 const env=createBenchmarkEnvironment({client,provider:'llamacpp',endpoint:'http://server:8080',models:[
  {id:'a',model:{key:'a',display_name:'A',size_bytes:0,hash:'abc',quantization:{name:'Q4_K_M'}}},
  {id:'b',model:{key:'b',display_name:'B',size_bytes:1234}},
 ]});
 assert.deepEqual(Object.keys(env.inferenceServer.modelIdentityByKey),['a','b']);
 assert.equal(env.inferenceServer.modelIdentityByKey.a.sizeBytes.value,null);
 assert.equal(env.inferenceServer.modelIdentityByKey.a.hash.value,'abc');
 assert.equal(env.inferenceServer.modelIdentityByKey.a.quantization.value,'Q4_K_M');
 assert.equal(env.inferenceServer.modelIdentityByKey.b.sizeBytes.value,1234);
 assert.equal(env.inferenceServer.modelIdentityByKey.b.hash.source,'not exposed by endpoint');
});

test('effective runtime and model configuration remain unknown until actual endpoint data is supplied',()=>{
 const before=createBenchmarkEnvironment({client,provider:'lmstudio',endpoint:'http://127.0.0.1:1234',models:[{id:'m',model:{key:'m'}}]});
 assert.equal(before.inferenceServer.runtime.ref.value,null);
 assert.equal(before.inferenceServer.effectiveConfigurationByModel.m.value,null);
 const after=createBenchmarkEnvironment({client,provider:'lmstudio',endpoint:'http://127.0.0.1:1234',models:[{id:'m',model:{key:'m'}}],effectiveConfigurations:{m:{context_length:8192,parallel:4}},effectiveRuntime:{label:'CUDA',ref:'cuda@1.2',version:'1.2'}});
 assert.deepEqual(after.inferenceServer.effectiveConfigurationByModel.m.value,{context_length:8192,parallel:4});
 assert.equal(after.inferenceServer.runtime.ref.value,'cuda@1.2');
});
