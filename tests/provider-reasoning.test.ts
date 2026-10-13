import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Model} from '../src/types';
import {defaultSettings} from '../src/defaults';
import {infer,listModels} from '../electron/lmstudio';
import {discoverReasoningSupport,llamaPropsSupport,reasoningRequest,reasoningSdk,sdkBudgetSupported} from '../electron/reasoning-provider';

const model:Model={key:'fixture-model',display_name:'Fixture model',size_bytes:0,quantization:null,max_context_length:65536,type:'llm',loaded_instances:[{id:'owned-instance',config:{context_length:65536,reasoning_budget_message:''}}],capabilities:{reasoning:{allowed_options:['off','on'],default:'on'}}};
const config={reasoningBudget:false as const,enableThinking:true,reasoningParsing:{enabled:true,startString:'<think>',endString:'</think>'}};
const props=(budget=-1)=>({chat_template:'{% if enable_thinking %}<think>reasoning</think>{% endif %}',default_generation_settings:{params:{reasoning_budget_tokens:budget}},chat_template_caps:{}});
const sse=(frames:unknown[])=>new Response(frames.map(frame=>'data: '+JSON.stringify(frame)+'\n\n').join('')+'data: [DONE]\n\n');
function fakeClient(handle:any,dispose:()=>Promise<void>=async()=>{}){return {llm:{createDynamicHandle:()=>handle},[Symbol.asyncDispose]:dispose} as any;}

