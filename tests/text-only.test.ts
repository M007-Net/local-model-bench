import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MARKER,TWIN_SUFFIX,awaitIndexed,createTextOnly,planTextOnly,removeTextOnly,textOnlyTwins} from '../electron/text-only';
import type {Model} from '../src/types';

const slash=(p:string)=>p.replaceAll('\\','/');
// A vision-capable model laid out the way LM Studio lays one out: weights, a projector beside
// them, and an MTP head in its own folder underneath.
function library(){
 const home=mkdtempSync(path.join(tmpdir(),'lmb-textonly-'));
 const dir=path.join(home,'.lmstudio','models','pub','repo-GGUF');
 mkdirSync(path.join(dir,'MTP'),{recursive:true});
 const main=path.join(dir,'model-IQ3.gguf'),head=path.join(dir,'MTP','mtp-model.gguf'),proj=path.join(dir,'mmproj-F16.gguf');
 writeFileSync(main,'WEIGHTS');writeFileSync(head,'HEAD');writeFileSync(proj,'PROJECTOR');
 const internal=path.join(home,'.lmstudio','.internal');mkdirSync(internal,{recursive:true});
 writeFileSync(path.join(internal,'model-index-cache.json'),JSON.stringify({models:[
  {domain:'llm',format:'gguf',defaultIdentifier:'model@iq3',sizeBytes:7,indexedModelIdentifier:'pub/repo-GGUF/model-IQ3.gguf',entryPoint:{absPath:slash(main)}},
 ]}));
 const model:Model={key:'model@iq3',display_name:'Model',format:'gguf',size_bytes:7,max_context_length:8192,type:'llm',loaded_instances:[],quantization:{name:'IQ3'},
  capabilities:{vision:true},nativeMtp:{supported:true,kind:'sidecar',reason:'',resource:'pub/repo-GGUF/model-IQ3.gguf',draftResource:'repo-GGUF/MTP/mtp-model.gguf',draftPath:slash(head)}};
 return {home,dir,main,head,proj,model,twin:dir+TWIN_SUFFIX,clean:()=>rmSync(home,{recursive:true,force:true})};
}

test('a text-only copy takes the weights and any MTP head, and leaves the projector behind',()=>{
 const lib=library();try{
  const plan=planTextOnly(lib.model,lib.home);
  assert.equal(slash(plan.folder),slash(lib.twin));
  assert.deepEqual(plan.files.map(f=>slash(path.relative(plan.folder,f.to))),['model-IQ3.gguf','MTP/mtp-model.gguf']);
  assert.deepEqual(plan.projectors,['mmproj-F16.gguf']);
  assert.equal(plan.headIncluded,true,'a copy without the head would silently lose native MTP');
  assert.ok(plan.files.every(f=>!/mmproj/i.test(f.to)));
 }finally{lib.clean();}
});
test('a model with no projector, and a copy of a copy, are refused rather than made pointlessly',()=>{
 const lib=library();try{
  assert.throws(()=>planTextOnly({...lib.model,capabilities:{vision:false}},lib.home),/already loads text-only/);
  rmSync(lib.proj);
  assert.throws(()=>planTextOnly(lib.model,lib.home),/No projector file was found/);
 }finally{lib.clean();}
});
test('the weights are linked, never copied, so a copy costs no disk space',()=>{
 const lib=library();try{
  const folder=createTextOnly(planTextOnly(lib.model,lib.home));
  const linked=path.join(folder,'model-IQ3.gguf'),head=path.join(folder,'MTP','mtp-model.gguf');
  assert.equal(statSync(linked).ino,statSync(lib.main).ino,'the copy is the same bytes on disk, not a second set');
  assert.equal(statSync(head).ino,statSync(lib.head).ino);
  assert.ok(statSync(linked).nlink>=2);
  assert.equal(existsSync(path.join(folder,'mmproj-F16.gguf')),false,'the projector is what a text-only copy leaves out');
  const marker=JSON.parse(readFileSync(path.join(folder,MARKER),'utf8'));
  assert.equal(marker.createdBy,'local-model-bench');
  assert.equal(slash(marker.source),slash(lib.dir));
 }finally{lib.clean();}
});
test('a copy that cannot be finished leaves no half-made model for LM Studio to index',()=>{
 const lib=library();try{
  const plan=planTextOnly(lib.model,lib.home);
  // A folder that is already there is the signal that something else owns this name.
  mkdirSync(plan.folder,{recursive:true});
  assert.throws(()=>createTextOnly(plan));
  const survivor=library();try{
   const other=planTextOnly(survivor.model,survivor.home);
   rmSync(survivor.head); // The head disappears between planning and linking.
   assert.throws(()=>createTextOnly(other));
   assert.equal(existsSync(other.folder),false,'the whole folder is taken back out');
  }finally{survivor.clean();}
 }finally{lib.clean();}
});
test('copies are found by their marker, never by a folder that merely looks named right',()=>{
 const lib=library();try{
  const folder=createTextOnly(planTextOnly(lib.model,lib.home));
  const twins=textOnlyTwins(lib.home);
  assert.equal(twins.length,1);
  assert.equal(slash(twins[0].folder),slash(folder));
  assert.equal(twins[0].sourceKey,'model@iq3');
  // Same name, no marker: not this app's, so not this app's to list or delete.
  const impostor=path.join(lib.home,'.lmstudio','models','pub','other-GGUF'+TWIN_SUFFIX);
  mkdirSync(impostor,{recursive:true});writeFileSync(path.join(impostor,'mine.gguf'),'MINE');
  assert.equal(textOnlyTwins(lib.home).length,1);
  assert.throws(()=>removeTextOnly(impostor,lib.home),/not created by Local Model Bench/);
  assert.equal(existsSync(path.join(impostor,'mine.gguf')),true);
 }finally{lib.clean();}
});
test('removing a copy drops links only, and refuses any file that exists nowhere else',()=>{
 const lib=library();try{
  const folder=createTextOnly(planTextOnly(lib.model,lib.home));
  // Something that only exists inside the copy stops the delete outright.
  writeFileSync(path.join(folder,'notes.txt'),'do not lose me');
  assert.throws(()=>removeTextOnly(folder,lib.home),/exist nowhere else/);
  assert.equal(existsSync(folder),true);
  rmSync(path.join(folder,'notes.txt'));
  removeTextOnly(folder,lib.home);
  assert.equal(existsSync(folder),false);
  assert.equal(readFileSync(lib.main,'utf8'),'WEIGHTS','the model itself is untouched');
  assert.equal(readFileSync(lib.head,'utf8'),'HEAD');
  assert.equal(readFileSync(lib.proj,'utf8'),'PROJECTOR');
  assert.deepEqual(readdirSync(lib.dir).sort(),['MTP','mmproj-F16.gguf','model-IQ3.gguf']);
 }finally{lib.clean();}
});

