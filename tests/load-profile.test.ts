import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptInputPrompt, cachedFollowupVariant, contextWorkloads } from '../src/load-profile';
import { defaultConfig, performanceTest, starterTests } from '../src/defaults';

test('context sweep expands one performance workload with stable IDs and approximate targets', () => {
  const config = { ...structuredClone(defaultConfig), contextSweep: [128, 512] };
  const base = performanceTest('short');
  const expanded = contextWorkloads([starterTests[0], base], config);
  assert.equal(expanded.length, 2);
  assert.deepEqual(expanded.map(item => item.contextTokens), [128, 512]);
  assert.notEqual(expanded[0].id, expanded[1].id);
  assert.match(expanded[0].name, /≈128 input tokens/);
  assert.ok(expanded[1].prompt.length > expanded[0].prompt.length);
  assert.deepEqual(contextWorkloads([base], config), expanded);
});

test('no context sweep or no performance test leaves the selected workloads unchanged', () => {
  const base = performanceTest('short');
  const config = { ...structuredClone(defaultConfig), contextSweep: [] };
  const tests = [starterTests[0], base];
  assert.equal(contextWorkloads(tests, config), tests);
  const sweep = { ...config, contextSweep: [128] };
  const qualityOnly = [starterTests[0]];
  assert.equal(contextWorkloads(qualityOnly, sweep), qualityOnly);
});

test('input adaptation uses endpoint usage, is bounded to three probes, and preserves a primed prefix', async()=>{
 const seen:string[]=[];
 const result=await adaptInputPrompt(256,5,async prompt=>{seen.push(prompt);return Math.ceil(prompt.length/3)+9;},{cacheMode:'cached-prefix-followup',prefixTokens:64,maxProbes:3});
 assert.ok(seen.length<=3);assert.equal(result.probeTokens.length,seen.length);assert.equal(result.withinTolerance,true);
 assert.ok(result.primePrompt);assert.ok(result.prompt.startsWith(result.primePrompt));
 const one=cachedFollowupVariant(result.prompt,'one'),two=cachedFollowupVariant(result.prompt,'two');
 assert.ok(one.startsWith(result.primePrompt));assert.ok(two.startsWith(result.primePrompt));assert.notEqual(one,two);
 assert.equal(one.slice(0,result.primePrompt!.length),two.slice(0,result.primePrompt!.length));
});

test('invalid usage leaves adaptation tolerance unknown and prompt growth bounded',async()=>{
 const result=await adaptInputPrompt(131072,5,async()=>null,{maxProbes:3});
 assert.equal(result.withinTolerance,null);assert.equal(result.probeTokens.length,0);assert.ok(result.prompt.length<=524288);
});
