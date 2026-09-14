import {readFileSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import type {Model} from '../src/types';

// The v1 model list currently omits supportsMtp. Use LM Studio's own local
// GGUF metadata, matched to an exact model resource and unchanged file stats.
// No architecture/name heuristics and no arbitrary draft-model pairings.
export function attachMtp(models:Model[],home=homedir()):Model[]{
 let index:any,cache:any;
 try {const dir=path.join(home,'.lmstudio','.internal');index=JSON.parse(readFileSync(path.join(dir,'model-index-cache.json'),'utf8'));cache=JSON.parse(readFileSync(path.join(dir,'gguf-metadata-cache.json'),'utf8'));}catch{return models;}
 return models.map(model=>{
  const unknown={...model,nativeMtp:{supported:null,reason:'Native MTP metadata unavailable or stale'}};
  try{
   const matches=index.models.filter((m:any)=>m.defaultIdentifier===model.key&&m.sizeBytes===model.size_bytes&&m.format===model.format);
   if(matches.length!==1)return unknown;
   const m=matches[0];
   const resource=m.indexedModelIdentifier;
   const rows=cache.json.map.filter(([file]:[string])=>file.replaceAll('\\','/').endsWith('/'+resource));
   if(rows.length!==1)return unknown;
   const [file,record]=rows[0],stats=statSync(file);
   if(stats.size!==record.fileSizeBytes||Math.abs(stats.mtimeMs-record.mtimeMs)>1)return unknown;
   const supported=record.metadata.supportsMtp;
   if(typeof supported!=='boolean'||m.format!=='gguf')return unknown;
   return {...model,nativeMtp:{supported,resource,reason:supported?'LM Studio GGUF metadata confirms built-in MTP':'This GGUF does not contain supported built-in MTP'}};
  }catch{return unknown;}
 });
}
export function mtpArgs(model:Model,mode:'on'|'off'|undefined,tokens=2):string[]{
 if(mode===undefined)return []; // Historical run configurations retain their original behavior.
 if(mode==='on'&&model.nativeMtp?.supported!==true)throw Error(`${model.display_name}: native MTP support is not confirmed for this exact file. Choose MTP off or a supported model.`);
 if(mode==='off'&&model.format!=='gguf')return [];
 return mode==='on'?['--speculative-draft-mtp','--speculative-draft-max-tokens',String(tokens)]:['--no-speculative-draft-mtp'];
}
export function verifyMtp(config:Record<string,unknown>,mode:'on'|'off'|undefined,format:unknown,tokens=2):void{
 if(mode===undefined||mode==='off'&&format!=='gguf')return;
 if(config.speculative_draft_mtp!==(mode==='on'))throw Error(`LM Studio did not confirm MTP ${mode}. No measurements were taken. Update LM Studio or check the model's native MTP support.`);
 if(config.speculative_draft_simple===true)throw Error('A separate draft model is active. Disable Draft Simple in LM Studio before benchmarking native MTP. No measurements were taken.');
 if(mode==='on'&&config.speculative_draft_max_tokens!==tokens)throw Error('LM Studio did not apply the requested MTP draft-token count. No measurements were taken.');
}
