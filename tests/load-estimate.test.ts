import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadAdvice,looksLikeMemory,parseEstimate} from '../electron/load-estimate';
import type {Model} from '../src/types';

const model:Model={key:'g@q8',display_name:'Gemma',format:'gguf',size_bytes:12.7*1024**3,max_context_length:262144,type:'llm',loaded_instances:[],quantization:null};

test('LM Studio’s estimate block is read, including its own confidence',()=>{
 const e=parseEstimate(['Model: gemma-4-12b-it@q8_k_xl','Context Length: 32,768','Estimated GPU Memory:   12.86 GiB','Estimated Total Memory: 12.86 GiB','Confidence: LOW','Estimate: This model may be loaded based on your resource guardrails settings.'].join('\n'));
 assert.ok(Math.abs(e.gpuGiB!-12.86)<0.01);
 assert.ok(Math.abs(e.totalGiB!-12.86)<0.01);
 assert.equal(e.confidence,'LOW');
 assert.match(e.verdict,/may be loaded/);
});

test('a block that says nothing is left null rather than defaulted to zero',()=>{
 const e=parseEstimate('Model: x\nSomething else entirely');
 assert.equal(e.gpuGiB,null);
 assert.equal(e.totalGiB,null);
 assert.equal(e.confidence,'UNREPORTED');
 // A zero here would read as "needs no memory", which is worse than admitting it is unknown.
 assert.notEqual(e.gpuGiB,0);
});

test('megabytes are normalised to the same unit as gigabytes',()=>{
 assert.ok(Math.abs(parseEstimate('Estimated GPU Memory: 512 MiB').gpuGiB!-0.5)<0.001);
});

// The distinction that decides whether memory advice is attached at all. Attaching it to a failure
// that was not about memory would send someone to lower a context length that was never the cause.
test('only failures that are actually about room attract memory advice',()=>{
 for(const yes of ['Failed to load model. Cause: not enough VRAM','out of memory','Model does not fit in the available memory','failed to allocate buffer','blocked by your resource guardrails'])
  assert.equal(looksLikeMemory(yes),true,`should be memory: ${yes}`);
 for(const no of ['failed to load draft model: invalid vector subscript','unknown option --nope','the projector could not be attached','Model architecture is not supported',''])
  assert.equal(looksLikeMemory(no),false,`should not be memory: ${no}`);
});

test('the advice names the arithmetic the run actually did, not just the model',()=>{
 const text=loadAdvice(model,8192,4,'off','off',{gpuGiB:12.86,totalGiB:12.86,confidence:'LOW',verdict:''});
 // The number nobody expects: they asked for 8192 and the instance was loaded with four times it.
 assert.match(text,/32,768 context tokens/);
 assert.match(text,/8,192 per request × 4 parallel slots/);
 assert.match(text,/12\.70 GiB/,'the weights are named separately from the cache');
 assert.match(text,/12\.86 GiB/);
 assert.match(text,/confidence: low/);
 // All three levers, because which one to pull is the reader's call, not this message's.
 assert.match(text,/lower the context length/i);
 assert.match(text,/concurrency/i);
 assert.match(text,/q8_0 roughly halves it/);
});

test('a run already quantizing its cache is told where it stands rather than told to start',()=>{
 const text=loadAdvice(model,8192,4,'q8_0','q4_0');
 assert.doesNotMatch(text,/q8_0 roughly halves it/,'it is already doing this');
 assert.match(text,/quantize the cache further/);
 // q8_0 stores 8.5 bits per element and q4_0 4.5, against f16's 16, so the pair averages to
 // (0.531 + 0.281) / 2 — about 41%, not the midpoint between "half" and "quarter" it sounds like.
 assert.match(text,/about 41% of an f16 cache/);
 // Nothing was estimated, so nothing is claimed about what LM Studio thought.
 assert.doesNotMatch(text,/estimated/i);
});

test('a single slot is described in the singular and without a phantom multiplier',()=>{
 const text=loadAdvice({...model,size_bytes:0},4096,1);
 assert.match(text,/1 parallel slot[^s]/);
 assert.doesNotMatch(text,/The weights are/,'an unknown size is left unsaid rather than printed as 0.00 GiB');
});
