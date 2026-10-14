// Shows actual persisted live evidence, checks exports and reloads it after restart.
// No synthetic results. --execute additionally starts a real benchmark through
// the desktop UI; without that flag this only reads saved live evidence.
import {_electron as electron} from 'playwright';
import path from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {selectHarnessTasks} from '../src/harness';
import {harnessTasks} from '../electron/harness-tasks';
const data=path.resolve('work/harness-live'),out=path.resolve('work/qa-harness-live');mkdirSync(out,{recursive:true});
async function launch(){return electron.launch({args:[process.cwd()],env:{...process.env,LMB_DATA_DIR:data},timeout:60000});}
const app=await launch(),page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
let runId='',expectedTrials=0;
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Agents',exact:true}).click();await page.getByRole('button',{name:'Harness Evaluation',exact:true}).click();
 await page.getByRole('heading',{name:'Task outcome matrix',exact:true}).waitFor();
 if(process.argv.includes('--execute')){
  const seed=Array.from({length:100},(_,i)=>i).find(seed=>selectHarnessTasks(harnessTasks,1,seed)[0].id==='mean');assert.notEqual(seed,undefined);
  await page.getByLabel('Evaluation name').fill('Desktop live integration');await page.getByRole('checkbox',{name:/Hermes Agent/}).check();
  await page.getByRole('checkbox',{name:'Gemma 4 12B Instruct UD · IQ3_XXS',exact:true}).check();
  await page.getByLabel('Tasks',{exact:true}).fill('1');await page.getByLabel('Task selection seed').fill(String(seed));await page.getByLabel('Context window').fill('65536');await page.getByLabel('Reasoning',{exact:true}).selectOption('off');
  await page.getByRole('button',{name:'Start harness evaluation',exact:true}).click();
  await page.getByRole('button',{name:'Cancel and clean up',exact:true}).waitFor({timeout:30000});
  const deadline=Date.now()+420000;
  for(;;){const s=await page.evaluate(()=>window.bench.snapshot());if(!s.harnessProgress&&s.harnessRuns[0]?.status!=='running')break;if(Date.now()>deadline)throw Error('Desktop evaluation deadline exceeded');await new Promise(resolve=>setTimeout(resolve,1000));}
  console.log('Desktop-started real evaluation finished.');
 }
 const run=await page.evaluate(async()=>{const s=await window.bench.snapshot();return window.bench.getHarnessRun(s.harnessRuns[0].id);});
 runId=run.id;expectedTrials=run.config.harnesses.length*run.tasks.length*run.config.trials*run.config.modelKeys.length;assert.equal(run.status,'completed',run.error);assert.equal(run.trials.length,expectedTrials);assert.ok(run.trials.every(t=>t.metrics.modelRequests>0&&t.metrics.toolCalls!>0&&t.verification.passed!==null));
 for(const trial of run.trials){await page.getByRole('button',{name:`${trial.trial}: ${trial.status}`,exact:true}).nth(run.trials.filter(t=>t.status===trial.status).indexOf(trial)).click();await page.getByRole('heading',{name:'Chronological execution',exact:true}).waitFor();}
 await page.screenshot({path:path.join(out,'live-comparison.png'),fullPage:true});
 for(const format of ['json','csv','md']){
  const file=path.join(out,`report.${format}`);
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target});},file);
  const exported=await page.evaluate(async({id,format})=>window.bench.exportHarnessRun(id,format),{id:run.id,format});assert.equal(exported,file);const text=readFileSync(file,'utf8');assert.ok(text.includes('lmb-harness-v1'));if(format==='json')assert.equal(JSON.parse(text).trials.length,expectedTrials);
 }
 assert.deepEqual(errors,[]);
 console.log('Actual live results displayed and JSON/CSV/Markdown exported:',out);
}finally{await app.close();}
const reopened=await launch();try{const p=await reopened.firstWindow();await p.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();const saved=await p.evaluate(id=>window.bench.getHarnessRun(id),runId);assert.equal(saved.trials.length,expectedTrials);console.log('Live trial history survived desktop restart.');}finally{await reopened.close();}
