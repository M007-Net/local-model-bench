import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unfence} from '../electron/json-answer';
import {objectiveScore} from '../electron/scoring';
import {starterTests} from '../src/defaults';
import type {TestCase} from '../src/types';

// These two prompts ask for "JSON only" and never mention fences, so they opt in.
const subnet={...starterTests.find(t=>t.id==='subnet')!,allowCodeFence:true} as TestCase;
const extract={...starterTests.find(t=>t.id==='json-extract')!,allowCodeFence:true} as TestCase;
// The exact replies Gemma 4 26B A4B gave, which scored 0 and 20.
const FENCED_SUBNET='```json\n{\n  "network": "192.168.10.64",\n  "broadcast": "192.168.10.95",\n  "first_host": "192.168.10.65",\n  "last_host": "192.168.10.94",\n  "usable_hosts": 30\n}\n```';
const FENCED_EXTRACT='```json\n{\n  "service": "inventory API",\n  "duration_minutes": 18,\n  "cause": "failed database migration",\n  "data_loss": false\n}\n```';

test('a correct answer inside a code fence now scores as correct',()=>{
 const s=objectiveScore(FENCED_SUBNET,subnet);
 assert.equal(s.score,100,'every subnet value was right; the fence was the only thing wrong');
 assert.ok(s.checks.every(c=>c.passed));
 assert.match(s.checks.find(c=>c.id==='json')!.detail,/code fence/,'the unwrapping is stated, not silent');
 assert.equal(objectiveScore(FENCED_EXTRACT,extract).score,100);
});

test('unfenced JSON is unaffected',()=>{
 const plain='{"network":"192.168.10.64","broadcast":"192.168.10.95","first_host":"192.168.10.65","last_host":"192.168.10.94","usable_hosts":30}';
 const s=objectiveScore(plain,subnet);
 assert.equal(s.score,100);
 assert.doesNotMatch(s.checks.find(c=>c.id==='json')!.detail,/code fence/);
});

test('prose around the JSON is still a failure',()=>{
 // A fence is markup around the answer; a sentence before it is not the same thing.
 assert.notEqual(objectiveScore('Here is the JSON:\n'+FENCED_SUBNET,subnet).score,100);
 assert.notEqual(objectiveScore('The network is 192.168.10.64.',subnet).score,100);
});

test('unfence only unwraps a single complete fence',()=>{
 assert.deepEqual(unfence('{"a":1}'),{json:'{"a":1}',fenced:false});
 assert.deepEqual(unfence('```json\n{"a":1}\n```'),{json:'{"a":1}',fenced:true});
 assert.deepEqual(unfence('```\n{"a":1}\n```'),{json:'{"a":1}',fenced:true},'a fence with no language still unwraps');
 // Never closed: left alone rather than half-stripped into something that parses by accident.
 assert.equal(unfence('```json\n{"a":1}').fenced,false);
 // Two blocks are prose containing code, not one wrapped answer.
 assert.equal(unfence('```\n{"a":1}\n```\n```\n{"b":2}\n```').fenced,false);
});

// A prompt that forbids fences — the accounting pack says "no prose or code fences" — keeps failing
// them, because there the fence is the instruction being tested.
test('a test that did not opt in still rejects a fence',()=>{
 const strict={...subnet,allowCodeFence:false} as TestCase;
 assert.equal(objectiveScore(FENCED_SUBNET,strict).score,0);
});

test('a wrong answer is still wrong once unfenced',()=>{
 const wrong='```json\n{"network":"10.0.0.0","broadcast":"10.0.0.255","first_host":"10.0.0.1","last_host":"10.0.0.254","usable_hosts":254}\n```';
 const s=objectiveScore(wrong,subnet);
 assert.ok(s.score!==null&&s.score<100,'unwrapping the fence does not make a wrong answer right');
 assert.ok(s.checks.find(c=>c.id==='json')!.passed,'…though it is at least valid JSON now');
});
