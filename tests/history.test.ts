import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultHistoryView,facetOptions,familyOf,groupHistory,matchesHistory,promptSizeOf,quantTier,restoreHistoryView,sizeBucket,sizeLabel,sortGroups,type HistoryRow,type HistoryView} from '../src/history';
import {historyRows} from '../electron/history';
import {inferProfile} from '../src/model-profile';
import {percentile} from '../electron/metrics';
import type {Metrics,Run,Sample} from '../src/types';
const row=(patch:Partial<HistoryRow>={}):HistoryRow=>({
 vision:'off',visionEffective:'',visionImagesSent:false,visionProjectorUnloaded:false,visionLimitation:'',
 mtp:'off',mtpDraftTokens:null,mtpDepth:null,draftAcceptance:null,draftMeanLen:null,model:'Gemma 4 12B',modelKey:'gemma-4-12b-it@iq3_xxs',test:'Short prompt throughput',testId:'perf-short',concurrency:1,
 requests:1,failures:0,failureRate:0,generationTps:null,estimatedPrefillTps:null,throughput:null,
 medianMs:null,p95Ms:null,ttftMs:null,objective:null,localJudge:null,externalJudge:null,
 gpuHotSpotAvg:null,gpuHotSpotMax:null,gpuCoreTempAvg:null,gpuCoreTempMax:null,gpuMemoryTempMax:null,
 gpuPowerAvg:null,gpuLoadAvg:null,gpuReadings:0,
 backend:'Vulkan',backendRef:'llama.cpp-win-x86_64-vulkan-avx2@2.40.0',prefillCalibratedTps:null,prefillOverheadMs:null,
 runId:'r1',runName:'Run one',runCreated:'2026-09-01T00:00:00.000Z',runStatus:'completed',
 family:'Gemma',kind:'dense',sizeLabel:'12B',sizeBucket:'8-20B',quantization:'IQ3_XXS',quantTier:'IQ3',
 publisher:'unsloth',architecture:'gemma4',totalB:12,activeB:null,
 promptSize:'short',testKind:'performance',benchmarkPack:null,
 reasoning:'default',temperature:0,contextLength:8192,maxTokens:512,waves:1,
 completed:1,durationsMs:[],objectiveCount:0,localJudgeCount:0,externalJudgeCount:0,
 ...patch});
