import {test} from 'node:test';
import assert from 'node:assert/strict';
import {infer,listModels,resolveLms} from '../electron/lmstudio';
import {defaultSettings} from '../src/defaults';
import {validateSettings} from '../electron/validation';
const settings={...defaultSettings,provider:'llamacpp' as const,baseUrl:'http://127.0.0.1:8080',token:'fixture-token'};
const sse=(frames:unknown[])=>new Response(frames.map(f=>'data: '+JSON.stringify(f)+'\n\n').join('')+'data: [DONE]\n\n');
test('compatible discovery uses v1 and leaves unknown capabilities unknown',async t=>{
 t.mock.method(globalThis,'fetch',async(url:any,init:any)=>{
  assert.equal(url,settings.baseUrl+'/v1/models');assert.equal(init.redirect,'error');
  assert.equal(init.headers.Authorization,'Bearer fixture-token');
  return Response.json({data:[{id:'served-model'}]});
 });
 const models=await listModels(settings);assert.equal(models[0].key,'served-model');
 assert.equal(models[0].nativeMtp?.supported,null);assert.equal(models[0].max_context_length,0);
 assert.equal(models[0].loaded_instances[0].id,'served-model');
});
test('compatible provider supports a custom API prefix and bearer key',async t=>{
 const custom={...settings,provider:'openai' as const,baseUrl:'https://models.example.org/api'};
 const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url:any,init:any)=>{
  calls.push(String(url));
  assert.equal(init.headers.Authorization,'Bearer fixture-token');
  if(String(url).endsWith('/api/models'))return Response.json({data:[{id:'served-model'}]});
  const body=JSON.parse(init.body);
  assert.equal(body.model,'served-model');
  assert.equal(body.stream,true);
  assert.ok(!('stream_options' in body));
  return sse([{choices:[{index:0,delta:{content:'Connected'},finish_reason:'stop'}]}]);
 });
 const [model]=await listModels(custom);
 assert.equal(model.key,'served-model');
 const result=await infer(custom,model.key,'Say connected',16,0,'default',new AbortController().signal);
 assert.equal(result.status,'completed');
 assert.equal(result.output,'Connected');
 assert.deepEqual(calls,['https://models.example.org/api/models','https://models.example.org/api/chat/completions']);
 assert.doesNotThrow(()=>validateSettings({...custom,tokenConfigured:true}));
});
test('compatible discovery preserves reported llama.cpp metadata and distinguishes active context',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{id:'gemma-4-12b-qa',meta:{n_ctx:2048,n_ctx_train:262144,n_params:11907350576,size:4623890624,ftype:'IQ3_XXS - 3.0625 bpw'}}]}));
 const [model]=await listModels(settings);
 assert.equal(model.size_bytes,4623890624);assert.deepEqual(model.quantization,{name:'IQ3_XXS - 3.0625 bpw'});
 assert.equal(model.max_context_length,262144);assert.equal(model.loaded_instances[0].config.context_length,2048);
 assert.equal(model.nativeMtp?.supported,null);assert.equal(model.capabilities,undefined);
});
test('compatible discovery skips invalid entries and duplicate IDs without inventing metadata',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({data:[null,42,'model',[],{}, {id:' '},{id:23},
  {id:'valid',meta:{size:-1,n_ctx:'2048',n_ctx_train:3.5,ftype:12}},{id:'valid',meta:{size:999}},
  {id:'plain',meta:[]},{id:'empty',meta:{size:0,n_ctx:0,n_ctx_train:0,ftype:'  '}}]}));
 const models=await listModels(settings);assert.deepEqual(models.map(m=>m.key),['valid','plain','empty']);
 for(const model of models){assert.equal(model.size_bytes,0);assert.equal(model.quantization,null);assert.equal(model.max_context_length,0);assert.equal(model.loaded_instances[0].config.context_length,0);}
});
test('compatible discovery rejects malformed top-level responses with a useful error',async t=>{
 const mocked=t.mock.method(globalThis,'fetch',async()=>Response.json(null));
 await assert.rejects(listModels(settings),/OpenAI-compatible model list/);
 mocked.mock.mockImplementation(async()=>Response.json({data:{id:'model'}}));
 await assert.rejects(listModels(settings),/OpenAI-compatible model list/);
});
test('compatible streamed answers preserve usage, reasoning and length finish',async t=>{
 t.mock.method(globalThis,'fetch',async(url:any,init:any)=>{
  assert.equal(url,settings.baseUrl+'/v1/chat/completions');assert.equal(init.redirect,'error');
  const body=JSON.parse(init.body);assert.deepEqual(body.messages,[{role:'user',content:'Question'}]);
  assert.equal(body.max_tokens,8);assert.ok(!('input' in body));
  return sse([{choices:[{delta:{reasoning_content:'Think '}}]},{choices:[{delta:{content:'42'},finish_reason:'length'}]},
   {choices:[],usage:{prompt_tokens:12,completion_tokens:8},timings:{prompt_ms:20,prompt_per_second:600,predicted_per_second:40}}]);
 });
 const r=await infer(settings,'served-model','Question',8,0,'default',new AbortController().signal);
 assert.equal(r.status,'completed');assert.equal(r.output,'42');assert.equal(r.reasoning,'Think ');
 assert.equal(r.metrics.outputTokens,8);assert.equal(r.metrics.generationTps,40);assert.equal(r.metrics.prefillTps,600);assert.equal(r.possibleTruncation,true);
 assert.ok(r.metrics.clientGenerationTps!==null,'visible reasoning and answer chunks form a client-observed span');
 assert.match(r.metrics.generationMethod!,/Server-reported/);
});
test('missing usage is unavailable, and a truncated stream fails',async t=>{
 const mocked=t.mock.method(globalThis,'fetch',async()=>sse([{choices:[{delta:{content:'42'},finish_reason:'stop'}]}]));
 const r=await infer(settings,'m','q',8,0,'default',new AbortController().signal);
 assert.equal(r.status,'completed');assert.equal(r.metrics.outputTokens,null);assert.equal(r.metrics.generationTps,null);assert.equal(r.metrics.prefillTps,null);
 assert.equal(r.metrics.clientGenerationTps,null);
 mocked.mock.mockImplementation(async()=>sse([{choices:[{delta:{content:'partial'}}]}]));
 const broken=await infer(settings,'m','q',8,0,'default',new AbortController().signal);
 assert.equal(broken.status,'failed');assert.match(broken.error!,/finish reason/);
});
test('compatible stream transport failure reports response progress without leaking credentials',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n'));controller.error(Object.assign(new TypeError('terminated'),{cause:{code:'UND_ERR_SOCKET'}}));}
 }),{status:200}));
 const result=await infer(settings,'m','q',8,0,'default',new AbortController().signal);
 assert.equal(result.status,'failed');
 assert.match(result.error!,/response stream closed unexpectedly after HTTP 200/);
 assert.match(result.error!,/UND_ERR_SOCKET/);
 assert.doesNotMatch(result.error!,/fixture-token|Bearer/);
});
test('compatible stream accepts a socket close after a finish reason but records the warning',async t=>{
 let sent=false;
 t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream<Uint8Array>({
  pull(controller){if(sent){controller.error(Object.assign(new TypeError('terminated'),{cause:{code:'UND_ERR_SOCKET'}}));return;}sent=true;controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\n'));}
 },{highWaterMark:0}),{status:200}));
 const result=await infer(settings,'m','q',256,0,'default',new AbortController().signal);
 assert.equal(result.status,'completed');assert.equal(result.output,'complete');assert.equal(result.error,undefined);
 assert.equal(result.rawStats.finish_reason,'stop');
 assert.match(String(result.rawStats.streamTransportWarning),/Socket closed after the finish reason/);
 assert.equal(result.metrics.outputTokens,null);
});
test('compatible authentication failures and cancellation remain distinct',async t=>{
 const mocked=t.mock.method(globalThis,'fetch',async()=>new Response('Unauthorized',{status:401}));
 assert.equal((await infer(settings,'m','q',8,0,'default',new AbortController().signal)).status,'failed');
 const controller=new AbortController();controller.abort();
 mocked.mock.mockImplementation(async()=>{throw new DOMException('Aborted','AbortError');});
 assert.equal((await infer(settings,'m','q',8,0,'default',controller.signal)).status,'cancelled');
});
test('external or remote providers cannot launch local LM Studio management',()=>{
 assert.throws(()=>resolveLms(settings),/loopback LM Studio/);
 assert.throws(()=>resolveLms({...defaultSettings,baseUrl:'https://server.example'}),/loopback LM Studio/);
 assert.throws(()=>validateSettings({...defaultSettings,provider:'invalid'} as any),/provider|settings/i);
});
