// No inference: local HTTP fixture answers discovery only. Any POST fails the check.
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../electron/store.ts';
import {defaultConfig,defaultSettings} from '../src/defaults.ts';
import {selectBenchmark,benchmarkConfig} from '../src/benchmarks.ts';
import {objectiveScore} from '../electron/scoring.ts';
const root=process.cwd(),out=path.join(root,'work','efficiency-qa',String(Date.now())),data=path.join(out,'data');
mkdirSync(data,{recursive:true});
const calls=[],errors=[];
const server=createServer((req,res)=>{calls.push({method:req.method,url:req.url});res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url==='/v1/models')res.end(JSON.stringify({data:[{id:'offline-ui-fixture'}]}));
 else {res.writeHead(500);res.end(JSON.stringify({error:'No inference permitted in UI verification'}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const store=new Store(path.join(data,'bench.sqlite'));
store.set('settings',{...defaultSettings,provider:'openai',baseUrl:'http://127.0.0.1:'+server.address().port,updateCheck:false});
const selection={packId:'token-efficiency',count:6,seed:42},tests=selectBenchmark(selection),now=new Date().toISOString();
const config=benchmarkConfig({...defaultConfig,modelKeys:['offline-ui-fixture']},selection,'OFFLINE UI FIXTURE — no model measured');
config.name='OFFLINE UI FIXTURE — no model measured';
const run={id:'offline-efficiency-fixture',created:now,updated:now,status:'completed',config,tests,modelInfo:{},environment:{purpose:'Synthetic UI verification only; no model results'},logs:[],waves:[],samples:tests.map((t,i)=>({id:'fixture-'+i,runId:'offline-efficiency-fixture',testId:t.id,testName:t.name,modelKey:'offline-ui-fixture',modelName:'Offline fixture',concurrency:1,wave:0,worker:0,warmup:false,status:'completed',prompt:t.prompt,output:i<2?'wrong':t.answerKey,objective:objectiveScore(i<2?'wrong':t.answerKey,t),metrics:{durationMs:1,inputTokens:100,outputTokens:20,generationTps:null,prefillTps:null,prefillMs:null,ttftMs:null,firstContentMs:null,prefillMethod:'fixture',cacheNote:'fixture'},grades:[],started:now,finished:now}))};
store.saveRun(run);for(const s of run.samples)store.saveSample(s);store.close();
let app;
try{
 const executablePath=process.env.LMB_QA_EXE;
 app=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:[root]}),env:{...process.env,LMB_DATA_DIR:data},timeout:60000});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.locator('nav').getByRole('button',{name:'Benchmarks',exact:true}).click();
 await page.locator('.benchmark-card').filter({has:page.getByRole('heading',{name:'Token efficiency',exact:false})}).click();
 assert.equal(await page.getByLabel('Questions per model').inputValue(),'36');
 await page.getByText('Original synthetic suite, scored deterministically.',{exact:false}).waitFor();
 await page.screenshot({path:path.join(out,'library.png'),fullPage:true});
 await page.getByLabel('Questions per model').selectOption('60');
 await page.getByRole('button',{name:'Use Token efficiency',exact:true}).click();
 await page.getByText('60 questions · seed 42',{exact:false}).waitFor();
 assert.equal(await page.getByLabel('Maximum output tokens',{exact:false}).inputValue(),'2048');
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('heading',{name:'Token efficiency scores',exact:true}).waitFor();
 await page.getByText('Average output tokens: 20.0',{exact:false}).waitFor();
 await page.getByText('Correct / 1,000 output tokens: 33.33',{exact:false}).waitFor();
 await page.getByText('Token counts reported: 6/6 attempts',{exact:false}).waitFor();
 await page.screenshot({path:path.join(out,'results.png'),fullPage:true});
 assert.deepEqual(errors,[]);assert.ok(calls.every(c=>c.method==='GET'&&c.url==='/v1/models'),JSON.stringify(calls));
 writeFileSync(path.join(out,'validation.json'),JSON.stringify({passed:true,noInference:true,calls,errors,checks:['original-suite labeling','balanced 36 default','all 60 selection transferred','2048 output budget','saved fixture rendering','token usage and efficiency ratios']},null,2));
 console.log('Token efficiency desktop QA passed with no inference. Evidence: '+out);
}finally{if(app)await app.close();await new Promise(resolve=>server.close(resolve));}
