import type { RunConfig, SettingsUpdate, TestCase } from '../src/types';
import { parseAnswer } from './json-answer';
import { supportedInstructions } from './benchmark-scoring';
import { validateUrl, validateLmsPath } from './lmstudio';
import { parseRepo } from './update';
import {builtInPacks,validateBenchmark,type BenchmarkPack} from '../src/benchmarks';
import {maxMtpDepth,normalizeSweep} from '../src/mtp-sweep';
import {cacheQuants,flashOn,needsFlashAttention} from '../src/cache-quant';
export function integer(n:unknown,min:number,max:number,name:string){if(typeof n!=='number'||!Number.isInteger(n)||n<min||n>max)throw Error(`${name} must be an integer from ${min} to ${max}.`);}
export function validateSettings(s:SettingsUpdate){validateUrl(s.baseUrl);integer(s.timeoutSec,1,86400,'Request timeout');integer(s.loadTimeoutSec,10,3600,'Load timeout');if(typeof s.lmsPath!=='string'||typeof s.judgePrompt!=='string'||typeof s.updateCheck!=='boolean')throw Error('Invalid settings');
 validateLmsPath(s.lmsPath);
 if(s.judgePrompt.length>20000)throw Error('The judge prompt is too long.');
 // An empty repository is how update checking stays off: with nothing to ask, nothing is ever requested.
 if(typeof s.updateRepo!=='string'||s.updateRepo.length>200||(s.updateRepo.trim()&&!parseRepo(s.updateRepo)))throw Error('Update repository must be owner/name, for example your-account/local-model-bench, or empty to turn update checks off.');
 if(s.updateCheck&&!s.updateRepo.trim())throw Error('Name the repository to check before turning on update checks.');
 // An absent token means the window is not changing it. A token that is
 // present has to be a plausible header value: a control character would let
 // the rest of the string be read as a second header.
 if(s.token!==undefined){if(typeof s.token!=='string'||s.token.length>4096||/[\u0000-\u001f\u007f]/.test(s.token))throw Error('Invalid API token.');}}
