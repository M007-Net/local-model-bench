import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performanceSummary} from '../src/performance-summary';
import {metrics,StreamTiming} from '../electron/metrics';
import {validateConfig} from '../electron/validation';
import {defaultConfig} from '../src/defaults';
import type {Sample} from '../src/types';
const sample=(first:number,warmup=false,status:Sample['status']='completed')=>{const stream=new StreamTiming();stream.record(first);stream.record(first+10);return {warmup,status,metrics:metrics({input_tokens:42},first+20,null,null,null,stream.summary(2,true))} as Sample;};
test('stream distributions exclude failures and warmups and retain missing historical data',()=>{
 const rows=[sample(10),sample(20),sample(10000,true),sample(20000,false,'failed')];
 const result=performanceSummary(rows);assert.equal(result.streamingRequests,2);assert.equal(result.firstEventP50Ms,10);assert.equal(result.firstEventP99Ms,20);assert.equal(result.meanStreamGapMs,10);assert.equal(result.worstStreamGapMs,10);assert.equal(result.inputTokensMean,42);
 const old=sample(5);delete old.metrics.streaming;assert.equal(performanceSummary([old]).streamingRequests,0);assert.equal(performanceSummary([old]).firstEventP95Ms,null);
});
test('load validation rejects invalid duration, targets and quality mixing',()=>{
 const base={...defaultConfig,modelKeys:['m'],mode:'performance' as const,loadProfile:'sustained' as const,durationSec:1};
 validateConfig({...base,contextSweep:[1024,256,256]});
 for(const durationSec of [0,3601,NaN,1.5])assert.throws(()=>validateConfig({...base,durationSec}));
 for(const contextSweep of [[127],[Infinity],Array(9).fill(256)])assert.throws(()=>validateConfig({...base,contextSweep}));
 assert.throws(()=>validateConfig({...base,mode:'quality'}),/speed-only/);
 assert.throws(()=>validateConfig({...base,vision:'on'}),/text prompts/);
 const normalized={...base,contextSweep:[1024,256,256]};validateConfig(normalized);assert.deepEqual(normalized.contextSweep,[256,1024]);
});
