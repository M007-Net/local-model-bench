// Real web workers and streaming transport, exclusively synthetic endpoint replies.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {selectBenchmark,benchmarkConfig,benchmarkRows} from '../src/benchmarks.ts';
import {defaultConfig} from '../src/defaults.ts';
const out=path.resolve('work/qa-efficiency-web-'+Date.now());mkdirSync(out,{recursive:true});
const selection={packId:'token-efficiency',count:6,seed:42},tests=selectBenchmark(selection),requests=[];
let missing=false,child,logs='',cookie='';
const endpoint=createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'efficiency-fixture'}]}));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);requests.push(body);
 const index=tests.findIndex(t=>t.prompt===body.messages[0].content),warmup=index<0;
 const output=warmup?'ready':index===3?'{}':index===4?'{"x":1,"x":1}':tests[index].answerKey;
 const finish=index===5?'length':'stop';
 res.setHeader('Content-Type','text/event-stream');
 res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:output},finish_reason:null}]})+'\n\n');
 res.end('data: '+JSON.stringify({choices:[{index:0,delta:{},finish_reason:finish}],...(!(missing&&index===0)?{usage:{prompt_tokens:100,completion_tokens:20,completion_tokens_details:{reasoning_tokens:5}}}:{})})+'\n\ndata: [DONE]\n\n');
});
await new Promise(r=>endpoint.listen(0,'127.0.0.1',r));
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base='http://127.0.0.1:'+port,token='isolated-efficiency-qa';
const pause=()=>new Promise(r=>setTimeout(r,100));
async function start(){
 child=spawn(process.execPath,['dist-web/server.cjs'],{env:{...process.env,LMB_PORT:String(port),LMB_HOST:'127.0.0.1',LMB_DATA_DIR:path.join(out,'data'),LMB_WEB_TOKEN:token},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/healthz')).ok)break;}catch{}await pause();}
 const login=await fetch(base+'/login',{method:'POST',body:new URLSearchParams({token}),redirect:'manual'});assert.equal(login.status,303);cookie=login.headers.get('set-cookie').split(';')[0];
}
async function stop(){if(child&&child.exitCode===null){const c=child;await new Promise(r=>{c.once('exit',r);c.kill();});}child=undefined;}
async function call(name,args=[]){const response=await fetch(base+'/api/call/'+name,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-LMB-Request':'1'},body:JSON.stringify({args})});const body=await response.json();assert.equal(response.status,200,body.error);return body;}
try{
 await start();const s=(await call('snapshot')).result;
 await call('saveSettings',[{...s.settings,provider:'openai',baseUrl:'http://127.0.0.1:'+endpoint.address().port,updateCheck:false,token:''}]);
 const runs=[];
 for(const budget of [4096,32]){
  missing=budget===32;
  const config={...benchmarkConfig({...defaultConfig,modelKeys:['efficiency-fixture']},selection,'Synthetic efficiency QA'),maxTokens:budget,contextLength:16384,concurrency:[1,2],waves:2,reasoning:'default',timeoutSec:30};
  const id=(await call('startRun',[config])).result;let run;
  for(let i=0;i<300;i++){run=(await call('getRun',[id])).result;if(run.status!=='running')break;await pause();}
  assert.equal(run.status,'completed',run.error);const rows=benchmarkRows(run);assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r.expected),[12,24]);assert.deepEqual(rows.map(r=>r.score),[50,50]);assert.ok(rows.every(r=>!r.provisional));
  for(const sample of run.samples.filter(s=>!s.warmup)){assert.equal(sample.requestedOutputTokens,budget);if(sample.possibleTruncation)assert.equal(sample.objective.score,0);}
  assert.ok(rows.every(r=>missing?r.efficiency.correctPerThousandOutput===null:r.efficiency.correctPerThousandOutput===25));
  for(const format of ['json','csv','md','html']){const exported=await call('exportRun',[id,format]);assert.ok(exported.download.text.length>100);if(['md','html'].includes(format))assert.match(exported.download.text,/correct\/1,000 output tokens/);writeFileSync(path.join(out,id+'.'+format),exported.download.text);}
  writeFileSync(path.join(out,id+'-rows.json'),JSON.stringify(rows,null,2));runs.push(id);
 }
 assert.equal(requests.filter(r=>tests.some(t=>t.prompt===r.messages[0].content)).length,72);
 await stop();await start();assert.equal((await call('getRun',[runs[0]])).result.samples.filter(s=>!s.warmup).length,36);
 const result={passed:true,noRealInference:true,measuredRequests:72,budgets:[4096,32],checks:['real worker requests','concurrency and waves','warmup exclusion','wrong and malformed misses','truncated detail scores','reasoning subset not double-counted','missing usage unavailable','four report formats','restart persistence']};
 writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log('Evidence: '+out);
}finally{await stop();endpoint.closeAllConnections();await new Promise(r=>endpoint.close(r));}
