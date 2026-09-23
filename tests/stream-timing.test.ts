import {test} from 'node:test';
import assert from 'node:assert/strict';
import {infer} from '../electron/lmstudio';
import {StreamTiming} from '../electron/metrics';
import {defaultSettings} from '../src/defaults';

const compatible={...defaultSettings,provider:'llamacpp' as const,baseUrl:'http://127.0.0.1:8080'};
const sse=(frames:Array<{event?:string;data:unknown}>)=>new Response(frames.map(f=>`${f.event?`event: ${f.event}\n`:''}data: ${JSON.stringify(f.data)}\n\n`).join('')+'data: [DONE]\n\n');

test('stream timing summarizes every observed event with bounded percentile storage',()=>{
 const timing=new StreamTiming();
 for(let i=0;i<100_001;i++)timing.record(i*10);
 const result=timing.summary(100_001,true);
 assert.equal(result.eventCount,100_001);assert.equal(result.gapCount,100_000);
 assert.equal(result.meanGapMs,10);assert.equal(result.maxGapMs,10);
 assert.ok(result.p95GapMs!==null&&Math.abs(result.p95GapMs-10)<1);
 assert.equal(result.tpotMs,10);
 assert.match(result.method,/not exact token inter-token latency/);
});

test('native LM Studio records only nonempty text and reasoning delta events',async t=>{
 t.mock.method(globalThis,'fetch',async()=>sse([
  {event:'message.delta',data:{content:''}},
  {event:'reasoning.delta',data:{content:'think'}},
  {event:'message.delta',data:{content:'answer'}},
  {event:'message.delta',data:{content:''}},
  {event:'chat.end',data:{result:{stats:{total_output_tokens:5,reasoning_output_tokens:2}}}},
 ]));
 const result=await infer(defaultSettings,'model','prompt',8,0,'default',new AbortController().signal);
 const stream=result.metrics.streaming!;
 assert.equal(result.status,'completed');assert.equal(stream.eventCount,2);assert.equal(stream.gapCount,1);
 assert.ok(stream.firstEventMs!==null&&stream.lastEventMs!==null&&stream.lastEventMs>=stream.firstEventMs);
 assert.ok(stream.tpotMs!==null);assert.equal(stream.maxGapMs,stream.meanGapMs);
});

test('compatible streams ignore empty terminal and usage frames; single event has no TPOT',async t=>{
 t.mock.method(globalThis,'fetch',async()=>sse([
  {data:{choices:[{delta:{content:'answer'},finish_reason:'stop'}]}},
  {data:{choices:[{delta:{content:''}}]}},
  {data:{choices:[],usage:{prompt_tokens:4,completion_tokens:3}}},
 ]));
 const result=await infer(compatible,'model','prompt',8,0,'default',new AbortController().signal);
 const stream=result.metrics.streaming!;
 assert.equal(result.status,'completed');assert.equal(result.metrics.outputTokens,3);
 assert.equal(stream.eventCount,1);assert.equal(stream.gapCount,0);assert.equal(stream.firstEventMs,stream.lastEventMs);
 assert.equal(stream.meanGapMs,null);assert.equal(stream.p95GapMs,null);assert.equal(stream.tpotMs,null);
});

test('failed LM Studio stream retains observed event counts without claiming TPOT',async t=>{
 t.mock.method(globalThis,'fetch',async()=>sse([
  {event:'message.delta',data:{content:'partial'}},
  {event:'reasoning.delta',data:{content:'more'}},
  {event:'error',data:{error:{message:'fixture failure'}}},
  {event:'chat.end',data:{result:{stats:{total_output_tokens:8}}}},
 ]));
 const result=await infer(defaultSettings,'model','prompt',8,0,'default',new AbortController().signal);
 assert.equal(result.status,'failed');assert.equal(result.metrics.streaming?.eventCount,2);
 assert.equal(result.metrics.streaming?.tpotMs,null);
});

test('compatible missing usage preserves measured event gaps and leaves TPOT unavailable',async t=>{
 t.mock.method(globalThis,'fetch',async()=>sse([
  {data:{choices:[{delta:{reasoning_content:'reasoning'}}]}},
  {data:{choices:[{delta:{content:'answer'},finish_reason:'stop'}]}},
 ]));
 const result=await infer(compatible,'model','prompt',8,0,'default',new AbortController().signal);
 assert.equal(result.status,'completed');assert.equal(result.metrics.outputTokens,null);
 assert.equal(result.metrics.streaming?.eventCount,2);assert.equal(result.metrics.streaming?.gapCount,1);
 assert.equal(result.metrics.streaming?.tpotMs,null);
});
