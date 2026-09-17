import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calibratePrefill,calibrationFor,calibrationKey,calibrationPrompt,calibrationRepeats,minDeltaMs,minTokenRatio,prefillText} from '../src/prefill';
import {parseRuntimes,runtimeChoices,runtimeLabel} from '../electron/runtime';
import type {Run} from '../src/types';
import {cacheScale,cacheScalePair,cacheQuantText,flashOn,needsFlashAttention} from '../src/cache-quant';
import {validateConfig} from '../electron/validation';
import {defaultConfig} from '../src/defaults';

// The case the calibration exists for: a fixed per-request cost that a single measurement charges
// to the GPU. 150 ms of overhead plus a true 1500 tok/s means a 150-token prompt is timed at
// 250 ms, which reads as 600 tok/s — under half the real rate — while a 3000-token prompt is
// timed at 2150 ms and reads as 1395. The slope recovers 1500 from either pair.
test('two points recover the real rate and name the fixed cost',()=>{
 const truth=1500,overhead=150;
 const at=(tokens:number)=>({tokens,ms:overhead+tokens/truth*1000});
 const c=calibratePrefill(at(150),at(3000));
 assert.ok(Math.abs(c.marginalTps!-truth)<1,`recovered ${c.marginalTps}`);
 assert.ok(Math.abs(c.overheadMs!-overhead)<1,`overhead ${c.overheadMs}`);
 // And the figure the old method would have reported for the same short request, kept beside it
 // so the two can be compared rather than quietly swapped.
 assert.ok(c.naiveTps!<truth/2,`naive ${c.naiveTps} should be far below the truth`);
});

test('a rate is reported only when two points can support one',()=>{
 const ok={tokens:3000,ms:2150};
 // A long prompt that is not long enough: the difference would be mostly noise.
 const tooClose=calibratePrefill({tokens:1000,ms:800},{tokens:1000*minTokenRatio-1,ms:3000});
 assert.equal(tooClose.marginalTps,null);
 assert.match(tooClose.note,/not at least/);
 // Two timings a few milliseconds apart, which a cache hit on the second request would produce.
 const tooFast=calibratePrefill({tokens:100,ms:500},{tokens:3000,ms:500+minDeltaMs-1});
 assert.equal(tooFast.marginalTps,null);
 assert.match(tooFast.note,/timing noise/);
 // A request that returned no timing at all is not calibrated rather than calibrated as zero.
 assert.equal(calibratePrefill({tokens:0,ms:0},ok).marginalTps,null);
 for(const c of [tooClose,tooFast])assert.equal(prefillText(c),c.note);
 assert.equal(prefillText(null),'Not measured');
});

// A long prompt cheaper per token than the line implies (a batch boundary, or partial cache reuse)
// would make the derived fixed cost negative, which is not a cost anyone can act on.
test('a negative fixed cost is reported as none rather than as a negative',()=>{
 const c=calibratePrefill({tokens:100,ms:10},{tokens:4000,ms:1000});
 assert.ok(c.marginalTps!>0);
 assert.ok(c.overheadMs!>=0,`overhead was ${c.overheadMs}`);
});

test('the calibration prompts differ in length by enough to be calibrated',()=>{
 const small=calibrationPrompt(calibrationRepeats.small),big=calibrationPrompt(calibrationRepeats.big);
 assert.ok(big.length>small.length*minTokenRatio,'the long prompt clears the ratio the calibration requires');
 // It is never scored and never read back, so it must not look like an instruction worth obeying
 // at length: a model that wrote an essay here would time the essay, not the prompt.
 assert.match(small,/reply with the single word/i);
});

test('runtime listings are parsed, labelled, and disambiguated',()=>{
 const listing=[
  'LLM ENGINE                                     SELECTED    MODEL FORMAT',
  'llama.cpp-win-x86_64-amd-rocm-avx2@2.40.0                      GGUF',
  'llama.cpp-win-x86_64-vulkan-avx2@2.40.0           ✓            GGUF',
  'llama.cpp-win-x86_64-vulkan-avx2@2.38.0                        GGUF',
 ].join('\n');
 const parsed=parseRuntimes(listing);
 assert.equal(parsed.length,3);
 assert.deepEqual(parsed.map(r=>r.selected),[false,true,false],'only the ticked row is selected');
 assert.equal(parsed[0].engine,'llama.cpp-win-x86_64-amd-rocm-avx2');
 assert.equal(parsed[0].version,'2.40.0');
 assert.equal(parsed.every(r=>r.format==='GGUF'),true);
 assert.deepEqual([runtimeLabel(parsed[0].engine),runtimeLabel(parsed[1].engine)],['ROCm','Vulkan']);
 // Two Vulkan builds cannot both be called "Vulkan" in a dropdown, so those carry their version.
 const choices=runtimeChoices(parsed);
 assert.equal(choices[0].label,'ROCm');
 assert.deepEqual(choices.slice(1).map(c=>c.label),['Vulkan 2.40.0','Vulkan 2.38.0']);
});

