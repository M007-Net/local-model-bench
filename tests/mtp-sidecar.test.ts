import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appendFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {attachMtp,mtpArgs,verifyMtp} from '../electron/mtp';
import {applySidecar,sidecarConfigPath} from '../electron/mtp-sidecar';
import {draftAcceptance,draftModelsLoaded,settledDraftAcceptance,watchEngineLog} from '../electron/engine-log';
import {runEngine,type Adapter,type EngineEvent} from '../electron/engine';
import {metrics} from '../electron/metrics';
import {defaultConfig,defaultSettings,starterTests} from '../src/defaults';
import type {Model,Run,RunConfig} from '../src/types';

const slash=(p:string)=>p.replaceAll('\\','/');
const base:Model={key:'main@q3',display_name:'Main',format:'gguf',size_bytes:4,max_context_length:8192,type:'llm',loaded_instances:[],quantization:null};

// A library laid out the way LM Studio lays one out: a model file, and prediction heads stored
// with it as their own file that LM Studio indexes in its separate "drafter" domain.
function library(over:{headMeta?:Record<string,unknown>;headAt?:string;extraHead?:boolean}={}){
 const home=mkdtempSync(path.join(tmpdir(),'lmb-sidecar-'));
 const main=path.join(home,'pub','repo','main.gguf');
 const head=path.join(home,over.headAt??path.join('pub','repo','MTP','head.gguf'));
 for(const file of [main,head]){mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,'GGUF');}
 const internal=path.join(home,'.lmstudio','.internal');mkdirSync(internal,{recursive:true});
 const headResource=slash(path.relative(path.join(home,'pub'),head));
 const entry=(file:string,extra:object)=>({format:'gguf',entryPoint:{absPath:slash(file)},...extra});
 const models=[
  entry(main,{domain:'llm',defaultIdentifier:'main@q3',sizeBytes:4,indexedModelIdentifier:'pub/repo/main.gguf'}),
  entry(head,{domain:'drafter',indexedModelIdentifier:headResource}),
 ];
 if(over.extraHead){
  const spare=path.join(home,'pub','repo','spare.gguf');writeFileSync(spare,'GGUF');
  models.push(entry(spare,{domain:'drafter',indexedModelIdentifier:'pub/repo/spare.gguf'}));
 }
 writeFileSync(path.join(internal,'model-index-cache.json'),JSON.stringify({models}));
 const record=(file:string,metadata:object)=>[slash(file),{mtimeMs:statSync(file).mtimeMs,fileSizeBytes:statSync(file).size,metadata}];
 const headMeta={supportsMtp:false,arch:'testarch-assistant',embeddingLength:1024,embeddingLengthOut:3840,nextnPredictLayers:4,...over.headMeta};
 const map=[record(main,{supportsMtp:false,arch:'testarch',embeddingLength:3840}),record(head,headMeta)];
 if(over.extraHead)map.push(record(path.join(home,'pub','repo','spare.gguf'),headMeta));
 writeFileSync(path.join(internal,'gguf-metadata-cache.json'),JSON.stringify({json:{map}}));
 return {home,head:slash(head),headResource,clean:()=>rmSync(home,{recursive:true,force:true})};
}

