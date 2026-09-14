import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=fs.mkdtempSync(path.resolve('work/upgrade-'));
const db=new DatabaseSync(path.join(dir,'bench.sqlite'));
db.exec('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE tests(id TEXT PRIMARY KEY,doc TEXT NOT NULL);');
db.prepare('INSERT INTO kv VALUES (?,?)').run('seeded','true');
const custom={id:'accounting-cash-capital',name:'Preserve my custom accounting case',category:'Accounting',version:7,prompt:'Custom prompt',answerKey:'5',rules:[],rubric:'Custom rubric',kind:'quality',maxTokens:128};
db.prepare('INSERT INTO tests VALUES (?,?)').run(custom.id,JSON.stringify(custom));db.close();
const launch=()=>electron.launch({executablePath:path.resolve('outputs/win-unpacked/Local Model Bench.exe'),args:[],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
let app=await launch();try{
 let page=await app.firstWindow();await page.getByRole('heading',{name:'Your models. Real numbers.'}).waitFor();
 let s=await page.evaluate(()=>window.bench.snapshot());assert.equal(s.tests.filter(t=>t.category==='Accounting').length,12);assert.deepEqual(s.tests.find(t=>t.id===custom.id),custom);
 await page.evaluate(()=>window.bench.deleteTest('accounting-supplies'));
 await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('heading',{name:'Your models. Real numbers.'}).waitFor();
 s=await page.evaluate(()=>window.bench.snapshot());assert.equal(s.tests.filter(t=>t.category==='Accounting').length,11);assert.ok(!s.tests.some(t=>t.id==='accounting-supplies'));assert.deepEqual(s.tests.find(t=>t.id===custom.id),custom);
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'1.5.0');
 fs.writeFileSync('work/accounting-mtp-ui/upgrade-result.json',JSON.stringify({passed:true,packagedVersion:'1.5.0',customTestPreserved:true,deletedTestRemainsDeleted:true},null,2));
 console.log('Packaged 1.5.0 upgrade preserves customized tests and does not restore deleted accounting tests.');
}finally{await app.close();}
