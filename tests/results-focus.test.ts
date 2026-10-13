import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runFailureMessage} from '../src/results-focus';
import type {Run} from '../src/types';

const run=(overrides:Partial<Run>):Run=>({
 id:'run',created:'',updated:'',status:'failed',config:{} as Run['config'],tests:[],modelInfo:{},environment:{},logs:[],samples:[],waves:[],...overrides,
});

test('failure details prefer the model-specific diagnostic in the saved log',()=>{
 const message=runFailureMessage(run({error:'Warm-up failed: terminated',logs:['10:15:00 Model failed: qwen3.8:27b: Warm-up failed: terminated']}));
 assert.equal(message,'10:15:00 Model failed: qwen3.8:27b: Warm-up failed: terminated');
});

test('failure details redact credentials in provider diagnostics',()=>{
 const message=runFailureMessage(run({logs:['Model failed: model: Bearer abc123 https://user:pass@example.test api_key=secret-value']}));
 assert.equal(message,'Model failed: model: Bearer [redacted] https://[redacted]@example.test api_key=[redacted]');
});

test('failure details fall back to the run or failed sample error',()=>{
 assert.equal(runFailureMessage(run({error:'Warm-up failed: terminated'})),'Warm-up failed: terminated');
 assert.equal(runFailureMessage(run({samples:[{status:'failed',error:'request timed out'} as Run['samples'][number]]})),'request timed out');
});
