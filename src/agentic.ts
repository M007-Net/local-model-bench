// Agentic worker sweep: one "agent turn" is a single model call followed by the host-side work a
// coding agent actually does with the answer — scaffolding files, compiling, running a test suite,
// walking a syntax tree, hashing and packaging. The same fixed set of turns is replayed at several
// parallel worker counts so the machine's own ceiling becomes visible next to the model's.
//
// Host stages never execute model output. Their workload is seeded from the turn index, so it is
// byte-for-byte identical across models, worker counts and machines; only the model call changes.
import {average} from '../electron/metrics';
import {integer} from './validate';

export const agenticStages = ['llm','scaffold','compile','test','ast','hash','package'] as const;
export type AgenticStage = typeof agenticStages[number];
export type HostStage = Exclude<AgenticStage,'llm'>;
export const stageLabels:Record<AgenticStage,string>={llm:'LLM call (GPU)',scaffold:'scaffold',compile:'compile',test:'run tests',ast:'analyze AST',hash:'hash',package:'package'};
// The single source of truth for stage colour. The timeline SVG and every DOM swatch read this, so
// adding a stage cannot leave one of them rendering nothing.
export const stageColors:Record<AgenticStage,string>={llm:'#22d3ee',scaffold:'#fbbf24',compile:'#fb923c',test:'#f4626f',ast:'#ec4899',hash:'#d946ef',package:'#a855f7'};
export const stageDescriptions:Record<AgenticStage,string>={
 llm:'The model call itself. This is the only stage that uses the GPU; with model call off it is not run at all.',
 scaffold:'Builds the candidate project tree in memory: paths, manifests and source text.',
 compile:'A deterministic source-to-source transform over the scaffolded files.',
 test:'Runs the turn\'s check suite over the transformed output.',
 ast:'Parses the generated source into a tree and walks every node.',
 hash:'SHA-256 over every produced artifact.',
 package:'Deflate-compresses the artifacts into one bundle.'
};
export const hostStages:HostStage[]=agenticStages.filter((s):s is HostStage=>s!=='llm');

export type AgenticSegment={stage:AgenticStage;start:number;end:number};
// `queuedMs` is the time this turn waited for a free host thread before its stages ran. It is the
// visible cost of asking for more workers than the machine can actually run at once.
export type AgenticTurn={index:number;lane:number;start:number;end:number;segments:AgenticSegment[];status:'completed'|'failed';error?:string;llmMs:number|null;outputTokens:number|null;generationTps:number|null;queuedMs?:number};
// `wallMs` is the median of `wallSamples` — one sample per repeat of the same fixed turn set — and
// `turns` is the trace of that median repeat, so the timeline shows a representative run rather
// than the luckiest one.
export type AgenticPoint={workers:number;lanes:number;wallMs:number;wallSamples:number[];completed:number;failed:number;turns:AgenticTurn[]};
export type AgenticConfig={name:string;modelKey:string;modelName:string;modelCall:'on'|'off';turns:number;workers:number[];repeats:number;hostWorkScale:number;maxTokens:number;contextLength:number;temperature:number;reasoning:string;timeoutSec:number;prompt:string};
export type AgenticRun={id:string;created:string;updated:string;status:'running'|'completed'|'cancelled'|'failed'|'interrupted';config:AgenticConfig;environment:Record<string,unknown>;logs:string[];points:AgenticPoint[];error?:string;gpu?:import('./types').RunGpu};
export type AgenticSummary=Omit<AgenticRun,'points'>;
export type AgenticProgress={runId:string;phase:string;message:string;workers:number;completedTurns:number;totalTurns:number;pointIndex:number;pointCount:number};

