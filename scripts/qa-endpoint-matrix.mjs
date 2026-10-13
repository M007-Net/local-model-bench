import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(),out=path.join(root,'work','full-qa','endpoints-'+Date.now());mkdirSync(out,{recursive:true});
const checks=[],requests=[],errors=[];let mode='success',requireToken=false,redirectTarget='';
const fakeToken='lmb-qa-only-not-a-real-secret';
const handler=async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;
 const body=text?JSON.parse(text):null;requests.push({url:req.url,auth:req.headers.authorization,body});
 if(requireToken&&req.headers.authorization!=='Bearer '+fakeToken){res.writeHead(401);res.end('Unauthorized');return;}
 if(mode==='redirect'){res.writeHead(307,{Location:redirectTarget});res.end();return;}
 if(req.url==='/v1/models'){
  if(mode==='bad-list'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{broken');return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:mode==='empty'?[]:[{id:'fixture-model'}]}));return;
 }
 if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end('Wrong API');return;}
 const warm=body.messages[0].content.endsWith('Reply with the word ready.');
 if(mode==='http500'&&!warm){res.writeHead(500);res.end('Fixture failure');return;}
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const frame=data=>res.write('data: '+JSON.stringify(data)+'\n\n');
 if((mode==='slow'||mode==='timeout')&&!warm){frame({choices:[{delta:{content:'partial'}}]});return;}
 const grade=JSON.stringify({criteria:['correctness','completeness','clarity','instruction_following'].map(name=>({name,score:100,reason:'Fixture verified'})),summary:'Fixture grade'});
 const answer=mode==='grade'?grade:'42';
 frame({choices:[{index:0,delta:{content:answer}}]});
 if(mode!=='truncated'||warm)frame({choices:[{index:0,delta:{},finish_reason:'stop'}]});
 if(mode!=='no-usage')frame({choices:[],usage:{prompt_tokens:12,completion_tokens:1,total_tokens:13}});
 res.end('data: [DONE]\n\n');
};
const servers=[createServer(handler),createServer(handler)];
for(const server of servers)await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const urls=servers.map(s=>'http://127.0.0.1:'+s.address().port);
let app,page;
const launch=async()=>{app=await electron.launch({executablePath:path.join(root,'outputs','win-unpacked','Local Model Bench.exe'),args:['--user-data-dir='+path.join(out,'chromium')],env:{...process.env,LMB_DATA_DIR:path.join(out,'data')},timeout:60000});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();};
const close=async()=>{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});app=null;}};
const save=async(patch)=>page.evaluate(async patch=>{const {settings}=await window.bench.snapshot();await window.bench.saveSettings({...settings,...patch});},patch);
const models=()=>page.evaluate(()=>window.bench.models());
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
const idle=async()=>{const deadline=Date.now()+20000;while(Date.now()<deadline){const s=await page.evaluate(()=>window.bench.snapshot());if(!s.progress&&!s.agenticProgress)return;await new Promise(r=>setTimeout(r,50));}throw Error('Workers did not become idle');};
const start=()=>page.evaluate(()=>window.bench.startRun({name:'Matrix check',modelKeys:['fixture-model'],testIds:['matrix-answer'],mode:'quality',preset:'Custom',concurrency:[1,2],waves:1,maxTokens:8,contextLength:512,temperature:0,gpu:'auto',reasoning:'default',judgeModel:'',performanceLengths:[],timeoutSec:1}));
const result=async id=>{await idle();return page.evaluate(id=>window.bench.getRun(id),id);};
try{
 await launch();
 await check('Legacy settings migrate to LM Studio',async()=>{assert.equal((await page.evaluate(()=>window.bench.snapshot())).settings.provider,'lmstudio');});
 await save({provider:'llamacpp',baseUrl:urls[0]+'/v1',token:fakeToken});requireToken=true;
 await check('Authenticated discovery and token isolation',async()=>{assert.equal((await models())[0].key,'fixture-model');const s=await page.evaluate(()=>window.bench.snapshot());assert.equal(s.settings.tokenConfigured,true);assert.ok(!JSON.stringify(s).includes(fakeToken));});
 await check('Omitted token survives same-endpoint save',async()=>{await save({timeoutSec:10});assert.equal((await models()).length,1);});
 await check('Token persists encrypted across application restart',async()=>{await close();await launch();assert.equal((await models()).length,1);for(const f of ['bench.sqlite','bench.sqlite-wal']){try{assert.ok(!readFileSync(path.join(out,'data',f)).includes(Buffer.from(fakeToken)));}catch(e){if(e.code!=='ENOENT')throw e;}}});
 await check('Changing provider clears saved token',async()=>{await save({provider:'openai'});assert.equal((await page.evaluate(()=>window.bench.snapshot())).settings.tokenConfigured,false);await assert.rejects(models(),/401/);});
 await save({token:fakeToken});await models();
 await check('Changing origin clears saved token',async()=>{await save({baseUrl:urls[1]});assert.equal((await page.evaluate(()=>window.bench.snapshot())).settings.tokenConfigured,false);await assert.rejects(models(),/401/);});
 requireToken=false;
 await check('Invalid settings rejected without changing saved connection',async()=>{await assert.rejects(save({baseUrl:'http://user:password@localhost:8080'}),/token/);assert.equal((await page.evaluate(()=>window.bench.snapshot())).settings.baseUrl,urls[1]);});
 await check('Redirects refused instead of forwarding requests',async()=>{mode='redirect';redirectTarget=urls[0]+'/v1/models';await assert.rejects(models());mode='success';});
 await check('Empty and malformed model responses handled',async()=>{mode='empty';assert.equal((await models()).length,0);mode='bad-list';await assert.rejects(models(),/JSON/);mode='success';});
 await check('External modes reject local model-management actions',async()=>{assert.deepEqual(await page.evaluate(()=>window.bench.runtimes()),[]);await assert.rejects(page.evaluate(()=>window.bench.startServer()),/loopback LM Studio/);await assert.rejects(page.evaluate(()=>window.bench.makeTextOnly('fixture-model')),/local LM Studio/);});
 await page.evaluate(()=>window.bench.saveTest({id:'matrix-answer',name:'Matrix answer',category:'QA',version:1,prompt:'Return only 42.',answerKey:'42',rubric:'Return 42',maxTokens:8,rules:[{id:'answer',label:'Answer',type:'exact',expected:'42',weight:1}],kind:'quality'}));
 let goodId,failedId;
 await check('Generic endpoint concurrency and exact scoring',async()=>{goodId=await start();const run=await result(goodId);assert.equal(run.status,'completed');assert.equal(run.samples.filter(s=>!s.warmup&&s.objective.score===100).length,3);});
 await check('Missing usage stays unavailable',async()=>{mode='no-usage';const run=await result(await start());assert.equal(run.status,'completed');assert.ok(run.samples.every(s=>s.metrics.outputTokens===null&&s.metrics.generationTps===null));mode='success';});
 await check('Server failures are saved as failed samples',async()=>{mode='http500';failedId=await start();const run=await result(failedId);assert.equal(run.status,'failed');assert.equal(run.samples.filter(s=>!s.warmup&&s.status==='failed').length,3);mode='success';});
 await check('Retry rejects a different endpoint or provider',async()=>{await save({baseUrl:urls[0]});await assert.rejects(page.evaluate(id=>window.bench.retry(id),failedId),/original endpoint/);await save({baseUrl:urls[1],provider:'llamacpp'});await assert.rejects(page.evaluate(id=>window.bench.retry(id),failedId),/original endpoint/);await save({provider:'openai'});});
 await check('Retry executes failed requests on original endpoint',async()=>{const id=await page.evaluate(id=>window.bench.retry(id),failedId);const run=await result(id);assert.equal(run.status,'completed');assert.equal(run.samples.filter(s=>!s.warmup).length,3);});
 await check('Truncated streams fail rather than score partial responses',async()=>{mode='truncated';const run=await result(await start());assert.equal(run.status,'failed');assert.ok(run.samples.filter(s=>!s.warmup).every(s=>s.objective.score===null));mode='success';});
 await check('Timeouts stop stalled streams',async()=>{mode='timeout';const run=await result(await start());assert.equal(run.status,'failed');assert.equal(run.samples.filter(s=>!s.warmup&&s.status==='timeout').length,3);mode='success';});
 await check('Cancel blocks concurrent settings changes and releases worker',async()=>{mode='slow';const id=await start();await assert.rejects(save({timeoutSec:15}),/active/);await page.evaluate(()=>window.bench.cancel());const run=await result(id);assert.equal(run.status,'cancelled');mode='success';});
 await check('Grading preserves telemetry and records criteria and endpoint provenance',async()=>{const before=await result(goodId);mode='grade';await page.evaluate(id=>window.bench.grade(id,'fixture-model'),goodId);const run=await result(goodId);assert.equal(run.status,'completed');assert.deepEqual(run.gpu,before.gpu);assert.equal(run.samples.filter(s=>!s.warmup&&s.grades.length===1&&s.grades[0].score===100&&s.grades[0].endpoint===urls[1]&&s.grades[0].provider==='openai').length,3);mode='success';});
 await check('Every export format writes full results without token',async()=>{for(const format of ['json','csv','md','html']){const file=path.join(out,'report.'+format);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);assert.equal(await page.evaluate(({id,format})=>window.bench.exportRun(id,format),{id:goodId,format}),file);const text=readFileSync(file,'utf8');assert.ok(text.includes('fixture-model'));assert.ok(!text.includes(fakeToken));}});
 await check('History and completed results survive restart',async()=>{await close();await launch();assert.equal((await page.evaluate(id=>window.bench.getRun(id),goodId)).status,'completed');assert.ok((await page.evaluate(()=>window.bench.history())).length>0);});
 assert.deepEqual(errors,[]);assert.ok(!requests.some(r=>r.url.startsWith('/api/')));
 writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,checks,requests:requests.length,rendererErrors:errors},null,2));console.log('Evidence: '+out);
}catch(error){writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:String(error),stack:error.stack,errors},null,2));console.error(error);process.exitCode=1;}
finally{await close();for(const s of servers){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}}
