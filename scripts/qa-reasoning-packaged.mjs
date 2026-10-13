import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../electron/store.ts';
import {defaultConfig,defaultSettings} from '../src/defaults.ts';
import {selectBenchmark} from '../src/benchmarks.ts';
import {comparisonConfig,reasoningSummaries} from '../src/reasoning-comparison.ts';
const out=path.resolve('work/qa-reasoning-packaged-'+Date.now()),data=path.join(out,'data');mkdirSync(data,{recursive:true});
const selection={packId:'gsm8k',count:2,seed:42},tests=selectBenchmark(selection),requests=[],errors=[];
let forceWrong=false;
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'packaged-reasoning-fixture',meta:{n_ctx:65536,n_ctx_train:131072}}]}));return;}
 if(req.url.startsWith('/props')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({chat_template:'{% if enable_thinking %}<think>...</think>{% endif %}',chat_template_caps:{supports_enable_thinking:true},default_generation_settings:{params:{reasoning_budget_tokens:-1}}}));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);const index=tests.findIndex(t=>t.prompt===body.messages[0].content);assert.ok(index>=0);
 const off=body.chat_template_kwargs?.enable_thinking===false,cutoff=body.reasoning_budget_tokens===-1&&index===1;
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{reasoning_content:off?'':'Synthetic reasoning',content:forceWrong?'wrong':off&&index===0?'0':tests[index].answerKey},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:cutoff?'length':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,completion_tokens_details:{reasoning_tokens:off?0:10}}})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const store=new Store(path.join(data,'bench.sqlite'));store.set('settings',{...defaultSettings,provider:'llamacpp',baseUrl:'http://127.0.0.1:'+server.address().port,updateCheck:false});store.close();let app;
try{
 app=await electron.launch({executablePath:process.env.LMB_QA_EXE||path.resolve('outputs/win-unpacked/Local Model Bench.exe'),args:[],env:{...process.env,LMB_DATA_DIR:data}});
 const version=await app.evaluate(({app})=>app.getVersion());assert.equal(version,JSON.parse(readFileSync('package.json','utf8')).version);
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 const config={...comparisonConfig({...defaultConfig,modelKeys:['packaged-reasoning-fixture']}),benchmark:selection,name:'Packaged reasoning QA',reasoningComparison:{settings:[{id:'off',kind:'off'},{id:'budget-512',kind:'budget',tokens:512},{id:'unlimited',kind:'unlimited'}],baselineId:'off',unlimitedPolicy:'shared-limits'},timeoutSec:30};
 const id=await page.evaluate(c=>window.bench.startRun(c),config);let run;
 for(let i=0;i<300;i++){run=await page.evaluate(id=>window.bench.getRun(id),id);if(run.status!=='running')break;await page.waitForTimeout(100);}
 assert.equal(run.status,'completed',run.error);assert.equal(requests.length,18);assert.equal(run.samples.length,18);assert.deepEqual(reasoningSummaries(run).map(r=>r.accuracy),[50,100,50]);
 assert.ok(run.samples.every(s=>s.requestedOutputTokens===32768));assert.ok(run.samples.filter(s=>s.possibleTruncation).every(s=>s.objective.score===0));
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();await page.getByRole('heading',{name:'Compare final answers',exact:true}).waitFor();assert.equal(await page.getByRole('img',{name:'Objective accuracy by reasoning setting',exact:true}).count(),1);
 await page.getByLabel('Reasoning answer filter').selectOption('worsened');await page.getByLabel('Answer baseline setting').selectOption('budget-512');await page.getByLabel('Answer comparison setting').selectOption('unlimited');assert.equal(await page.locator('.reasoning-pair').count(),3);
 await page.screenshot({path:path.join(out,'results.png'),fullPage:true});assert.deepEqual(errors,[]);
 forceWrong=true;const before=requests.length;const stoppedId=await page.evaluate(c=>window.bench.startRun(c),{...config,reasoningComparison:{...config.reasoningComparison,unlimitedPolicy:'unbounded',stopAfterConsecutiveMisses:2}});let stopped;
 for(let i=0;i<300;i++){stopped=await page.evaluate(id=>window.bench.getRun(id),stoppedId);if(stopped.status!=='running')break;await page.waitForTimeout(100);}
 assert.equal(stopped.status,'completed');assert.equal(stopped.samples.length,6);assert.ok(reasoningSummaries(stopped).every(r=>r.stop?.reason==='consecutive-misses'));
 const unlimitedRequests=requests.slice(before).filter(b=>b.reasoning_budget_tokens===-1);assert.equal(unlimitedRequests.length,2);assert.ok(unlimitedRequests.every(b=>b.max_tokens===-1));
 assert.ok(stopped.samples.filter(s=>s.reasoningSetting.kind==='unlimited').every(s=>s.requestedOutputTokens===null&&s.requestedTimeoutSec===null));writeFileSync(path.join(out,'stopped-run.json'),JSON.stringify(stopped,null,2));
 writeFileSync(path.join(out,'run.json'),JSON.stringify(run,null,2));const result={passed:true,version,noRealInference:true,requests:18,truncatedMisses:3,checks:['shipped worker','GSM8K shared cap overrides task cap','truncated final-answer miss','reasoning charts','regression answer filter','no browser errors']};writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log('Evidence: '+out);
}finally{await app?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
