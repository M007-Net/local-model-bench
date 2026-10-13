// Independent review QA: all requests go to this local fixture and use an isolated profile.
// Run after npm run build: node --import tsx scripts/qa-benchmark-parity.mjs
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {exportText,summaries} from '../electron/export.ts';
import {chartReport} from '../electron/chart-report.ts';

const root=process.cwd(),out=path.join(root,'work','benchmark-parity-qa',String(Date.now()));
mkdirSync(out,{recursive:true});
const requests=[],errors=[];let app;
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'parity-fixture'}]}));return;}
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw),prompt=body.messages[0].content;
 requests.push({prompt,max:body.max_tokens});
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const frame=x=>res.write('data: '+JSON.stringify(x)+'\n\n');
 frame({choices:[{delta:{role:'assistant',content:''}}]});
 frame({choices:[{delta:{content:'Fixture'}}]});
 await new Promise(resolve=>setTimeout(resolve,35));
 frame({choices:[{delta:{content:' response.'},finish_reason:'stop'}]});
 frame({choices:[],usage:{prompt_tokens:Math.ceil(prompt.length/3)+9,completion_tokens:Math.min(8,body.max_tokens),prompt_tokens_details:{cached_tokens:0}}});
 res.end('data: [DONE]\n\n');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const baseUrl='http://127.0.0.1:'+server.address().port;
try{
 app=await electron.launch({args:[root],env:{...process.env,LMB_DATA_DIR:path.join(out,'data')},timeout:60000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.waitForFunction(()=>!!window.bench);
 await page.locator('nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('group',{name:'Endpoint provider'}).getByRole('button',{name:/llama.cpp/}).click();
 await page.getByLabel('Server address',{exact:false}).fill(baseUrl);
 await page.getByRole('button',{name:'Save & test connection',exact:true}).click();
 await page.getByText('Connection saved and tested',{exact:false}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Models',exact:true}).click();
 await page.getByRole('button',{name:/parity-fixture/}).first().click();
 await page.getByRole('button',{name:'Configure benchmark'}).click();
 await page.getByLabel('Sweep input context sizes').check();
 await page.getByLabel('Approximate input token targets',{exact:true}).fill('256');
 await page.getByLabel('Approximate input token targets',{exact:true}).press('Tab');
 await page.getByLabel('Concurrency levels',{exact:true}).fill('1');
 await page.getByLabel('Concurrency levels',{exact:true}).press('Tab');
 await page.getByLabel('Waves per test',{exact:false}).fill('3');
 await page.getByLabel('Maximum output tokens',{exact:false}).fill('32');
 await page.getByLabel('Cache protocol intent').selectOption('cached-prefix-followup');
 await page.getByLabel('Prefix target tokens').fill('64');
 await page.getByLabel('Input adaptation tolerance (%)',{exact:false}).fill('5');
 await page.screenshot({path:path.join(out,'controlled-setup.png'),fullPage:true});

 async function runFromUi(){
  const prior=new Set((await page.evaluate(()=>window.bench.snapshot())).runs.map(r=>r.id));
  await page.getByRole('button',{name:'Start benchmark',exact:true}).click();
  let run;const deadline=Date.now()+60000;
  while(Date.now()<deadline){
   const snapshot=await page.evaluate(()=>window.bench.snapshot());
   const item=snapshot.runs.find(r=>!prior.has(r.id));
   if(item){run=await page.evaluate(id=>window.bench.getRun(id),item.id);if(!['running','grading'].includes(run.status))break;}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(run,'UI start should create a run');
  assert.equal(run.status,'completed',run.error||run.logs.join('\n'));
  return run;
 }
 const controlled=await runFromUi(),measured=controlled.samples.filter(s=>!s.warmup);
 assert.equal(measured.length,3);
 assert.ok(measured.every(s=>s.metrics.generationTps===null&&s.metrics.clientGenerationTps>0));
 assert.ok(measured.every(s=>s.inputTargetTokens===256&&s.inputWithinTolerance===true),JSON.stringify(measured.map(s=>({target:s.inputTargetTokens,within:s.inputWithinTolerance,actual:s.metrics.inputTokens,probes:s.inputProbeTokens}))));
 assert.ok(measured.every(s=>s.cacheMode==='cached-prefix-followup'&&s.cachePrimeInputTokens>0));
 assert.ok(measured.every(s=>s.requestedOutputTokens===32&&s.metrics.outputTokens===8));
 assert.ok(measured.every(s=>s.metrics.streaming?.timeline?.buckets.length>0));
 const row=summaries(controlled)[0];assert.equal(row.clientGenerationN,3);assert.equal(row.generationN,0);
 assert.equal(controlled.environment.inferenceServer.hostCpu.value,null);
 for(const format of ['json','csv','md'])writeFileSync(path.join(out,'controlled.'+format),exportText(controlled,format));
 writeFileSync(path.join(out,'controlled.html'),chartReport(controlled));
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('heading',{name:'Streaming and load behavior'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'controlled-results.png')});
 await page.locator('nav').getByRole('button',{name:'Run',exact:true}).click();
 await page.getByLabel('Cache protocol intent').selectOption('cold-prompt');
 await page.getByLabel('Sweep input context sizes').uncheck();
 await page.getByLabel('Load pattern',{exact:true}).selectOption('arrival-rate');
 await page.getByLabel('Target arrivals per second').fill('4');
 await page.getByLabel('Offer interval (seconds)').fill('1');
 await page.getByLabel('Response latency target (ms)').fill('1000');
 const arrival=await runFromUi();assert.equal(arrival.waves.length,1);
 assert.equal(arrival.waves[0].arrival.planned,4);assert.equal(arrival.waves[0].arrival.started,4);
 assert.ok(arrival.waves[0].durationMs>=1000);
 for(const format of ['json','csv','md'])writeFileSync(path.join(out,'arrival.'+format),exportText(arrival,format));
 writeFileSync(path.join(out,'arrival.html'),chartReport(arrival));
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('heading',{name:'Streaming and load behavior'}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(out,'arrival-results.png')});
 assert.deepEqual(errors,[]);
 writeFileSync(path.join(out,'summary.json'),JSON.stringify({passed:true,controlledRequests:measured.length,arrivalRequests:arrival.waves[0].arrival.started,fixtureRequests:requests.length,errors},null,2));
 console.log(JSON.stringify({passed:true,evidence:out,fixtureRequests:requests.length}));
}finally{
 if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
