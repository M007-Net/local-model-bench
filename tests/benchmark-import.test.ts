import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildPack,defaultInstruction,maxPackItems,parseDelimited,parsePackFile,scoringModes,suggestScoring,validateDraft,type PackDraft,type PackItem} from '../src/benchmark-import';
import {describePack,removedPackSummary,selectBenchmark,summaryFor,validateBenchmark,builtInPacks} from '../src/benchmarks';
import {objectiveScore} from '../electron/scoring';
import {Store} from '../electron/store';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const items=(n=3):PackItem[]=>Array.from({length:n},(_,i)=>({id:String(i),prompt:`Question ${i}`,answer:String(i*2),rubric:''}));
const draft=(patch:Partial<PackDraft>={}):PackDraft=>({name:'My set',scoring:'exact',instruction:'',...patch});
const pack=(patch:Partial<PackDraft>={},list=items())=>buildPack(draft(patch),list,'my-set.csv',hash,'2026-09-14T00:00:00.000Z');
test('a CSV is read as a CSV, not split on commas',()=>{
 assert.deepEqual(parseDelimited('a,b\n1,2\n',','),[['a','b'],['1','2']]);
 assert.deepEqual(parseDelimited('prompt,answer\n"Costs $3, then $4","7"\n',','),[['prompt','answer'],['Costs $3, then $4','7']]);
 assert.deepEqual(parseDelimited('prompt,answer\n"He said ""hi""",2\n',','),[['prompt','answer'],['He said "hi"','2']]);
 assert.deepEqual(parseDelimited('prompt,answer\n"line one\nline two",5\n',','),[['prompt','answer'],['line one\nline two','5']]);
});
test('questions are read from JSON, JSON Lines, CSV, and TSV alike',()=>{
 const expected=[{id:'0',prompt:'What is 2+2?',answer:'4',rubric:''}];
 assert.deepEqual(parsePackFile('[{"prompt":"What is 2+2?","answer":"4"}]','a.json'),expected);
 assert.deepEqual(parsePackFile('{"items":[{"prompt":"What is 2+2?","answer":"4"}]}','a.json'),expected);
 assert.deepEqual(parsePackFile('{"prompt":"What is 2+2?","answer":"4"}','a.jsonl'),expected);
 assert.deepEqual(parsePackFile('prompt,answer\nWhat is 2+2?,4\n','a.csv'),expected);
 assert.deepEqual(parsePackFile('prompt\tanswer\nWhat is 2+2?\t4\n','a.tsv'),expected);
 // The names a question file actually arrives with, and an id and rubric are kept when present.
 assert.deepEqual(parsePackFile('question,expected,id,rubric\nWhat is 2+2?,4,q7,Check the arithmetic\n','a.csv'),
  [{id:'q7',prompt:'What is 2+2?',answer:'4',rubric:'Check the arithmetic'}]);
 assert.deepEqual(parsePackFile('[{"input":"x","target":"y"}]','a.json')[0].prompt,'x');
});
test('a file that cannot be read says what is wrong with it',()=>{
 assert.throws(()=>parsePackFile('   ','a.json'),/empty/);
 assert.throws(()=>parsePackFile('[]','a.json'),/No questions/);
 assert.throws(()=>parsePackFile('{"nope":1}','a.json'),/array of questions/);
 assert.throws(()=>parsePackFile('{"prompt":"a","answer":"b"}\nnot json','a.jsonl'),/line 2/);
 assert.throws(()=>parsePackFile('[{"answer":"4"}]','a.json'),/Question 1 has no prompt/);
 assert.throws(()=>parsePackFile('[{"prompt":"x"}]','a.json'),/Question 1 has no answer/);
 assert.throws(()=>parsePackFile('[{"prompt":"x","answer":"1","id":"a"},{"prompt":"y","answer":"2","id":"a"}]','a.json'),/share the id/);
 assert.throws(()=>parsePackFile('prompt,answer\n','a.csv'),/header row/);
 assert.throws(()=>parsePackFile(JSON.stringify(Array.from({length:maxPackItems+1},()=>({prompt:'p',answer:'a'}))),'a.json'),/limit is/);
 assert.throws(()=>parsePackFile(JSON.stringify([{prompt:'x'.repeat(20001),answer:'1'}]),'a.json'),/prompt longer than/);
});
test('all-numeric answers suggest final-number scoring, anything else does not',()=>{
 assert.equal(suggestScoring(items()),'final-number');
 assert.equal(suggestScoring([{id:'0',prompt:'p',answer:'Paris',rubric:''}]),'exact');
 assert.equal(suggestScoring([]),'exact');
 assert.equal(defaultInstruction.contains,'','contains scoring needs no instruction to be answerable');
});
test('a draft is refused before anything is stored',()=>{
 assert.throws(()=>validateDraft(draft({name:'   '}),items()),/Give the pack a name/);
 assert.throws(()=>validateDraft(draft({name:'x'.repeat(81)}),items()),/at most 80/);
 assert.throws(()=>validateDraft(draft({scoring:'vibes' as never}),items()),/how the answers should be scored/);
 assert.throws(()=>validateDraft(draft(),[]),/at least one question/);
 assert.throws(()=>validateDraft(draft({scoring:'final-number'}),[{id:'0',prompt:'p',answer:'Paris',rubric:''}]),/every answer to be a number/);
 assert.deepEqual(validateDraft(draft({name:'  Trimmed  '}),items()).name,'Trimmed');
});
test('an imported pack is shaped exactly like a published one',()=>{
 const built=pack({name:'My set',scoring:'final-number',instruction:'Answer with the number.'});
 assert.equal(built.count,3);
 assert.equal(built.originalCount,3);
 assert.ok(built.id.startsWith('custom-'));
 assert.equal(built.custom,true);
 assert.equal(built.tests.length,3);
 const [first]=built.tests;
 assert.equal(first.prompt,'Question 0\n\nAnswer with the number.','the added instruction is part of the prompt that is actually sent');
 assert.equal(first.answerKey,'0');
 assert.equal(first.kind,'quality');
 assert.deepEqual(first.benchmark,{packId:built.id,itemId:'0',datasetHash:built.datasetHash,protocol:built.protocol});
 assert.deepEqual(first.rules,[{id:'final-answer',label:'Correct final numeric answer',type:'final-number',expected:'0',weight:1}]);
 // The same seeded selection a published pack gets, over the packs the app actually knows about.
 assert.equal(selectBenchmark({packId:built.id,count:2,seed:42},[...builtInPacks,built]).length,2);
 assert.deepEqual(selectBenchmark({packId:built.id,count:2,seed:42},[built]),selectBenchmark({packId:built.id,count:2,seed:42},[built]));
 assert.throws(()=>validateBenchmark({packId:built.id,count:4,seed:42},[built]),/between 1 and 3/);
 assert.throws(()=>validateBenchmark({packId:built.id,count:1,seed:0},builtInPacks),/available benchmark pack/,'an imported pack is not reachable unless it is passed in');
});
test('identity follows the questions, and the name distinguishes two packs built from them',()=>{
 const a=pack({name:'Set A'}),b=pack({name:'Set B'}),again=pack({name:'Set A'});
 assert.equal(a.datasetHash,b.datasetHash,'the same questions are the same questions');
 assert.notEqual(a.id,b.id,'a differently named import does not overwrite one you still use');
 assert.equal(a.id,again.id,'re-importing the same file the same way replaces it rather than duplicating it');
 assert.notEqual(pack({name:'Set A',scoring:'contains'}).id,a.id,'changing the scoring makes a different pack');
 assert.notEqual(pack({name:'Set A'},items(4)).datasetHash,a.datasetHash);
});
test('each scoring mode actually scores a model response',()=>{
 const numeric=pack({name:'N',scoring:'final-number'},[{id:'0',prompt:'2+2?',answer:'4',rubric:''}]).tests[0];
 assert.equal(objectiveScore(`Two plus two.
4`,numeric).score,100,'a worked answer passes on the number it ends with');
 assert.equal(objectiveScore('#### 4',numeric).score,100);
 assert.equal(objectiveScore('4',numeric).score,100);
 assert.equal(objectiveScore('The answer is 5',numeric).score,0);
 assert.equal(objectiveScore('I am not sure',numeric).score,0);
 // The checker wants the number alone on the last line, which is exactly why final-number scoring appends an
 // instruction saying so rather than hoping the model happens to answer that way.
 assert.equal(objectiveScore('Let me think. 2 plus 2 is 4',numeric).score,0);
 assert.ok(defaultInstruction['final-number'].includes('own line'));
 const exact=pack({name:'E',scoring:'exact'},[{id:'0',prompt:'Capital?',answer:'Paris',rubric:''}]).tests[0];
 assert.equal(objectiveScore('Paris',exact).score,100);
 assert.equal(objectiveScore('  Paris  ',exact).score,100,'surrounding whitespace is not a wrong answer');
 assert.equal(objectiveScore('The capital is Paris.',exact).score,0);
 const loose=pack({name:'C',scoring:'contains'},[{id:'0',prompt:'Capital?',answer:'Paris',rubric:''}]).tests[0];
 assert.equal(objectiveScore('The capital is paris.',loose).score,100,'contains ignores case');
 assert.equal(objectiveScore('The capital is Lyon.',loose).score,0);
});
test('a pack describes itself, and a deleted one still explains a saved run',()=>{
 const built=pack({name:'My set',scoring:'contains',instruction:''});
 const summary=describePack(built);
 assert.equal(summary.custom,true);
 assert.equal(summary.name,'My set');
 assert.ok(summary.protocol.includes('my-set.csv'));
 assert.ok(summary.protocol.includes('nothing appended'));
 assert.ok(describePack(pack({name:'X',instruction:'Answer only.'})).protocol.includes('Answer only.'));
 assert.equal(describePack(builtInPacks[0]).custom,false,'a published pack keeps its written description');
 assert.equal(summaryFor(built.id,[summary]).name,'My set');
 assert.equal(summaryFor('gone',[summary]).name,'Removed benchmark');
 assert.equal(removedPackSummary('gone').custom,true);
});
test('imported packs survive a reopen and can be removed without touching runs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lmb-packs-')),file=path.join(dir,'bench.sqlite');
 try{
  const built=pack({name:'My set'});
  let store=new Store(file);
  store.saveRun({id:'r1',created:'',updated:'',status:'completed',config:{}as never,tests:built.tests,modelInfo:{},environment:{},logs:[],samples:[],waves:[]});
  store.savePack(built);store.close();
  store=new Store(file);
  assert.equal(store.packs().length,1);
  assert.equal(store.packs()[0].tests.length,3,'the questions are stored with the pack, not rebuilt from the file');
  store.deletePack(built.id);
  assert.equal(store.packs().length,0);
  assert.equal(store.getRun('r1').tests.length,3,'a saved run keeps every question it asked after its pack is gone');
  store.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('scoring modes are the ones the objective checker implements',()=>{
 assert.deepEqual(Object.keys(scoringModes),['final-number','exact','contains']);
});
