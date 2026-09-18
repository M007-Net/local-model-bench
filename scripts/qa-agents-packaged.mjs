// Checks the agent sweep inside the installed application, not the dev tree. The stage worker is
// spawned from within another worker thread and lives inside app.asar, so this is the only check
// that proves a shipped build can run host stages in parallel at all.
// Requires `npm run package` first.
import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=path.resolve('work/pkg-agents');fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
const app=await electron.launch({executablePath:path.resolve('outputs/win-unpacked/Local Model Bench.exe'),args:[],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Agents',exact:true}).click();
 // Drive it through the API so this checks packaging, not the form.
 const id=await page.evaluate(()=>window.bench.startAgenticRun({name:'packaged',modelKey:'',modelName:'',modelCall:'off',turns:6,workers:[1,4],repeats:1,hostWorkScale:1,maxTokens:256,contextLength:4096,temperature:0,reasoning:'default',timeoutSec:300,prompt:'x'}));
 let run=null;
 for(let i=0;i<120;i++){run=await page.evaluate(x=>window.bench.getAgenticRun(x),id);if(run.status!=='running')break;await page.waitForTimeout(1000);}
 assert.equal(run.status,'completed',`packaged sweep status ${run.status}: ${run.error??''}`);
 assert.deepEqual(run.points.map(p=>p.workers),[1,4]);
 for(const p of run.points)assert.equal(p.completed,6,`${p.workers}w completed ${p.completed}`);
 assert.ok(run.environment.hostThreads>1,`host pool ran ${run.environment.hostThreads} thread(s) \u2014 the stage worker did not load from the package`);
 assert.ok(run.points[1].wallMs<run.points[0].wallMs,'four workers must beat one inside the packaged app');
 assert.deepEqual(errors,[]);
 console.log(`Packaged agent sweep OK: pool ${run.environment.hostThreads} threads, 1w ${(run.points[0].wallMs/1000).toFixed(2)}s -> 4w ${(run.points[1].wallMs/1000).toFixed(2)}s`);
}finally{await app.close();}