test('SDK budgets require a reported control and enabled, distinct delimiters',()=>{
 assert.equal(sdkBudgetSupported(config,true),true);
 assert.equal(sdkBudgetSupported(config),false,'SDK defaults alone must not prove runtime support');
 assert.equal(sdkBudgetSupported({...config,reasoningBudget:2048},true),true);
 assert.equal(sdkBudgetSupported({...config,reasoningBudget:undefined},true),false);
 assert.equal(sdkBudgetSupported({...config,reasoningParsing:{...config.reasoningParsing,enabled:false}},true),false);
 assert.equal(sdkBudgetSupported({...config,reasoningParsing:{...config.reasoningParsing,endString:'<think>'}},true),false);
});
test('LM discovery inspects the exact owned instance without model loading or inference',async t=>{
 let inspected='',disposed=0;
 t.mock.method(reasoningSdk,'create',()=>({llm:{createDynamicHandle(id:string){inspected=id;return {getBasePredictionConfig:async()=>config};}},[Symbol.asyncDispose]:async()=>{disposed++;}} as any));
 const support=await discoverReasoningSupport(defaultSettings,model);
 assert.equal(inspected,'owned-instance');assert.equal(disposed,1);
 assert.equal(support.numeric,true);assert.equal(support.unlimited,true);assert.equal(support.off,true);
 assert.equal(support.confirmation,'reported');assert.match(support.note,/does not prove enforcement/);
});
test('unloaded models retain advertised on/off modes and do not open an SDK connection',async t=>{
 t.mock.method(reasoningSdk,'create',()=>{throw Error('SDK must not connect for an unloaded model');});
 const support=await discoverReasoningSupport(defaultSettings,{...model,loaded_instances:[]});
 assert.equal(support.numeric,false);assert.equal(support.off,true);assert.deepEqual(support.efforts,['on']);assert.match(support.note,/after this model is loaded/);
});
test('SDK discovery failures retain effort fallback and disposal errors cannot mask them',async t=>{
 t.mock.method(reasoningSdk,'create',()=>fakeClient({getBasePredictionConfig:async()=>{throw Error('Old runtime');}},async()=>{throw Error('disconnect failed');}));
 const support=await discoverReasoningSupport(defaultSettings,model);
 assert.equal(support.numeric,false);assert.deepEqual(support.efforts,['on']);assert.equal(support.off,true);
});
test('llama.cpp numeric capability distinguishes finite default, absent budget and true off',()=>{
 const support=llamaPropsSupport(props(),model);assert.equal(support.numeric,true);assert.equal(support.unlimited,true);assert.equal(support.off,true);
 const finite=llamaPropsSupport(props(2000),model);assert.equal(finite.numeric,true);assert.equal(finite.unlimited,false);assert.match(finite.note,/finite server default/);
 const unknown=llamaPropsSupport({chat_template:'<think>reason</think>'},{...model,capabilities:undefined});assert.equal(unknown.numeric,false);assert.equal(unknown.off,false);
 const noDelimiters=llamaPropsSupport({default_generation_settings:{params:{reasoning_budget_tokens:-1}}},{...model,capabilities:undefined});assert.equal(noDelimiters.numeric,false);
});
test('compatible discovery uses authenticated read-only props with the selected model',async t=>{
 const settings={...defaultSettings,provider:'llamacpp' as const,baseUrl:'http://localhost:8080/api/v1',token:'secret-fixture'};
 t.mock.method(globalThis,'fetch',async(url:any,options:any)=>{
  assert.equal(String(url),'http://localhost:8080/api/props?model=owned-instance');assert.equal(options.method,undefined);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer secret-fixture');return Response.json(props());
 });
 const support=await discoverReasoningSupport(settings,model);assert.equal(support.numeric,true);
});
test('llama.cpp wire budgets are separate from off, effort and total output caps',()=>{
 const settings={...defaultSettings,provider:'llamacpp' as const};
 assert.deepEqual(reasoningRequest(settings,{id:'2000',kind:'budget',tokens:2000}).body,{reasoning_budget_tokens:2000,chat_template_kwargs:{enable_thinking:true},reasoning_format:'deepseek'});
 assert.equal(reasoningRequest(settings,{id:'unlimited',kind:'unlimited'}).body.reasoning_budget_tokens,-1);
 assert.equal(reasoningRequest(settings,{id:'zero-budget',kind:'budget',tokens:0}).body.reasoning_budget_tokens,0);
 const off=reasoningRequest(settings,{id:'off',kind:'off'}).body;assert.equal(off.reasoning_budget_tokens,undefined);assert.deepEqual(off.chat_template_kwargs,{enable_thinking:false});
 assert.equal(reasoningRequest(settings,{id:'low',kind:'effort',value:'low'}).body.reasoning_effort,'low');
 assert.deepEqual(reasoningRequest(settings,{id:'default',kind:'default'}).body,{});
 assert.throws(()=>reasoningRequest({...settings,provider:'openai'},{id:'2000',kind:'budget',tokens:2000}),/no confirmed numeric/);
});
test('LM numeric SDK streaming preserves final answer, total counts and echoed budget without estimating reasoning counts',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[model]}));
 let options:any,history:any,disposed=0;
 const prediction={async *[Symbol.asyncIterator](){yield {content:'thinking',reasoningType:'reasoning',tokensCount:37};yield {content:'<think>',reasoningType:'reasoningStartTag',tokensCount:1};yield {content:'42',reasoningType:'none',tokensCount:1};},async result(){return {nonReasoningContent:'42',reasoningContent:'thinking',stats:{stopReason:'eosFound',promptTokensCount:12,predictedTokensCount:10,tokensPerSecond:50,timeToFirstTokenSec:.1},predictionConfig:{fields:[{key:'llm.prediction.reasoning.budgetTokens',value:{checked:true,value:2000}}]}};},async cancel(){}};
 const handle={getBasePredictionConfig:async()=>config,respond(chat:any,opts:any){history=chat;options=opts;return prediction;}};
 t.mock.method(reasoningSdk,'create',()=>fakeClient(handle,async()=>{disposed++;}));
 const result=await infer(defaultSettings,'owned-instance','Question',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.deepEqual(history,[{role:'user',content:'Question'}]);assert.equal(options.reasoningBudget,2000);assert.equal(options.maxTokens,32768);assert.equal(options.temperature,0);assert.equal(options.contextOverflowPolicy,'stopAtLimit');assert.equal(options.enableThinking,true);
 assert.equal(result.status,'completed');assert.equal(result.output,'42');assert.equal(result.reasoning,'thinking');assert.equal(result.metrics.outputTokens,10);assert.equal(result.metrics.reasoningTokens,null);assert.equal(result.possibleTruncation,false);assert.equal(disposed,1);
 assert.equal(result.reasoningControl?.confirmation,'reported');assert.match(result.reasoningControl!.note,/not independently verified/);
 assert.match(result.metrics.cacheNote,/fragment counts are approximate/);
});
test('unrestricted SDK reasoning retains the shared output cap and context-limit truncation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[model]}));
 let options:any;
 const handle={getBasePredictionConfig:async()=>config,respond(_chat:any,opts:any){options=opts;return {async *[Symbol.asyncIterator](){},async result(){return {nonReasoningContent:'partial',reasoningContent:'',stats:{stopReason:'contextLengthReached'},predictionConfig:{fields:[]}};},async cancel(){}};}};
 t.mock.method(reasoningSdk,'create',()=>fakeClient(handle));
 const result=await infer(defaultSettings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'unlimited',kind:'unlimited'});
 assert.equal(options.reasoningBudget,false);assert.equal(options.maxTokens,32768);assert.equal(result.possibleTruncation,true);assert.equal(result.metrics.outputTokens,null);assert.equal(result.reasoningControl?.confirmation,'requested');
});
test('unsupported loaded SDK controls fail before generating and rejected requests stay failed',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[model]}));
 const mocked=t.mock.method(reasoningSdk,'create',()=>fakeClient({getBasePredictionConfig:async()=>({}),respond(){throw Error('Must not generate');}}));
 const result=await infer(defaultSettings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.equal(result.status,'failed');assert.equal(result.reasoningControl?.confirmation,'unsupported');assert.match(result.error!,/does not expose/);
 mocked.mock.mockImplementation(()=>fakeClient({getBasePredictionConfig:async()=>config,respond(){throw Error('Unsupported budget in runtime');}}));
 const rejected=await infer(defaultSettings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.equal(rejected.status,'failed');assert.match(rejected.error!,/Unsupported budget/);assert.equal(rejected.reasoningControl?.confirmation,'requested');
});
test('SDK cancellation and timeout preserve partial output and cancel only their prediction',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[model]}));
 let cancelled=0,disposed=0;
 const handle={getBasePredictionConfig:async()=>config,respond(_chat:any,options:any){return {async *[Symbol.asyncIterator](){yield {content:'partial thought',reasoningType:'reasoning',tokensCount:5};await new Promise<void>(resolve=>options.signal.addEventListener('abort',()=>resolve(),{once:true}));},async result(){throw Error('Aborted');},async cancel(){cancelled++;}};}};
 t.mock.method(reasoningSdk,'create',()=>fakeClient(handle,async()=>{disposed++;}));
 const controller=new AbortController();setTimeout(()=>controller.abort(),10);
 const result=await infer(defaultSettings,'owned-instance','Q',32768,0,'default',controller.signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.equal(result.status,'cancelled');assert.equal(result.reasoning,'partial thought');assert.equal(result.metrics.outputTokens,null);assert.equal(cancelled,1);assert.equal(disposed,1);
 const timed=await infer({...defaultSettings,timeoutSec:.01},'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.equal(timed.status,'timeout');assert.equal(timed.reasoning,'partial thought');assert.equal(cancelled,2);assert.equal(disposed,2);
});
test('LM discovery and inference do not treat SDK defaults as old-runtime support',async t=>{
 const older={...model,loaded_instances:[{id:'owned-instance',config:{context_length:65536}}]};
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[older]}));
 t.mock.method(reasoningSdk,'create',()=>fakeClient({getBasePredictionConfig:async()=>config,respond(){throw Error('Must not generate');}}));
 const support=await discoverReasoningSupport(defaultSettings,older);assert.equal(support.numeric,false);assert.equal(support.off,true);assert.match(support.note,/SDK defaults alone/);
 const result=await infer(defaultSettings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});assert.equal(result.status,'failed');assert.equal(result.reasoningControl?.confirmation,'unsupported');
});
test('native off and compatible budgets are emitted with explicit requested provenance',async t=>{
 let body:any;
 const mocked=t.mock.method(globalThis,'fetch',async(_url:any,options:any)=>{body=JSON.parse(options.body);return sse([{type:'chat.end',result:{output:[{type:'message',content:'42'}],stats:{total_output_tokens:1}}}]);});
 const native=await infer(defaultSettings,'owned-instance','Q',32768,0,'on',new AbortController().signal,undefined,{id:'off',kind:'off'});
 assert.equal(body.reasoning,'off');assert.equal(body.max_output_tokens,32768);assert.equal(native.reasoningControl?.confirmation,'requested');
 mocked.mock.mockImplementation(async(_url:any,options:any)=>{body=JSON.parse(options.body);return sse([{choices:[{delta:{reasoning_content:'Think'}},{index:0,delta:{content:'42'},finish_reason:'stop'}],usage:{completion_tokens:12,completion_tokens_details:{reasoning_tokens:10}}}]);});
 const compatible=await infer({...defaultSettings,provider:'llamacpp'},'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'4000',kind:'budget',tokens:4000});
 assert.equal(body.reasoning_budget_tokens,4000);assert.equal(body.reasoning_budget,undefined);assert.equal(body.max_tokens,32768);assert.equal(compatible.metrics.outputTokens,12);assert.equal(compatible.metrics.reasoningTokens,10);assert.equal(compatible.reasoningControl?.confirmation,'requested');
});
test('standard upstream llama.cpp props permit explicitly unverified numeric requests and withhold Unlimited',()=>{
 const upstream={chat_template:'{% if enable_thinking %}<think>reasoning</think>{% endif %}',chat_template_caps:{supports_enable_thinking:true},default_generation_settings:{params:{temperature:.8}}};
 const support=llamaPropsSupport(upstream,{...model,capabilities:undefined});
 assert.equal(support.numeric,true);assert.equal(support.unlimited,false);assert.equal(support.confirmation,'requested');assert.match(support.note,/requested budget is unverified/);assert.match(support.note,/server default, which was not reported/);
});
test('compatible response echo is evidence of reported configuration, missing echo remains requested',async t=>{
 const mocked=t.mock.method(globalThis,'fetch',async()=>sse([{choices:[{index:0,delta:{content:'42'},finish_reason:'stop'}],generation_settings:{reasoning_budget_tokens:2000},usage:{completion_tokens:1}}]));
 const settings={...defaultSettings,provider:'llamacpp' as const};
 const echoed=await infer(settings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.equal(echoed.reasoningControl?.confirmation,'reported');assert.deepEqual(echoed.rawStats.reasoningConfigurationEcho,{reasoning_budget_tokens:2000});
 mocked.mock.mockImplementation(async()=>sse([{choices:[{index:0,delta:{content:'42'},finish_reason:'stop'}],generation_settings:{reasoning_budget_tokens:4000}}]));
 const other=await infer(settings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});assert.equal(other.reasoningControl?.confirmation,'requested');
});
test('generic compatible endpoints expose only reported effort modes',async t=>{
 const settings={...defaultSettings,provider:'openai' as const,baseUrl:'https://example.test/api'};
 t.mock.method(globalThis,'fetch',async()=>Response.json({data:[{id:'fixture',capabilities:{reasoning:{allowed_options:['none','low','high']}}}]}));
 const [discovered]=await listModels(settings);assert.equal(discovered.reasoningSupport?.numeric,false);assert.equal(discovered.reasoningSupport?.off,true);assert.deepEqual(discovered.reasoningSupport?.efforts,['low','high']);
 const unsupportedOff=await discoverReasoningSupport(settings,model);assert.equal(unsupportedOff.off,false,'An off native mode does not establish the compatible reasoning_effort none wire value');
});
test('SDK client shutdown has a bounded wait and cannot hold a completed result indefinitely',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[model]}));
 const handle={getBasePredictionConfig:async()=>config,respond(){return {async *[Symbol.asyncIterator](){},async result(){return {nonReasoningContent:'42',reasoningContent:'',stats:{stopReason:'eosFound'},predictionConfig:{fields:[]}};},async cancel(){}};}};
 t.mock.method(reasoningSdk,'create',()=>fakeClient(handle,()=>new Promise<void>(()=>{})));
 const started=performance.now();
 const result=await infer(defaultSettings,'owned-instance','Q',32768,0,'default',new AbortController().signal,undefined,{id:'2000',kind:'budget',tokens:2000});
 assert.equal(result.status,'completed');assert.equal(result.output,'42');assert.ok(performance.now()-started<2500);
});

test('unbounded SDK requests disable both caps, shift context and remain cancellable without a timer',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({models:[model]}));
 let options:any,cancelled=0;
 const handle={getBasePredictionConfig:async()=>config,respond(_chat:any,opts:any){options=opts;return {async *[Symbol.asyncIterator](){yield {content:'thought',reasoningType:'reasoning'};await new Promise<void>(resolve=>opts.signal.addEventListener('abort',()=>resolve(),{once:true}));},async result(){throw Error('Aborted');},async cancel(){cancelled++;}};}};
 t.mock.method(reasoningSdk,'create',()=>fakeClient(handle));
 const abort=new AbortController();setTimeout(()=>abort.abort(),50);
 const result=await infer({...defaultSettings,timeoutSec:0},'owned-instance','Q',0,0,'default',abort.signal,undefined,{id:'unlimited',kind:'unlimited'});
 assert.equal(options.maxTokens,false);assert.equal(options.reasoningBudget,false);assert.equal(options.contextOverflowPolicy,'truncateMiddle');
 assert.equal(result.status,'cancelled');assert.equal(cancelled,1);
});
