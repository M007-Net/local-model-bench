import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {Model} from '../src/types';
import {sweepSteps,type MtpConfig} from '../src/mtp-sweep';

// LM Studio ships native MTP in two shapes, and only one of them is reachable from the
// command line. Verified on 2026-09-15 against lms CLI commit 07b7252 and LM Studio's own
// load path:
//  * bundled — the prediction heads sit inside the model's own GGUF. LM Studio's metadata
//    sets supportsMtp true and `--speculative-draft-mtp` loads them. Qwen3.8-27B is one.
//  * sidecar — the heads ship as a separate GGUF stored with the model, which LM Studio
//    indexes in its own "drafter" domain. supportsMtp is false on both files;
//    `--speculative-draft-mtp` refuses with "requires a GGUF model with a bundled supported
//    MTP head"; and `--speculative-draft-model` cannot name the head because that flag
//    resolves only in the llm domain. LM Studio loads it through a load-config field,
//    draftMtpSidecar, that neither the CLI nor POST /api/v1/models/load exposes at all.
//    Gemma 4 ships its heads this way. See mtp-sidecar.ts for how the load is made.
// The v1 model list reports neither shape, so both are read from LM Studio's own local GGUF
// metadata, matched to an exact model resource and unchanged file stats. No architecture or
// name heuristics, and no arbitrary draft-model pairings.