const defaultPrompt='You are a coding agent working one turn of a refactor task. Reply with a short plan (at most six lines) for extracting a duplicated validation block into a helper function, then a one-line summary starting with SUMMARY:. Do not write the full implementation.';
export const agenticWorkerChoices=[1,2,4,8,16,32,48,64,96,128];
export type AgenticShape={turns:number;repeats:number;hostWorkScale:number;workers:number[]};
export const agenticPresets:Record<string,{shape:AgenticShape;blurb:string}>={
 'Quick look':{shape:{turns:24,repeats:2,hostWorkScale:2,workers:[1,2,4,8]},blurb:'A first reading in about a minute'},
 'Balanced':{shape:{turns:48,repeats:3,hostWorkScale:4,workers:[1,2,4,8,16,32]},blurb:'Enough repeats to compare machines'},
 'Find the ceiling':{shape:{turns:64,repeats:3,hostWorkScale:6,workers:[1,2,4,8,16,32,64,96]},blurb:'Push past this machine\u2019s thread count'}
};
export function presetName(c:AgenticConfig){
 const match=Object.entries(agenticPresets).find(([,{shape}])=>shape.turns===c.turns&&shape.repeats===c.repeats&&shape.hostWorkScale===c.hostWorkScale&&shape.workers.length===c.workers.length&&shape.workers.every((w,i)=>w===c.workers[i]));
 return match?match[0]:'Custom';
}
// A turn's host work costs roughly this much on one core of a current desktop CPU. It is only used
// to estimate how long a sweep will take before it starts; once a sweep has run, the app estimates
// from that machine's own measurement instead.
export const TYPICAL_TURN_MS=40;
export function measuredTurnCost(points:AgenticPoint[],scale:number){
 const single=sweepStats(points).find(s=>s.workers===1);
 return single?.meanTurnMs&&scale>0?single.meanTurnMs/scale:null;
}
// Deliberately an over-estimate rather than an under-estimate: the settle gaps, the discarded
// warm-up pass and the fact that workers beyond the machine's thread count queue are all counted.
export function estimateSweepMs(c:AgenticConfig,turnCostAtScale1:number,threads:number,settleMs=1200){
 const perTurn=Math.max(1,turnCostAtScale1)*c.hostWorkScale,cores=Math.max(1,threads);
 const pass=(workers:number)=>c.turns*perTurn/Math.min(Math.max(1,workers),cores);
 return pass(Math.max(...c.workers))+c.workers.reduce((total,w)=>total+c.repeats*(settleMs+pass(w)),0);
}
export function humanDuration(ms:number){
 if(!Number.isFinite(ms)||ms<=0)return '\u2014';
 const s=Math.round(ms/1000);
 if(s<90)return `${s} s`;
 const m=Math.round(s/60);
 return m<90?`${m} min`:`${(m/60).toFixed(1)} h`;
}
export const defaultAgenticConfig:AgenticConfig={name:'',modelKey:'',modelName:'',modelCall:'off',turns:48,workers:[1,2,4,8,16,32],repeats:3,hostWorkScale:4,maxTokens:256,contextLength:4096,temperature:0,reasoning:'default',timeoutSec:300,prompt:defaultPrompt};
// One phrasing for "what produced these numbers", shared by the panel, the run environment record,
// and every export, so a user comparing a CSV to the screen sees the same words.
export const modelCallLabel=(c:AgenticConfig)=>c.modelCall==='on'?c.modelName||c.modelKey||'unnamed model':'disabled (host-side work only)';
// Bumped whenever the host stage workload changes in a way that changes its cost. Sweeps recorded
// under different versions measured different work, so they are never plotted as if comparable.
export const WORKLOAD_VERSION=2;
export const hostWorkCaveat='One agent turn is one model call followed by the host-side stages a coding agent runs with the answer. Host stage workloads are seeded from the turn index, are identical on every machine, model and worker count, and never include or execute model output. Each stage is timed on the thread that ran it, so a segment is the stage’s own cost; the time a turn spent waiting for a free host thread is reported separately as queued time and appears as the gap before its first stage.';

export function validateAgenticConfig(c:AgenticConfig){
 if(!c||typeof c!=='object')throw Error('Invalid agent sweep configuration.');
 if(c.modelCall!=='on'&&c.modelCall!=='off')throw Error('Model call must be on or off.');
 if(c.modelCall==='on'&&!c.modelKey)throw Error('Choose a model, or turn the model call off for a CPU-only trace.');
 integer(c.turns,1,4096,'Agent turns');
 if(!Array.isArray(c.workers)||!c.workers.length)throw Error('Choose at least one worker count.');
 c.workers=[...new Set(c.workers)].sort((a,b)=>a-b);
 c.workers.forEach(w=>integer(w,1,256,'Worker count'));
 integer(c.repeats,1,10,'Repeats per worker count');
 integer(c.hostWorkScale,1,40,'Host work scale');
 integer(c.maxTokens,1,131072,'Output limit');
 integer(c.contextLength,512,1048576,'Context');
 integer(c.timeoutSec,1,86400,'Request timeout');
 if(!Number.isFinite(c.temperature)||c.temperature<0||c.temperature>1)throw Error('Temperature must be between 0 and 1.');
 if(typeof c.prompt!=='string'||!c.prompt.trim())throw Error('Enter the agent turn prompt.');
 if(c.modelCall==='on'&&c.maxTokens>=c.contextLength)throw Error('Output limit must be smaller than context length, leaving room for the prompt.');
 return c;
}

