import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateLmsPath} from '../electron/lmstudio';

test('CLI paths accept the platform executable and refuse URLs, relative paths and traversal',()=>{
 assert.doesNotThrow(()=>validateLmsPath(''));
 const valid=process.platform==='win32'?'C:\\LM Studio\\lms.exe':'/home/test/.lmstudio/bin/lms';
 assert.doesNotThrow(()=>validateLmsPath(valid));
 for(const invalid of ['lms','https://example.com/lms','\\\\server\\share\\lms.exe','bad\npath',
  process.platform==='win32'?'C:\\models\\..\\lms.exe':'/home/test/../bin/lms',
  process.platform==='win32'?'C:\\models\\model.gguf':'/usr/bin/sh']){
  assert.throws(()=>validateLmsPath(invalid),invalid);
 }
});
