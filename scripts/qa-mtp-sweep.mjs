import {_electron as electron} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Drives the real window to check the MTP sweep: the controls that plan one, and the panel,
// graphs and export that report one. No LM Studio is needed and nothing is inferred here.
//
// The results half reads the saved validation run and relabels its measurements with MTP
// depths - concurrency 1 becomes "MTP off" and concurrency 2 becomes "2 tokens" - so that the
// depth-aware rendering has something real to render. The NUMBERS are real measurements; the
// DEPTHS are labels this script invented. Whichever depth the panel calls fastest here is an
// artefact of that relabelling and says nothing whatsoever about multi-token prediction. That
// is why nothing from this script is written into the repository.
const root=process.cwd(),dir=path.join(root,'work/mtp-sweep-qa/data');
fs.mkdirSync(dir,{recursive:true});
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const preview=()=>page.locator('.run-summary');
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();

 // --- Planning a sweep -----------------------------------------------------------------
 await page.locator('nav').getByRole('button',{name:'Run',exact:true}).click();
 await page.getByRole('heading',{name:'Configure a benchmark',exact:true}).waitFor();
 const sweepToggle=page.getByLabel('Sweep MTP prediction depths');
 assert.equal(await sweepToggle.count(),0,'the sweep is offered only once MTP itself is on');
 await page.getByLabel('Enable native MTP').check();
 await sweepToggle.waitFor();
 assert.equal(await page.getByLabel('MTP draft tokens').count(),1,'a single depth is still the default');

 await sweepToggle.check();
 const depths=page.getByLabel('MTP depths to sweep');
 assert.equal(await depths.inputValue(),'0, 1, 2, 3, 4, 5');
 assert.equal(await page.getByLabel('MTP draft tokens').count(),0,'one fixed depth is meaningless during a sweep');
 await page.getByText('6× the size of the same run without a sweep',{exact:false}).waitFor();
 await preview().getByText('MTP off, 1 token, 2 tokens, 3 tokens, 4 tokens, 5 tokens',{exact:true}).waitFor();

 // The preflight is opt-in, and says so in the preview either way. It is a property of MTP
 // rather than of sweeping, so it stays available once the sweep itself is turned off.
 const preflight=page.getByLabel('Check the MTP head before measuring');
 assert.equal(await preflight.isChecked(),false,'a run does not pay for the check unless it asks');
 await preview().getByText('Off',{exact:true}).first().waitFor();
 await preflight.check();
 await preview().getByText('On · checked first',{exact:true}).waitFor();
 await preflight.uncheck();
 await preview().getByText('On · checked first',{exact:true}).waitFor({state:'detached'});
 await preflight.check();
 // What is typed is kept as typed, then ordered and de-duplicated when the field is left.
 await depths.fill('4, 0, 0, 2');await depths.blur();
 assert.equal(await depths.inputValue(),'0, 2, 4');
 await preview().getByText('MTP off, 2 tokens, 4 tokens',{exact:true}).waitFor();
 // The warning is live feedback while typing. Leaving the field is what drops what it could not
 // read, so the warning has served its purpose by then and the field is simply correct.
 await depths.fill('0, 99, two');
 await page.getByText('Ignored: 99, two.',{exact:false}).waitFor();
 assert.equal(await depths.getAttribute('aria-invalid'),'true');
 await depths.blur();
 assert.equal(await depths.inputValue(),'0');
 assert.equal(await page.getByText('Ignored:',{exact:false}).count(),0);

 await depths.fill('');await depths.blur();
 await page.getByText('Enter at least one depth, or turn the sweep off.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Start benchmark'}).isDisabled(),true);

 // Turning MTP off has to take the sweep with it, or the run would be rejected on start.
 await depths.fill('0, 2');await depths.blur();
 await page.getByLabel('Enable native MTP').uncheck();
 assert.equal(await page.getByLabel('Sweep MTP prediction depths').count(),0);
 await page.getByLabel('Enable native MTP').check();
 assert.equal(await page.getByLabel('Sweep MTP prediction depths').isChecked(),false,'the sweep does not come back on by itself');

 // --- Reporting a sweep ----------------------------------------------------------------
 const source=JSON.parse(fs.readFileSync('outputs/Live-validation-results.json','utf8'));
 const {samples,waves,...doc}=source;
 const DEPTHS=[0,2];
 const run={...doc,id:doc.id+'-sweep-fixture',config:{...doc.config,name:'Depth-labelled fixture (not an MTP measurement)',mtp:'on',mtpSweep:DEPTHS,concurrency:[1,2]}};
 const db=new DatabaseSync(path.join(dir,'bench.sqlite'));
 db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(run.id,JSON.stringify(run));
 // The real run measured two concurrency levels at one setting. Every measurement is copied
 // once per depth so that depth and concurrency are crossed the way a real sweep crosses them
 // — which is the whole point of the panel under test. The numbers in each copy are identical,
 // so no depth can beat another here; only the layout is being checked.
 for(const depth of DEPTHS){
  const tag=`-f${depth}`;
  for(const s of samples)db.prepare('INSERT OR REPLACE INTO samples VALUES (?,?,?)').run(s.id+tag,run.id,JSON.stringify({...s,id:s.id+tag,runId:run.id,waveId:s.waveId+tag,...(s.warmup?{}:{mtpTokens:depth})}));
  // Invented acceptance figures, present only at a depth that drafts at all, so the panel has
  // both a filled cell and an empty one to render.
  const draft=depth===0?undefined:{tasks:1,accepted:40,generated:64,acceptance:40/64,meanLen:2.5};
  for(const w of waves)db.prepare('INSERT OR REPLACE INTO waves VALUES (?,?,?)').run(w.id+tag,run.id,JSON.stringify({...w,id:w.id+tag,runId:run.id,mtpTokens:depth,...(draft?{draft}:{})}));
 }
 db.close();

 await page.reload();
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('combobox',{name:'Saved run'}).selectOption(run.id);
 const panel=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Maximum predictions sweep',exact:true})});
 await panel.waitFor();
 // One block per model, a table per concurrency level inside it, and a row per depth in each:
 // two models at two concurrency levels at two depths is eight rows.
 assert.equal(await panel.locator('h3').count(),2);
 assert.equal(await panel.locator('h4').count(),4,'each concurrency level is reported on its own');
 for(const level of ['1 concurrent request','2 concurrent requests'])await panel.getByRole('heading',{name:level,exact:true}).first().waitFor();
 assert.equal(await panel.locator('tbody tr').count(),8);
 for(const label of ['MTP off','2 tokens'])assert.equal(await panel.locator('tbody tr').filter({hasText:label}).count(),4);
 assert.equal(await panel.getByText('Not enough completed measurements',{exact:false}).count(),0,'both depths were found at every concurrency level');
 // Acceptance is reported where drafting happened and left blank where none did, rather than
 // shown as a rate of zero.
 assert.equal(await panel.locator('tbody tr').filter({hasText:'62.5%'}).count(),4,'the accepted-draft share is rendered per depth and concurrency');
 assert.equal(await panel.locator('tbody tr').filter({hasText:'MTP off'}).filter({hasText:'62.5%'}).count(),0,'MTP off drafts nothing, so it reports no acceptance');

 // Each depth is its own line in the graphs rather than a second point on one model's curve.
 const legend=await page.locator('.chart-legend').first().innerText();
 for(const key of source.config.modelKeys)for(const label of ['MTP off','MTP 2 tokens'])
  assert.ok(legend.includes(`${key} · ${label}`),`legend is missing ${key} at ${label}`);

 const dest=path.join(root,'work/mtp-sweep-qa/report.md');
 await app.evaluate(({dialog},dest)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:dest});},dest);
 await page.getByRole('button',{name:'MD',exact:true}).click();
 await page.getByText('Export saved: '+dest,{exact:true}).waitFor();
 const report=fs.readFileSync(dest,'utf8');
 assert.match(report,/## Native MTP sweep/);
 assert.match(report,/swept depths: MTP off, 2 tokens/);
 assert.match(report,/\/ MTP 2 tokens/);
 assert.match(report,/— 2 concurrent requests/);
 assert.match(report,/drafted tokens accepted 62\.5% \(40 of 64 drafted/);
 assert.match(report,/drafted tokens accepted not applicable/);

 assert.deepEqual(errors,[]);
 await panel.scrollIntoViewIfNeeded();await page.waitForTimeout(300);
 await page.screenshot({path:'work/mtp-sweep-qa/sweep.png',fullPage:true});
 fs.writeFileSync('work/mtp-sweep-qa/result.json',JSON.stringify({passed:true,controls:'planned, normalized, and cleared',depthsRendered:['MTP off','2 tokens'],
  caution:'Depth labels were invented by this script over real measurements; no MTP speed claim can be read from it.',errors,installed:!!process.env.LMB_QA_EXE},null,2));
 console.log('Sweep controls, depth-split panel, per-depth graph series, and the export section verified.');
 console.log('Reminder: the depths in the fixture are labels, not measurements. Nothing here says anything about MTP speed.');
}finally{await app.close();}
