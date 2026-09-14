import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
// Deliberately offline: this checks that a default install asks GitHub for nothing, that the controls refuse
// to arm themselves until a repository is named, and that no update banner appears out of nowhere.
const root=process.cwd(),dir=path.join(root,'work/update-qa/data');fs.mkdirSync(dir,{recursive:true});
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const requested=[];page.on('request',r=>{if(!/^(file|devtools):/.test(new URL(r.url()).protocol))requested.push(r.url());});
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('heading',{name:'Updates',exact:true}).waitFor();

 // A fresh install is inert: no repository, no startup check, nothing fetched, no banner.
 const state=await page.evaluate(()=>window.bench.updateState());
 assert.equal(state.phase,'idle');
 assert.equal(state.info,null);
 const snap=await page.evaluate(()=>window.bench.snapshot());
 assert.equal(snap.settings.updateRepo,'');
 assert.equal(snap.settings.updateCheck,false);
 const repo=page.getByLabel('GitHub repository'),startup=page.getByLabel('Check for updates at startup');
 assert.equal(await repo.inputValue(),'');
 assert.ok(await startup.isDisabled(),'the startup check cannot be armed without a repository');
 assert.ok(await page.getByRole('button',{name:'Check now'}).isDisabled(),'checking is unavailable until a saved repository exists');
 assert.equal(await page.locator('.update-pill').count(),0,'no update banner may appear on its own');

 // Naming a repository is what arms the checkbox; clearing it disarms it again.
 await repo.fill('your-account/local-model-bench');
 assert.ok(await startup.isEnabled());
 await startup.check();
 await repo.fill('');
 assert.ok(await startup.isDisabled(),'emptying the repository must turn the startup check back off');
 assert.equal(await startup.isChecked(),false);

 // A malformed repository is refused before anything is stored.
 await repo.fill('not a repository');
 await page.getByRole('button',{name:'Save settings'}).click();
 await page.getByRole('alert').filter({hasText:'owner/name'}).waitFor();
 assert.equal((await page.evaluate(()=>window.bench.snapshot())).settings.updateRepo,'','a refused repository must not be saved');

 await repo.fill('your-account/local-model-bench');
 await startup.check();
 await page.getByRole('button',{name:'Save settings'}).click();
 await page.getByRole('status').filter({hasText:'Settings saved'}).waitFor();
 const saved=await page.evaluate(()=>window.bench.snapshot());
 assert.equal(saved.settings.updateRepo,'your-account/local-model-bench');
 assert.equal(saved.settings.updateCheck,true);
 assert.ok(await page.getByRole('button',{name:'Check now'}).isEnabled(),'a saved repository makes checking available');
 await page.screenshot({path:'work/update-qa/settings.png',fullPage:true});

 // Installing refuses unless a verified download is actually sitting on disk.
 await assert.rejects(page.evaluate(()=>window.bench.installUpdate()),/Download and verify the update first/);
 await assert.rejects(page.evaluate(()=>window.bench.downloadUpdate()),/Check for an update first/);

 // Nothing in any of that reached the network.
 assert.deepEqual(requested,[],'a default install must make no outbound request');
 assert.deepEqual(errors,[]);
 console.log('Update controls: inert by default, armed only by a saved owner/name, malformed input refused, install and download refuse without a verified file, and no outbound request was made.');
}finally{await app.close();}
