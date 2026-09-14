import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visionSupport,visionArgs,verifyVision,visionSummary,projectorToggle,noProjectorToggleNote,visionTestIds} from '../electron/vision';
import {png,dataUrl,imageDigest,visionImages,visionTests} from '../electron/vision-image';
import {chatInput} from '../electron/lmstudio';
import {validateConfig} from '../electron/validation';
import {defaultConfig} from '../src/defaults';
import {normalizeModels} from '../src/model-capabilities';
import type {Model} from '../src/types';

const base:Model={key:'m@q4',display_name:'Model',format:'gguf',size_bytes:4,max_context_length:8192,type:'llm',loaded_instances:[],quantization:null};
const seeing={...base,capabilities:{vision:true}};
const blind={...base,capabilities:{vision:false}};
const unknown={...base,capabilities:{}};

test('vision support is read from the server report, and unknown never counts as capable',()=>{
 assert.equal(visionSupport(seeing).supported,true);
 assert.equal(visionSupport(blind).supported,false);
 assert.equal(visionSupport(unknown).supported,null);
 assert.equal(visionSupport(base).supported,null);
 assert.equal(visionSupport(undefined).supported,null);
 // A vision-looking name must never stand in for a reported capability.
 assert.equal(visionSupport({...base,key:'qwen - vision@iq3_s',display_name:'Qwen Vision'}).supported,null);
});

test('vision adds no load arguments because LM Studio has no projector flag',()=>{
 assert.equal(projectorToggle,false);
 assert.deepEqual(visionArgs(seeing,'on'),[]);
 assert.deepEqual(visionArgs(blind,'off'),[]);
 assert.deepEqual(visionArgs(seeing,'auto'),[]);
 assert.deepEqual(visionArgs(blind,undefined),[]);
});

test('vision on is refused before loading for text-only and unknown models',()=>{
 assert.throws(()=>visionArgs(blind,'on'),/not confirmed/);
 assert.throws(()=>visionArgs(unknown,'on'),/not confirmed/);
 assert.throws(()=>visionArgs(base,'on'),/did not report/);
 // Off and auto stay available for every model, so no duplicate download is needed.
 assert.deepEqual(visionArgs(unknown,'off'),[]);
});

test('vision on stops the benchmark unless the loaded model entry confirms capability',()=>{
 assert.throws(()=>verifyVision(blind,'on'),/No measurements were taken/);
 assert.throws(()=>verifyVision(unknown,'on'),/No measurements were taken/);
 assert.throws(()=>verifyVision(undefined,'on'),/No measurements were taken/);
 const on=verifyVision(seeing,'on');
 assert.equal(on.confirmed,true);assert.equal(on.imagesSent,true);assert.equal(on.limitation,'');
});

test('text-only never claims the projector was unloaded',()=>{
 for(const mode of ['off','auto',undefined] as const){
  const state=verifyVision(seeing,mode);
  assert.equal(state.imagesSent,false);
  assert.equal(state.projectorUnloaded,false);
  assert.match(state.limitation,/does not unload vision weights/);
  assert.doesNotMatch(state.effective,/unload/i);
 }
 assert.equal(verifyVision(seeing,undefined).requested,'auto');
 // A vision-capable model says plainly that its projector stayed loaded.
 assert.match(verifyVision(seeing,'off').limitation,/remained attached and loaded/);
 assert.doesNotMatch(verifyVision(blind,'off').limitation,/remained attached/);
 assert.match(visionSummary(verifyVision(blind,'off')),/requested off/);
 assert.equal(noProjectorToggleNote.includes('no load-time option'),true);
});

test('chat input stays a plain string without an image and refuses remote urls',()=>{
 assert.equal(chatInput('hello'),'hello');
 assert.deepEqual(chatInput('hello','data:image/png;base64,AAAA'),[{type:'text',content:'hello'},{type:'image',data_url:'data:image/png;base64,AAAA'}]);
 assert.throws(()=>chatInput('hello','https://example.com/a.png'),/local data URL/);
 assert.throws(()=>chatInput('hello','file:///tmp/a.png'),/local data URL/);
});

test('benchmark images are valid, deterministic PNGs built locally',()=>{
 const first=visionImages.colour(),second=visionImages.colour();
 assert.deepEqual(first,second);
 assert.equal(imageDigest(first),imageDigest(second));
 assert.deepEqual([...first.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(first.subarray(12,16).toString('ascii'),'IHDR');
 assert.equal(first.subarray(first.length-8,first.length-4).toString('ascii'),'IEND');
 assert.equal(first.readUInt32BE(16),224);assert.equal(first.readUInt32BE(20),224);
 assert.ok(dataUrl(first).startsWith('data:image/png;base64,'));
 // Distinct tasks must not share one picture.
 const digests=new Set(Object.values(visionImages).map(make=>imageDigest(make())));
 assert.equal(digests.size,3);
 // A 1x1 image is still a structurally valid PNG.
 assert.equal(png(1,1,()=>[0,0,0]).subarray(12,16).toString('ascii'),'IHDR');
});

test('vision tests carry local images, objective checks, and match the ids the UI counts',()=>{
 const tests=visionTests();
 assert.deepEqual(tests.map(t=>t.id),visionTestIds);
 for(const t of tests){
  assert.ok(t.image?.startsWith('data:image/png;base64,'),t.id+' must carry a local data URL');
  assert.equal(t.imageDigest?.length,64);
  assert.equal(t.kind,'quality');
  assert.equal(t.category,'Vision');
  assert.ok(t.rules.length>0,t.id+' needs an objective check');
  assert.ok(t.maxTokens>0);
 }
 // Same input every run, so results stay comparable across runs.
 assert.deepEqual(visionTests().map(t=>t.imageDigest),tests.map(t=>t.imageDigest));
});

test('vision mode is validated and stays optional for saved runs',()=>{
 for(const mode of ['auto','off','on'] as const)validateConfig({...defaultConfig,modelKeys:['m'],vision:mode});
 validateConfig({...defaultConfig,modelKeys:['m']});
 assert.throws(()=>validateConfig({...defaultConfig,modelKeys:['m'],vision:'yes' as any}),/Invalid vision mode/);
 assert.throws(()=>validateConfig({...defaultConfig,modelKeys:['m'],vision:'' as any}),/Invalid vision mode/);
 assert.equal(defaultConfig.vision,undefined);
});

test('a missing vision capability from the server is preserved as unknown, not false',()=>{
 const [model]=normalizeModels([{type:'llm',key:'k',capabilities:{}}]);
 assert.equal(visionSupport(model).supported,null);
 const [reported]=normalizeModels([{type:'llm',key:'k',capabilities:{vision:true}}]);
 assert.equal(visionSupport(reported).supported,true);
 // Vision must survive discovery for a model that reports nothing else.
 const [bare]=normalizeModels([{type:'llm',key:'k'}]);
 assert.equal(visionSupport(bare).supported,null);
});
