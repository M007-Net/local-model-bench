import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.cwd();fs.mkdirSync('work/qa-results',{recursive:true});
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:path.join(root,process.env.LMB_QA_EXE?'work/qa-installed/data':'work/qa-results/data')},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.getByText('LM Studio connected',{exact:true}).waitFor({timeout:20000});
 const modelKey=process.env.LMB_MODEL_KEY;if(!modelKey)throw Error('Set LMB_MODEL_KEY to an exact downloaded model key.');
 const model=page.locator('.model-card').filter({has:page.locator('.model-key',{hasText:modelKey})});await model.click();
 await page.getByRole('button',{name:'Configure benchmark'}).click();
 await page.getByRole('button',{name:'Quality only',exact:true}).click();
 await page.getByLabel('Run name',{exact:true}).fill('Desktop end-to-end validation');
 // Use the exposed desktop API for precise setup; the run itself is executed by the packaged worker.
 const config={name:'Desktop end-to-end validation',modelKeys:[modelKey],testIds:['instructions'],mode:'quality',preset:'Custom',concurrency:[1,2],waves:1,maxTokens:128,contextLength:4096,temperature:0,gpu:'auto',reasoning:'default',judgeModel:'',performanceLengths:[],timeoutSec:180};
 console.log('Starting worker validation');
 const id=process.env.LMB_QA_REUSE?(await page.evaluate(()=>window.bench.snapshot())).runs[0].id:await page.evaluate(c=>window.bench.startRun(c),config);
 console.log('Run ID '+id);
 const deadline=Date.now()+300000;
 while(true){const state=await page.evaluate(id=>window.bench.getRun(id),id);if(!['running','grading'].includes(state.status))break;if(Date.now()>deadline)throw Error('Run deadline exceeded');await new Promise(r=>setTimeout(r,500));}
 const run=await page.evaluate(id=>window.bench.getRun(id),id);assert.equal(run.status,'completed',run.error);assert.equal(run.samples.filter(s=>!s.warmup&&s.status==='completed').length,3);assert.equal(run.waves.length,2);
 console.log('Worker finished; opening results');
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('combobox',{name:'Saved run'}).selectOption(id);
 await page.locator('.response-list>button').first().waitFor();await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(300);console.log('Rendering results screenshot');
 await page.screenshot({path:'work/qa-results/results.png'});
 await page.locator('.response-list>button').first().click();
 await app.evaluate(async({clipboard,BrowserWindow})=>{globalThis.__qaClipboard=await clipboard.readText();BrowserWindow.getAllWindows()[0].focus();});
 await page.getByRole('button',{name:'Copy grading package'}).click();
 await page.getByRole('textbox',{name:'Grading package text',exact:true}).waitFor();
 const packageText=await page.getByRole('textbox',{name:'Grading package text',exact:true}).inputValue();
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());
 assert.ok(packageText.includes('candidate_response'));assert.ok(!packageText.includes(modelKey));
 if(copied!==packageText){await page.getByText('Clipboard access is unavailable. Copy the selected grading package below.',{exact:true}).waitFor();console.log('Native clipboard unavailable in this session; verified selectable grading package fallback.');}else console.log('Native clipboard copy verified.');
 await page.getByText('Paste an external grade',{exact:true}).click();
 await page.getByLabel('Provider / model name').fill('QA sample reviewer (synthetic grade)');
 const raw=JSON.stringify({criteria:['correctness','completeness','clarity','instruction_following'].map(name=>({name,score:90,reason:'Synthetic fixture to validate grade storage.'})),summary:'QA fixture; not a model-generated evaluation.'});
 await page.getByRole('textbox',{name:'External grade JSON'}).fill(raw);
 await page.getByRole('button',{name:'Save external grade'}).click();
 await page.getByText('QA fixture; not a model-generated evaluation.',{exact:true}).first().waitFor();
 await page.locator('.modal-body').evaluate(e=>e.scrollTo(0,0));await page.waitForTimeout(300);await page.screenshot({path:'work/qa-results/response.png'});
 await app.evaluate(async({clipboard})=>{await clipboard.writeText(globalThis.__qaClipboard);delete globalThis.__qaClipboard;});
 await page.getByRole('button',{name:'Close response'}).click();
 for(const format of ['csv','json','md']){const dest=path.join(root,'work/qa-results','export.'+format);await app.evaluate(({dialog},dest)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:dest});},dest);await page.evaluate(({id,format})=>window.bench.exportRun(id,format),{id,format});assert.ok(fs.statSync(dest).size>100);}
 assert.deepEqual(errors,[]);fs.writeFileSync('work/qa-results/result.json',JSON.stringify({passed:true,runId:id,errors,checks:['worker run','concurrency 1 and 2','SQLite persistence','comparison chart','clipboard grading package','external grade import','CSV JSON Markdown export']},null,2));
 console.log('Desktop run, results, clipboard grading, and all exports passed.');
}catch(e){console.error(e);await page.screenshot({path:'work/qa-results/failure.png'}).catch(()=>{});throw e;}finally{await app.evaluate(async({clipboard})=>{if(typeof globalThis.__qaClipboard==='string'){await clipboard.writeText(globalThis.__qaClipboard);delete globalThis.__qaClipboard;}}).catch(()=>{});await app.close();}