const view=(patch:Partial<HistoryView>={}):HistoryView=>({...defaultHistoryView,...patch});
test('the family comes from the reported architecture, never from the repackager',()=>{
 assert.equal(familyOf('gemma4','gemma-4-12b-it@iq3_xxs'),'Gemma');
 assert.equal(familyOf('qwen35','qwen3.8-27b@iq3_s'),'Qwen');
 assert.equal(familyOf('qwen35moe','qwen3.6-35b-a3b@iq4_xs'),'Qwen');
 // No architecture saved: fall back to the key, and never let the quantization suffix leak into the family.
 assert.equal(familyOf('','mistral-small-24b@q4_k_m'),'Mistral');
 assert.equal(familyOf(undefined,'7b-something@q4'),'Unknown');
 assert.equal(familyOf(null,null),'Unknown');
});
test('quantization tiers group by bit count and keep unlabelled formats visible',()=>{
 assert.equal(quantTier('IQ3_XXS'),'IQ3');
 assert.equal(quantTier('Q3_K_XL'),'Q3');
 assert.equal(quantTier('Q4_0'),'Q4');
 assert.equal(quantTier('IQ4_XS'),'IQ4');
 assert.equal(quantTier('F16'),'F16');
 assert.equal(quantTier(''),'Unknown');
 assert.equal(quantTier(undefined),'Unknown');
});
test('size labels and buckets agree with the comparison ranges and never assume a missing size',()=>{
 assert.equal(sizeLabel(12),'12B');
 assert.equal(sizeLabel(2.6),'2.6B');
 assert.equal(sizeLabel(null),'Unknown size');
 assert.equal(sizeBucket(8),'Up to 8B');
 assert.equal(sizeBucket(12),'8-20B');
 assert.equal(sizeBucket(27),'20-35B');
 assert.equal(sizeBucket(35),'20-35B');
 assert.equal(sizeBucket(35.1),'35-70B');
 assert.equal(sizeBucket(null),'Unknown size');
 // The real expert-layout label in the saved library resolves through the model name, not params_string.
 const gemmaMoe=inferProfile({key:'gemma-4-26b-a4b-it-qat-ud - vision',display_name:'Gemma 4 26B A4B Instruct QAT UD',params_string:'128x2.6B',architecture:'gemma4'});
 assert.deepEqual([gemmaMoe.totalB,gemmaMoe.activeB,gemmaMoe.kind],[26,4,'moe']);
 assert.equal(sizeBucket(gemmaMoe.totalB),'20-35B');
});
test('performance prompt sizes are recognised and other tests stay unlabelled',()=>{
 assert.equal(promptSizeOf('perf-long'),'long');
 assert.equal(promptSizeOf('perf-medium'),'medium');
 assert.equal(promptSizeOf('gsm8k-17'),null);
 assert.equal(promptSizeOf(undefined),null);
});
test('choices inside a facet are alternatives and choices across facets all have to match',()=>{
 const gemma=row(),qwen=row({family:'Qwen',kind:'moe',quantTier:'IQ4',quantization:'IQ4_XS',modelKey:'qwen3.6-35b-a3b@iq4_xs',architecture:'qwen35moe'});
 assert.equal(matchesHistory(gemma,view()),true);
 assert.equal(matchesHistory(gemma,view({families:['Gemma','Qwen']})),true);
 assert.equal(matchesHistory(qwen,view({families:['Gemma','Qwen']})),true);
 assert.equal(matchesHistory(qwen,view({families:['Gemma']})),false);
 assert.equal(matchesHistory(gemma,view({families:['Gemma'],kinds:['MoE']})),false);
 assert.equal(matchesHistory(gemma,view({families:['Gemma'],kinds:['Dense'],quantTiers:['IQ3']})),true);
 assert.equal(matchesHistory(gemma,view({concurrency:['4']})),false);
 assert.equal(matchesHistory(gemma,view({search:'iq3_xxs'})),true);
 assert.equal(matchesHistory(gemma,view({search:'run one'})),true);
 assert.equal(matchesHistory(gemma,view({search:'qwen'})),false);
});
test('chip counts report what pressing that chip would show, not what is already filtered out',()=>{
 const rows=[row(),row({quantTier:'Q3',quantization:'Q3_K_XL'}),row({family:'Qwen',architecture:'qwen35',quantTier:'IQ3'})];
 // Narrowing to Gemma must not shrink the Gemma chip's own count, but must shrink the tier counts.
 const chosen=view({families:['Gemma']});
 assert.deepEqual(facetOptions(rows,chosen,'families'),[{value:'Gemma',count:2},{value:'Qwen',count:1}]);
 assert.deepEqual(facetOptions(rows,chosen,'quantTiers'),[{value:'IQ3',count:1},{value:'Q3',count:1}]);
 // A value that nothing matches any more stays on offer at zero rather than vanishing, so the chips a run
 // was measured under never disappear mid-press.
 assert.deepEqual(facetOptions(rows,view({quantTiers:['Q3']}),'families'),[{value:'Gemma',count:1},{value:'Qwen',count:0}]);
});
test('pooled rates weight by the requests behind them and report the spread they came from',()=>{
 const rows=[row({generationTps:40,requests:100,completed:100}),row({runId:'r2',generationTps:10,requests:2,completed:2})];
 const [group]=groupHistory(rows,view());
 assert.equal(group.requests,102);
 assert.equal(group.runs.length,2);
 // The naive mean is 25; the honest one is dominated by the hundred-request run.
 assert.ok(Math.abs(group.generationTps!.value-4020/102)<1e-9);
 assert.deepEqual([group.generationTps!.min,group.generationTps!.max],[10,40]);
});
test('median and p95 are recomputed from pooled durations, not averaged from per-run percentiles',()=>{
 const a=[100,200,300,400,500],b=[1000,2000];
 const rows=[row({durationsMs:a,requests:5,completed:5,p95Ms:percentile(a,.95)}),row({runId:'r2',durationsMs:b,requests:2,completed:2,p95Ms:percentile(b,.95)})];
 const [group]=groupHistory(rows,view());
 assert.equal(group.p95Ms,percentile([...a,...b],.95));
 assert.notEqual(group.p95Ms,(percentile(a,.95)!+percentile(b,.95)!)/2);
 assert.equal(group.medianMs,percentile([...a,...b],.5));
});
test('scores weight by graded responses, so an ungraded run cannot dilute a graded one',()=>{
 const graded=row({objective:80,objectiveCount:100,requests:100,completed:100});
 const ungraded=row({runId:'r2',objective:null,objectiveCount:0,requests:100,completed:100});
 assert.equal(groupHistory([graded,ungraded],view())[0].objective,80);
 const both=groupHistory([row({objective:80,objectiveCount:1}),row({runId:'r2',objective:100,objectiveCount:3})],view());
 assert.equal(both[0].objective,95);
});
test('a group that pools more than one condition says so',()=>{
 const same=groupHistory([row(),row({runId:'r2'})],view());
 assert.equal(same[0].mixed,false);
 const mixed=groupHistory([row(),row({runId:'r2',concurrency:4})],view());
 assert.equal(mixed[0].mixed,true);
 assert.deepEqual(mixed[0].conditions.concurrency,['1','4']);
 const byPrompt=groupHistory([row(),row({runId:'r2',promptSize:'long',testId:'perf-long'})],view());
 assert.equal(byPrompt[0].mixed,true);
});
test('regrouping moves rows without losing or duplicating requests',()=>{
 const rows=[row({requests:10}),row({runId:'r2',quantTier:'Q3',quantization:'Q3_K_XL',modelKey:'gemma-4-12b-it@q3_k_xl',requests:6}),row({runId:'r3',family:'Qwen',architecture:'qwen35',kind:'moe',quantTier:'IQ3',modelKey:'qwen3.6-35b-a3b@iq3_xxs',requests:4})];
 const total=(by:'model'|'family'|'quantTier'|'kind')=>groupHistory(rows,view(),{by}).reduce((n,g)=>n+g.requests,0);
 assert.equal(groupHistory(rows,view(),{by:'model'}).length,3);
 assert.equal(groupHistory(rows,view(),{by:'family'}).length,2);
 assert.equal(groupHistory(rows,view(),{by:'quantTier'}).length,2);
 assert.equal(groupHistory(rows,view(),{by:'kind'}).length,2);
 for(const by of ['model','family','quantTier','kind'] as const)assert.equal(total(by),20);
 // Splitting for the graphs keeps one point per group and concurrency.
 assert.equal(groupHistory([row(),row({runId:'r2',concurrency:4})],view(),{splitConcurrency:true}).length,2);
});
test('groups with no measurement for the sorted column stay last in both directions',()=>{
 const rows=[row({modelKey:'fast',generationTps:40}),row({modelKey:'slow',generationTps:10}),row({modelKey:'unmeasured'})];
 const labels=(descending:boolean)=>sortGroups(groupHistory(rows,view()),view({sort:'generationTps',descending})).map(g=>g.label);
 assert.deepEqual(labels(true),['fast','slow','unmeasured']);
 assert.deepEqual(labels(false),['slow','fast','unmeasured']);
 assert.deepEqual(sortGroups(groupHistory(rows,view()),view({sort:'label',descending:false})).map(g=>g.label),['fast','slow','unmeasured']);
});
test('a saved overview is restored defensively',()=>{
 assert.deepEqual(restoreHistoryView(null),defaultHistoryView);
 assert.deepEqual(restoreHistoryView('nonsense'),defaultHistoryView);
 const restored=restoreHistoryView({families:['Gemma','Gemma',7],kinds:'Dense',groupBy:'nope',sort:'dropTable',descending:'yes',search:5});
 assert.deepEqual(restored.families,['Gemma']);
 assert.deepEqual(restored.kinds,[]);
 assert.equal(restored.groupBy,'model');
 assert.equal(restored.sort,'generationTps');
 assert.equal(restored.descending,true);
 assert.equal(restored.search,'');
 assert.deepEqual(restoreHistoryView({groupBy:'quantTier',sort:'label',descending:false}).groupBy,'quantTier');
});
const metrics=(durationMs:number,generationTps:number):Metrics=>({inputTokens:10,outputTokens:20,reasoningTokens:null,generationTps,prefillTps:null,prefillMs:null,ttftMs:null,durationMs,firstContentMs:null,prefillMethod:'',cacheNote:''});
const sample=(patch:Partial<Sample>):Sample=>({id:'s',runId:'run',modelKey:'gemma-4-12b-it@iq3_xxs',modelName:'Gemma 4 12B',testId:'perf-short',testName:'Short prompt throughput',concurrency:1,waveId:'w',wave:0,slot:0,warmup:false,prompt:'p',output:'o',reasoning:'',status:'completed',metrics:metrics(1000,40),objective:{score:null,checks:[]},grades:[],rawStats:{},created:'2026-09-01T00:00:00.000Z',possibleTruncation:false,...patch});
const savedRun=():Run=>({id:'run',created:'2026-09-01T00:00:00.000Z',updated:'2026-09-01T00:10:00.000Z',status:'completed',
 config:{name:'Saved sweep',modelKeys:['gemma-4-12b-it@iq3_xxs'],testIds:[],mode:'combined',preset:'Quick',concurrency:[1],waves:1,maxTokens:512,contextLength:8192,temperature:0,gpu:'auto',reasoning:'default',judgeModel:'',performanceLengths:['short'],timeoutSec:300,mtp:'off',vision:'off'},
 tests:[{id:'perf-short',name:'Short prompt throughput',category:'Performance',version:1,prompt:'p',answerKey:'',rubric:'',maxTokens:0,rules:[],kind:'performance'}],
 modelInfo:{'gemma-4-12b-it@iq3_xxs':{model:{key:'gemma-4-12b-it@iq3_xxs',display_name:'Gemma 4 12B Instruct UD',params_string:'12B',architecture:'gemma4',publisher:'unsloth',quantization:{name:'IQ3_XXS'}}}},
 environment:{},logs:[],
 samples:[sample({id:'warm',warmup:true,metrics:metrics(9999,1)}),sample({id:'a',metrics:metrics(1000,40),objective:{score:80,checks:[]}}),sample({id:'b',metrics:metrics(2000,20),grades:[{source:'local',score:70,criteria:[],summary:'',judge:'j',rubricVersion:1,created:'',raw:''}]}),sample({id:'c',status:'failed'})],
 waves:[]});
test('saved runs become history rows with their facets, counts, and durations',()=>{
 const [row]=historyRows([savedRun()],{});
 assert.equal(historyRows([savedRun()],{}).length,1);
 assert.deepEqual([row.family,row.kind,row.sizeLabel,row.quantization,row.quantTier,row.publisher],['Gemma','dense','12B','IQ3_XXS','IQ3','unsloth']);
 assert.deepEqual([row.runId,row.runName,row.runStatus,row.promptSize,row.testKind],['run','Saved sweep','completed','short','performance']);
 // The warm-up is excluded and the failure is counted but contributes no duration.
 assert.deepEqual([row.requests,row.failures,row.completed],[3,1,2]);
 assert.deepEqual(row.durationsMs,[1000,2000]);
 assert.deepEqual([row.objectiveCount,row.localJudgeCount,row.externalJudgeCount],[1,1,0]);
 assert.equal(row.generationTps,30);
 // A saved correction overrides the inferred architecture for every run it appears in.
 const corrected=historyRows([savedRun()],{'gemma-4-12b-it@iq3_xxs':{totalB:13,activeB:2,kind:'moe',source:'User supplied'}})[0];
 assert.deepEqual([corrected.kind,corrected.sizeLabel],['moe','13B']);
});
