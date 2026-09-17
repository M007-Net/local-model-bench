import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maxCliErrorChars,readableCliError} from '../electron/cli-output';
const ESC='\u001B';
// Shaped exactly like what `lms load` actually produced when a Gemma 4 MTP head could not be
// loaded: the failure block once per stream, separated by a minute of repainted progress
// frames, each wrapped in cursor-hide and colour codes.
const frames=Array.from({length:120},(_,i)=>`${ESC}[?25lLoading gemma-4-12b-it@q8_k_xl ${i}% ${'⠋⠙⠹⠸'[i%4]}`).join('');
const block='Error: Failed to load model. \n\n\n   (X) CAUSE  \n\nfailed to load draft model, \'C:\\Users\\mwwood\\.lmstudio\\models\\unsloth\\gemma-4-12b-it-GGUF\\MTP\\mtp-gemma-4-12b-it-Q8_0.gguf\': error loading model: invalid vector subscript\n';
const real=`Command failed: C:\\Users\\mwwood\\.lmstudio\\bin\\lms.exe load gemma-4-12b-it@q8_k_xl --identifier lmb-1 --context-length 32768 --parallel 4 --yes\n${block}\n${block}\n${frames}${ESC}[K${ESC}[?25h`;
test('the one line that explains a failed load survives the progress bar',()=>{
 const out=readableCliError(real);
 assert.ok(out.includes('invalid vector subscript'),'the cause has to survive');
 assert.ok(out.includes('mtp-gemma-4-12b-it-Q8_0.gguf'),'so does the file it names');
 assert.ok(out.includes('Cause:'),'the marker is rewritten into something readable');
 assert.ok(out.includes('lms.exe load gemma-4-12b-it@q8_k_xl'),'and the command that was run');
});
test('nothing unreadable is left behind',()=>{
 const out=readableCliError(real);
 assert.ok(!out.includes(ESC),'no escape sequences');
 assert.ok(!/Loading .*\d+%/.test(out),'no progress repaints');
 assert.ok(!/⠋|⠙|⠹|⠸/.test(out),'no spinner glyphs');
 assert.ok(!out.includes('(X)'),'no stray marker');
 assert.ok(!/\n/.test(out),'one line, so a log entry stays one log entry');
 assert.ok(!/ {2}/.test(out),'no runs of padding');
});
test('a failure block printed on both streams is reported once',()=>{
 const out=readableCliError(real);
 assert.equal(out.split('invalid vector subscript').length-1,1);
 assert.equal(out.split('Failed to load model').length-1,1);
 // 120 repaint frames and a doubled block collapse to something a person reads at a glance.
 assert.ok(real.length>4000&&out.length<400,`expected a short line, got ${out.length} from ${real.length}`);
});
test('an error that was already readable is left alone',()=>{
 assert.equal(readableCliError('Model not found: nope@q4'),'Model not found: nope@q4');
 assert.equal(readableCliError(''),'');
 assert.equal(readableCliError(null as unknown as string),'');
 assert.equal(readableCliError(undefined as unknown as string),'');
});
test('a pathological stream cannot fill the database',()=>{
 const huge=readableCliError(Array.from({length:5000},(_,i)=>`distinct failure line ${i}`).join('\n'));
 assert.ok(huge.length<=maxCliErrorChars,`expected a capped string, got ${huge.length}`);
 assert.ok(huge.endsWith('…'),'a truncated message says it was truncated');
});
