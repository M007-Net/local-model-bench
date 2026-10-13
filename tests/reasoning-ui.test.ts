import test from 'node:test';
import assert from 'node:assert/strict';
import {reasoningComparisonDefaults} from '../src/ReasoningComparisonPanel';
import {defaultConfig} from '../src/defaults';
import {describePack,builtInPacks} from '../src/benchmarks';

const packs=builtInPacks.map(describePack);
test('enabling reasoning comparison preserves selected questions and fixed engine settings',()=>{
 const benchmark={packId:'token-efficiency',count:6,seed:71};
 const config=reasoningComparisonDefaults({...defaultConfig,modelKeys:['one','two'],benchmark,mtp:'on',mtpDraftTokens:3,mtpDraftPMin:.4,runtime:'fixture@1',cacheK:'q8_0',mtpSweep:[0,1,2],mtpPMinSweep:[0,.5],mtpAutoFind:true,contextSweep:[2048,4096],judgeModel:'judge'},packs);
 assert.deepEqual(config.benchmark,benchmark);assert.deepEqual(config.modelKeys,['one','two']);
 assert.equal(config.mtp,'on');assert.equal(config.mtpDraftTokens,3);assert.equal(config.mtpDraftPMin,.4);assert.equal(config.runtime,'fixture@1');assert.equal(config.cacheK,'q8_0');
 assert.equal(config.mtpSweep,undefined);assert.equal(config.mtpPMinSweep,undefined);assert.equal(config.contextSweep,undefined);assert.equal(config.mtpAutoFind,false);assert.equal(config.judgeModel,'');
 assert.equal(config.waves,3);assert.equal(config.maxTokens,32768);assert.equal(config.timeoutSec,1200);assert.equal(config.temperature,0);assert.deepEqual(config.concurrency,[1]);
});
test('enabling comparison without selected questions uses the objective efficiency pack',()=>{
 const config=reasoningComparisonDefaults({...defaultConfig,benchmark:undefined},packs);
 assert.equal(config.benchmark?.packId,'token-efficiency');assert.equal(config.benchmark?.count,10);assert.deepEqual(config.testIds,[]);
 assert.deepEqual(config.reasoningComparison?.settings.map(s=>s.kind==='budget'?s.tokens:s.kind),['off',512,1024,2048,4096,'unlimited']);
});
test('comparison defaults work when only an imported objective pack is installed',()=>{
 const imported={...packs[0],id:'imported-fixture',custom:true,count:4};
 const config=reasoningComparisonDefaults({...defaultConfig,benchmark:undefined},[imported]);
 assert.deepEqual(config.benchmark,{packId:'imported-fixture',count:4,seed:42});
});
