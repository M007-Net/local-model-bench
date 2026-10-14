// Desktop UI test: all saved results here are explicitly synthetic fixtures.
// It never invokes a model or installs harness dependencies.
import {_electron as electron} from 'playwright';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../electron/store';
import {defaultHarnessConfig,HARNESS_PROTOCOL,type HarnessRun,type HarnessTrial} from '../src/harness';
import {harnessTasks} from '../electron/harness-tasks';
const out=path.resolve('work/qa-harness-'+randomUUID().slice(0,8));mkdirSync(out,{recursive:true});
const store=new Store(path.join(out,'bench.sqlite'));
const run:HarnessRun={id:'ui-fixture',created:'2026-10-13',updated:'2026-10-13',status:'completed',config:{...defaultHarnessConfig,name:'UI fixture · mock data',modelKeys:['fixture-model'],taskCount:1},protocol:HARNESS_PROTOCOL,tasks:[harnessTasks[0]],environment:{source:'synthetic UI fixture; no inference performed'},trials:[],logs:[]};
store.saveHarnessRun(run);
for(const [index,harness] of (['mini-swe-agent','opencode'] as const).entries()){
 const trial:HarnessTrial={id:'ui-'+harness,runId:run.id,modelKey:'fixture-model',harness,taskId:'mean',taskVersion:1,trial:1,status:index===0?'success':'failure',failure:index===0?null:'verification_failed',metrics:{durationMs:1000,startupMs:10,inferenceMs:100,toolMs:5,externalWaitMs:null,toolCalls:1,failedToolCalls:0,modelRequests:1,iterations:1,inputTokens:null,outputTokens:null,totalTokens:null,tokenSource:'unavailable'},effective:{source:'synthetic UI fixture'},events:[{at:10,kind:'tool',data:{command:'fixture; never executed'}}],files:{'solution.py':'# synthetic fixture\n'},verification:{passed:index===0,output:'Synthetic verification fixture'},traceTruncated:false};store.saveHarnessTrial(trial);
}
store.db.close();
const app=await electron.launch({args:[process.cwd()],env:{...process.env,LMB_DATA_DIR:out},timeout:60000});
const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Agents',exact:true}).click();
 await page.getByRole('button',{name:'Harness Evaluation',exact:true}).click();
 await page.getByRole('heading',{name:'Harness Evaluation',exact:true}).waitFor();
 await page.getByRole('heading',{name:'Task outcome matrix',exact:true}).waitFor();
 await page.waitForFunction(()=>{const field=document.querySelector('.harness-fieldset') as HTMLFieldSetElement|null;return !!field&&!field.disabled;});assert.equal(await page.getByRole('checkbox',{name:/Hermes/}).isDisabled(),false);
 await page.getByRole('button',{name:'1: success',exact:true}).click();
 await page.getByRole('heading',{name:'Chronological execution',exact:true}).waitFor();
 assert.ok(await page.getByText('Synthetic verification fixture').isVisible());
 assert.equal(await page.getByLabel('Tasks',{exact:true}).inputValue(),'20');assert.equal(await page.getByLabel('Tasks',{exact:true}).getAttribute('max'),'20');await page.getByRole('combobox',{name:'Task pack',exact:true}).selectOption('python-repairs-v1');assert.equal(await page.getByLabel('Tasks',{exact:true}).inputValue(),'8');assert.equal(await page.getByLabel('Tasks',{exact:true}).getAttribute('max'),'8');await page.getByRole('combobox',{name:'Task pack',exact:true}).selectOption('python-repairs-v2');await page.getByLabel('Tasks',{exact:true}).fill('20');await page.getByLabel('Task selection seed').fill('123');assert.equal(await page.getByLabel('Task selection seed').inputValue(),'123');
 await page.getByLabel('Measured token stopping threshold (optional)').fill('');
 await page.screenshot({path:path.join(out,'harness-fixture.png'),fullPage:true});
 const exported=await page.evaluate(async()=>{const s=await window.bench.snapshot();return window.bench.getHarnessRun(s.harnessRuns[0].id);});assert.equal(exported.trials.length,2);assert.equal(exported.environment.source,'synthetic UI fixture; no inference performed');
 assert.deepEqual(errors,[]);
 console.log('Harness desktop UI passed; synthetic fixtures only. Screenshot:',path.join(out,'harness-fixture.png'));
}finally{await app.close();}
