import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// Drives the whole import path against real files: choose, preview, name, score, import, use, and remove. The
// native file chooser is replaced in the main process, which is the only part a test cannot click.
const root=process.cwd(),work=path.join(root,'work/custom-pack-qa'),dir=path.join(work,'data');
fs.mkdirSync(dir,{recursive:true});
const questions=path.join(work,'my-questions.csv');
fs.writeFileSync(questions,'prompt,answer\n"What is 2 + 2?",4\n"A ledger shows $3, then $4. Total?",7\n"He said ""go"". How many words did he say?",2\n"Multiply six by seven.",42\n',
 'utf8');
const broken=path.join(work,'broken.json');
fs.writeFileSync(broken,'[{"question":"missing its answer"}]','utf8');
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const chooseFile=file=>app.evaluate(({dialog},filePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filePath]});},file);
const cancelChooser=()=>app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
const cards=()=>page.locator('.benchmark-card');
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Benchmarks',exact:true}).click();
 await page.getByRole('heading',{name:'Try established tests, or your own.'}).waitFor();
 assert.equal(await cards().count(),3,'the three published packs are there to begin with');

 // A file that cannot be read is refused, and nothing is stored from it.
 const open=async()=>{await page.getByRole('button',{name:'Import a pack'}).click();await page.getByRole('dialog',{name:'Import a benchmark pack'}).waitFor();};
 await open();
 await chooseFile(broken);
 await page.getByRole('button',{name:'Choose a question file'}).click();
 await page.getByRole('alert').filter({hasText:'has no answer'}).waitFor();
 assert.ok(await page.getByRole('button',{name:'Import pack'}).isDisabled(),'nothing can be imported from a file that did not read');

 // Cancelling the chooser leaves the dialog exactly as it was.
 await cancelChooser();
 await page.getByRole('button',{name:'Choose a question file'}).click();
 assert.ok(await page.getByRole('button',{name:'Import pack'}).isDisabled());

 // A real file previews before anything is saved.
 await chooseFile(questions);
 await page.getByRole('button',{name:'Choose a question file'}).click();
 await page.getByText('my-questions.csv · 4 questions').waitFor();
 const preview=page.getByRole('dialog',{name:'Import a benchmark pack'});
 assert.ok((await preview.innerText()).includes('A ledger shows $3, then $4. Total?'),'a quoted comma must survive the CSV reader');
 assert.ok((await preview.innerText()).includes('He said "go". How many words did he say?'),'a doubled quote must survive it too');
 assert.equal(await page.getByLabel('How to score an answer').inputValue(),'final-number','all-numeric answers suggest final-number scoring');
 await page.screenshot({path:path.join(work,'import-preview.png'),fullPage:true});

 // The appended instruction is shown as part of the request that will actually be sent.
 await preview.locator('summary').filter({hasText:'What one request will actually contain'}).click();
 const shown=await preview.locator('pre').innerText();
 assert.ok(shown.includes('What is 2 + 2?')&&shown.includes('own line'),'the request preview shows the question and what is appended');
 await page.getByLabel('Pack name').fill('QA arithmetic set');
 await page.getByRole('button',{name:'Import pack'}).click();
 await page.getByRole('dialog',{name:'Import a benchmark pack'}).waitFor({state:'hidden'});
 await page.getByRole('status').filter({hasText:'Imported QA arithmetic set: 4 questions'}).waitFor();

 // It is now a pack like any other, and it is stored rather than held in the window.
 assert.equal(await cards().count(),4);
 const imported=cards().filter({hasText:'QA arithmetic set'});
 assert.ok((await imported.innerText()).includes('Imported'));
 assert.ok((await imported.innerText()).includes('4 available questions'));
 const snap=await page.evaluate(()=>window.bench.snapshot());
 const stored=snap.packs.find(p=>p.name==='QA arithmetic set');
 assert.ok(stored&&stored.custom&&stored.id.startsWith('custom-'),'the pack is in the snapshot as a custom pack');
 assert.equal(stored.count,4);
 assert.ok(/^[a-f0-9]{64}$/.test(stored.datasetHash),'an imported pack gets a question fingerprint like a published one');

 // Its meaning panel describes what was imported instead of inventing a claim about it.
 const meaning=page.locator('.benchmark-meaning');
 assert.ok((await meaning.innerText()).includes('Your own questions'));
 assert.ok((await meaning.innerText()).includes('not a published benchmark'));
 assert.ok((await meaning.innerText()).includes('my-questions.csv'));

 // Question counts never offer more questions than the file holds.
 const counts=await page.getByLabel('Questions per model').locator('option').allInnerTexts();
 assert.deepEqual(counts,['All 4 available'],'a four-question pack cannot be run for ten questions');
 await page.screenshot({path:path.join(work,'imported-pack.png'),fullPage:true});

 // Using it configures a real run against the imported questions.
 await page.getByRole('button',{name:'Use QA arithmetic set'}).click();
 await page.getByRole('heading',{name:'Configure a benchmark'}).waitFor();
 await page.getByRole('heading',{name:'QA arithmetic set',exact:true}).waitFor();
 await page.getByText('4 questions · seed 42').waitFor();
 assert.equal(await page.locator('.run-fieldset').getByLabel('Run name').inputValue(),'QA arithmetic set · 4 questions');

 // Removing it leaves the published packs alone and cannot touch a saved run's own copy of the questions.
 await page.locator('nav').getByRole('button',{name:'Benchmarks',exact:true}).click();
 await cards().filter({hasText:'QA arithmetic set'}).click();
 await page.getByRole('button',{name:'Remove this imported pack'}).click();
 await page.getByRole('button',{name:'Remove QA arithmetic set'}).click();
 await page.getByRole('status').filter({hasText:'Imported pack removed'}).waitFor();
 assert.equal(await cards().count(),3);
 assert.equal((await page.evaluate(()=>window.bench.snapshot())).packs.length,3);
 await assert.rejects(page.evaluate(()=>window.bench.deletePack('gsm8k')),/Published benchmarks/,'a published pack cannot be deleted');
 assert.equal((await page.evaluate(()=>window.bench.snapshot())).packs.length,3);

 assert.deepEqual(errors,[]);
 console.log('Custom packs: bad files refused, CSV quoting preserved, preview before saving, scoring suggested, imported pack stored, described, run-configurable, count-capped, and removable without touching the published ones.');
}finally{await app.close();}
