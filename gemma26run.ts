import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {runEngine} from './electron/engine';
import {defaultConfig, defaultSettings, performanceTest, starterTests} from './src/defaults';
import {listModels} from './electron/lmstudio';
import {Store} from './electron/store';
import type {Run, RunConfig} from './src/types';

const dataDir = process.argv[2];
const which = process.argv[3]; // 'quants' | 'mtp'
const engine = process.argv[4] ?? 'llama.cpp-win-x86_64-amd-rocm-avx2@2.40.0';
const engineName = engine.includes('rocm') ? 'ROCm' : 'Vulkan';
const settings = {...defaultSettings, lmsPath: path.join(homedir(), '.lmstudio', 'bin', 'lms.exe'), timeoutSec: 600, loadTimeoutSec: 900};
const store = Store.open(path.join(dataDir, 'bench.sqlite'));

const IQ3 = 'gemma-4-26b-a4b-it';        // IQ3_XXS, text-only, MTP sidecar
const Q4 = 'gemma-4-26b-a4b-it-qat-ud';  // Q4_K_XL QAT, text-only, no MTP
// Tests whose objective checks are crisp: an exact answer, exact JSON, or an exact two-line reply.
const OBJECTIVE = ['subnet', 'json-extract', 'reasoning', 'instructions'];

async function main() {
  const models = await listModels(settings);
  const keys = which === 'mtp' ? [IQ3] : [IQ3, Q4];
  for (const k of keys) {
    const m = models.find(x => x.key === k);
    if (!m) throw Error(`not in LM Studio: ${k}`);
    if (m.capabilities?.vision === true) throw Error(`${k} carries a vision projector; this run is text-only`);
    if (which === 'mtp' && m.nativeMtp?.supported !== true) throw Error(`${k}: MTP not confirmed`);
    console.log(`  ok ${k} · ${(m.size_bytes / 1024 ** 3).toFixed(2)} GiB · ${m.quantization?.name} · text-only`);
  }
  const tests = [...starterTests.filter(t => OBJECTIVE.includes(t.id)), performanceTest('medium')];
  const config: RunConfig = {
    ...defaultConfig,
    name: which === 'mtp' ? `Gemma 4 26B A4B IQ3_XXS · MTP sweep · ${engineName} (reasoning off)` : `Gemma 4 26B A4B · quant comparison · ${engineName} (f16 cache, reasoning off)`,
    modelKeys: keys, mode: 'combined', preset: 'Custom',
    testIds: OBJECTIVE, performanceLengths: ['medium'],
    concurrency: [1], waves: 2, maxTokens: 1024, contextLength: 8192,
    // Reasoning OFF, deliberately. These tests cap themselves at 256 output tokens, and with
    // reasoning on this model spent 253 of them thinking and emitted no answer at all — every
    // objective check then failed on an empty string, scoring 0 for reasons that had nothing to
    // do with the quantization being compared.
    temperature: 0, gpu: 'auto', reasoning: 'off', timeoutSec: 600,
    judgeModel: '',                       // Objective checks only — no judge model.
    vision: 'off',
    mtp: which === 'mtp' ? 'on' : 'off',
    mtpDraftTokens: 2,
    ...(which === 'mtp' ? {mtpSweep: [0, 1, 2, 3]} : {mtpSweep: undefined}),
    runtime: engine,
    // f16, explicitly — not 'off'. 'off' means "leave LM Studio's own setting alone", and this
    // machine has a stored q4_0 cache for the QAT model with no flash attention, which LM Studio
    // refuses to load. Writing f16 states the condition for the load and restores it afterwards,
    // and matches the unquantized cache the MTP run measured under.
    cacheK: 'f16', cacheV: 'f16',
  };
  const now = new Date().toISOString();
  const run: Run = {
    id: randomUUID(), created: now, updated: now, status: 'running', config, tests,
    modelInfo: Object.fromEntries(models.filter(m => keys.includes(m.key)).map(m => [m.key, {model: m}])),
    environment: {platform: 'win32', appVersion: '1.12.0', runtime: '', note: 'Started headlessly at the user’s request.'},
    logs: [], samples: [], waves: [],
  };
  store.saveRun(run);
  console.log(`run ${run.id.slice(0, 8)} "${config.name}" — ${keys.length} model(s), ${tests.length} tests`);
  const ac = new AbortController();
  await runEngine(run, settings, ac.signal, e => {
    if (e.type === 'sample') {
      run.samples.push(e.sample); store.saveSample(e.sample);
      if (!e.sample.warmup) console.log(`    ${e.sample.modelKey.slice(0, 24).padEnd(24)} ${String(e.sample.testId).padEnd(13)} d=${e.sample.mtpTokens ?? '-'} ${e.sample.status} gen=${e.sample.metrics.generationTps?.toFixed(1) ?? '-'} obj=${e.sample.objective.score ?? '-'}`);
    }
    if (e.type === 'wave') { run.waves.push(e.wave); store.saveWave(e.wave); }
    if (e.type === 'model') run.modelInfo[e.key] = e.info;
    if (e.type === 'log') { run.logs.push(new Date().toLocaleTimeString() + ' ' + e.message); if (/Prompt processing|Model failed|Runtime:|Native MTP/.test(e.message)) console.log('  log: ' + e.message.slice(0, 140)); }
    if (e.type === 'gpu') run.gpu = e.gpu;
    if (e.type === 'finish') { run.status = e.status; if (e.error) run.error = e.error; }
    run.updated = new Date().toISOString();
    store.saveRun(run);
  });
  run.updated = new Date().toISOString(); store.saveRun(run);
  const ok = run.samples.filter(s => !s.warmup && s.status === 'completed');
  console.log(`\nDONE ${which} status=${run.status} measured=${ok.length}${run.error ? ' error=' + run.error.slice(0, 200) : ''}`);
}
main().then(() => process.exit(0)).catch(e => { console.error('FAILED:', e.message); process.exit(1); });
