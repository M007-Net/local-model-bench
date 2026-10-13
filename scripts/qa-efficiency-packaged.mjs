// Verify the shipped benchmark worker with an isolated profile and HTTP fixture.
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Store} from '../electron/store.ts';
import {defaultConfig,defaultSettings} from '../src/defaults.ts';
import {selectBenchmark,benchmarkConfig,benchmarkRows} from '../src/benchmarks.ts';
const root=process.cwd(),out=path.resolve('work/qa-efficiency-packaged-'+Date.now()),data=path.join(out,'data');mkdirSync(data,{recursive:true});
const selection={packId:'token-efficiency',count:6,seed:42},tests=selectBenchmark(selection),requests=[],errors=[];
const server=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'packaged-efficiency-fixture'}]}));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
 const index=tests.findIndex(t=>t.prompt===body.messages[0].content);
 res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:index<0?'ready':tests[index].answerKey},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:index===1?'length':'stop'}],usage:{prompt_tokens:100,completion_tokens:20,completion_tokens_details:{reasoning_tokens:5}}})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const store=new Store(path.join(data,'bench.sqlite'));store.set('settings',{...defaultSettings,provider:'openai',baseUrl:'http://127.0.0.1:'+server.address().port,updateCheck:false});store.close();
let app;
try{
 app=await electron.launch({executablePath:process.env.LMB_QA_EXE||path.join(root,'outputs/win-unpacked/Local Model Bench.exe'),args:[],env:{...process.env,LMB_DATA_DIR:data}});
 const version=await app.evaluate(({app})=>app.getVersion());assert.equal(version,JSON.parse(readFileSync('package.json','utf8')).version);
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 const config={...benchmarkConfig({...defaultConfig,modelKeys:['packaged-efficiency-fixture']},selection,'Packaged synthetic QA'),maxTokens:4096,contextLength:16384,concurrency:[1,2],waves:1};
 const id=await page.evaluate(c=>window.bench.startRun(c),config);let run;
 for(let i=0;i<300;i++){run=await page.evaluate(id=>window.bench.getRun(id),id);if(run.status!=='running')break;await page.waitForTimeout(100);}
 assert.equal(run.status,'completed',run.error);const measured=run.samples.filter(s=>!s.warmup);assert.equal(measured.length,18);
 assert.ok(measured.every(s=>s.requestedOutputTokens===4096));assert.ok(measured.filter(s=>s.possibleTruncation).every(s=>s.objective.score===0));
 assert.deepEqual(benchmarkRows(run).map(r=>r.passed),[5,10]);assert.ok(benchmarkRows(run).every(r=>!r.provisional));
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByRole('heading',{name:'Token efficiency scores',exact:true}).waitFor();
 await page.getByText('83.3 / 100',{exact:true}).first().waitFor();
 await page.screenshot({path:path.join(out,'results.png'),fullPage:true});assert.deepEqual(errors,[]);
 const result={passed:true,version,noRealInference:true,measured:18,requestedBudget:4096,truncatedMisses:3,errors};writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log('Evidence: '+out);
}finally{if(app)await app.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
