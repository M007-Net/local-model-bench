import {linkSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {Model} from '../src/types';

// Benchmarking a vision-capable model without its vision projector.
//
// LM Studio attaches a projector from the model's index entry and from nothing else. Its own
// load path reduces to two lines:
//     const visionPath = indexedModel.visionAdapter?.absPath;
//     if (visionPath !== undefined) loadParams.mmproj_path = visionPath;
// There is no command-line flag, no field of POST /api/v1/models/load, and no key in LM
// Studio's load-config schema that can turn that off — checked against lms CLI commit 07b7252
// and LM Studio's own bundle on 2026-09-15. A model is vision-capable exactly when an
// mmproj-*.gguf sits in its folder, so the only way to measure the same weights without the
// projector is to give LM Studio a second folder holding those weights and no projector. LM
// Studio indexes that as its own model key, reports capabilities.vision false for it, and
// loads it with no mmproj_path at all. LM Studio's own library already works this way: a
// "… - Vision" folder beside a plain one is the same GGUF indexed twice.
//
// Nothing is copied. Every file in the twin is a hard link, so it occupies no additional disk
// space and shares the original's bytes; removing it deletes a directory entry and never the
// weights. An MTP head stored with the model is linked in at the same relative place, so a
// text-only twin keeps native MTP. Hard links need a single NTFS volume, which a sibling
// folder inside the same models directory always is; anything else is refused rather than
// quietly duplicating many gigabytes.

export const TWIN_SUFFIX=' - Text only';
export const MARKER='.local-model-bench-text-only.json';
const slash=(p:string)=>p.replaceAll('\\','/');
const isProjector=(name:string)=>/^mmproj.*\.gguf$/i.test(name);

function readIndex(home:string){
 return JSON.parse(readFileSync(path.join(home,'.lmstudio','.internal','model-index-cache.json'),'utf8'));
}
// The same identity rule mtp.ts uses: an exact key, an unchanged size, and one matching entry.
// Two entries that both answer to a key are not a model this app will act on.
export function indexEntry(model:Model,home=homedir()){
 const matches=readIndex(home).models.filter((m:any)=>m.defaultIdentifier===model.key&&m.sizeBytes===model.size_bytes&&m.format===model.format);
 if(matches.length!==1)throw Error(`LM Studio does not describe exactly one stored model for ${model.display_name}. Refresh the library in LM Studio and try again.`);
 return matches[0];
}

export type TwinFile={from:string;to:string};
export type TwinPlan={key:string;displayName:string;sourceDir:string;folder:string;files:TwinFile[];projectors:string[];headIncluded:boolean};

// What making a twin would do, worked out before anything is written so the window can say it
// and so an impossible one fails with a reason rather than half a folder.
export function planTextOnly(model:Model,home=homedir()):TwinPlan{
 if(model.capabilities?.vision!==true)throw Error(`${model.display_name} has no vision projector attached, so it already loads text-only.`);
 const entry=indexEntry(model,home);
 const own=slash(entry.entryPoint?.absPath??'');
 if(!own)throw Error('LM Studio did not say which file this model loads from.');
 const sourceDir=own.slice(0,own.lastIndexOf('/'));
 if(sourceDir.endsWith(TWIN_SUFFIX))throw Error(`${model.display_name} is already a text-only copy.`);
 const folder=sourceDir+TWIN_SUFFIX;
 // The model's own weights, and any MTP head stored with it at the same relative place. The
 // projector is the one thing deliberately left behind.
 const files:TwinFile[]=[{from:own,to:path.join(folder,path.basename(own))}];
 const head=model.nativeMtp?.kind==='sidecar'?slash(model.nativeMtp.draftPath??''):'';
 if(head&&head.startsWith(sourceDir+'/'))files.push({from:head,to:path.join(folder,...head.slice(sourceDir.length+1).split('/'))});
 const projectors=(()=>{try{return readdirSync(sourceDir).filter(isProjector).sort();}catch{return [];}})();
 if(!projectors.length)throw Error(`No projector file was found beside ${model.display_name}, so a text-only copy would be identical to it.`);
 return {key:model.key,displayName:model.display_name,sourceDir,folder,files,projectors,headIncluded:files.length>1};
}

export function createTextOnly(plan:TwinPlan):string{
 if(statSync(plan.sourceDir).isDirectory()!==true)throw Error('The model folder has moved. Refresh the library in LM Studio and try again.');
 let made=false;
 try{
  mkdirSync(plan.folder,{recursive:false});made=true;
  for(const file of plan.files){
   mkdirSync(path.dirname(file.to),{recursive:true});
   // linkSync, never copyFileSync: a twin has to share the original's bytes, and failing
   // loudly on a volume that cannot hard link is better than silently writing another 17 GB.
   try{linkSync(file.from,file.to);}
   catch(e){throw Error(`A hard link could not be made for ${path.basename(file.from)} (${(e as Error).message}). This needs the model folder to be on an NTFS volume. Nothing was changed.`);}
  }
  writeFileSync(path.join(plan.folder,MARKER),JSON.stringify({createdBy:'local-model-bench',source:plan.sourceDir,sourceKey:plan.key,created:new Date().toISOString(),
   note:'Every .gguf here is a hard link to the folder named in "source" and uses no extra disk space. Deleting this folder removes the links only; the model itself is untouched.',
   files:plan.files.map(f=>slash(path.relative(plan.folder,f.to)))},null,2));
 }catch(e){
  // A twin that was only half made would be indexed by LM Studio as a real model, so a
  // failure takes the whole folder back out rather than leaving one.
  if(made)try{rmSync(plan.folder,{recursive:true,force:true});}catch{}
  throw e;
 }
 return plan.folder;
}

// LM Studio notices a new folder by itself and re-indexes it in about a quarter of a second,
// measured on 2026-09-15. That is quick, but not instant, and a copy that is not indexed yet
// is not selectable yet: returning before then would hand back a model the library does not
// list. So the copy is not reported as made until LM Studio's own index holds it.
// Removal has the same lag in reverse: a copy that has just been deleted stays in the library
// until LM Studio notices, so both directions wait for the index to agree with the disk.
export async function awaitIndexed(folder:string,home=homedir(),timeoutMs=20000,tick=150,present=true):Promise<boolean>{
 const prefix=slash(folder)+'/',until=Date.now()+timeoutMs;
 for(;;){
  try{if(readIndex(home).models.some((m:any)=>slash(String(m.entryPoint?.absPath??'')).startsWith(prefix))===present)return true;}catch{}
  if(Date.now()>=until)return false;
  await new Promise(r=>setTimeout(r,tick));
 }
}

// `key` is the twin's OWN model key, which is what a run has to select to load the weights without
// the projector. LM Studio assigns it when it indexes the folder, so it is read back from the index
// rather than derived from the folder name; null while LM Studio has not indexed the twin yet.
export type Twin={folder:string;source:string;sourceKey:string;created:string;key:string|null};
function readMarker(folder:string):Twin|null{
 try{
  const marker=JSON.parse(readFileSync(path.join(folder,MARKER),'utf8'));
  if(marker?.createdBy!=='local-model-bench'||typeof marker.source!=='string')return null;
  return {folder:slash(folder),source:slash(marker.source),sourceKey:String(marker.sourceKey??''),created:String(marker.created??''),key:null};
 }catch{return null;}
}
// Twins this app made, found by their marker rather than by their name, so a folder a user
// happened to name "… - Text only" themselves is never treated as this app's to delete.
// Which model key LM Studio gave a twin folder. Matched on the indexed entry point living inside
// that folder, because the key itself is LM Studio's to choose and has no reliable spelling.
function keyForFolder(folder:string,home:string):string|null{
 try{
  const inside=slash(folder).replace(/\/+$/,'')+'/';
  const hit=readIndex(home).models.filter((m:any)=>slash(String(m?.entryPoint?.absPath??'')).startsWith(inside));
  return hit.length===1&&typeof hit[0].defaultIdentifier==='string'?hit[0].defaultIdentifier:null;
 }catch{return null;}
}
export function textOnlyTwins(home=homedir()):Twin[]{
 const root=path.join(home,'.lmstudio','models'),found:Twin[]=[];
 const walk=(dir:string,depth:number)=>{
  let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   if(!entry.isDirectory())continue;
   const full=path.join(dir,entry.name);
   const twin=readMarker(full);
   if(twin)found.push(twin);
   else if(depth>0)walk(full,depth-1);
  }
 };
 walk(root,3);
 // Resolved once here rather than per caller: the index is one file read for the whole list.
 return found.map(t=>({...t,key:keyForFolder(t.folder,home)}));
}
// Removal refuses anything that is not one of this app's twins, and anything holding a file
// that exists nowhere else. Between them, a delete here can only ever drop directory entries
// whose bytes are still reachable from the model they were linked from.
export function removeTextOnly(folder:string,home=homedir()):void{
 const twin=readMarker(folder);
 if(!twin)throw Error('That folder was not created by Local Model Bench, so it will not be deleted from here. Remove it in LM Studio or in Explorer if you meant to.');
 const root=slash(path.join(home,'.lmstudio','models'));
 if(!slash(path.resolve(folder)).startsWith(root+'/'))throw Error('That folder is outside the LM Studio models directory.');
 const unique:string[]=[];
 const walk=(dir:string)=>{
  for(const entry of readdirSync(dir,{withFileTypes:true})){
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){walk(full);continue;}
   if(entry.name===MARKER)continue;
   if(statSync(full).nlink<2)unique.push(slash(path.relative(folder,full)));
  }
 };
 walk(folder);
 if(unique.length)throw Error(`This folder holds ${unique.length} file(s) that exist nowhere else (${unique.slice(0,3).join(', ')}). It was not deleted. Move anything you want to keep out of it first.`);
 rmSync(folder,{recursive:true,force:true});
}