type Meta=Record<string,any>;
const slash=(p:string)=>p.replaceAll('\\','/');
// A cached record only describes the file it was read from while that file still has the
// size and modification time the cache recorded. Anything else is stale, not evidence.
function verified(cache:any,resource:string):{file:string;metadata:Meta}|null{
 const rows=cache.json.map.filter(([file]:[string])=>slash(file).endsWith('/'+resource));
 if(rows.length!==1)return null;
 const [file,record]=rows[0];
 let stats;try{stats=statSync(file);}catch{return null;}
 if(stats.size!==record.fileSizeBytes||Math.abs(stats.mtimeMs-record.mtimeMs)>1)return null;
 return {file:slash(file),metadata:record.metadata&&typeof record.metadata==='object'?record.metadata:{}};
}
// A head is paired with a model by structure, never by file name: it has to be stored inside
// that model's own folder, declare prediction layers, project into exactly that model's
// hidden size, and carry that model's architecture under LM Studio's "-assistant" suffix.
function sidecarHeads(index:any,cache:any,mainFile:string,main:Meta){
 const dir=mainFile.slice(0,mainFile.lastIndexOf('/')+1),heads:{resource:string;file:string}[]=[];
 if(typeof main.arch!=='string'||!Number.isInteger(main.embeddingLength))return heads;
 for(const entry of index.models){
  if(entry?.domain!=='drafter'||entry.format!=='gguf'||typeof entry.indexedModelIdentifier!=='string')continue;
  const file=slash(entry.entryPoint?.absPath??'');
  if(!file.startsWith(dir))continue;
  const head=verified(cache,entry.indexedModelIdentifier);
  if(!head||head.file!==file)continue;
  if(!Number.isInteger(head.metadata.nextnPredictLayers)||head.metadata.nextnPredictLayers<1)continue;
  if(head.metadata.embeddingLengthOut!==main.embeddingLength||head.metadata.arch!==main.arch+'-assistant')continue;
  heads.push({resource:entry.indexedModelIdentifier,file});
 }
 return heads;
}
export function attachMtp(models:Model[],home=homedir()):Model[]{
 let index:any,cache:any;
 try {const dir=path.join(home,'.lmstudio','.internal');index=JSON.parse(readFileSync(path.join(dir,'model-index-cache.json'),'utf8'));cache=JSON.parse(readFileSync(path.join(dir,'gguf-metadata-cache.json'),'utf8'));}catch{return models;}
 return models.map(model=>{
  const unknown={...model,nativeMtp:{supported:null,reason:'Native MTP metadata unavailable or stale'}} as Model;
  try{
   const matches=index.models.filter((m:any)=>m.defaultIdentifier===model.key&&m.sizeBytes===model.size_bytes&&m.format===model.format);
   if(matches.length!==1)return unknown;
   const entry=matches[0],resource=entry.indexedModelIdentifier;
   const main=verified(cache,resource);
   if(!main||entry.format!=='gguf')return unknown;
   if(main.metadata.supportsMtp===true)return {...model,nativeMtp:{supported:true,kind:'bundled',resource,reason:'LM Studio GGUF metadata confirms MTP heads built into this file'}};
   if(typeof main.metadata.supportsMtp!=='boolean')return unknown;
   const heads=sidecarHeads(index,cache,main.file,main.metadata);
   if(heads.length===1)return {...model,nativeMtp:{supported:true,kind:'sidecar',resource,draftResource:heads[0].resource,draftPath:heads[0].file,
    reason:`This GGUF has no built-in MTP heads, but LM Studio indexes a matching MTP head stored with it (${heads[0].resource}) that is loaded alongside the model.`}};
   // Two heads that both fit cannot be told apart by anything this app can see, and guessing
   // one would be exactly the arbitrary pairing the rest of this file refuses to make.
   if(heads.length>1)return {...model,nativeMtp:{supported:null,resource,
    reason:`More than one MTP head fits this model (${heads.map(h=>h.resource).join(', ')}). Remove the duplicate in LM Studio so one head can be paired without guessing.`}};
   return {...model,nativeMtp:{supported:false,resource,reason:'This GGUF contains no built-in MTP heads, and no matching MTP head is stored with it.'}};
  }catch{return unknown;}
 });
}
export function mtpArgs(model:Model,mode:'on'|'off'|undefined,tokens=2):string[]{
 if(mode===undefined)return []; // Historical run configurations retain their original behavior.
 if(mode==='on'&&model.nativeMtp?.supported!==true)throw Error(`${model.display_name}: native MTP support is not confirmed for this exact file. ${model.nativeMtp?.reason??''} Choose MTP off or a supported model.`.replace(/\s+/g,' '));
 if(mode==='off'&&model.format!=='gguf')return [];
 // A sidecar head has no command-line flag at all, so its load carries no extra arguments:
 // the draft-token count travels with the head in the config written by mtp-sidecar.ts.
 if(mode==='on')return model.nativeMtp?.kind==='sidecar'?[]:['--speculative-draft-mtp','--speculative-draft-max-tokens',String(tokens)];
 return ['--no-speculative-draft-mtp'];
}
// What LM Studio said about the load, gathered from both places it says anything: the loaded
// instance's own reported config, and the engine log line naming a draft model it opened.
export type MtpEvidence={kind?:'bundled'|'sidecar';draftPath?:string;draftersLoaded:string[]};
export function verifyMtp(config:Record<string,unknown>,mode:'on'|'off'|undefined,format:unknown,tokens=2,evidence:MtpEvidence={draftersLoaded:[]}):void{
 if(mode===undefined||mode==='off'&&format!=='gguf')return;
 if(config.speculative_draft_simple===true)throw Error('A separate draft model is active. Disable Draft Simple in LM Studio before benchmarking native MTP. No measurements were taken.');
 if(mode==='on'&&evidence.kind==='sidecar'){
  // A sidecar leaves no trace in the instance config LM Studio reports: its REST API has no
  // field for one. The single piece of evidence it does give is the engine's own load line
  // naming the head file, so that line is required, and required to name this exact head.
  const wanted=slash(evidence.draftPath??'').toLowerCase();
  if(!wanted||!evidence.draftersLoaded.includes(wanted))throw Error(`LM Studio did not report loading the MTP head for this model (${evidence.draftPath??'unknown head'}). No measurements were taken.${evidence.draftersLoaded.length?` It loaded ${evidence.draftersLoaded.join(', ')} instead.`:''}`);
  if(config.speculative_draft_mtp===true)throw Error('LM Studio reported built-in MTP as well as a separate MTP head. No measurements were taken.');
  if(config.speculative_draft_max_tokens!==tokens)throw Error('LM Studio did not apply the requested MTP draft-token count. No measurements were taken.');
  return;
 }
 if(config.speculative_draft_mtp!==(mode==='on'))throw Error(`LM Studio did not confirm MTP ${mode}. No measurements were taken. Update LM Studio or check the model's native MTP support.`);
 if(mode==='on'&&config.speculative_draft_max_tokens!==tokens)throw Error('LM Studio did not apply the requested MTP draft-token count. No measurements were taken.');
 // MTP off has to mean no drafting at all, including a head this app never asked for. A
 // setting left behind in LM Studio would otherwise turn a sweep's baseline into a
 // speculative run and quietly flatter every depth measured against it.
 if(mode==='off'&&evidence.draftersLoaded.length)throw Error(`LM Studio loaded a draft model (${evidence.draftersLoaded.join(', ')}) for a load with MTP off. No measurements were taken. Clear this model's speculative decoding settings in LM Studio.`);
}
// Every depth a sweep will load has to be possible before the first one is loaded. A run that
// would only fail on its fourth depth, an hour into measuring, has wasted the hour.
export function assertMtpPlan(model:Model,config:MtpConfig):void{
 for(const step of sweepSteps(config))mtpArgs(model,step.mode,step.tokens);
}
