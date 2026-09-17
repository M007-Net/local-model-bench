import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backendOf,unknownBackend} from '../electron/runtime';
import {backendRows,comparableBackends,overlayId,overlayOptions,overlayRows,stillOffered} from '../src/chart-compare';
import type {HistoryRow} from '../src/history';

const row=(patch:Partial<HistoryRow>):HistoryRow=>({
 runId:'r1',runName:'run',runCreated:'2026-09-10T00:00:00.000Z',runStatus:'completed',
 modelKey:'gemma@q4',testId:'perf-short',concurrency:1,mtpDepth:null,backend:'Vulkan',
 backendRef:null,prefillCalibratedTps:null,prefillOverheadMs:null,
 ...patch,
} as unknown as HistoryRow);

const listing=(selected:string)=>['LLM ENGINE  SELECTED  MODEL FORMAT',
 `llama.cpp-win-x86_64-amd-rocm-avx2@2.40.0 ${selected==='rocm'?'✓':''} GGUF`,
 `llama.cpp-win-x86_64-vulkan-avx2@2.40.0 ${selected==='vulkan'?'✓':''} GGUF`].join('\n');

test('a run says which engine measured it, preferring what it asked for',()=>{
 // A run that named an engine is exact, whatever the machine has selected now.
 assert.equal(backendOf({config:{runtime:'llama.cpp-win-x86_64-amd-rocm-avx2@2.40.0'}}).label,'ROCm');
 // Otherwise the ticked row of the table captured when the run was created.
 assert.equal(backendOf({environment:{runtime:listing('vulkan')}}).label,'Vulkan');
 assert.equal(backendOf({config:{runtime:'llama.cpp-win-x86_64-vulkan-avx2@2.40.0'}}).version,'2.40.0');
 // A run from before either existed is not attributed to whatever happens to be selected today,
 // because that would invent an engine comparison out of measurements nobody took under one.
 assert.equal(backendOf({}).label,unknownBackend);
 assert.equal(backendOf({environment:{runtime:'   '}}).label,unknownBackend);
});

test('only engines that measured the same model on the same test are offered',()=>{
 const history=[
  row({runId:'other',backend:'ROCm',modelKey:'gemma@q4',testId:'perf-short'}),
  row({runId:'other2',backend:'CUDA',modelKey:'someone-elses@q4',testId:'perf-short'}),
  row({runId:'other3',backend:'ROCm',modelKey:'gemma@q4',testId:'perf-long'}),
  row({runId:'other4',backend:unknownBackend,modelKey:'gemma@q4',testId:'perf-short'}),
 ];
 const options=overlayOptions(history,'r1','perf-short','Vulkan',['gemma@q4']);
 const engines=options.filter(o=>o.kind==='backend').map(o=>o.label);
 // CUDA measured a different model, perf-long is a different test, and Unknown is not an engine.
 assert.deepEqual(engines,['Compare with ROCm']);
 // The model CUDA did measure is still offered, just as a model rather than as an engine.
 assert.deepEqual(options.filter(o=>o.kind==='model').map(o=>o.id),[overlayId('model','someone-elses@q4')]);
 // The run being viewed never offers itself.
 assert.equal(overlayOptions(history,'other','perf-short','ROCm',['gemma@q4']).some(o=>o.label==='Compare with ROCm'),false);
});

test('the newest run wins when several measured the same point',()=>{
 const history=[
  row({runId:'old',backend:'ROCm',runCreated:'2026-09-01T00:00:00.000Z',generationTps:10} as Partial<HistoryRow>),
  row({runId:'new',backend:'ROCm',runCreated:'2026-09-20T00:00:00.000Z',generationTps:99} as Partial<HistoryRow>),
 ];
 const rows=overlayRows(history,[overlayId('backend','ROCm')],'r1','perf-short',['gemma@q4']);
 // One line, not two drawn through points taken weeks apart.
 assert.equal(rows.length,1);
 assert.equal((rows[0] as unknown as {generationTps:number}).generationTps,99);
 // The series is renamed so the legend says which engine it came from.
 assert.equal(rows[0].modelKey,'gemma@q4 · ROCm');
});

test('a selection that the current test cannot honour is dropped rather than drawn empty',()=>{
 const history=[row({runId:'other',backend:'ROCm',testId:'perf-short'})];
 const forShort=overlayOptions(history,'r1','perf-short','Vulkan',['gemma@q4']);
 const forLong=overlayOptions(history,'r1','perf-long','Vulkan',['gemma@q4']);
 const picked=[overlayId('backend','ROCm')];
 assert.deepEqual(stillOffered(picked,forShort),picked);
 assert.deepEqual(stillOffered(picked,forLong),[],'no ROCm data for this test, so the choice lapses');
 assert.deepEqual(overlayRows(history,picked,'r1','perf-long',['gemma@q4']),[]);
});

test('the table pools engines across tests, unlike the graph which is per test',()=>{
 const history=[
  row({runId:'other',backend:'ROCm',testId:'perf-short'}),
  row({runId:'other',backend:'ROCm',testId:'perf-long'}),
 ];
 assert.deepEqual(comparableBackends(history,'r1','Vulkan',['gemma@q4']),['ROCm']);
 // The comparison table shows every test at once, so both rows come through.
 assert.equal(backendRows(history,'r1',['ROCm'],['gemma@q4']).length,2);
 // A model this run did not measure is not pooled in: it would not be an engine comparison.
 assert.equal(backendRows(history,'r1',['ROCm'],['something-else@q4']).length,0);
 assert.deepEqual(comparableBackends(history,'r1','ROCm',['gemma@q4']),[],'the engine you are already on is not an alternative');
});
