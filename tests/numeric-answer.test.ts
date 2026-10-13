import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildPack} from '../src/benchmark-import';
import {objectiveScore} from '../electron/scoring';
import {validateTest} from '../electron/validation';
import {finalNumber} from '../electron/benchmark-scoring';
import {numericAnswerKey} from '../src/numeric-answer';
const imported=(answer:string)=>buildPack({name:'Numbers',scoring:'final-number',instruction:''},[{id:'q',prompt:'Return the answer.',answer,rubric:''}],'numbers.json',s=>createHash('sha256').update(s).digest('hex'),'2026-10-09').tests[0];

test('exact numeric keys normalize formatting without rounding or underflow',()=>{
 for(const group of [['1200','1,200','+1200.00','12e2'],['-0','0','0.000','0e-500'],['-2.50','-25e-1']]){
  const key=numericAnswerKey(group[0]);
  assert.notEqual(key,null);
  for(const value of group)assert.equal(numericAnswerKey(value),key,value);
 }
 for(const invalid of ['', 'NaN','Infinity','1,2','0x10','1e','42 or 43'])assert.equal(numericAnswerKey(invalid),null,invalid);
 assert.notEqual(numericAnswerKey('1e-500'),numericAnswerKey('0'));
 assert.notEqual(numericAnswerKey('1.00000000000000001'),numericAnswerKey('1'));
});

test('final-number import preserves large integers and never rewards their rounded neighbor',()=>{
 const question=imported('9007199254740993');
 assert.equal(question.rules[0].expected,'9007199254740993');
 validateTest(question);
 assert.equal(objectiveScore('9007199254740992',question).score,0);
 assert.equal(objectiveScore('9007199254740993',question).score,100);
});

test('scientific notation round-trips through final-number import and grading',()=>{
 assert.equal(finalNumber('Work\n#### 1e-7'),0.0000001);
 for(const answer of ['1e-7','-2.5E+3','0.0000001']){
  const question=imported(answer);
  validateTest(question);
  assert.equal(objectiveScore(answer,question).score,100,answer);
 }
 const question=imported('1e-7');
 assert.equal(objectiveScore('0.0000001',question).score,100);
 assert.equal(objectiveScore('#### 1E-7',question).score,100);
 assert.equal(objectiveScore('2e-7',question).score,0);
 assert.equal(objectiveScore('The answer is 1e-7',question).score,0);
});