test('a copy is not reported as made until LM Studio’s own index holds it',async()=>{
 const lib=library();try{
  const plan=planTextOnly(lib.model,lib.home);
  const folder=createTextOnly(plan);
  // LM Studio re-indexes a new folder on its own, in about a quarter of a second. Until it
  // has, the copy exists but is not selectable, which is not the same as being ready.
  assert.equal(await awaitIndexed(folder,lib.home,300,50),false);
  const index=path.join(lib.home,'.lmstudio','.internal','model-index-cache.json');
  const doc=JSON.parse(readFileSync(index,'utf8'));
  doc.models.push({domain:'llm',format:'gguf',defaultIdentifier:'model - text only',sizeBytes:7,
   indexedModelIdentifier:'pub/repo-GGUF - Text only/model-IQ3.gguf',entryPoint:{absPath:slash(path.join(folder,'model-IQ3.gguf'))}});
  writeFileSync(index,JSON.stringify(doc));
  assert.equal(await awaitIndexed(folder,lib.home,2000,50),true);
 }finally{lib.clean();}
});

test('a removed copy is not reported as gone until the library has dropped it too',async()=>{
 const lib=library();try{
  const folder=createTextOnly(planTextOnly(lib.model,lib.home));
  const index=path.join(lib.home,'.lmstudio','.internal','model-index-cache.json');
  const doc=JSON.parse(readFileSync(index,'utf8'));
  const entry={domain:'llm',format:'gguf',defaultIdentifier:'model - text only',sizeBytes:7,
   indexedModelIdentifier:'pub/repo-GGUF - Text only/model-IQ3.gguf',entryPoint:{absPath:slash(path.join(folder,'model-IQ3.gguf'))}};
  writeFileSync(index,JSON.stringify({models:[...doc.models,entry]}));
  removeTextOnly(folder,lib.home);
  assert.equal(await awaitIndexed(folder,lib.home,300,50,false),false,'the folder is gone but LM Studio still lists it');
  writeFileSync(index,JSON.stringify(doc));
  assert.equal(await awaitIndexed(folder,lib.home,2000,50,false),true);
 }finally{lib.clean();}
});