export type PointStats={
 workers:number;lanes:number;wallMs:number;completed:number;failed:number;turns:number;
 turnsPerMin:number|null;speedup:number|null;efficiency:number|null;meanTurnMs:number|null;
 offGpuShare:number|null;meanLlmMs:number|null;meanHostMs:number|null;meanQueuedMs:number|null;wallSpread:number|null;stageMs:Record<AgenticStage,number>;
};
const emptyStageMs=()=>Object.fromEntries(agenticStages.map(s=>[s,0])) as Record<AgenticStage,number>;
const hostMs=(turn:AgenticTurn)=>turn.segments.filter(s=>s.stage!=='llm').reduce((a,s)=>a+Math.max(0,s.end-s.start),0);

export function pointStats(point:AgenticPoint,baselineWallMs:number|null):PointStats{
 const done=point.turns.filter(t=>t.status==='completed');
 const stageMs=emptyStageMs();
 for(const t of done)for(const s of t.segments)stageMs[s.stage]+=Math.max(0,s.end-s.start);
 const turnMs=done.map(t=>Math.max(0,t.end-t.start));
 const totalTurnMs=turnMs.reduce((a,b)=>a+b,0);
 // Off-GPU share is the portion of measured turn time that is not the model call. With the model
 // call off there is nothing on the GPU at all, so every millisecond of the turn is host time.
 const offGpuShare=totalTurnMs>0?(totalTurnMs-stageMs.llm)/totalTurnMs*100:null;
 const speedup=baselineWallMs!==null&&point.wallMs>0?baselineWallMs/point.wallMs:null;
 // How far apart the repeats of this worker count landed. Two machines whose curves differ by less
 // than this are not distinguishable by this sweep, and the table says so instead of implying they are.
 const samples=(point.wallSamples??[point.wallMs]).filter(v=>Number.isFinite(v)&&v>0);
 const wallSpread=samples.length>1&&point.wallMs>0?(Math.max(...samples)-Math.min(...samples))/point.wallMs*100:null;
 return {
  workers:point.workers,lanes:point.lanes,wallMs:point.wallMs,completed:point.completed,failed:point.failed,turns:point.turns.length,
  turnsPerMin:point.wallMs>0?point.completed/(point.wallMs/60000):null,
  speedup,efficiency:speedup===null?null:speedup/point.workers,
  meanTurnMs:average(turnMs),
  offGpuShare,wallSpread,
  meanLlmMs:average(done.map(t=>t.llmMs)),
  meanHostMs:average(done.map(hostMs)),
  meanQueuedMs:average(done.map(t=>t.queuedMs??null)),
  stageMs
 };
}
export function sweepStats(points:AgenticPoint[]):PointStats[]{
 // Speedup is only meaningful against a single-worker run measured in the same sweep. A sweep
 // that never ran one worker reports no speedup rather than borrowing another point as a base.
 const base=points.find(p=>p.workers===1&&p.wallMs>0)?.wallMs??null;
 return [...points].sort((a,b)=>a.workers-b.workers).map(p=>pointStats(p,base));
}
export function peakPoint(stats:PointStats[]):PointStats|null{
 let best:PointStats|null=null;
 for(const s of stats)if(s.turnsPerMin!==null&&(best===null||s.turnsPerMin>best.turnsPerMin!))best=s;
 return best;
}
// One column list for the on-screen table, the Markdown export and the HTML report, so a column
// cannot be added to one of them and quietly missed by the other two.
export type SweepColumn={header:string;value(s:PointStats):number|null;digits:number;suffix?:string;help:string};
export const sweepColumns:SweepColumn[]=[
 {header:'Workers',value:s=>s.workers,digits:0,help:'How many agents were working in parallel.'},
 {header:'Wall s',value:s=>s.wallMs/1000,digits:2,help:'Seconds to finish the whole fixed set of turns. The median of the repeats.'},
 {header:'Turns/min',value:s=>s.turnsPerMin,digits:1,help:'Completed agent turns per minute. The highest row is this machine\u2019s ceiling.'},
 {header:'Speedup',value:s=>s.speedup,digits:2,suffix:'x',help:'How many times faster than one worker. Needs a one-worker row in the same sweep.'},
 {header:'Efficiency',value:s=>s.efficiency,digits:2,help:'Speedup divided by workers. 1.00 means every added worker still paid for itself.'},
 {header:'Mean turn ms',value:s=>s.meanTurnMs,digits:0,help:'Average time one agent turn took from start to finish, including any queueing.'},
 {header:'Model call ms',value:s=>s.meanLlmMs,digits:0,help:'Average time inside the model call. Unavailable when the model call was off.'},
 {header:'Queued ms',value:s=>s.meanQueuedMs,digits:0,help:'Average time a turn waited for a free host thread. This is where extra workers go once the machine is full.'},
 {header:'Off-GPU %',value:s=>s.offGpuShare,digits:0,help:'Share of turn time that was not the model call \u2014 the part the CPU is responsible for.'},
 {header:'Spread %',value:s=>s.wallSpread,digits:1,help:'Gap between the fastest and slowest repeat. A difference between two machines smaller than this is a tie.'},
 {header:'Completed',value:s=>s.completed,digits:0,help:'Turns that finished every stage.'},
 {header:'Failed',value:s=>s.failed,digits:0,help:'Turns that stopped at a failed model call or host stage.'}
];
// Plain-English reading of where the sweep topped out, shown under the sweep table and repeated
// verbatim in every export.
export function sweepVerdict(stats:PointStats[],modelCall:'on'|'off'){
 const peak=peakPoint(stats);
 if(!peak)return 'No completed turns yet, so this sweep has no scaling reading.';
 const last=stats[stats.length-1];
 const source=modelCall==='off'?'No model call in this run, so nothing caps concurrency but the host itself.':'The model call and the host share this sweep, so a plateau can come from either one.';
 const ceiling=peak.workers===last.workers?`Throughput was still climbing at ${peak.workers} workers — the highest count measured. Add a larger worker count to find the ceiling.`:`Peak at ${peak.workers} workers. Beyond that, added workers queue instead of finishing turns.`;
 return `${source} ${ceiling} Peak measured throughput was ${peak.turnsPerMin!.toFixed(1)} turns per minute at ${peak.workers} workers.`;
}