test('colour codes around the tick do not hide which engine is selected',()=>{
 const coloured=`LLM ENGINE  SELECTED\n[32mllama.cpp-win-x86_64-vulkan-avx2@2.40.0[0m   ✓   GGUF`;
 const [only]=parseRuntimes(coloured);
 assert.equal(only.engine,'llama.cpp-win-x86_64-vulkan-avx2');
 assert.equal(only.selected,true);
});

test('cache quantization scales memory and is described honestly',()=>{
 assert.equal(cacheScale('off'),1,'off is LM Studio’s own default, which for these models is f16');
 assert.equal(cacheScale('f16'),1);
 assert.ok(cacheScale('q8_0')<0.6&&cacheScale('q8_0')>0.5,'q8_0 is about half, not exactly half: it carries a scale per block');
 assert.ok(cacheScale('q4_0')<0.3);
 // K and V are set separately because they do not degrade alike, so the combined figure is the
 // mean of the two halves rather than either one.
 assert.equal(cacheScalePair('f16','q4_0'),(cacheScale('f16')+cacheScale('q4_0'))/2);
 assert.equal(cacheQuantText('off','off'),'Off');
 assert.equal(cacheQuantText('q8_0','q8_0'),'q8_0 K and V');
 assert.equal(cacheQuantText('q8_0','q4_0'),'q8_0 K · q4_0 V');
 // llama.cpp will not use a quantized cache without flash attention, so a config that asks for
 // one has to know it depends on it.
 assert.equal(needsFlashAttention('off','off'),false);
 assert.equal(needsFlashAttention('f16','f16'),false);
 assert.equal(needsFlashAttention('off','q4_0'),true);
});

// The bug this caught on real data: the engine stored calibrations under one key shape and the
// results screen looked them up under another, so the calibrated column was blank on every sweep —
// the exact runs it was built for. Emit and lookup now share calibrationKey(), and the shape saved
// before the fix is still read.
test('a calibration is found under the key the engine actually wrote',()=>{
 const c=(tps:number)=>({marginalTps:tps,overheadMs:0,naiveTps:null,note:'',small:{tokens:1,ms:1},big:{tokens:9,ms:9}});
 assert.equal(calibrationKey('m@q4',0),'prefill:m@q4 · MTP off','depth 0 is "MTP off", never "MTP MTP off"');
 assert.equal(calibrationKey('m@q4',1),'prefill:m@q4 · MTP 1 token');
 assert.equal(calibrationKey('m@q4',2),'prefill:m@q4 · MTP 2 tokens');
 assert.equal(calibrationKey('m@q4',null),'prefill:m@q4','a run with no sweep keeps the plain key');

 // Round trip through the canonical key, per depth.
 const canonical={modelInfo:Object.fromEntries([0,1,2].map(d=>[calibrationKey('m@q4',d),c(100+d)]))} as unknown as Run;
 for(const d of [0,1,2]) assert.equal(calibrationFor(canonical,'m@q4',d)?.marginalTps,100+d);

 // Runs saved before the fix used 'MTP ' + label, which doubled the prefix at depth 0.
 const legacy={modelInfo:{'prefill:m@q4 · MTP MTP off':c(7),'prefill:m@q4 · MTP 2 tokens':c(9)}} as unknown as Run;
 assert.equal(calibrationFor(legacy,'m@q4',0)?.marginalTps,7,'the old depth-0 key is still read');
 assert.equal(calibrationFor(legacy,'m@q4',2)?.marginalTps,9);

 // A non-sweep run stores one calibration under the plain key; a depth still finds it.
 const plain={modelInfo:{'prefill:m@q4':c(5)}} as unknown as Run;
 assert.equal(calibrationFor(plain,'m@q4',0)?.marginalTps,5);
 assert.equal(calibrationFor(plain,'m@q4',null)?.marginalTps,5);
 // And nothing is invented when nothing was measured.
 assert.equal(calibrationFor({modelInfo:{}} as unknown as Run,'m@q4',1),null);
});

test('flash attention defaults to on and a quantized cache cannot turn it off',()=>{
 assert.equal(flashOn(undefined),true,'a run that says nothing gets it on');
 assert.equal(flashOn('on'),true);
 assert.equal(flashOn('off'),false,'and it can still be turned off deliberately');
 // The contradiction is caught here rather than by LM Studio, whose refusal names neither setting.
 const base={...defaultConfig,modelKeys:['m@q4'],testIds:['subnet'],performanceLengths:['short']};
 assert.throws(()=>validateConfig({...base,cacheK:'q4_0',cacheV:'q4_0',flashAttention:'off'}),/needs flash attention/);
 assert.doesNotThrow(()=>validateConfig({...base,cacheK:'q4_0',cacheV:'q4_0',flashAttention:'on'}));
 // f16 is not a quantization, so it does not force the flag on.
 assert.doesNotThrow(()=>validateConfig({...base,cacheK:'f16',cacheV:'f16',flashAttention:'off'}));
 assert.throws(()=>validateConfig({...base,flashAttention:'sometimes' as never}),/Invalid flash attention/);
});
