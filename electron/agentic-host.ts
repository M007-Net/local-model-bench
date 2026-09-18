// Host-side stage worker. One of these runs per pool thread; the pool is what makes the CPU side of
// an agent turn genuinely parallel, the way separate agent processes would be on a real machine.
//
// Every stage recomputes its own input from the turn index with a fixed pseudo-random generator, so
// the work is identical on every machine, every worker count and every model. Model output is never
// passed in and never executed: this measures the host, not the answer.
import {parentPort} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import type {AgenticStage,HostStage} from '../src/agentic';

// One message carries a whole turn's host stages. Dispatching each stage separately made the lane
// and the pool thread ping-pong six times per turn, which costs nothing when every core is busy but
// roughly a fifth of the turn when only one worker is running — enough to inflate the single-worker
// baseline and push every speedup above its true value.
export type HostJob={turnIndex:number;scale:number;stages:HostStage[]};
export type HostResult={durations:number[];error?:string};

// The corpus is deliberately larger than a core's private cache: 96 modules is about a megabyte of
// UTF-16 source per worker, and the derived syntax trees are several times that again. A sweep at
// 16 or 32 workers therefore pushes tens of megabytes through the shared cache, so a machine's cache
// and memory subsystem show up in the curve instead of only its per-core arithmetic throughput.
//
// Sized so one turn at scale 1 costs roughly 35 ms of real CPU on a current desktop core, with the
// six stages costing a comparable amount as each other. Every stage's cost is one number in the
// `passes` column below; `npm run agents:calibrate` re-measures them. Changing any of these numbers,
// or the corpus, changes what a sweep measures — bump WORKLOAD_VERSION in src/agentic.ts when you
// do, so sweeps from two different builds can never be compared as if they ran the same work.
const BASE_FILES=96;
function rng(seed:number){let a=(seed*2654435761)>>>0;return()=>{a^=a<<13;a>>>=0;a^=a>>17;a^=a<<5;a>>>=0;return a/4294967296;};}
const words=['record','tenant','invoice','ledger','packet','session','adapter','handler','cursor','payload','segment','quota','retry','bucket','digest','schema'];

function sourceFor(turnIndex:number,file:number){
 const next=rng(turnIndex*1009+file*31+7);
 const lines:string[]=[`// module ${file} of turn ${turnIndex}`,'"use strict";'];
 for(let i=0;i<34;i++){
  const a=words[Math.floor(next()*words.length)],b=words[Math.floor(next()*words.length)],n=Math.floor(next()*997);
  lines.push(`function ${a}_${b}_${i}(${a}, ${b}) { const ${a}Count = ${n}; if (${a} > ${b}) { return ${a}Count + ${a} * ${i}; } return ${b} - ${a}Count; }`);
 }
 return lines.join('\n');
}
type File={path:string;source:string};
function corpus(turnIndex:number,files=BASE_FILES):File[]{
 const out:File[]=[];
 for(let f=0;f<files;f++)out.push({path:`src/turn-${turnIndex}/module-${f}.js`,source:sourceFor(turnIndex,f)});
 return out;
}
// A tiny fold over each stage's result keeps the optimiser from discarding the work and gives the
// calibration script and the tests something they can assert on.
const fold=(s:string)=>{let h=0;for(let i=0;i<s.length;i++)h=(Math.imul(h,31)+s.charCodeAt(i))|0;return h;};

type Node={kind:string;text:string;children:Node[]};
function parse(source:string):Node{
 const root:Node={kind:'program',text:'',children:[]};
 for(const line of source.split('\n')){
  const node:Node={kind:line.startsWith('function')?'function':line.startsWith('//')?'comment':'statement',text:line,children:[]};
  for(const token of line.split(/[\s(){};,]+/))if(token)node.children.push({kind:/^\d+$/.test(token)?'number':'identifier',text:token,children:[]});
  root.children.push(node);
 }
 return root;
}
function walk(node:Node,depth=0):number{let n=depth+node.text.length;for(const child of node.children)n=(n+walk(child,depth+1))|0;return n;}
const testPatterns=[/return\s+\w+/g,/if\s*\(/g,/const\s+\w+Count/g,/\b\d{2,}\b/g];

// Each stage is one row: how many passes per unit of scale, and what one pass does. `setup` runs
// once per stage so `package` can hoist its blob and `scaffold` can opt out of the shared corpus.
type Stage<T>={passes:number;setup(turnIndex:number):T;pass(input:T,turnIndex:number,pass:number):number};
const stage=<T,>(s:Stage<T>)=>s;
const stages:{[K in HostStage]:Stage<any>}={
 scaffold:stage({passes:4,setup:()=>null,pass:(_n,turnIndex,pass)=>{
  const files=corpus(turnIndex+pass*97);
  const manifest=JSON.stringify({turn:turnIndex,pass,files:files.map(f=>({path:f.path,bytes:f.source.length}))});
  return fold(manifest)+fold(files.map(f=>f.source).join('\n'));
 }}),
 compile:stage({passes:1,setup:corpus,pass:(files:File[])=>{
  let sum=0;
  for(const file of files){
   const out=file.source.split(/\b/).map(token=>/^[a-z][A-Za-z0-9_]*$/.test(token)?token.replace(/_/g,'$'):token).join('');
   sum=(sum+fold(out.replace(/function\s+/g,'const ').replace(/\{/g,'{ /*c*/')))|0;
  }
  return sum;
 }}),
 test:stage({passes:5,setup:corpus,pass:(files:File[],_turnIndex,pass)=>{
  let sum=0;
  for(const file of files)for(const pattern of testPatterns){
   pattern.lastIndex=0;let hits=0;
   while(pattern.exec(file.source)!==null)hits++;
   sum=(sum+hits*(pass+1))|0;
  }
  return sum;
 }}),
 ast:stage({passes:2,setup:corpus,pass:(files:File[])=>{
  let sum=0;
  for(const file of files)sum=(sum+walk(parse(file.source)))|0;
  return sum;
 }}),
 hash:stage({passes:20,setup:corpus,pass:(files:File[])=>{
  const hash=createHash('sha256');
  for(const file of files){hash.update(file.path);hash.update(file.source);}
  return fold(hash.digest('hex'));
 }}),
 package:stage({passes:1,setup:(turnIndex:number)=>Buffer.from(corpus(turnIndex).map(f=>f.path+'\n'+f.source).join('\n'),'utf8'),pass:(blob:Buffer)=>deflateSync(blob,{level:6}).length})
};

export function runStage(stage:AgenticStage,turnIndex:number,scale:number){
 if(stage==='llm')throw Error('The model call is not a host stage.');
 const spec=stages[stage],input=spec.setup(turnIndex);
 let checksum=0;
 for(let pass=0;pass<spec.passes*Math.max(1,scale);pass++)checksum=(checksum+spec.pass(input,turnIndex,pass))|0;
 return checksum;
}
parentPort?.on('message',(job:HostJob)=>{
 // Each stage is timed here, on the thread that ran it, so a segment length is the stage's own cost
 // and never includes the time the turn spent waiting for this thread to become free.
 const durations:number[]=[];
 for(const stage of job.stages){
  const started=performance.now();
  try{runStage(stage,job.turnIndex,job.scale);}
  catch(e){durations.push(performance.now()-started);return parentPort!.postMessage({durations,error:`${stage}: ${(e as Error).message}`} as HostResult);}
  durations.push(performance.now()-started);
 }
 parentPort!.postMessage({durations} as HostResult);
});