test('prediction heads stored beside a model count as native MTP, and say so',()=>{
 const lib=library();try{
  const mtp=attachMtp([base],lib.home)[0].nativeMtp!;
  assert.equal(mtp.supported,true);
  assert.equal(mtp.kind,'sidecar');
  assert.equal(mtp.draftResource,lib.headResource);
  assert.equal(mtp.draftPath,lib.head);
 }finally{lib.clean();}
});
test('a head is paired by structure, never by where its name looks right',()=>{
 for(const broken of [{embeddingLengthOut:2048},{arch:'otherarch-assistant'},{nextnPredictLayers:0}]){
  const lib=library({headMeta:broken});try{
   const mtp=attachMtp([base],lib.home)[0].nativeMtp!;
   assert.equal(mtp.supported,false,JSON.stringify(broken));
   assert.equal(mtp.kind,undefined);
  }finally{lib.clean();}
 }
 // A head filed outside the model's own folder belongs to something else, whatever it contains.
 const away=library({headAt:path.join('pub','elsewhere','head.gguf')});try{
  assert.equal(attachMtp([base],away.home)[0].nativeMtp!.supported,false);
 }finally{away.clean();}
});
test('two heads that both fit are reported as ambiguous rather than guessed between',()=>{
 const lib=library({extraHead:true});try{
  const mtp=attachMtp([base],lib.home)[0].nativeMtp!;
  assert.equal(mtp.supported,null);
  assert.match(mtp.reason,/More than one MTP head/);
  assert.match(mtp.reason,/spare\.gguf/);
 }finally{lib.clean();}
});
test('a separate head adds no load arguments, because LM Studio has no flag for one',()=>{
 const sidecar={...base,nativeMtp:{supported:true,kind:'sidecar' as const,reason:'',resource:'pub/repo/main.gguf',draftResource:'repo/MTP/head.gguf',draftPath:'c:/m/head.gguf'}};
 assert.deepEqual(mtpArgs(sidecar,'on',3),[]);
 assert.deepEqual(mtpArgs(sidecar,'off'),['--no-speculative-draft-mtp']);
 assert.deepEqual(mtpArgs({...base,nativeMtp:{supported:true,kind:'bundled',reason:''}},'on',3),['--speculative-draft-mtp','--speculative-draft-max-tokens','3']);
});
test('a separate head is only believed when the engine log names that exact file',()=>{
 const evidence=(loaded:string[])=>({kind:'sidecar' as const,draftPath:'C:/m/head.gguf',draftersLoaded:loaded});
 const config={speculative_draft_mtp:false,speculative_draft_max_tokens:3};
 verifyMtp(config,'on','gguf',3,evidence(['c:/m/head.gguf']));
 assert.throws(()=>verifyMtp(config,'on','gguf',3,evidence([])),/did not report loading the MTP head/);
 assert.throws(()=>verifyMtp(config,'on','gguf',3,evidence(['c:/m/other.gguf'])),/loaded c:\/m\/other\.gguf instead/);
 assert.throws(()=>verifyMtp({...config,speculative_draft_max_tokens:4},'on','gguf',3,evidence(['c:/m/head.gguf'])),/draft-token count/);
 // The sweep's baseline has to be a plain load. A head LM Studio brought along on its own
 // would make every depth measured against it look better than it is.
 assert.throws(()=>verifyMtp({speculative_draft_mtp:false},'off','gguf',2,{kind:'sidecar',draftPath:'C:/m/head.gguf',draftersLoaded:['c:/m/head.gguf']}),/MTP off/);
 verifyMtp({speculative_draft_mtp:false},'off','gguf',2,{kind:'sidecar',draftPath:'C:/m/head.gguf',draftersLoaded:[]});
});
test('the load setting is written into LM Studio’s own config and taken straight back out',()=>{
 const lib=library();try{
  const model=attachMtp([base],lib.home)[0];
  const file=sidecarConfigPath(model.nativeMtp!.resource!,lib.home);
  assert.equal(existsSync(file),false);
  const restore=applySidecar(model,4,lib.home);
  const fields=JSON.parse(readFileSync(file,'utf8')).load.fields as {key:string;value:unknown}[];
  const value=(key:string)=>fields.find(f=>f.key.endsWith(key))?.value;
  assert.equal(value('draftMtpSidecar'),true);
  assert.equal(value('draftModel'),lib.headResource);
  assert.equal(value('draftMaxTokens'),4);
  // Only one speculative mode may be on at once or LM Studio refuses the load outright.
  assert.equal(value('draftMtp'),false);
  assert.equal(value('draftSimple'),false);
  restore();
  assert.equal(existsSync(file),false,'a file this app created is deleted again');
  assert.equal(existsSync(path.dirname(file)),false,'and so are the folders it had to make');
 }finally{lib.clean();}
});
test('settings the user already had are kept, and restored byte for byte',()=>{
 const lib=library();try{
  const model=attachMtp([base],lib.home)[0];
  const file=sidecarConfigPath(model.nativeMtp!.resource!,lib.home);
  const original='{"preset":"","operation":{"fields":[]},"load":{"fields":[{"key":"llm.load.contextLength","value":4242},{"key":"llm.load.llama.speculativeDecoding.draftSimple","value":true}]}}';
  mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,original);
  const restore=applySidecar(model,2,lib.home);
  const fields=JSON.parse(readFileSync(file,'utf8')).load.fields as {key:string;value:unknown}[];
  assert.equal(fields.find(f=>f.key==='llm.load.contextLength')?.value,4242);
  assert.equal(fields.find(f=>f.key.endsWith('draftSimple'))?.value,false);
  restore();
  assert.equal(readFileSync(file,'utf8'),original);
  restore(); // Restoring twice must not undo a later, unrelated write.
  assert.equal(readFileSync(file,'utf8'),original);
 }finally{lib.clean();}
});
test('a model resource that is not a relative path is refused before anything is written',()=>{
 for(const bad of ['C:/somewhere/main.gguf','../../escape.gguf','..'])assert.throws(()=>sidecarConfigPath(bad,tmpdir()),/relative path/);
});
test('only log lines written during a load are read, and only draft models are taken from them',()=>{
 const home=mkdtempSync(path.join(tmpdir(),'lmb-log-'));try{
  const dir=path.join(home,'.lmstudio','server-logs','2026-09');mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'2026-09-15.1.log');
  writeFileSync(file,"[old] I common_speculative_init_result: loading draft model 'C:\\models\\stale.gguf'\n");
  const watch=watchEngineLog(home);
  assert.deepEqual(draftModelsLoaded(watch),[],'anything logged before the load began is not evidence about it');
  appendFileSync(file,"[new] I load: something unrelated\n[new] I common_speculative_init_result: loading draft model 'C:\\models\\MTP\\head.gguf'\n");
  assert.deepEqual(draftModelsLoaded(watch),['c:/models/mtp/head.gguf']);
  // A file rotated in the middle of a load was not there to be measured, so it is read whole.
  appendFileSync(path.join(dir,'2026-09-15.2.log'),"[new] I common_speculative_init_result: loading draft model 'C:\\models\\MTP\\second.gguf'\n");
  assert.deepEqual(draftModelsLoaded(watch).sort(),['c:/models/mtp/head.gguf','c:/models/mtp/second.gguf']);
 }finally{rmSync(home,{recursive:true,force:true});}
});

