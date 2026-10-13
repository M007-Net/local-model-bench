import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Run,Sample} from '../src/types';
import {defaultConfig} from '../src/defaults';
import {summaries,exportText} from '../electron/export';
import {historyRows} from '../electron/history';
import {benchmarkReport} from '../electron/benchmark-report';
import {chartReport} from '../electron/chart-report';
import {defaultHistoryView,groupHistory,type GroupBy} from '../src/history';
import {chartSeriesKey} from '../src/charts';
import {reasoningSummaries,resolveReasoningSettings,type ReasoningSetting} from '../src/reasoning-comparison';

const off:ReasoningSetting={id:'off',kind:'off'},budget:ReasoningSetting={id:'budget-2048',kind:'budget',tokens:2048};
const sample=(id:string,setting:ReasoningSetting,repeat:number,patch:Partial<Sample>={}):Sample=>({
 id,runId:'r',modelKey:'fixture',modelName:'Fixture model',testId:'q',testName:'Removed pack · q',concurrency:1,waveId:setting.id+repeat,wave:repeat,slot:0,warmup:false,prompt:'same prompt',output:'wrong',reasoning:'private thought',status:'completed',
 metrics:{inputTokens:30,outputTokens:12,reasoningTokens:null,generationTps:5,prefillTps:null,prefillMs:null,ttftMs:null,durationMs:1000,firstContentMs:null,prefillMethod:'',cacheNote:''},objective:{score:0,checks:[]},grades:[],rawStats:{},created:'',possibleTruncation:false,
 reasoningSetting:setting,reasoningRepeat:repeat,reasoningControl:{transport:'fixture control',confirmation:'requested',note:'Acceptance alone does not prove enforcement.'},...patch,
});
function run():Run{
 const samples=[sample('off0',off,0,{status:'timeout'}),sample('off1',off,1),sample('old',budget,0,{status:'failed'}),sample('retry',budget,0,{retryOf:'old',output:'<script>answer</script>',objective:{score:100,checks:[]},metrics:{...sample('x',budget,0).metrics,reasoningTokens:100}}),sample('budget1',budget,1,{output:'right but truncated',objective:{score:100,checks:[]},possibleTruncation:true})];
 return {id:'r',created:'today',updated:'today',status:'completed',config:{...structuredClone(defaultConfig),name:'Reasoning fixture',modelKeys:['fixture'],mode:'quality',concurrency:[1],waves:2,reasoningComparison:{settings:[off,budget],baselineId:'off'},benchmark:{packId:'removed-custom',count:1,seed:42}},
  tests:[{id:'q',name:'Removed pack · q',kind:'quality',version:1,category:'Test',prompt:'same prompt',answerKey:'right',rubric:'',maxTokens:0,rules:[],benchmark:{packId:'removed-custom',itemId:'q',datasetHash:'saved-hash',protocol:'saved-scoring-protocol'}}],samples,
  waves:[{id:'off0',runId:'r',modelKey:'fixture',testId:'q',concurrency:1,durationMs:1000,outputTokens:12,throughput:10,completed:0,failed:1,reasoningSetting:off},{id:'off1',runId:'r',modelKey:'fixture',testId:'q',concurrency:1,durationMs:1000,outputTokens:12,throughput:10,completed:1,failed:0,reasoningSetting:off},{id:'budget-20480',runId:'r',modelKey:'fixture',testId:'q',concurrency:1,durationMs:1000,outputTokens:12,throughput:20,completed:1,failed:0,reasoningSetting:budget},{id:'budget-20481',runId:'r',modelKey:'fixture',testId:'q',concurrency:1,durationMs:1000,outputTokens:12,throughput:20,completed:1,failed:0,reasoningSetting:budget}],
  modelInfo:{'reasoning:fixture':{baselineId:'off',settings:[off,budget],unsupported:[{id:'unlimited',kind:'unlimited'}]}},environment:{},logs:[]};
}

test('reasoning measurements and history retain settings and exclude replaced failures',()=>{
 const fixture=run(),rows=summaries(fixture),history=historyRows([fixture],{});
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(r=>[r.reasoningSettingId,r.requests,r.failures,r.objective,r.throughput]),[['off',2,1,0,10],['budget-2048',2,0,50,20]]);
 assert.deepEqual(history.map(r=>[r.reasoning,r.objectiveCount,r.durationsMs.length]),[['No reasoning',2,1],['2,048 thinking tokens',2,2]]);
 for(const by of ['model','family','kind','size','sizeBucket','quantTier','quantization','benchmark','backend','mtpSettings','none'] as GroupBy[]){
  const groups=groupHistory(history,{...defaultHistoryView,groupBy:by});
  assert.equal(groups.length,2,by+' must preserve reasoning settings');
  assert.equal(groups.reduce((n,g)=>n+g.requests,0),4);
 }
 assert.notEqual(chartSeriesKey(rows[0]),chartSeriesKey(rows[1]));
});

