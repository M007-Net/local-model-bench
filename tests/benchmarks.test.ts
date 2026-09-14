import {test} from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkPacks,selectBenchmark,benchmarkConfig,benchmarkRows,sameBenchmarkQuestions,interpretScore,describeMeta} from '../src/benchmarks';
import {benchmarkReport} from '../electron/benchmark-report';
import {chartReport} from '../electron/chart-report';
import {exportText} from '../electron/export';
import {defaultConfig} from '../src/defaults';
import {objectiveScore} from '../electron/scoring';
import {checkInstruction,finalNumber} from '../electron/benchmark-scoring';
import {validateTest,validateConfig} from '../electron/validation';
import type {Run,Sample} from '../src/types';
test('published numerical and code keys all pass their objective checker',()=>{assert.deepEqual(benchmarkPacks.map(p=>p.count),[1319,205,750]);for(const p of benchmarkPacks)for(const t of p.tests){validateTest(t);assert.equal(t.benchmark?.datasetHash.length,64);if(p.id!=='ifeval'){assert.equal(objectiveScore(t.answerKey,t).score,100,t.id);assert.equal(objectiveScore('wrong',t).score,0,t.id);}}});
test('seeded samples are repeatable, unique, nested and isolated copies',()=>{const a=selectBenchmark({packId:'gsm8k',count:10,seed:42});assert.deepEqual(a,selectBenchmark({packId:'gsm8k',count:25,seed:42}).slice(0,10));assert.equal(new Set(a.map(t=>t.id)).size,10);assert.notDeepEqual(a,selectBenchmark({packId:'gsm8k',count:10,seed:43}));a[0].prompt='changed';assert.notEqual(selectBenchmark({packId:'gsm8k',count:10,seed:42})[0].prompt,'changed');});
test('numeric scoring requires a final answer, not a number buried in prose',()=>{assert.equal(finalNumber('Working\n#### -1,200.5'),-1200.5);for(const s of ['answer is 42','42 or 43','42\nnot sure','NaN','1,2',''])assert.equal(finalNumber(s),null);});
const cases:[string,Record<string,unknown>,string,string][]=[
 ['punctuation:no_comma',{},'Hello world','Hello, world'],
 ['detectable_format:number_bullet_lists',{num_bullets:2},'- one\n- two','- one'],
 ['detectable_format:json_format',{},'```json\n{"x":1}\n```','{"x":}'],
 ['keywords:existence',{keywords:['cat','dog']},'CAT and dog','cat'],
 ['keywords:frequency',{keyword:'cat',frequency:2,relation:'at least'},'cat cat','cat'],
 ['keywords:forbidden_words',{forbidden_words:['cat']},'category','a cat'],
 ['combination:two_responses',{},'first******second','first******first'],
 ['combination:repeat_prompt',{prompt_to_repeat:'Hello'},'hello there','say hello'],
 ['startend:end_checker',{end_phrase:'Done'},'All done','Done now'],
 ['detectable_format:title',{},'<<Title>>\nBody','<< >>'],
 ['startend:quotation',{},'"Hello"','Hello']
];
for(const [kind,args,yes,no] of cases)test(`IFEval positive and negative: ${kind}`,()=>{assert.equal(checkInstruction(yes,{kind,args}),true);assert.equal(checkInstruction(no,{kind,args}),false);assert.equal(checkInstruction('',{kind,args}),false);});
test('benchmark configuration validates pack size and seed',()=>{const c=benchmarkConfig({...defaultConfig,modelKeys:['m']},{packId:'gsm8k',count:10,seed:42},'GSM8K');validateConfig(c);assert.throws(()=>validateConfig({...c,mode:'performance'}));for(const count of [0,1320,1.2])assert.throws(()=>selectBenchmark({packId:'gsm8k',count,seed:42}));assert.throws(()=>selectBenchmark({packId:'gsm8k',count:1,seed:-1}));});
test('aggregate counts failures as misses and excludes warmups; signatures reject changed checks',()=>{const tests=selectBenchmark({packId:'gsm8k',count:2,seed:42});const sample=(status:string,score:number,warmup=false)=>({testId:tests[0].id,modelKey:'m',concurrency:1,status,objective:{score},warmup} as Sample);const r:Run={id:'r',created:'',updated:'',status:'completed',config:{...defaultConfig,modelKeys:['m'],concurrency:[1],waves:1},tests,samples:[sample('completed',100),sample('failed',0),sample('completed',100,true)],waves:[],modelInfo:{},environment:{},logs:[]};assert.equal(benchmarkRows(r)[0].score,50);assert.equal(benchmarkRows(r)[0].provisional,false);assert.equal(benchmarkRows({...r,samples:[]})[0].score,null);assert.equal(benchmarkRows({...r,status:'running'})[0].provisional,true);const other=structuredClone(r);assert.ok(sameBenchmarkQuestions(r,other));other.tests[0].rules[0].expected='999';assert.ok(!sameBenchmarkQuestions(r,other));assert.equal(interpretScore(49.9999)?.min,0);assert.equal(interpretScore(100)?.min,100);assert.equal(interpretScore(null),null);});
// A pack the user imported has no hand-written description, and a report is written from
// the saved run rather than from the installed packs, so this used to throw and take the
// HTML and Markdown exports with it.
test('a report describes an imported or deleted pack instead of crashing on it',()=>{
 const meta={packId:'custom-abcdef0123456789',itemId:'q7',datasetHash:'d'.repeat(64),protocol:'Imported questions; final-number scoring.'};
 const t={id:'t1',name:'My questions \u00b7 q7',category:'Benchmark',version:1,prompt:'p',answerKey:'7',rubric:'',maxTokens:64,rules:[],kind:'quality' as const,benchmark:meta};
 const run:Run={id:'r',created:'now',updated:'now',status:'completed',
  config:{...defaultConfig,name:'My questions',modelKeys:['m'],concurrency:[1],waves:1,benchmark:{packId:meta.packId,count:1,seed:1}},
  tests:[t],modelInfo:{},environment:{},logs:[],samples:[],waves:[]};
 const report=benchmarkReport(run);
 assert.match(report,/^My questions \u2014 benchmark meaning/);
 assert.match(report,/imported rather than published/);
 assert.ok(!report.includes('undefined'));
 const html=chartReport(run);
 assert.match(html,/Content-Security-Policy/);
 assert.ok(!html.includes('<script'));
 assert.match(exportText(run,'md'),/My questions/);
 // Published packs keep their curated wording.
 assert.equal(describeMeta({packId:'gsm8k',itemId:'x',datasetHash:'',protocol:''}).name,'GSM8K');
});
// A grader that cannot evaluate a rule is not the model answering wrongly. Counting it as
// a miss silently lowered the score with nothing in the number to show it.
test('an unscorable check is excluded from the score rather than counted as a failure',()=>{
 const rule=(id:string,type:string,expected:string)=>({id,label:id,type,expected,weight:1} as any);
 const base={id:'t',name:'t',category:'c',version:1,prompt:'p',answerKey:'',rubric:'',maxTokens:32,kind:'quality' as const};
 const supported=JSON.stringify([{kind:'punctuation:no_comma',args:{}}]);
 const unknown=JSON.stringify([{kind:'length_constraints:number_words',args:{num_words:5}}]);
 const both={...base,rules:[rule('a','ifeval',supported),rule('b','ifeval',unknown)]};
 const scored=objectiveScore('no commas here',both);
 assert.equal(scored.score,100,'the one rule this build can score passed, so the score is 100');
 assert.equal(scored.checks.find(c=>c.id==='b')?.unscorable,true);
 assert.equal(scored.checks.find(c=>c.id==='a')?.unscorable,undefined);
 // Every rule unscorable means no score at all, not zero.
 assert.equal(objectiveScore('x',{...base,rules:[rule('b','ifeval',unknown)]}).score,null);
 // A response that is simply not JSON is still a real miss, not an unscorable check.
 const notJson=objectiveScore('plain prose',{...base,rules:[rule('j','json','')]});
 assert.equal(notJson.score,0);
 assert.equal(notJson.checks[0].unscorable,undefined);
 // And an unsupported kind is refused while the test is being written.
 assert.throws(()=>validateTest({...both,rules:[rule('b','ifeval',unknown)]} as any),/cannot score these instruction checks/);
});
// Keywords are literal words. Compiled raw, one like "(a+)+$" backtracks forever on the
// worker thread, where cancelling cannot interrupt it.
test('instruction keywords are matched literally, so a pattern cannot hang the grader',()=>{
 const value='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!';
 const started=Date.now();
 assert.equal(checkInstruction(value,{kind:'keywords:forbidden_words',args:{forbidden_words:['(a+)+$']}}),true,'a literal "(a+)+$" does not occur in the text');
 assert.equal(checkInstruction('say (a+)+$ here',{kind:'keywords:existence',args:{keywords:['(a+)+$']}}),true);
 assert.ok(Date.now()-started<1000,'matching must not backtrack');
 assert.throws(()=>checkInstruction(value,{kind:'keywords:existence',args:{keywords:[]}}),/non-empty list/);
});