const textTest=starterTests.find(t=>t.id==='reasoning')!;
const makeRun=(config:Partial<RunConfig>):Run=>({id:'sidecar-run',created:'2026-09-15T00:00:00.000Z',updated:'2026-09-15T00:00:00.000Z',status:'running',
 config:{...structuredClone(defaultConfig),modelKeys:['mock'],testIds:['reasoning'],mode:'quality',concurrency:[1],waves:1,maxTokens:64,contextLength:2048,judgeModel:'',mtp:'on',...config},
 tests:[textTest],modelInfo:{},environment:{},logs:[],samples:[],waves:[]});
function mockAdapter(opts:{logLoads?:boolean}={}){
 const written:number[]=[];let restores=0,instance='';
 const model={key:'mock',display_name:'Mock',format:'gguf',type:'llm',size_bytes:100,quantization:null,max_context_length:8192,loaded_instances:[],
  nativeMtp:{supported:true,kind:'sidecar',reason:'test fixture',resource:'pub/repo/main.gguf',draftResource:'repo/MTP/head.gguf',draftPath:'C:/models/MTP/head.gguf'}} as unknown as Model;
 let tokens=0,on=false;
 const adapter:Adapter={
  models:async()=>[{...model,loaded_instances:instance?[{id:instance,config:{context_length:2048,parallel:1,speculative_draft_mtp:false,...(on?{speculative_draft_max_tokens:tokens}:{})}}]:[]}],
  cli:async(_s,args)=>{instance=args[args.indexOf('--identifier')+1];return 'loaded';},
  api:async()=>{instance='';return {};},
  infer:async()=>({output:'84',reasoning:'',rawStats:{},metrics:metrics({input_tokens:10,total_output_tokens:20,tokens_per_second:40},1000,0,10,20),status:'completed' as const,possibleTruncation:false}),
  sidecar:(_m,count)=>{written.push(count);tokens=count;on=true;return ()=>{restores++;};},
  watchLog:()=>({root:'',sizes:new Map()}),
  draftModels:()=>on&&opts.logLoads!==false?['c:/models/mtp/head.gguf']:[],
  draftAcceptance:async()=>({tasks:1,accepted:6,generated:10,acceptance:.6,meanLen:2}),
 };
 return {adapter,written,state:()=>({restores})};
}
const runIt=async(run:Run,adapter:Adapter)=>{
 const events:EngineEvent[]=[];
 await runEngine(run,defaultSettings,new AbortController().signal,e=>{events.push(e);if(e.type==='sample')run.samples.push(e.sample);},adapter);
 return {events,logs:events.filter(e=>e.type==='log').map(e=>(e as Extract<EngineEvent,{type:'log'}>).message),
  measured:events.filter(e=>e.type==='sample'&&!(e as Extract<EngineEvent,{type:'sample'}>).sample.warmup).length};
};
test('a sweep over separate heads writes one setting per depth and restores every one',async()=>{
 const mock=mockAdapter();
 const result=await runIt(makeRun({mtpSweep:[0,1,2,3,4,5]}),mock.adapter);
 // Depth 0 is the MTP-off baseline: it is loaded plainly, so no setting is written for it.
 assert.deepEqual(mock.written,[1,2,3,4,5]);
 assert.equal(mock.state().restores,5,'every written setting is taken back out again');
 assert.equal(result.measured,6,'all six depths measured');
 assert.ok(result.logs.some(m=>m.includes('repo/MTP/head.gguf')),'the run log names the head that was loaded');
});
test('nothing is measured at a depth whose head LM Studio never reported loading',async()=>{
 const mock=mockAdapter({logLoads:false});
 const result=await runIt(makeRun({mtpSweep:[2]}),mock.adapter);
 assert.equal(result.measured,0);
 assert.equal(mock.state().restores,1,'the setting is restored even when the load is rejected');
 assert.ok(result.logs.some(m=>/did not report loading the MTP head/.test(m)));
});

