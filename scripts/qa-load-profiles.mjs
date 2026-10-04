// UI and live-server checks use an isolated profile, never the user's saved runs.
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),out=path.join(root,'work','load-qa',String(Date.now()));mkdirSync(out,{recursive:true});
const live=process.env.LMB_LIVE_URL;let server,app;const errors=[];
let baseUrl=live;
if(!live){
 server=createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'load-fixture'}]}));return;}
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const frame=x=>res.write('data: '+JSON.stringify(x)+'\n\n');
  frame({choices:[{delta:{content:'A'}}]});await new Promise(r=>setTimeout(r,25));
  frame({choices:[{delta:{content:' B'}}]});await new Promise(r=>setTimeout(r,35));
  frame({choices:[{delta:{content:' C'},finish_reason:'stop'}]});frame({choices:[],usage:{prompt_tokens:Math.ceil(body.messages[0].content.length/4),completion_tokens:3}});res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));baseUrl='http://127.0.0.1:'+server.address().port;
}
try{
 app=await electron.launch({...(process.env.LMB_QA_EXECUTABLE?{executablePath:process.env.LMB_QA_EXECUTABLE,args:[]}:{args:[root]}),env:{...process.env,LMB_DATA_DIR:path.join(out,'data')},timeout:60000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>!!window.bench);
 await page.locator('nav').getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('group',{name:'Endpoint provider'}).getByRole('button',{name:/llama.cpp/}).click();
 await page.getByLabel('Server address',{exact:false}).fill(baseUrl);await page.getByRole('button',{name:'Save & test connection',exact:true}).click();
 await page.getByText('Connection saved and tested',{exact:false}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Models',exact:true}).click();
 const model=(await page.evaluate(()=>window.bench.models()))[0].key;
 await page.getByRole('button',{name:new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).first().click();
 await page.getByRole('button',{name:'Configure benchmark'}).click();
 await page.getByLabel('Load pattern',{exact:true}).selectOption('sustained');
 await page.getByLabel('Seconds per combination').fill(live?'3':'1');
 await page.getByLabel('Sweep input context sizes').check();
 await page.getByLabel('Approximate input token targets',{exact:true}).fill('256, 512');
 await page.getByLabel('Approximate input token targets',{exact:true}).press('Tab');
 await page.getByLabel('Concurrency levels',{exact:true}).fill('1, 2');await page.getByLabel('Concurrency levels',{exact:true}).press('Tab');
 await page.getByLabel('Maximum output tokens',{exact:false}).fill('64');
 await page.screenshot({path:path.join(out,'setup.png'),fullPage:true});
 await page.getByRole('button',{name:'Start benchmark',exact:true}).click();
 let started;const startDeadline=Date.now()+30000;
 do{started=await page.evaluate(()=>window.bench.snapshot());if(started.runs.length)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<startDeadline);
 writeFileSync(path.join(out,'after-click.json'),JSON.stringify({runs:started.runs,progress:started.progress},null,2));
 assert.ok(started.runs.length, 'Start did not save a run; see after-click.json');
 const runId=started.runs[0].id;
 let run;const finishDeadline=Date.now()+180000;
 do{run=await page.evaluate(id=>window.bench.getRun(id),runId);if(!['running','grading'].includes(run.status))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<finishDeadline);
 assert.equal(run.status,'completed',run.error||run.logs.join('\n'));assert.equal(run.config.loadProfile,'sustained');assert.deepEqual(run.config.contextSweep,[256,512]);
 assert.equal(run.waves.length,4);const samples=run.samples.filter(s=>!s.warmup);assert.ok(samples.length>=6);
 assert.equal(new Set(samples.map(s=>s.prompt)).size,samples.length,'Refilled requests need distinct prompt identifiers');
 assert.ok(samples.every(s=>s.metrics.streaming?.eventCount>1));assert.ok(samples.every(s=>s.metrics.streaming?.tpotMs!==null));
 assert.ok(run.waves.every(w=>w.durationMs>=run.config.durationSec*1000));
 assert.deepEqual([...new Set(samples.map(s=>s.contextTokens))].sort(),[256,512]);
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();await page.getByRole('heading',{name:'Streaming and load behavior'}).waitFor();
 await page.getByRole('heading',{name:'Streaming and load behavior'}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'timing-results.png')});
 await page.setViewportSize({width:1050,height:720});await page.screenshot({path:path.join(out,'timing-results-small.png')});
 assert.deepEqual(errors,[]);writeFileSync(path.join(out,'run.json'),JSON.stringify(run,null,2));
 console.log(JSON.stringify({passed:true,live:!!live,measured:samples.length,points:run.waves.length,contexts:run.config.contextSweep,errors,evidence:out}));
}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}
