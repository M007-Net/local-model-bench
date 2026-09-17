// KV cache quantization, shared by the window and the engine.
//
// The context is the part of a run's memory that scales with concurrency: LM Studio loads one
// instance holding contextLength × parallel tokens of keys and values, so raising the highest
// concurrency raises the cache, not the weights. On a card where the weights already nearly fill
// VRAM that is what decides whether the run measures the GPU or measures an offload to system RAM.

// The types llama.cpp accepts for a KV cache, in the order LM Studio lists them. f16 is what an
// unquantized cache already is, so it is offered as the explicit "full precision" choice and
// `off` means "do not write the setting at all".
export type CacheQuant='off'|'f16'|'q8_0'|'q5_0'|'q4_0'|'iq4_nl';
export const cacheQuants:CacheQuant[]=['off','f16','q8_0','q5_0','q4_0','iq4_nl'];

// Bits per element actually stored, used for the size estimate the run preview shows. q8_0 and
// q4_0 carry a scale per block of 32, which is why they are not exactly 8 and 4.
const BITS:Record<Exclude<CacheQuant,'off'>,number>={f16:16,q8_0:8.5,q5_0:5.5,q4_0:4.5,iq4_nl:4.5};

export const cacheQuantLabel=(q:CacheQuant):string=>
 q==='off'?'Off · LM Studio default':q==='f16'?'f16 · full precision':
 q==='q8_0'?'q8_0 · half size':q==='q5_0'?'q5_0':q==='q4_0'?'q4_0 · quarter size':'iq4_nl · quarter size';

// Relative to an f16 cache, which is the baseline every existing run in the history was measured
// with. `off` is reported as 1 because LM Studio's own default for these models is f16.
export const cacheScale=(q:CacheQuant):number=>q==='off'?1:BITS[q]/16;

// A run sets K and V independently because they do not degrade alike: a q4_0 V cache is routinely
// fine where a q4_0 K cache measurably hurts, so the common recommendation is q8_0 K with a
// smaller V. The combined figure is the mean of the two halves.
export const cacheScalePair=(k:CacheQuant,v:CacheQuant):number=>(cacheScale(k)+cacheScale(v))/2;

// Whether flash attention is required. llama.cpp will not use a quantized KV cache without it, and
// LM Studio refuses the load outright rather than falling back. Its own default is not dependable —
// it varies by engine and by whatever the model was last loaded with — which is why a run states the
// setting instead of inheriting it, and why asking for a quantized cache with flash off is refused
// rather than sent to LM Studio to fail.
export const needsFlashAttention=(k:CacheQuant,v:CacheQuant):boolean=>
 (k!=='off'&&k!=='f16')||(v!=='off'&&v!=='f16');

export const cacheQuantText=(k:CacheQuant,v:CacheQuant):string=>
 k==='off'&&v==='off'?'Off':k===v?`${k} K and V`:`${k} K · ${v} V`;

// On unless a run says otherwise. Kept here rather than read inline so the engine, the validator
// and the run preview cannot drift about what the default is.
export const flashOn=(v:'on'|'off'|undefined):boolean=>v!=='off';