test('accepted-draft figures are read from the engine log and pooled over the wave',async()=>{
 const home=mkdtempSync(path.join(tmpdir(),'lmb-accept-'));try{
  const dir=path.join(home,'.lmstudio','server-logs','2026-09');mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'2026-09-15.1.log');
  const line=(a:number,g:number,len:number)=>`I slot print_timing: id  0 | task 0 | draft acceptance = 0.5 ( ${a} accepted / ${g} generated), mean len =  ${len}\n`;
  writeFileSync(file,line(999,999,9));
  const watch=watchEngineLog(home);
  assert.equal(draftAcceptance(watch),null,'a rate from before the wave is not the wave’s rate');
  appendFileSync(file,line(53,111,2.43)+line(27,49,1.5));
  const found=draftAcceptance(watch)!;
  assert.equal(found.tasks,2);
  assert.equal(found.accepted,80);
  assert.equal(found.generated,160);
  // Pooled over drafted tokens, so a long request weighs more than a short one: 80/160, not
  // the average of 53/111 and 27/49.
  assert.equal(found.acceptance,0.5);
  assert.equal(found.meanLen,(2.43+1.5)/2);
  // Waiting stops as soon as every request in the wave has reported.
  const began=Date.now();
  assert.equal((await settledDraftAcceptance(watch,2,5000))!.tasks,2);
  assert.ok(Date.now()-began<1000,'a complete wave is not waited on');
  // A request that never reports back gives up and says how many it did find.
  assert.equal((await settledDraftAcceptance(watch,3,300))!.tasks,2);
  assert.equal(await settledDraftAcceptance(watchEngineLog(home),0,5000),null,'nothing to wait for when MTP is off');
 }finally{rmSync(home,{recursive:true,force:true});}
});
