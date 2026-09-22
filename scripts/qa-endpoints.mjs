// Desktop integration check against a deterministic OpenAI-compatible HTTP fixture.
// No real models, credentials, or saved user data are used.
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),out=path.join(root,'work','qa-endpoints',String(Date.now()));
mkdirSync(out,{recursive:true});
const requests=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 requests.push({url:req.url,method:req.method,body:raw?JSON.parse(raw):null});
 if(req.url==='/v1/models'){
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({object:'list',data:[{id:'fixture-model',object:'model',owned_by:'fixture'}]}));return;
 }
 if(req.url==='/v1/chat/completions'){
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  for(const data of [
   {choices:[{index:0,delta:{role:'assistant',content:'42'},finish_reason:null}]},
   {choices:[{index:0,delta:{},finish_reason:'stop'}]},
   {choices:[],usage:{prompt_tokens:12,completion_tokens:1,total_tokens:13}},
  ])res.write('data: '+JSON.stringify(data)+'\n\n');
  res.end('data: [DONE]\n\n');return;
 }
 res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Unexpected fixture route'}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseUrl='http://127.0.0.1:'+server.address().port;
let app;const errors=[];
try{
 app=await electron.launch({...(process.env.LMB_QA_EXECUTABLE?{executablePath:process.env.LMB_QA_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,LMB_DATA_DIR:path.join(out,'data')},timeout:60000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>!!window.bench);
 await page.locator('nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('group',{name:'Endpoint provider'}).getByRole('button',{name:/llama.cpp/}).click();
 await page.getByLabel('Server address',{exact:false}).fill(baseUrl+'/v1');
 await page.getByRole('button',{name:'Save & test connection',exact:true}).click();
 await page.getByText('Connection saved and tested',{exact:false}).waitFor();
 await page.reload();
 await page.waitForFunction(()=>document.body.innerText.includes('fixture-model'));
 await page.screenshot({path:path.join(out,'models.png'),fullPage:true});
 const snapshot=await page.evaluate(()=>window.bench.snapshot());
 assert.equal(snapshot.settings.provider,'llamacpp');assert.equal(snapshot.settings.baseUrl,baseUrl);
 assert.ok(!('token' in snapshot.settings));
 assert.deepEqual(await page.evaluate(()=>window.bench.runtimes()),[]);
 await page.locator('nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.screenshot({path:path.join(out,'settings.png'),fullPage:true});
 const id=await page.evaluate(async()=>{
  const t=await window.bench.saveTest({id:'endpoint-qa',name:'Endpoint answer',category:'QA',version:1,prompt:'Return only 42.',answerKey:'42',rubric:'Return 42',maxTokens:8,rules:[{id:'answer',label:'Correct answer',type:'exact',expected:'42',weight:1}],kind:'quality'});
  return window.bench.startRun({name:'Endpoint integration',modelKeys:['fixture-model'],testIds:[t.id],mode:'quality',preset:'Custom',concurrency:[1,2],waves:1,maxTokens:8,contextLength:512,temperature:0,gpu:'auto',reasoning:'default',judgeModel:'',performanceLengths:[],timeoutSec:10});
 });
 console.log('Started fixture benchmark '+id);
 let run;const deadline=Date.now()+60000;
 do{run=await page.evaluate(id=>window.bench.getRun(id),id);if(!['running','grading'].includes(run.status))break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
 assert.equal(run.status,'completed',run.error||run.logs.join('\n'));
 const measured=run.samples.filter(s=>!s.warmup);assert.equal(measured.length,3);
 for(const sample of measured){assert.equal(sample.output,'42');assert.equal(sample.objective.score,100);assert.equal(sample.metrics.outputTokens,1);}
 const agentId=await page.evaluate(()=>window.bench.startAgenticRun({name:'Endpoint agent sweep',modelCall:'on',modelKey:'fixture-model',modelName:'fixture-model',instance:'loaded',instanceId:'fixture-model',turns:2,workers:[1],repeats:1,hostWorkScale:1,maxTokens:8,contextLength:512,temperature:0,reasoning:'default',timeoutSec:10,prompt:'Reply 42',cacheK:'off',cacheV:'off',flashAttention:'on'}));
 let sweep;const sweepDeadline=Date.now()+60000;
 do{sweep=await page.evaluate(id=>window.bench.getAgenticRun(id),agentId);if(sweep.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<sweepDeadline);
 assert.equal(sweep.status,'completed',sweep.error||sweep.logs.join('\n'));
 assert.ok(!requests.some(r=>r.url.startsWith('/api/')),'External mode must never call LM Studio APIs');
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.screenshot({path:path.join(out,'results.png'),fullPage:true});
 await page.setViewportSize({width:1050,height:720});
 await page.locator('nav').getByRole('button',{name:'Models',exact:true}).click();
 await page.screenshot({path:path.join(out,'models-small.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,requests:requests.length,measured:measured.length,agentSweep:sweep.status,errors},null,2));
 console.log('Endpoint desktop integration passed. Evidence: '+out);
}catch(error){console.error(error);throw error;}
finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
