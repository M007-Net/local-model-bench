// End-to-end transport, persistence and worker checks. Without LMB_QA_ENDPOINT this
// uses a deterministic streaming fixture; live checks preserve their actual scores.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {defaultConfig,defaultSettings} from '../src/defaults.ts';
import {defaultAgenticConfig} from '../src/agentic.ts';
const out=path.resolve(process.env.LMB_QA_OUT||'work/qa-web-'+Date.now());mkdirSync(out,{recursive:true});
const password='local-bench-qa';let port=Number(process.env.LMB_QA_PORT||0);
if(!port&&!process.env.LMB_QA_PANEL){const probe=createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve);});port=probe.address().port;await new Promise(r=>probe.close(r));}
const base=process.env.LMB_QA_PANEL||`http://127.0.0.1:${port}`;
let child,fixture,cookie='',messages='';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitServer(){for(let i=0;i<100;i++){if(child&&child.exitCode!==null)throw Error('Web server exited: '+messages);try{if((await fetch(base+'/healthz',{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}await pause(100);}throw Error('Web server did not start: '+messages);}
function start(){child=spawn(process.execPath,['dist-web/server.cjs'],{env:{...process.env,LMB_HOST:'127.0.0.1',LMB_PORT:String(port),LMB_WEB_TOKEN:password,LMB_DATA_DIR:path.join(out,'data')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>messages+=b);child.stderr.on('data',b=>messages+=b);}
async function stop(){if(!child)return;const current=child;child=undefined;if(current.exitCode!==null||current.signalCode)return;await new Promise(resolve=>{current.once('exit',resolve);current.kill('SIGTERM');});}
async function login(){const r=await fetch(base+'/login',{method:'POST',body:new URLSearchParams({token:process.env.LMB_QA_PASSWORD||password}),redirect:'manual'});assert.equal(r.status,303);cookie=r.headers.get('set-cookie').split(';')[0];}
async function call(name,args=[],upload){const r=await fetch(base+'/api/call/'+name,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-LMB-Request':'1'},body:JSON.stringify({args,upload})});const body=await r.json();assert.equal(r.status,200,body.error);return body;}
async function idle(){for(let i=0;i<1200;i++){const s=(await call('snapshot')).result;if(!s.progress&&!s.agenticProgress)return;await pause(100);}throw Error('Worker did not finish');}
try{
 let endpoint=process.env.LMB_QA_ENDPOINT,model=process.env.LMB_QA_MODEL;
 if(!endpoint){fixture=createServer(async(req,res)=>{if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'tiny-fixture'}]}));return;}if(req.url==='/v1/chat/completions'){for await(const _ of req){}res.setHeader('Content-Type','text/event-stream');res.end('data: '+JSON.stringify({choices:[{delta:{content:'42'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:2,total_tokens:14}})+'\n\ndata: [DONE]\n\n');return;}res.writeHead(404);res.end();});await new Promise(r=>fixture.listen(0,'127.0.0.1',r));endpoint='http://127.0.0.1:'+fixture.address().port;model='tiny-fixture';}
 if(!process.env.LMB_QA_PANEL)start();await waitServer();console.log("Web server ready");
 assert.equal((await fetch(base+'/api/call/snapshot',{method:'POST',headers:{'Content-Type':'application/json','X-LMB-Request':'1'},body:'{"args":[]}'})).status,401);
 assert.equal((await fetch(base+'/login',{method:'POST',body:new URLSearchParams({token:'incorrect'}),redirect:'manual'})).status,401);
 await login();console.log("Signed in");assert.equal((await fetch(base+'/api/call/snapshot',{method:'POST',headers:{Cookie:cookie,Origin:'http://untrusted.example','Content-Type':'application/json','X-LMB-Request':'1'},body:'{"args":[]}'})).status,403);
 await call('saveSettings',[{...defaultSettings,provider:'openai',baseUrl:endpoint,token:fixture?'lmb-fixture-secret':'',loadTimeoutSec:120,timeoutSec:60}]);
 console.log('Settings saved');const snapshot=(await call('snapshot')).result;assert.ok(snapshot.packs.length>0);assert.ok(Array.isArray(snapshot.harnessRuns));assert.equal(snapshot.harnessProgress,null);const diagnostic=(await call('harnessDiagnostics')).result;assert.equal(diagnostic.ready,false);assert.match(diagnostic.message,/desktop app/);const refusal=await fetch(base+'/api/call/startHarnessRun',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-LMB-Request':'1'},body:JSON.stringify({args:[{}]})});assert.equal(refusal.status,400);assert.match((await refusal.json()).error,/desktop application only/);assert.ok(!('token' in snapshot.settings));if(fixture)assert.equal(snapshot.settings.tokenConfigured,true);
 assert.ok((await call('models')).result.some(m=>m.key===model));
 await call('saveTest',[{id:'tiny-web-test',name:'Tiny model smoke test',category:'QA',version:1,prompt:'Return only the number 42.',answerKey:'42',rubric:'Return 42',maxTokens:32,rules:[{id:'answer',label:'Answer',type:'contains',expected:'42',weight:1}],kind:'quality'}]);
 console.log('Connecting progress events');const events=await fetch(base+'/api/events',{headers:{Cookie:cookie},signal:AbortSignal.timeout(120000)}),reader=events.body.getReader();assert.equal(events.status,200);
 let eventText='';const eventReading=(async()=>{while(true){const chunk=await reader.read();if(chunk.done)break;eventText+=new TextDecoder().decode(chunk.value);}})();
 const id=(await call('startRun',[{...defaultConfig,name:'Web tiny-model smoke',modelKeys:[model],testIds:['tiny-web-test'],mode:'quality',preset:'Custom',concurrency:[1,2],waves:1,maxTokens:32,contextLength:2048,temperature:0,judgeModel:'',performanceLengths:[],timeoutSec:60}])).result;
 console.log('Started benchmark '+id);await idle();const run=(await call('getRun',[id])).result;assert.equal(run.status,'completed',run.error||run.logs.join('\n'));const measured=run.samples.filter(s=>!s.warmup);assert.equal(measured.length,3);assert.ok(measured.every(s=>s.status==='completed'&&s.output));
 assert.ok(eventText.includes('event: progress'),'Live worker progress must arrive over SSE');await reader.cancel();await eventReading;
 writeFileSync(path.join(out,'benchmark.json'),JSON.stringify(run,null,2));
 for(const format of ['json','csv','md','html']){const exported=await call('exportRun',[id,format]);assert.ok(exported.download.text.length>20);writeFileSync(path.join(out,'benchmark.'+format),exported.download.text);}
 assert.ok((await call('history')).result.length>0);
 const preview=(await call('choosePackFile',[],{name:'smoke.csv',text:'prompt,answer\nWhat is 2 plus 2?,4\n'})).result;assert.equal(preview.count,1);
 const pack=(await call('importPack',[{name:'Browser import smoke',scoring:'exact',instruction:''}])).result;assert.ok(pack.id);await call('deletePack',[pack.id]);
 const agentId=(await call('startAgenticRun',[{...defaultAgenticConfig,name:'Web host sweep smoke',modelCall:'off',modelKey:'',workers:[1,2],turns:2,repeats:1,hostWorkScale:1}])).result;
 await idle();const agent=(await call('getAgenticRun',[agentId])).result;assert.equal(agent.status,'completed',agent.error);assert.equal(agent.points.length,2);const agentExport=await call('exportAgenticRun',[agentId,'json']);assert.ok(agentExport.download.text.length>20);const imported=(await call('importAgenticRun',[],{name:'agent.json',text:agentExport.download.text})).result;assert.notEqual(imported,agentId);
 if(!process.env.LMB_QA_PANEL){
  const competing=spawn(process.execPath,['dist-web/server.cjs'],{env:{...process.env,LMB_HOST:'127.0.0.1',LMB_PORT:String(port),LMB_WEB_TOKEN:password,LMB_DATA_DIR:path.join(out,'data')},stdio:['ignore','ignore','pipe']});let refusal='';competing.stderr.on('data',b=>refusal+=b);const code=await new Promise(r=>competing.once('exit',r));assert.equal(code,1);assert.match(refusal,/already using this data directory/);
  await stop();start();await waitServer();await login();assert.equal((await call('getRun',[id])).result.samples.length,run.samples.length);if(fixture)assert.equal((await call('snapshot')).result.settings.tokenConfigured,true);assert.ok((await call('models')).result.some(m=>m.key===model));
  const killed=child;await new Promise(r=>{killed.once('exit',r);killed.kill('SIGKILL');});child=undefined;start();await waitServer();await login();assert.equal((await call('getRun',[id])).result.samples.length,run.samples.length);
 }
 const result={passed:true,panel:base,endpoint,model,status:run.status,measuredSamples:measured.length,outputTokens:measured.map(s=>s.metrics.outputTokens),scores:measured.map(s=>s.objective.score),hostSweep:agent.status,checks:['login','cross-origin refusal','models','streaming inference','concurrency 1 and 2','progress events','history','four export formats','question upload','agent workers','agent export/import','persistence']};writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));console.log('Evidence: '+out);
}catch(error){console.error(messages);throw error;}finally{await stop();if(fixture){fixture.closeAllConnections();await new Promise(r=>fixture.close(r));}}