// The two readings that separate one machine from another: how fast a single worker gets through a
// turn (per-core speed) and how many turns the whole chip can finish per minute (cores plus cache
// and memory). A CPU comparison that quotes only one of them is describing half the machine.
export function cpuReading(stats:PointStats[]){
 const single=stats.find(s=>s.workers===1)??null,peak=peakPoint(stats);
 if(!single&&!peak)return '';
 const band=(s:PointStats|null)=>s?.wallSpread===null||s?.wallSpread===undefined?'':` (±${s.wallSpread.toFixed(1)}% across repeats)`;
 const perCore=single?.meanTurnMs!==null&&single?.meanTurnMs!==undefined?`One worker finishes an agent turn in ${Math.round(single.meanTurnMs).toLocaleString()} ms${band(single)} — this machine's per-core speed.`:'No single-worker point in this sweep, so there is no per-core reading.';
 const whole=peak?`The whole CPU tops out at ${peak.turnsPerMin!.toFixed(0)} turns per minute${band(peak)} with ${peak.workers} workers${single?.wallMs&&peak.wallMs?` (${(single.wallMs/peak.wallMs).toFixed(2)}× one worker)`:''}.`:'';
 const noise=(single?.wallSpread??peak?.wallSpread)===null||(single?.wallSpread??peak?.wallSpread)===undefined?' Only one repeat was run, so run-to-run variation is unknown; raise repeats before trusting a small gap.':' Treat a gap between two machines smaller than those bands as a tie.';
 return `${perCore} ${whole}${noise}`.trim();
}
// Imported sweeps come from a file the app did not write, so every field is checked before anything
// is stored or drawn. Nothing is repaired or guessed: a malformed sweep is refused, not patched.
export function validateAgenticRun(value:unknown):AgenticRun{
 const run=value as AgenticRun;
 if(!run||typeof run!=='object'||Array.isArray(run))throw Error('That file does not contain an agent sweep.');
 if(typeof run.id!=='string'||!run.id.trim())throw Error('The sweep has no identifier.');
 for(const key of ['created','updated'] as const)if(typeof run[key]!=='string')throw Error(`The sweep has no ${key} time.`);
 if(!['running','completed','cancelled','failed','interrupted'].includes(run.status))throw Error('The sweep has an unknown status.');
 if(!Array.isArray(run.logs)||run.logs.some(l=>typeof l!=='string'))throw Error('The sweep log is malformed.');
 if(!run.environment||typeof run.environment!=='object'||Array.isArray(run.environment))throw Error('The sweep has no environment record.');
 validateAgenticConfig(run.config);
 if(!Array.isArray(run.points))throw Error('The sweep has no measurements.');
 if(run.points.length>64)throw Error('The sweep has more worker counts than this app can hold.');
 const seen=new Set<number>();
 for(const point of run.points){
  if(!point||typeof point!=='object')throw Error('A sweep point is malformed.');
  integer(point.workers,1,256,'Sweep point worker count');
  if(seen.has(point.workers))throw Error('The sweep has two points for the same worker count.');
  seen.add(point.workers);
  integer(point.lanes,0,256,'Sweep point lane count');
  integer(point.completed,0,1e6,'Sweep point completed turns');
  integer(point.failed,0,1e6,'Sweep point failed turns');
  if(!Number.isFinite(point.wallMs)||point.wallMs<0)throw Error('A sweep point has no wall clock.');
  if(point.wallSamples!==undefined&&(!Array.isArray(point.wallSamples)||point.wallSamples.some(v=>!Number.isFinite(v)||v<0)))throw Error('A sweep point has malformed repeat timings.');
  if(!Array.isArray(point.turns))throw Error('A sweep point has no agent turns.');
  if(point.turns.length>65536)throw Error('A sweep point has more agent turns than this app can hold.');
  for(const turn of point.turns){
   if(!turn||typeof turn!=='object')throw Error('An agent turn is malformed.');
   integer(turn.index,0,1e6,'Agent turn index');integer(turn.lane,0,256,'Agent turn lane');
   if(![turn.start,turn.end].every(v=>Number.isFinite(v)&&v>=0))throw Error('An agent turn has no timing.');
   if(turn.queuedMs!==undefined&&(!Number.isFinite(turn.queuedMs)||turn.queuedMs<0))throw Error('An agent turn has a malformed queued time.');
   if(turn.status!=='completed'&&turn.status!=='failed')throw Error('An agent turn has an unknown status.');
   if(!Array.isArray(turn.segments))throw Error('An agent turn has no stages.');
   for(const segment of turn.segments){
    if(!segment||!agenticStages.includes(segment.stage))throw Error('An agent turn contains an unknown stage.');
    if(![segment.start,segment.end].every(v=>Number.isFinite(v)&&v>=0))throw Error('A stage has no timing.');
   }
  }
 }
 return run;
}
// An imported sweep that measured a different workload is shown, but never silently compared.
export const comparableWorkload=(run:{environment:Record<string,unknown>})=>run.environment.workloadVersion===undefined||run.environment.workloadVersion===WORKLOAD_VERSION;

export function laneRows(point:AgenticPoint){
 const rows=new Map<number,AgenticTurn[]>();
 for(const t of point.turns){const list=rows.get(t.lane)??[];list.push(t);rows.set(t.lane,list);}
 return [...rows.keys()].sort((a,b)=>a-b).map(lane=>({lane,turns:rows.get(lane)!.sort((a,b)=>a.start-b.start)}));
}
const span=(p:AgenticPoint)=>Math.max(p.wallMs,...p.turns.map(t=>t.end));
export function axisMax(points:AgenticPoint[],workers:number,locked:boolean){
 const point=points.find(p=>p.workers===workers);
 return Math.max(1,...(locked?points.map(span):point?[span(point)]:[]));
}
