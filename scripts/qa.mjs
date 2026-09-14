import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.cwd();fs.mkdirSync('work/qa',{recursive:true});

// This is a live smoke test: it drives the real window against a real LM Studio.
// Fail with an explanation rather than a Playwright stack trace when the thing it
// needs is simply not running, because that is the common case for a first-time
// contributor and CI deliberately does not run this script.
const base=process.env.LMB_QA_BASE_URL||'http://127.0.0.1:1234';
function stop(message){console.error(`
npm run qa could not start.

${message}
`);process.exit(2);}
let discovered;
try{
 const probe=await fetch(base+'/api/v1/models',{signal:AbortSignal.timeout(5000)});
 if(!probe.ok)stop(`LM Studio answered ${base} with HTTP ${probe.status}.
Start its local server (Developer tab -> Start Server) and try again.`);
 const body=await probe.json();
 discovered=Array.isArray(body?.data)?body.data:Array.isArray(body)?body:[];
}catch(error){
 // fetch reports a bare "TypeError: fetch failed"; the useful errno is one level down.
 const why=error?.cause?.code||error?.code||error?.name||'request failed';
 stop(`Could not reach LM Studio at ${base} (${why}).

These UI checks need LM Studio running with its local server started and at
least one model downloaded. Start it, or point the check elsewhere with
LMB_QA_BASE_URL=http://127.0.0.1:PORT.

Offline checks that need none of this: npm test, npm run build.`);
}
if(!discovered.length)stop(`LM Studio is running at ${base} but reports no models.
Download at least one model in LM Studio, then run this again.`);

const app=await electron.launch({args:[root],env:{...process.env,LMB_DATA_DIR:path.join(root,'work/qa/data')},timeout:60000});
const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.getByText('LM Studio connected',{exact:true}).waitFor({timeout:20000});
 await page.screenshot({path:'work/qa/models.png'});
 const models=await page.evaluate(()=>window.bench.models());assert.ok(models.length>0);
 await page.locator('.model-card').first().click();
 await page.getByRole('button',{name:'Configure benchmark'}).click();
 await page.getByRole('button',{name:'Quick',exact:false}).click();
 await page.screenshot({path:'work/qa/run.png'});

 // Vision mode: the control exists, On is offered only against reported capability, and
 // text-only never claims the projector was unloaded.
 const vision=page.getByRole('group',{name:'Vision mode'});
 await vision.waitFor();
 assert.deepEqual(await vision.getByRole('button').allInnerTexts(),['Auto','Off / text-only','On']);
 const startButton=page.getByRole('button',{name:'Start benchmark'});
 const capable=models.filter(m=>m.capabilities?.vision===true);
 const textOnly=models.map((m,index)=>({m,index})).filter(x=>x.m.capabilities?.vision!==true);

 await vision.getByRole('button',{name:'Off / text-only',exact:true}).click();
 await page.getByText('does not unload vision weights',{exact:false}).waitFor();
 assert.ok(!(await page.getByText('vision weights were unloaded',{exact:false}).count()),'text-only must never claim unloaded weights');

 const onButton=vision.getByRole('button',{name:'On',exact:true});
 if(capable.length){
  await onButton.click();
  await page.getByText('Nothing leaves this machine.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Select vision-capable models'}).click();
  assert.ok(!(await page.locator('.hint.amber',{hasText:'Vision is not confirmed for'}).count()),'capable models must not warn');
  assert.ok(await startButton.isEnabled(),'a vision-capable selection must be runnable');
  if(textOnly.length){
   // Adding a model LM Studio does not report as vision-capable must warn and block.
   const modelBoxes=page.locator('label.field').filter({hasText:/^Models/}).locator('.selection-list input[type=checkbox]');
   assert.equal(await modelBoxes.count(),models.length,'model checkbox locator must cover exactly the model list');
   await modelBoxes.nth(textOnly[0].index).check();
   await page.locator('.hint.amber').filter({hasText:'Vision is not confirmed for'}).waitFor();
   assert.ok(await startButton.isDisabled(),'an unconfirmed model must block a vision run');
   await page.getByText('a separate non-vision copy of the model is not needed',{exact:false}).waitFor();
   await page.screenshot({path:'work/qa/vision-warning.png'});
   await modelBoxes.nth(textOnly[0].index).uncheck();
   assert.ok(await startButton.isEnabled(),'removing it must clear the block');
  }
 }else{
  assert.ok(await onButton.isDisabled(),'On must be unavailable with no vision-capable model');
 }
 await vision.getByRole('button',{name:'Auto',exact:true}).click();
 await page.screenshot({path:'work/qa/vision.png'});

 await page.locator('nav').getByRole('button',{name:'Tests',exact:true}).click();
 await page.getByRole('button',{name:'New test',exact:true}).click();
 await page.getByLabel('Name',{exact:true}).fill('QA custom task');
 await page.getByLabel('Prompt',{exact:true}).fill('Return only the number 84.');
 await page.getByRole('button',{name:'Add check',exact:true}).click();
 await page.getByLabel('Check type').selectOption('number');
 await page.getByLabel('Expected value').fill('84');
 await page.screenshot({path:'work/qa/test-editor.png'});
 await page.getByRole('button',{name:'Save test',exact:true}).click();
 await page.getByRole('dialog').waitFor({state:'hidden'});
 const snap=await page.evaluate(()=>window.bench.snapshot());assert.ok(snap.tests.some(t=>t.name==='QA custom task'));
 await page.locator('nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.screenshot({path:'work/qa/settings.png'});
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.screenshot({path:'work/qa/empty-results.png'});
 assert.deepEqual(errors,[]);fs.writeFileSync('work/qa/ui-result.json',JSON.stringify({passed:true,models:models.length,errors},null,2));
 console.log('Desktop UI checks passed; '+models.length+' local models discovered.');
}catch(error){
 // Playwright's own failures are long and start with a stack; lead with the point.
 console.error(`
Desktop UI checks failed.

${error?.message||error}

Screenshots taken before the failure are in work/qa/.
`);
 await app.close();
 process.exit(1);
}finally{await app.close().catch(()=>{});}
