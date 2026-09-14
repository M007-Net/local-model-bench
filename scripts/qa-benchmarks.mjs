import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=path.resolve('work/benchmark-ui');fs.mkdirSync(dir,{recursive:true});
const app=await electron.launch({executablePath:path.resolve('outputs/win-unpacked/Local Model Bench.exe'),args:[],env:{...process.env,LMB_DATA_DIR:path.join(dir,'data')},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('button',{name:'Benchmarks',exact:true}).click();
 await page.getByRole('heading',{name:'Try established tests.'}).waitFor();
 assert.equal(await page.locator('.benchmark-card').count(),3);
 await page.getByRole('heading',{name:'Benchmark meaning',exact:true}).waitFor();
 await page.getByLabel('Questions per model').selectOption('25');
 await page.getByLabel('Question seed').fill('17');
 await page.getByRole('button',{name:'Use GSM8K',exact:true}).click();
 await page.getByText('25 questions · seed 17',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Enable native MTP',{exact:true}).isChecked(),false);
 await page.getByRole('button',{name:'Change benchmark',exact:true}).click();
 await page.locator('.benchmark-card').filter({hasText:'CRUXEval-O'}).click();
 await page.getByText('This measures code reading and tracing.',{exact:false}).waitFor();
 await page.screenshot({path:path.join(dir,'benchmark-library.png'),fullPage:true});
 await page.getByRole('button',{name:'Use CRUXEval-O',exact:true}).click();
 await page.getByText('10 questions · seed 42',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Use accounting suite',exact:true}).click();
 assert.equal(await page.locator('.selection-list').nth(1).locator('input:checked').count(),12);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(dir,'validation.json'),JSON.stringify({passed:true,checks:['published pack selection','score meaning panel','count and seed transferred','MTP control retained','accounting switch retained'],errors},null,2));
 console.log('Benchmark UI checks passed');
}finally{await app.close();}
