import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEngine, type Adapter, type EngineEvent } from '../electron/engine';
import { metrics } from '../electron/metrics';
import { defaultConfig, defaultSettings, performanceTest } from '../src/defaults';
import type { Model, Run } from '../src/types';

const workload = { ...performanceTest('short'), contextTokens: 128 };
const settings = { ...defaultSettings, provider: 'openai' as const };
function makeRun(durationSec = 1): Run {
  return {
    id: 'sustained-run', created: new Date().toISOString(), updated: new Date().toISOString(), status: 'running',
    config: { ...structuredClone(defaultConfig), loadProfile: 'sustained', durationSec, modelKeys: ['mock'], testIds: [workload.id], mode: 'performance', concurrency: [2], waves: 4, contextLength: 2048, maxTokens: 64 },
    tests: [workload], modelInfo: {}, environment: {}, logs: [], samples: [], waves: [],
  };
}
const model = { key: 'mock', display_name: 'Mock', type: 'llm', size_bytes: 1, quantization: null, max_context_length: 8192, loaded_instances: [] } as unknown as Model;
function adapter(infer: Adapter['infer']): Adapter {
  return { models: async () => [model], cli: async () => '', infer, api: async () => ({}) };
}
const reply = (status: 'completed' | 'failed' = 'completed') => ({
  output: 'ok', reasoning: '', rawStats: {}, metrics: metrics({ input_tokens: 128, total_output_tokens: 1, tokens_per_second: 25 }, 10, 0, 10, 10), status,
  ...(status === 'failed' ? { error: 'temporary failure' } : {}), possibleTruncation: false,
} as const);
async function execute(run: Run, signal: AbortSignal, infer: Adapter['infer']) {
  const events: EngineEvent[] = [];
  await runEngine(run, settings, signal, event => {
    events.push(event);
    if (event.type === 'sample') run.samples.push(event.sample);
    if (event.type === 'wave') run.waves.push(event.wave);
  }, adapter(infer));
  return events;
}

test('sustained mode refills concurrency until the duration deadline and records one timed point', async () => {
  const run = makeRun();
  const measuredPrompts: string[] = [];
  const events = await execute(run, new AbortController().signal, async (_s, _id, prompt) => {
    if (!prompt.includes('Reply with the word ready')) measuredPrompts.push(prompt);
    await new Promise(resolve => setTimeout(resolve, 25));
    return reply();
  });
  assert.ok(measuredPrompts.length > 2, 'workers should refill after each completed request');
  assert.equal(run.waves.length, 1, 'one wave summarizes the sustained point');
  assert.ok(run.waves[0].durationMs >= 1000, 'duration includes the measurement interval');
  assert.equal(run.waves[0].completed, measuredPrompts.length);
  assert.equal(run.waves[0].contextTokens, 128);
  assert.ok(run.samples.filter(sample => !sample.warmup).every(sample => sample.contextTokens === 128));
  assert.equal(events.find(event => event.type === 'finish')?.type, 'finish');
});

test('sustained mode drains in-flight requests after cancellation without refilling', async () => {
  const run = makeRun(3), controller = new AbortController();
  let count = 0;
  const timer = setTimeout(() => controller.abort(), 120);
  const events = await execute(run, controller.signal, async (_s, _id, prompt) => {
    if (!prompt.includes('Reply with the word ready')) count++;
    await new Promise(resolve => setTimeout(resolve, 60));
    return reply();
  });
  clearTimeout(timer);
  assert.ok(count >= 2 && count <= 6, `expected only initial and already-in-flight requests, got ${count}`);
  assert.equal(run.waves.length, 1);
  assert.equal(run.waves[0].completed, count);
  assert.equal(events.find(event => event.type === 'finish')?.type === 'finish' ? events.find(event => event.type === 'finish')?.status : '', 'cancelled');
});

test('immediate sustained failures are paced and included in the point totals', async () => {
  const run = makeRun();
  const failingRun = { ...run, config: { ...run.config, concurrency: [1] } };
  const events = await execute(failingRun, new AbortController().signal, async (_s, _id, prompt) =>
    prompt.includes('Reply with the word ready') ? reply() : reply('failed'));
  const measured = failingRun.samples.filter(sample => !sample.warmup);
  assert.ok(measured.length >= 8 && measured.length <= 24, `failure backoff should limit attempts, got ${measured.length}`);
  assert.ok(measured.every(sample => sample.status === 'failed'));
  assert.equal(failingRun.waves.length, 1);
  assert.equal(failingRun.waves[0].failed, measured.length);
  assert.ok(failingRun.waves[0].durationMs >= 1000);
  assert.equal(events.find(event => event.type === 'finish')?.type === 'finish' ? events.find(event => event.type === 'finish')?.status : '', 'failed');
});

test('thrown inference errors become failed samples with nonnegative elapsed time', async () => {
  const run = makeRun();
  await execute(run, new AbortController().signal, async (_s, _id, prompt) => {
    if (prompt.includes('Reply with the word ready')) return reply();
    throw new Error('connection reset');
  });
  const measured = run.samples.filter(sample => !sample.warmup);
  assert.ok(measured.length > 0);
  assert.ok(measured.every(sample => sample.status === 'failed'));
  assert.ok(measured.every(sample => Number.isFinite(sample.metrics.durationMs) && sample.metrics.durationMs >= 0));
});