export function validateConfig(c:RunConfig,packs:BenchmarkPack[]=builtInPacks){
 if(c.benchmark){validateBenchmark(c.benchmark,packs);if(c.mode==='performance')throw Error('Choose quality or combined mode for a benchmark pack.');}
 if(c.vision!==undefined&&!['auto','off','on'].includes(c.vision))throw Error('Invalid vision mode');
 if(c.mtp!==undefined&&!['off','on'].includes(c.mtp))throw Error('Invalid MTP mode');
 if(c.mtpDraftTokens!==undefined)integer(c.mtpDraftTokens,1,8,'MTP draft tokens');
 if(c.mtpPreflight!==undefined&&typeof c.mtpPreflight!=='boolean')throw Error('Invalid MTP preflight setting');
 // A sweep reloads the model once per depth and repeats the whole workload, so the depths are
 // normalized here: the run preview, the request count and the engine all read the same list.
 if(c.mtpSweep!==undefined){
  if(!Array.isArray(c.mtpSweep))throw Error('MTP sweep depths must be a list of whole numbers.');
  if(c.mtp!=='on')throw Error('Turn native MTP on before sweeping prediction depths.');
  c.mtpSweep.forEach(n=>integer(n,0,maxMtpDepth,'MTP sweep depth'));
  c.mtpSweep=normalizeSweep(c.mtpSweep);
  if(!c.mtpSweep.length)throw Error('Enter at least one MTP depth to sweep, or turn the sweep off.');
 }
 // The engine hands this to `lms runtime select`, so it becomes an argument to a real process and
 // is shaped here rather than trusted. Undefined means "leave LM Studio's own selection alone",
 // which is what every run made before this field existed did.
 if(c.runtime!==undefined&&(typeof c.runtime!=='string'||c.runtime.length>200||!/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(c.runtime)))
  throw Error('The runtime must be one of LM Studio’s installed engines, named engine@version.');
 for(const [name,q] of [['K cache',c.cacheK],['V cache',c.cacheV]] as const)
  if(q!==undefined&&!cacheQuants.includes(q))throw Error(`Invalid ${name} quantization. Choose one of: ${cacheQuants.join(', ')}.`);
 if(c.flashAttention!==undefined&&!['on','off'].includes(c.flashAttention))throw Error('Invalid flash attention setting.');
 // Caught here rather than sent to LM Studio, which refuses the load with a message that names
 // neither setting: llama.cpp cannot use a quantized KV cache without flash attention.
 if(needsFlashAttention(c.cacheK??'off',c.cacheV??'off')&&!flashOn(c.flashAttention))
  throw Error('A quantized KV cache needs flash attention. Turn flash attention on, or set both caches to f16 or off.');
 if(!Array.isArray(c.modelKeys)||!c.modelKeys.length)throw Error('Select at least one model.');
 if(!Array.isArray(c.concurrency)||!c.concurrency.length)throw Error('Enter concurrency levels.');
 c.concurrency=[...new Set(c.concurrency)].sort((a,b)=>a-b);c.concurrency.forEach(n=>integer(n,1,256,'Concurrency'));
 integer(c.waves,1,1000,'Waves');integer(c.maxTokens,1,131072,'Output limit');integer(c.contextLength,512,1048576,'Context');integer(c.timeoutSec,1,86400,'Request timeout');
 if(!Number.isFinite(c.temperature)||c.temperature<0||c.temperature>1)throw Error('Temperature must be between 0 and 1.');
 if(!['auto','off','max'].includes(c.gpu)&&(!Number.isFinite(Number(c.gpu))||Number(c.gpu)<0||Number(c.gpu)>1))throw Error('GPU offload must be auto, off, max, or a fraction from 0 to 1.');
 if(!['combined','quality','performance'].includes(c.mode))throw Error('Invalid run mode');
 if(c.mode!=='performance'&&!c.benchmark&&!c.testIds.length)throw Error('Select at least one quality test.');
 if(c.mode!=='quality'&&(!c.performanceLengths.length||c.performanceLengths.some(x=>!['short','medium','long'].includes(x))))throw Error('Select performance prompt sizes.');
 if(c.maxTokens>=c.contextLength)throw Error('Output limit must be smaller than context length, leaving room for the prompt.');
}
export function validateTest(t:TestCase){if(!t.name?.trim()||!t.prompt?.trim())throw Error('Test name and prompt are required.');integer(t.maxTokens,1,131072,'Test output limit');if(!Array.isArray(t.rules))throw Error('Rules must be a JSON array.');const ids=new Set();for(const r of t.rules){if(!r.id||ids.has(r.id))throw Error('Every check needs a unique id.');ids.add(r.id);if(!['exact','contains','heading','number','json','json-equal','field','words','lines','final-number','ifeval'].includes(r.type))throw Error('Unknown check type');if(!Number.isFinite(r.weight)||r.weight<=0)throw Error('Check weights must be positive.');if(['contains','heading','exact','number','field','json-equal','final-number','ifeval'].includes(r.type)&&typeof r.expected!=='string')throw Error('This check requires an expected string.');if(r.type==='ifeval'){const checks=JSON.parse(r.expected!);if(!Array.isArray(checks)||!checks.length||checks.some(c=>typeof c.kind!=='string'||!c.args))throw Error('Invalid instruction checks.');
  // Caught here rather than during a run, where an unknown kind would otherwise be
  // recorded as the model failing the check.
  const unknown=checks.filter(c=>!supportedInstructions.has(c.kind)).map(c=>c.kind);
  if(unknown.length)throw Error(`This build cannot score these instruction checks: ${[...new Set(unknown)].join(', ')}.`);}if(r.type==='final-number'&&!Number.isFinite(Number(r.expected)))throw Error('Invalid final number.');if(r.type==='json-equal')parseAnswer(r.expected!);if(r.type==='number'&&(!Number.isFinite(Number(r.expected))||(r.tolerance!==undefined&&(!Number.isFinite(r.tolerance)||r.tolerance<0))))throw Error('Invalid numeric check.');if(r.type==='field'&&!r.path)throw Error('Field check requires a path.');for(const x of [r.min,r.max])if(x!==undefined&&(!Number.isInteger(x)||x<0))throw Error('Bounds must be nonnegative integers.');if(r.min!==undefined&&r.max!==undefined&&r.min>r.max)throw Error('Minimum cannot exceed maximum.');}}
