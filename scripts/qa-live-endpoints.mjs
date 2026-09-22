import {_electron as electron} from 'playwright';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),out=path.join(root,'work','full-qa','live-'+Date.now());mkdirSync(out,{recursive:true});
const key=process.env.LMB_MODEL_KEY;if(!key)throw Error('LMB_MODEL_KEY is required');
const lms=process.env.LMB_LMS_PATH;if(!lms)throw Error('LMB_LMS_PATH is required');
const instance='lmb-live-qa-'+Date.now(),runs=[];let owned=false,app;
const cli=(args)=>promisify(execFile)(lms,args,{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
try{
 app=await electron.launch({args:[root,'--user-data-dir='+path.join(out,'chromium')],env:{...process.env,LMB_DATA_DIR:path.join(out,'data')},timeout:60000});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.evaluate(()=>window.bench.saveTest({id:'live-answer',name:'Real inference answer',category:'QA',version:1,prompt:'Return only the number 42.',answerKey:'42',rubric:'Return 42',maxTokens:128,rules:[{id:'answer',label:'Answer',type:'contains',expected:'42',weight:1}],kind:'quality'}));
 const run=async(provider,model)=>{
  await page.evaluate(async({provider,lms})=>{const s=await window.bench.snapshot();await window.bench.saveSettings({...s.settings,provider,baseUrl:'http://127.0.0.1:1234',lmsPath:lms,token:'',loadTimeoutSec:180,timeoutSec:60});},{provider,lms});
  const id=await page.evaluate(({provider,model})=>window.bench.startRun({name:'Real '+provider+' smoke test',modelKeys:[model],testIds:['live-answer'],mode:'quality',preset:'Custom',concurrency:[1,2],waves:1,maxTokens:128,contextLength:2048,temperature:0,gpu:'auto',reasoning:provider==='lmstudio'?'off':'default',judgeModel:'',performanceLengths:[],timeoutSec:60}),{provider,model});
  console.log('Started '+provider+' '+id);const deadline=Date.now()+240000;let result;
  do{result=await page.evaluate(id=>window.bench.getRun(id),id);if(!['running','grading'].includes(result.status))break;await new Promise(r=>setTimeout(r,500));}while(Date.now()<deadline);
  writeFileSync(path.join(out,provider+'.json'),JSON.stringify(result,null,2));
  assert.equal(result.status,'completed',result.error||result.logs.join('\n'));
  const samples=result.samples.filter(s=>!s.warmup);assert.equal(samples.length,3);assert.ok(samples.every(s=>s.status==='completed'&&(s.output||s.reasoning)));
  while((await page.evaluate(()=>window.bench.snapshot())).progress)await new Promise(r=>setTimeout(r,100));
  runs.push({provider,status:result.status,samples:samples.length,scores:samples.map(s=>s.objective.score),outputTokens:samples.map(s=>s.metrics.outputTokens)});console.log('PASS '+provider+' real inference');
 };
 await run('lmstudio',key);
 await cli(['load',key,'--identifier',instance,'--context-length','4096','--parallel','2','--yes']);owned=true;
 await run('openai',instance);
 await run('llamacpp',instance);
 writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,model:key,server:'LM Studio native and compatible APIs (not standalone llama-server)',runs},null,2));console.log('Evidence: '+out);
}catch(e){console.error(e);process.exitCode=1;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});if(owned)await cli(['unload',instance]).catch(e=>console.error('QA model cleanup: '+e.message));}
