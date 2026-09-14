import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=path.resolve('work/benchmark-ui'),data=path.join(dir,'data');
const original=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
// Isolated QA fixtures only; never add fabricated scores to the user's history.
const db=new DatabaseSync(path.join(data,'bench.sqlite'));
for(const [id,changed] of [['qa-current',false],['qa-same',false],['qa-different',true]]){
 const run=structuredClone(original);run.id=id;run.config.name=id;run.status='completed';if(changed)run.tests[0].rules[0].expected='invalid-fixture';
 const {samples,waves,...doc}=run;db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(id,JSON.stringify(doc));
 for(const s of samples){s.runId=id;s.id=id+s.id;db.prepare('INSERT OR REPLACE INTO samples VALUES (?,?,?)').run(s.id,id,JSON.stringify(s));}
}db.close();
const app=await electron.launch({executablePath:path.join(process.env.LOCALAPPDATA,'Programs/Local Model Bench/Local Model Bench.exe'),args:[],env:{...process.env,LMB_DATA_DIR:data},timeout:60000});
try{
 assert.equal(await app.evaluate(({app})=>app.getVersion()),'1.6.0');
 const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Results',exact:true}).click();
 await page.getByLabel('Saved run',{exact:true}).selectOption('qa-current');
 await page.getByRole('heading',{name:'GSM8K scores',exact:true}).waitFor();
 await page.locator('.benchmark-card').first().click();
 await page.getByRole('heading',{name:'Benchmark meaning',exact:true}).waitFor();
 await page.getByLabel('Compare with a saved benchmark run').selectOption('qa-same');
 await page.getByText('Same questions and scoring protocol.',{exact:false}).waitFor();
 await page.getByLabel('Compare with a saved benchmark run').selectOption('qa-different');
 await page.getByText('Different questions or scoring protocol.',{exact:false}).waitFor();
 await page.screenshot({path:path.join(dir,'benchmark-results.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Installed 1.6.0: result interpretation and comparison guards passed');
}finally{await app.close();}
