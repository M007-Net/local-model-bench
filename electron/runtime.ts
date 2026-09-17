import type {Settings} from '../src/types';
import type {cli} from './lmstudio';

// Choosing which llama.cpp build runs the benchmark.
//
// LM Studio ships several engines for the same model format and uses whichever one is selected at
// the time a model is loaded. On an AMD card the choice between the Vulkan build and the ROCm
// build can change prompt processing substantially, and nothing in a saved run used to record
// which one produced the numbers — so two runs of the same model on the same machine could differ
// by a large factor for a reason the history had no field for.
//
// The selection is global to LM Studio rather than per-load: there is no `lms load --engine`. So a
// run that asks for a specific engine selects it before loading and puts the previous selection
// back when the run ends, the same discipline the MTP sidecar uses for the same reason.

// `llama.cpp-win-x86_64-amd-rocm-avx2@2.40.0` — the part before the @ is the engine, after it the
// version. `lms runtime select` wants the whole thing.
export type Runtime={engine:string;version:string;ref:string;selected:boolean;format:string};

// Reused from cli-output.ts's reasoning: `lms` colours its tables, and a colour code between the
// engine name and the tick would otherwise read as part of one or the other.
const ANSI=/\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Za-z0-9]|[\x00-\x08\x0b-\x1f\x7f]/g;

export function parseRuntimes(text:string):Runtime[]{
 const out:Runtime[]=[];
 for(const raw of String(text??'').replace(ANSI,'').split(/\r?\n/)){
  const line=raw.trim();
  if(!line||/^LLM ENGINE\b/i.test(line))continue;
  const at=line.match(/^(\S+?)@(\S+)\s*(.*)$/);
  if(!at)continue;
  const [,engine,version,rest]=at;
  if(!engine.includes('llama.cpp')&&!engine.includes('mlx'))continue;
  out.push({engine,version,ref:`${engine}@${version}`,selected:/[✓✔*]/.test(rest),format:(rest.replace(/[✓✔*]/g,'').trim().split(/\s+/)[0])||''});
 }
 return out;
}

// What to call an engine in the window. The full identifier is exact but unreadable in a dropdown,
// and the accelerator is the only part of it anyone is choosing between.
export function runtimeLabel(engine:string):string{
 const name=engine.toLowerCase();
 if(name.includes('rocm'))return 'ROCm';
 if(name.includes('vulkan'))return 'Vulkan';
 if(name.includes('cuda'))return 'CUDA';
 if(name.includes('metal')||name.includes('mlx'))return 'Metal';
 return 'CPU';
}

// Two builds of the same accelerator differ only by version, so the label alone cannot identify
// one. The version is shown whenever more than one build of the same accelerator is installed.
export function runtimeChoices(runtimes:Runtime[]):{ref:string;label:string}[]{
 const counts=new Map<string,number>();
 for(const r of runtimes)counts.set(runtimeLabel(r.engine),(counts.get(runtimeLabel(r.engine))??0)+1);
 return runtimes.map(r=>({ref:r.ref,label:(counts.get(runtimeLabel(r.engine))??0)>1?`${runtimeLabel(r.engine)} ${r.version}`:runtimeLabel(r.engine)}));
}

// Which engine produced a saved run's numbers.
//
// Two places know. A run that named an engine carries it in its config, which is exact. Every other
// run carries the `lms runtime ls` table captured when it was created, in which exactly one row is
// ticked — that is what LM Studio would have used. Runs made before either existed report Unknown
// rather than being quietly attributed to whatever is selected today, because that would make a
// backend comparison out of measurements nobody took under a known backend.
export const unknownBackend='Unknown engine';
export type RunBackend={label:string;ref:string|null;version:string|null};
export function backendOf(run:{config?:{runtime?:string};environment?:Record<string,unknown>}):RunBackend{
 const chosen=run.config?.runtime;
 if(typeof chosen==='string'&&chosen.includes('@')){
  const [engine,version]=chosen.split('@');
  return {label:runtimeLabel(engine),ref:chosen,version:version||null};
 }
 const listing=run.environment?.runtime;
 if(typeof listing==='string'&&listing.trim()){
  const selected=parseRuntimes(listing).find(r=>r.selected);
  if(selected)return {label:runtimeLabel(selected.engine),ref:selected.ref,version:selected.version};
 }
 return {label:unknownBackend,ref:null,version:null};
}

export type Cli=typeof cli;
export async function listRuntimes(settings:Settings,run:Cli,signal?:AbortSignal):Promise<Runtime[]>{
 return parseRuntimes(await run(settings,['runtime','ls'],signal));
}

// Returns a restore function rather than nothing, so the caller cannot forget that selecting an
// engine changed something outside this app that has to be put back.
export async function selectRuntime(settings:Settings,run:Cli,ref:string,signal?:AbortSignal):Promise<()=>Promise<void>>{
 const before=await listRuntimes(settings,run,signal);
 const current=before.find(r=>r.selected);
 const wanted=before.find(r=>r.ref===ref);
 if(!wanted)throw Error(`LM Studio has no installed runtime ${ref}. Install it in LM Studio, or choose one of: ${before.map(r=>r.ref).join(', ')||'none reported'}.`);
 if(current?.ref===ref)return async()=>{}; // Already selected; nothing to put back.
 await run(settings,['runtime','select',ref],signal);
 // Confirmed rather than assumed: `lms runtime select` exits zero for a name it did not apply.
 const after=await listRuntimes(settings,run,signal);
 if(!after.find(r=>r.ref===ref)?.selected)throw Error(`LM Studio did not switch to ${ref}. No measurements were taken.`);
 let done=false;
 return async()=>{
  if(done||!current)return;done=true;
  try{await run(settings,['runtime','select',current.ref]);}catch{/* Restoring is best effort; the run's own result matters more. */}
 };
}
