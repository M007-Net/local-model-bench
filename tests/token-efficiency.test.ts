import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tokenEfficiency} from '../src/token-efficiency';
import {selectBenchmark,benchmarkRows} from '../src/benchmarks';
import {objectiveScore} from '../electron/scoring';
import {defaultConfig} from '../src/defaults';
import {benchmarkReport} from '../electron/benchmark-report';
import type {Sample,Run} from '../src/types';
const sample=(output:number|null,input:number|null=100)=>({metrics:{outputTokens:output,inputTokens:input,reasoningTokens:50}} as Sample);
test('efficiency includes missed attempts and never adds reasoning subset twice',()=>{
 const e=tokenEfficiency([sample(100),sample(300)],1);
 assert.equal(e.outputTokens,400);assert.equal(e.totalTokens,600);
 assert.equal(e.averageOutput,200);assert.equal(e.correctPerThousandOutput,2.5);
 assert.equal(e.correctPerThousandTotal,1000/600);
 assert.equal(tokenEfficiency([sample(200)],0).correctPerThousandOutput,0);
});
test('unknown, invalid and zero denominators cannot invent efficiency',()=>{
 for(const n of [null,NaN,Infinity,-1])assert.equal(tokenEfficiency([sample(100),sample(n)],1).correctPerThousandOutput,null);
 assert.equal(tokenEfficiency([sample(0)],1).correctPerThousandOutput,null);
 assert.equal(tokenEfficiency([],0).averageOutput,null);
 const e=tokenEfficiency([sample(100,null)],1);assert.equal(e.correctPerThousandOutput,10);assert.equal(e.correctPerThousandTotal,null);
});
test('balanced selection is nested and all deterministic answer keys pass',()=>{
 const all=selectBenchmark({packId:'token-efficiency',count:60,seed:42});
 assert.equal(new Set(all.map(t=>t.id)).size,60);
 assert.deepEqual(selectBenchmark({packId:'token-efficiency',count:6,seed:42}),all.slice(0,6));
 assert.equal(new Set(all.slice(0,6).map(t=>t.category)).size,6);
 for(const t of all){assert.equal(objectiveScore(t.answerKey,t).score,100);assert.equal(objectiveScore('{}',t).score,0);assert.equal(objectiveScore('wrong',t).score,0);}
 assert.notDeepEqual(all,selectBenchmark({packId:'token-efficiency',count:60,seed:43}));
});
test('run metrics exclude warmups, include failure usage, reject truncated passes and export',()=>{
 const tests=selectBenchmark({packId:'token-efficiency',count:3,seed:42});
 const samples=tests.map((t,i)=>({...sample(100),testId:t.id,modelKey:'m',concurrency:1,warmup:false,status:i===2?'failed':'completed',possibleTruncation:i===1,objective:{score:100}} as Sample));
 const run={id:'r',tests,samples:[...samples,{...samples[0],warmup:true}],status:'completed',config:{...defaultConfig,modelKeys:['m'],concurrency:[1],waves:1}} as Run;
 const row=benchmarkRows(run)[0];assert.equal(row.passed,1);assert.equal(row.attempted,3);assert.equal(row.efficiency.outputTokens,300);assert.equal(row.efficiency.correctPerThousandOutput,1000/300);
 assert.match(benchmarkReport(run),/correct\/1,000 output tokens 3.33/);
 assert.match(benchmarkReport(run),/usage coverage 3\/3/);
});
