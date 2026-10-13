import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {HARNESS_IMAGE,HARNESS_PROTOCOL,harnesses,type HarnessConfig,type HarnessDiagnostics} from '../src/harness';

export const MAX_WIRE_BYTES=2_000_000;
export function dockerCommand(args:string[],input='',signal?:AbortSignal,timeoutMs=30000):Promise<{code:number;stdout:string;stderr:string}>{
 return new Promise((resolve,reject)=>{
  const p=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',bytes=0,done=false;
  const finish=(error?:Error,code=1)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve({code,stdout,stderr});};
  const abort=()=>{p.kill();finish(Error(signal?.aborted?'Cancelled':'Docker command timed out'));};
  const timer=setTimeout(abort,timeoutMs);signal?.addEventListener('abort',abort,{once:true});
  for(const [stream,err] of [[p.stdout,false],[p.stderr,true]] as const)stream.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>MAX_WIRE_BYTES){p.kill();finish(Error('Docker output exceeded limit'));return;}if(err)stderr+=b.toString();else stdout+=b.toString();});
  p.on('error',e=>finish(e));p.on('close',code=>finish(undefined,code??1));p.stdin.on('error',()=>{});if(signal?.aborted){abort();return;}p.stdin.end(input);
 });
}
export function sandboxArgs(name:string,image:string,c:HarnessConfig,runId:string){
 return ['run','--rm','--pull=never','--name',name,'--label',`local.model.bench.run=${runId}`,'--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user','10001:10001','--cpus',String(c.cpus),'--memory',`${c.memoryMb}m`,'--memory-swap',`${c.memoryMb}m`,'--pids-limit','128','--ulimit','nofile=1024:1024','--log-driver=none','--tmpfs','/work:rw,nosuid,nodev,size=128m,uid=10001,gid=10001','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,uid=10001,gid=10001','--entrypoint','/usr/bin/timeout','-i',image,'--signal=KILL',String(c.timeoutSec+30),'python','-u','/opt/lmb/runner.py'];
}
export async function harnessDiagnostics():Promise<HarnessDiagnostics>{
 try{
  const info=await dockerCommand(['info','--format','{{.OSType}}']);if(info.code||info.stdout.trim()!=='linux')throw Error('Docker Desktop must be running with Linux containers');
  const image=await dockerCommand(['image','inspect',HARNESS_IMAGE,'--format','{{json .}}']);if(image.code)throw Error(`Evaluation image missing. Build ${HARNESS_IMAGE} using the documented, explicitly approved setup.`);
  const metadata=JSON.parse(image.stdout);if(metadata.Config?.Labels?.['local.model.bench.protocol']!==HARNESS_PROTOCOL)throw Error('Image protocol is incompatible');
  const args=sandboxArgs('lmb-harness-check-'+randomUUID().slice(0,8),metadata.Id,{...({} as HarnessConfig),cpus:1,memoryMb:1024,timeoutSec:30},'diagnostic');
  args.push('--diagnostic');const result=await dockerCommand(args,'',undefined,60000);if(result.code)throw Error(result.stderr||'Harness image self-check failed');
  const versions=JSON.parse(result.stdout);for(const h of harnesses.filter(h=>h.available))if(versions[h.id]!==h.version)throw Error(`${h.name} version mismatch: expected ${h.version}, found ${versions[h.id]}`);
  return {ready:true,imageId:metadata.Id,message:'Docker isolation and pinned harness imports available. Model compatibility is checked at start.',versions};
 }catch(e){return {ready:false,imageId:null,message:(e as Error).message,versions:{}};}
}
export async function removeSandbox(name:string){const r=await dockerCommand(['rm','-f',name]);if(r.code&&!/No such container/i.test(r.stderr))throw Error('Sandbox cleanup failed: '+r.stderr);}

// Only fixed Docker commands are executed on the host. Agent text is JSON stdin.
export async function runSandbox(options:{image:string;config:HarnessConfig;runId:string;payload:unknown;signal:AbortSignal;onEvent:(event:any)=>Promise<unknown|void>}){
 const name='lmb-harness-'+randomUUID();const {config,signal}=options;
 let failure:Error|undefined;
 try{
  return await new Promise<void>((resolve,reject)=>{
   const p=spawn('docker',sandboxArgs(name,options.image,config,options.runId),{windowsHide:true,stdio:['pipe','pipe','pipe']});let done=false,stderr='',chain=Promise.resolve(),bytes=0;
   const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);p.kill();error?reject(error):resolve();};
   const abort=()=>finish(Error('Cancelled'));const timer=setTimeout(()=>finish(Error('Task wall-clock timeout')),config.timeoutSec*1000);
   signal.addEventListener('abort',abort,{once:true});
   p.on('error',finish);p.stdin.on('error',()=>{});
   p.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(-8000);});
   // Cap total transport output as well as individual line size before JSON parsing.
   p.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>32_000_000)finish(Error('Sandbox output exceeded transport budget'));});
   const lines=createInterface({input:p.stdout});
   lines.on('line',line=>{if(Buffer.byteLength(line)>MAX_WIRE_BYTES){finish(Error('Sandbox event exceeded limit'));return;}
    chain=chain.then(async()=>{if(done)return;const event=JSON.parse(line);const reply=await options.onEvent(event);if(event.kind==='request'&&!done)p.stdin.write(JSON.stringify(reply)+'\n');}).catch(e=>finish(e));
   });
   p.on('close',code=>{chain.then(()=>finish(code?Error(`Sandbox exited ${code}: ${stderr}`):undefined));});
   if(signal.aborted){abort();return;}p.stdin.write(JSON.stringify(options.payload)+'\n');
  });
 }catch(e){failure=e as Error;throw e;}
 finally{try{await removeSandbox(name);}catch(cleanup){throw Error(`${failure?.message??''} ${(cleanup as Error).message}`.trim());}}
}

export async function verifySandbox(image:string,config:HarnessConfig,runId:string,payload:unknown,signal:AbortSignal){
 const name='lmb-harness-verify-'+randomUUID(),args=sandboxArgs(name,image,{...config,timeoutSec:30},runId);
 args[args.indexOf('/opt/lmb/runner.py')]='/opt/lmb/verifier.py';
 try{return await dockerCommand(args,JSON.stringify(payload)+'\n',signal,30000);}finally{await removeSandbox(name);}
}
