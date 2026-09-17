import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),dir=path.join(root,'work/chart-qa/data');fs.mkdirSync(dir,{recursive:true});
// Reuse real measured data; no new inference load is needed for a chart-only change.
const source=JSON.parse(fs.readFileSync('outputs/Live-validation-results.json','utf8'));
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 // Inject saved data into an isolated QA database, then reload to exercise ordinary retrieval.
 const db=new DatabaseSync(path.join(dir,'bench.sqlite'));const {samples,waves,...doc}=source;
 db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(source.id,JSON.stringify(doc));
 for(const s of samples)db.prepare('INSERT OR REPLACE INTO samples VALUES (?,?,?)').run(s.id,s.runId,JSON.stringify(s));
 for(const w of waves)db.prepare('INSERT OR REPLACE INTO waves VALUES (?,?,?)').run(w.id,w.runId,JSON.stringify(w));db.close();
 await page.reload();await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('combobox',{name:'Saved run'}).selectOption(source.id);
 await page.getByRole('heading',{name:'Automatic graphs',exact:true}).waitFor();
 assert.equal(await page.locator('.auto-chart svg').count(),9);
 assert.equal(await page.locator('.auto-chart').filter({has:page.getByRole('heading',{name:'Generation speed',exact:true})}).locator('circle').count(),4);
 await page.getByRole('combobox',{name:'Quality score source'}).selectOption('localJudge');
 await page.getByRole('heading',{name:'Local judge score',exact:true}).waitFor();
 assert.equal(await page.locator('.auto-chart').filter({has:page.getByRole('heading',{name:'Local judge score',exact:true})}).locator('circle').count(),4);
 await page.getByRole('combobox',{name:'Quality score source'}).selectOption('externalJudge');
 const empty=page.locator('.auto-chart').filter({has:page.getByRole('heading',{name:'External review score',exact:true})});await empty.getByText('No measurements available yet').waitFor();assert.equal(await empty.locator('circle').count(),0);
 await page.getByRole('combobox',{name:'Quality score source'}).selectOption('objective');
 await page.getByRole('heading',{name:'Automatic graphs',exact:true}).scrollIntoViewIfNeeded();await page.waitForTimeout(300);
 await page.screenshot({path:'work/chart-qa/dashboard.png',fullPage:true});
 const dest=path.join(root,'outputs/Example-Graph-Report.html');
 await app.evaluate(({dialog},dest)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:dest});},dest);
 await page.getByRole('button',{name:'Graph report',exact:true}).click();
 await page.getByText('Export saved: '+dest,{exact:true}).waitFor();
 assert.ok(fs.readFileSync(dest,'utf8').includes('Generation speed'));assert.deepEqual(errors,[]);
 await app.evaluate(async({BrowserWindow},dest)=>{await BrowserWindow.getAllWindows()[0].loadFile(dest);},dest);
 await page.getByRole('heading',{name:'Generation speed',exact:true}).waitFor();assert.equal(await page.locator('article svg').count(),13);
 await page.screenshot({path:'work/chart-qa/report.png',fullPage:true});
 fs.writeFileSync('work/chart-qa/result.json',JSON.stringify({passed:true,charts:9,reportCharts:13,errors,source:'Saved local validation run',installed:!!process.env.LMB_QA_EXE},null,2));console.log('Nine automatic graphs, score-source switching, missing data, and offline graph export verified.');
}finally{await app.close();}
