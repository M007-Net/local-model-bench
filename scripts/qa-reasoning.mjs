// Isolated real app/worker/browser QA against a synthetic llama.cpp-shaped endpoint.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {comparisonConfig,reasoningSummaries} from '../src/reasoning-comparison.ts';
import {selectBenchmark} from '../src/benchmarks.ts';
import {defaultConfig} from '../src/defaults.ts';
const out=path.resolve('work/qa-reasoning-'+Date.now());mkdirSync(out,{recursive:true});
const selection={packId:'token-efficiency',count:2,seed:42},tests=selectBenchmark(selection),requests=[];
const ids=['reasoning-fixture','effort-fixture'];let forceWrong=false;
const endpoint=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:ids.map(id=>({id,meta:{n_ctx:65536,n_ctx_train:131072},capabilities:{reasoning:{allowed_options:id==='effort-fixture'?['low','medium','high']:['off','on'],default:'on'}}}))}));return;}
 if(req.url.startsWith('/props')){res.setHeader('Content-Type','application/json');const effort=req.url.includes('effort-fixture');res.end(JSON.stringify(effort?{chat_template:'plain',reasoning_effort_options:['low','medium','high']}:{chat_template:'{% if enable_thinking %}<think>...</think>{% endif %}',chat_template_caps:{supports_enable_thinking:true},default_generation_settings:{params:{reasoning_budget_tokens:-1}}}));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
 const index=tests.findIndex(t=>t.prompt===body.messages[0].content);assert.ok(index>=0,'Question prompt changed');
 const off=body.chat_template_kwargs?.enable_thinking===false||body.reasoning_effort==='low';
 const unlimited=body.reasoning_budget_tokens===-1||body.reasoning_effort==='high';
 const output=(off&&index===0||unlimited&&index===1)?'{}':tests[index].answerKey;
 const thought=off?'':'Synthetic reasoning.',usage={prompt_tokens:100,completion_tokens:off?10:40,completion_tokens_details:{reasoning_tokens:off?0:30}};
 res.setHeader('Content-Type','text/event-stream');
 res.write('data: '+JSON.stringify({choices:[{index:0,delta:{reasoning_content:thought,content:forceWrong?'wrong':output},finish_reason:null}]})+'\n\n');
 res.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}],...(body.model==='effort-fixture'&&index===1?{}:{usage})})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>endpoint.listen(0,'127.0.0.1',r));
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base='http://127.0.0.1:'+port,token='isolated-reasoning-qa';let child,logs='',cookie='',browser;
const pause=()=>new Promise(r=>setTimeout(r,100));
async function start(){child=spawn(process.execPath,['dist-web/server.cjs'],{env:{...process.env,LMB_PORT:String(port),LMB_HOST:'127.0.0.1',LMB_DATA_DIR:path.join(out,'data'),LMB_WEB_TOKEN:token},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);let ready=false;for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/healthz')).ok){ready=true;break;}}catch{}await pause();}assert.ok(ready,logs);const login=await fetch(base+'/login',{method:'POST',body:new URLSearchParams({token}),redirect:'manual'});assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];}
async function stop(){if(child&&child.exitCode===null){const c=child;await new Promise(r=>{c.once('exit',r);c.kill();});}child=undefined;}
async function call(name,args=[]){const response=await fetch(base+'/api/call/'+name,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-LMB-Request':'1'},body:JSON.stringify({args})});const body=await response.json();assert.equal(response.status,200,body.error);return body;}
try{
 await start();const snap=(await call('snapshot')).result;
 await call('saveSettings',[{...snap.settings,provider:'llamacpp',baseUrl:'http://127.0.0.1:'+endpoint.address().port,updateCheck:false,token:''}]);
 const discovered=(await call('models')).result;assert.equal(discovered[0].reasoningSupport.numeric,true);assert.equal(discovered[1].reasoningSupport.numeric,false);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const [name,value]=cookie.split('=');await context.addCookies([{name,value,url:base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('button',{name:'Run',exact:true}).click();await page.getByRole('button',{name:'Quality only',exact:true}).click();await page.getByRole('button',{name:'Reasoning comparison',exact:true}).click();
 assert.equal(await page.getByLabel('Thinking-token budgets',{exact:true}).inputValue(),'512, 1024, 2048, 4096');assert.equal(await page.getByLabel('Reasoning repeats').inputValue(),'3');assert.equal(await page.getByLabel('Reasoning total output tokens').inputValue(),'32768');assert.equal(await page.getByLabel('Reasoning request timeout').inputValue(),'1200');
 await page.getByLabel('Thinking-token budgets',{exact:true}).fill('bad');assert.equal(await page.getByRole('button',{name:'Start benchmark',exact:true}).isDisabled(),true);await page.getByLabel('Thinking-token budgets',{exact:true}).fill('');await page.getByLabel('Thinking-token budgets',{exact:true}).pressSequentially('2000,4000',{delay:25});assert.equal(await page.getByLabel('Thinking-token budgets',{exact:true}).inputValue(),'2000,4000');assert.ok(await page.getByLabel('Reasoning baseline').getByRole('option',{name:'2,000 thinking tokens',exact:true}).count());assert.ok(await page.getByLabel('Reasoning baseline').getByRole('option',{name:'4,000 thinking tokens',exact:true}).count());await page.screenshot({path:path.join(out,'setup.png'),fullPage:true});
 await page.getByLabel('Stop after consecutive mistakes',{exact:true}).check();assert.equal(await page.getByLabel('Consecutive mistakes to stop').inputValue(),'2');assert.equal(await page.getByLabel('Reasoning repeats').inputValue(),'1');await page.getByLabel('Stop after consecutive mistakes',{exact:true}).uncheck();
 const config={...comparisonConfig({...defaultConfig,modelKeys:ids}),name:'Synthetic reasoning comparison QA',benchmark:selection,reasoningComparison:{settings:[{id:'off',kind:'off'},{id:'budget-512',kind:'budget',tokens:512},{id:'unlimited',kind:'unlimited'}],baselineId:'off',unlimitedPolicy:'shared-limits'},timeoutSec:30};
 const id=(await call('startRun',[config])).result;let run;
 for(let i=0;i<300;i++){run=(await call('getRun',[id])).result;if(run.status!=='running')break;await pause();}
 assert.equal(run.status,'completed',run.error);assert.equal(run.samples.length,36);assert.equal(requests.length,36);assert.ok(run.samples.every(s=>s.requestedOutputTokens===32768&&s.reasoningSetting&&s.reasoningRepeat!==undefined));
 const rows=reasoningSummaries(run);assert.equal(rows.length,6);assert.deepEqual(rows.filter(r=>r.modelKey===ids[0]).map(r=>r.accuracy),[50,100,50]);assert.deepEqual(rows.filter(r=>r.modelKey===ids[1]).map(r=>r.accuracy),[50,100,50]);assert.ok(rows.filter(r=>r.modelKey===ids[1]).every(r=>r.outputCoverage===3));
 await page.getByRole('button',{name:'Results',exact:true}).click();await page.getByRole('heading',{name:'Compare final answers',exact:true}).waitFor();assert.equal(await page.getByRole('img',{name:'Objective accuracy by reasoning setting',exact:true}).count(),2);
 await page.getByLabel('Reasoning answer filter').selectOption('improved');assert.equal(await page.locator('.reasoning-pair').count(),3);await page.locator('.reasoning-pair').first().locator('summary').first().click();await page.screenshot({path:path.join(out,'results.png'),fullPage:true});
 for(const format of ['json','csv','md','html']){const exported=await call('exportRun',[id,format]);assert.ok(exported.download.text.length>100);if(format==='csv')assert.match(exported.download.text.split('\n')[0],/"delta"/);if(format==='html')assert.match(exported.download.text,/Final answer comparison/);writeFileSync(path.join(out,'comparison.'+format),exported.download.text);}
 forceWrong=true;const before=requests.length;
 const stoppedConfig={...config,modelKeys:[ids[0]],reasoningComparison:{...config.reasoningComparison,unlimitedPolicy:undefined,stopAfterConsecutiveMisses:2}};
 const stoppedId=(await call('startRun',[stoppedConfig])).result;let stopped;
 for(let i=0;i<300;i++){stopped=(await call('getRun',[stoppedId])).result;if(stopped.status!=='running')break;await pause();}
 assert.equal(stopped.status,'completed');assert.equal(stopped.config.reasoningComparison.unlimitedPolicy,'unbounded');assert.equal(stopped.samples.length,6);assert.ok(reasoningSummaries(stopped).every(r=>r.stop?.reason==='consecutive-misses'));
 assert.ok(requests.slice(before).filter(b=>b.reasoning_budget_tokens===-1).every(b=>b.max_tokens===-1));assert.ok(stopped.samples.filter(s=>s.reasoningSetting.kind==='unlimited').every(s=>s.requestedOutputTokens===null&&s.requestedTimeoutSec===null));
 await page.getByRole('button',{name:'Results',exact:true}).click();await page.getByRole('heading',{name:'Compare final answers',exact:true}).waitFor();assert.ok(await page.getByText('Stopped after 2 consecutive mistakes at attempt 2.',{exact:false}).count());await page.screenshot({path:path.join(out,'stopped-results.png'),fullPage:true});
 for(const format of ['json','csv','md','html']){const exported=await call('exportRun',[stoppedId,format]);assert.ok(exported.download.text.length>100);writeFileSync(path.join(out,'stopped.'+format),exported.download.text);}
 assert.deepEqual(errors,[]);await browser.close();browser=undefined;await stop();await start();const saved=(await call('getRun',[id])).result;assert.equal(saved.samples.length,36);assert.equal(reasoningSummaries(saved).length,6);const persistedStop=(await call('getRun',[stoppedId])).result;assert.ok(reasoningSummaries(persistedStop).every(r=>r.stop?.reason==='consecutive-misses'));
 writeFileSync(path.join(out,'run.json'),JSON.stringify(saved,null,2));const result={passed:true,noRealInference:true,requests:requests.length,models:2,settingsPerModel:3,repeats:3,checks:['browser configuration','invalid custom budget blocked','real workers and streaming','per-model numeric/effort controls','paired answer filter','per-setting scores','missing usage coverage','four exports','restart persistence','no browser errors']};writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log('Evidence: '+out);
}finally{await browser?.close();await stop();endpoint.closeAllConnections();await new Promise(r=>endpoint.close(r));}
