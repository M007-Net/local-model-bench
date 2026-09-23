import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextWorkloads } from '../src/load-profile';
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
