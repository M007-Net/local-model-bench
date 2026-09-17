import {closeSync,openSync,readSync,readdirSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

// Reading what LM Studio's inference engine says about itself.
//
// Two things this app needs are printed to LM Studio's server log and offered nowhere else —
// not by `lms`, and not by any field of the v1 HTTP API:
//  * the draft model a load opened, which is the only proof a separate MTP head was attached
//    (see mtp-sidecar.ts);
//  * how much of the drafting actually paid off, which llama.cpp prints per finished request
//    as `draft acceptance = 0.47748 (53 accepted / 111 generated), mean len = 2.43`.
// So a stretch of work is watched by remembering how long each log file was before it began
// and reading back only what was appended. No timestamps are parsed, and a file rotated in the
// middle of a watch was not there to be measured, so it is read whole.
export type LogWatch={root:string;sizes:Map<string,number>};
const LOG_ROOT=['.lmstudio','server-logs'];
const CAP=8*1024*1024;
function logFiles(root:string):string[]{
 const out:string[]=[];
 const walk=(dir:string,depth:number)=>{
  let entries;try{entries=readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){if(depth>0)walk(full,depth-1);}
   else if(entry.name.endsWith('.log'))out.push(full);
  }
 };
 walk(root,2);
 return out.sort();
}
const sizeOf=(file:string)=>{try{return statSync(file).size;}catch{return 0;}};
function slice(file:string,from:number,to:number):string{
 const start=Math.max(from,to-CAP),length=to-start;
 if(length<=0)return '';
 const handle=openSync(file,'r');
 try{const buffer=Buffer.alloc(length);readSync(handle,buffer,0,length,start);return buffer.toString('utf8');}finally{closeSync(handle);}
}
export function watchEngineLog(home=homedir()):LogWatch{
 const root=path.join(home,...LOG_ROOT);
 return {root,sizes:new Map(logFiles(root).map(file=>[file,sizeOf(file)]))};
}
// Everything written since the watch began. Reading it again is cheap and gives the same
// answer plus whatever has arrived since, so a caller may poll while it waits for a line.
export function sinceWatch(watch:LogWatch):string{
 return logFiles(watch.root).map(file=>slice(file,watch.sizes.get(file)??0,sizeOf(file))).join('\n');
}
// Every draft model llama.cpp opened since the watch began, lower-cased with forward slashes
// so a path can be compared with the head this app asked for.
export function draftModelsLoaded(watch:LogWatch):string[]{
 const found=new Set<string>();
 for(const match of sinceWatch(watch).matchAll(/loading draft model '([^']+)'/g))found.add(match[1].replaceAll('\\','/').toLowerCase());
 return [...found];
}

// How much of the drafting was kept. llama.cpp prints one line per finished request, so under
// concurrency there is one per request in the wave and they are pooled here: the acceptance
// rate is total accepted over total drafted, which weights a long request more heavily than a
// short one exactly as it should. `tasks` is how many lines were actually found, so a caller
// can say whether every request in a wave was accounted for rather than assuming it was.
export type DraftAcceptance={tasks:number;accepted:number;generated:number;acceptance:number;meanLen:number|null};
const ACCEPTANCE=/draft acceptance = [\d.]+ \(\s*(\d+) accepted \/\s*(\d+) generated\), mean len =\s*([\d.]+)/g;
export function draftAcceptance(watch:LogWatch):DraftAcceptance|null{
 let accepted=0,generated=0,tasks=0,lengths=0;
 for(const [,a,g,len] of sinceWatch(watch).matchAll(ACCEPTANCE)){
  accepted+=Number(a);generated+=Number(g);lengths+=Number(len);tasks++;
 }
 if(!tasks||generated<=0)return null;
 // mean len is a per-request average over speculative steps, and the step count is not printed,
 // so these are averaged across requests rather than pooled. At concurrency 1 that is one
 // request and the figure is exactly what llama.cpp reported.
 return {tasks,accepted,generated,acceptance:accepted/generated,meanLen:lengths/tasks};
}
// llama.cpp prints its timings as a request finishes, which can be just after the HTTP
// response has been handed back, so a wave waits briefly for the lines it expects rather than
// recording a rate from however many happened to have landed. Returns whatever it has when the
// wait runs out; `tasks` then shows the shortfall instead of hiding it.
export async function settledDraftAcceptance(watch:LogWatch,expected:number,timeoutMs=4000,tick=100):Promise<DraftAcceptance|null>{
 const until=Date.now()+timeoutMs;
 for(;;){
  const found=draftAcceptance(watch);
  if(expected<=0||(found&&found.tasks>=expected)||Date.now()>=until)return found;
  await new Promise(r=>setTimeout(r,tick));
 }
}
