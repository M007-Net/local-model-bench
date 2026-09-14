import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// Two saved runs of the same models under different concurrency, so the overview has something real to pool
// and the mixed-condition warning has something real to warn about.
const root=process.cwd(),dir=path.join(root,'work/history-qa/data');fs.mkdirSync(dir,{recursive:true});
const source=JSON.parse(fs.readFileSync('outputs/Live-validation-results.json','utf8'));
const replay=structuredClone(source);
replay.id='9f1c0d22-0000-4000-8000-000000000001';
replay.created=replay.updated='2026-09-05T12:00:00.000Z';
replay.config={...replay.config,name:'Live validation replay · concurrency 4',concurrency:[4]};
replay.samples=replay.samples.map((s,i)=>({...s,id:'replay-sample-'+i,runId:replay.id,concurrency:4,waveId:'replay-wave-'+i}));
replay.waves=replay.waves.map((w,i)=>({...w,id:'replay-wave-'+i,runId:replay.id,concurrency:4}));
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const table=page.locator('.history-table');
const bodies=()=>table.locator('tbody');
const labels=async()=>table.locator('tbody > tr:first-child > td:first-child > b').allInnerTexts();
const requestTotal=async()=>(await table.locator('tbody > tr:first-child > td:nth-child(3)').allInnerTexts()).reduce((n,t)=>n+Number(t.replace(/,/g,'')),0);
const chip=(group,name)=>page.getByRole('group',{name:group}).getByRole('button',{name});
const statValue=label=>page.locator('.stat').filter({hasText:label}).locator('b');
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 const db=new DatabaseSync(path.join(dir,'bench.sqlite'));
 const insert=run=>{const {samples,waves,...doc}=run;
  db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(run.id,JSON.stringify(doc));
  for(const s of samples)db.prepare('INSERT OR REPLACE INTO samples VALUES (?,?,?)').run(s.id,s.runId,JSON.stringify(s));
  for(const w of waves)db.prepare('INSERT OR REPLACE INTO waves VALUES (?,?,?)').run(w.id,w.runId,JSON.stringify(w));};
 insert(source);insert(replay);db.exec('DELETE FROM model_profiles');db.close();
 await page.reload();
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();

 // 1. Both modes are offered, and whichever is not showing stays one click away at the top.
 const modes=page.getByRole('group',{name:'Results view'});
 assert.deepEqual(await modes.getByRole('button').allInnerTexts(),['Specific run','All runs overview']);
 await page.getByLabel('Saved run').waitFor();
 await modes.getByRole('button',{name:'All runs overview'}).click();
 await page.getByRole('heading',{name:'What to include'}).waitFor();
 assert.ok(await modes.getByRole('button',{name:'Specific run'}).isVisible(),'the other mode must stay reachable');

 // 2. Both saved runs are pooled, grouped by model.
 assert.equal(await statValue('Runs covered').innerText(),'2');
 assert.equal(await statValue('Models covered').innerText(),'2');
 assert.deepEqual((await labels()).sort(),['gemma-4-26b-a4b-it-qat-ud','qwen3.6-35b-a3b@iq3_xxs']);
 const allRequests=await requestTotal();
 assert.ok(allRequests>0,'pooled rows must carry measured requests');
 await page.screenshot({path:'work/history-qa/overview.png',fullPage:true});

 // 3. A family chip narrows, All widens again.
 await chip('Model family',/^Qwen/).click();
 assert.deepEqual(await labels(),['qwen3.6-35b-a3b@iq3_xxs']);
 await page.getByRole('group',{name:'Model family'}).getByRole('button',{name:'All'}).click();
 assert.equal(await bodies().count(),2);

 // 4. Choices inside a facet are alternatives; choices across facets all have to match. A tier nothing in the
 // current selection was measured at drops to zero rather than disappearing out from under the press.
 await chip('Model family',/^Gemma/).click();
 const tiers=async()=>(await page.getByRole('group',{name:'Quantization tier'}).getByRole('button').allInnerTexts()).map(t=>t.replace('\n',' '));
 assert.deepEqual(await tiers(),['All','IQ3 0','Q4 3'],'a tier with nothing left to show stays on offer at zero');
 await chip('Quantization tier',/^Q4/).click();
 assert.deepEqual(await labels(),['gemma-4-26b-a4b-it-qat-ud']);
 await chip('Model family',/^Qwen/).click();
 assert.deepEqual(await labels(),['gemma-4-26b-a4b-it-qat-ud'],'widening the family must not smuggle the IQ3 Qwen row past the Q4 tier');
 await chip('Quantization tier',/^IQ3/).click();
 assert.equal(await bodies().count(),2,'both tiers chosen brings the Qwen row back');
 await page.getByRole('button',{name:'Reset overview'}).click();
 assert.equal(await bodies().count(),2);

 // 5. Regrouping collapses rows without inventing or losing requests.
 await page.getByLabel('Group by').selectOption('quantTier');
 assert.deepEqual((await labels()).sort(),['IQ3','Q4']);
 assert.equal(await requestTotal(),allRequests);
 await page.getByLabel('Group by').selectOption('kind');
 assert.equal(await requestTotal(),allRequests);
 await page.getByLabel('Group by').selectOption('model');

 // 6. Sorting a column reverses the order and reports itself.
 const header=table.locator('th').filter({hasText:'Gen tok/s'}),groupColumn=table.locator('th').filter({hasText:'Group'});
 assert.equal(await header.getAttribute('aria-sort'),'descending','the overview opens on the fastest first');
 const fastestFirst=await labels();
 await header.getByRole('button').click();
 assert.equal(await header.getAttribute('aria-sort'),'ascending');
 assert.deepEqual(await labels(),[...fastestFirst].reverse());
 await groupColumn.getByRole('button').click();
 assert.equal(await groupColumn.getAttribute('aria-sort'),'ascending','a name column starts A to Z');
 assert.equal(await header.getAttribute('aria-sort'),'none','only the sorted column reports a direction');
 await header.getByRole('button').click();
 assert.deepEqual(await labels(),fastestFirst);

 // 7. Pooling different concurrency levels is declared, and pinning one clears it.
 const warning=page.locator('.hint.amber').filter({hasText:'pool more than one condition'});
 await warning.waitFor();
 assert.ok((await table.locator('td.conditions').first().innerText()).includes('concurrency 1, 2, 4'));
 await chip('Concurrent requests',/^4\b/).click();
 assert.equal(await warning.count(),0,'one pinned concurrency leaves nothing mixed');
 assert.equal(await statValue('Runs covered').innerText(),'1');
 await page.getByRole('group',{name:'Concurrent requests'}).getByRole('button',{name:'All'}).click();

 // 8. The runs behind a row are listed, and opening one lands on the existing single-run view.
 await table.locator('tbody > tr:first-child > td:nth-child(2) button').first().click();
 await page.getByText('Runs behind this row').waitFor();
 await page.screenshot({path:'work/history-qa/contributing-runs.png',fullPage:true});
 await page.getByRole('button',{name:/Open this run/}).first().click();
 await page.getByRole('heading',{name:'Compare models',exact:true}).waitFor();
 assert.ok(await page.getByLabel('Saved run').inputValue(),'opening a run must select it');

 // 9. A saved metadata correction moves a model between Dense and MoE here too.
 await page.evaluate(()=>window.bench.saveModelProfile('gemma-4-26b-a4b-it-qat-ud',{totalB:26,activeB:null,kind:'dense',source:'User supplied'}));
 await modes.getByRole('button',{name:'All runs overview'}).click();
 await page.getByRole('button',{name:'Refresh history'}).click();
 await chip('Architecture',/^Dense/).waitFor();
 await chip('Architecture',/^Dense/).click();
 assert.deepEqual(await labels(),['gemma-4-26b-a4b-it-qat-ud']);

 // 10. The overview, its chips, and its grouping survive a restart.
 await page.getByLabel('Group by').selectOption('family');
 await page.reload();
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('heading',{name:'What to include'}).waitFor();
 assert.equal(await page.getByLabel('Group by').inputValue(),'family');
 assert.equal(await chip('Architecture',/^Dense/).getAttribute('aria-pressed'),'true');
 assert.deepEqual(await labels(),['Gemma']);

 // 11. The graphs draw from the pooled rows.
 const graph=page.locator('.auto-chart').filter({has:page.getByRole('heading',{name:'Generation speed',exact:true})});
 await graph.waitFor();
 assert.ok(await graph.locator('circle').count()>0,'pooled groups must appear on the graphs');
 await page.screenshot({path:'work/history-qa/graphs.png',fullPage:true});

 assert.deepEqual(errors,[]);
 console.log('History overview: two-run pooling, chip filters, regrouping, sorting, mixed-condition warning, run drill-through, metadata corrections, persistence, and graphs all passed.');
}finally{await app.close();}