test('reasoning CSV and Markdown export per-setting accuracy, deltas, repeats and provenance',()=>{
 const fixture=run(),csv=exportText(fixture,'csv'),md=exportText(fixture,'md');
 assert.equal(csv.split('\r\n').length,3,'one aggregate row per setting');
 for(const name of ['accuracy','delta','baselineId','repeatScores','controls','reasoningCoverage'])assert.ok(csv.includes('"'+name+'"'),name);
 assert.ok(csv.includes('fixture control'));
 assert.ok(md.includes('50.00% (1/2 correct)'));
 assert.ok(md.includes('+50.00 percentage points'));
 assert.ok(md.includes('repeat 2: 0.00%'));
 assert.ok(md.includes('1/2 reported'));
 assert.ok(md.includes('Reasoning setting: 2,048 thinking tokens; repeat 1'));
 assert.ok(md.includes('Acceptance alone does not prove enforcement'));
 assert.ok(md.includes('Unsupported settings (not attempted)'));
 assert.ok(md.includes('Unlimited'));
 assert.ok(benchmarkReport(fixture).includes('saved-hash'));
});

test('offline HTML reasoning report charts settings and escapes paired final answers',()=>{
 const html=chartReport(run());
 assert.ok(html.includes('Objective accuracy by reasoning setting'));
 assert.ok(html.includes('Selected reasoning setting'));
 assert.ok(html.includes('Final answer comparison'));
 assert.ok(html.includes('changed answer'));
 assert.ok(html.includes('Reasoning output'));
 assert.ok(html.includes('&lt;script&gt;answer&lt;/script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.ok(!/NaN|Infinity/.test(html));
 assert.ok(html.includes("default-src 'none'"));
});

test('saved JSON round trip retains removed-pack metadata and retry reports remain subsets',()=>{
 const fixture=run(),restored=JSON.parse(exportText(fixture,'json')) as Run;
 assert.equal(restored.tests[0].benchmark?.protocol,'saved-scoring-protocol');
 assert.equal(restored.samples.find(s=>s.id==='retry')?.reasoningControl?.confirmation,'requested');
 assert.equal(reasoningSummaries(restored).find(r=>r.setting.id===budget.id)?.delta,50);
 restored.config.retryOf='prior-run';
 assert.ok(exportText(restored,'md').includes('Retry subset; full comparison not implied'));
 assert.ok(benchmarkReport(restored).includes(' | retry subset | '));
 restored.status='cancelled';
 assert.ok(exportText(restored,'md').includes('scores are provisional'));
});

test('effort fallback baseline uses lowest effort rather than server option order',()=>{
 const resolved=resolveReasoningSettings({key:'m',capabilities:{reasoning:{allowed_options:['high','medium','low'],default:'high'}}} as import('../src/types').Model,{settings:[off,budget],baselineId:'off'});
 assert.equal(resolved.baselineId,'effort-low');
});

test('undefined legacy usage does not count as reported coverage',()=>{
 const fixture=run();
 const original=fixture.samples.find(s=>s.id==='retry')!;
 original.metrics.reasoningTokens=undefined as unknown as null;
 original.metrics.outputTokens=undefined as unknown as null;
 const row=reasoningSummaries(fixture).find(r=>r.setting.id===budget.id)!;
 assert.equal(row.reasoningTokens,null);
 assert.equal(row.reasoningCoverage,0);
 assert.equal(row.outputCoverage,1);
 assert.ok(exportText(fixture,'md').includes('Mean reasoning tokens: Unavailable (0/2 reported)'));
});

test('reports distinguish new unbounded runs and saved legacy limits and show actual stop reasons',()=>{
 const fixture=run();fixture.config.reasoningComparison!.unlimitedPolicy='unbounded';fixture.config.reasoningComparison!.stopAfterConsecutiveMisses=2;
 fixture.modelInfo['reasoning-stop:fixture:off']={modelKey:'fixture',settingId:'off',attempted:2,correct:0,consecutiveMisses:2,threshold:2,reason:'consecutive-misses'};
 const md=exportText(fixture,'md'),html=chartReport(fixture),csv=exportText(fixture,'csv');
 assert.match(md,/no app thinking, output-token, or request-time limit/);assert.match(md,/Stopped after 2 consecutive mistakes at attempt 2/);assert.match(html,/Stop condition/);assert.match(csv,/consecutive-misses/);
 delete fixture.config.reasoningComparison!.unlimitedPolicy;assert.match(exportText(fixture,'md'),/Legacy Unlimited removes the thinking cap only/);
});
