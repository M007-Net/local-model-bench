import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {EventEmitter} from 'node:events';
import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync,chmodSync,unlinkSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import os from 'node:os';
import {isIP} from 'node:net';
import type * as Electron from 'electron';

const data=path.resolve(process.env.LMB_DATA_DIR||path.join(os.homedir(),'.local','share','local-model-bench-web'));
mkdirSync(data,{recursive:true,mode:0o700});
const keyFile=path.join(data,'web-key');
if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});
const key=readFileSync(keyFile);if(key.length!==32)throw Error('Invalid web encryption key. Preserve web-key with the database.');
if(process.platform!=='win32')chmodSync(keyFile,0o600);
const lifecycle=new EventEmitter();let lease:DatabaseSync|undefined;
export const isWeb=true;
export const app={
 isPackaged:false,getPath:(name:string)=>name==='temp'?os.tmpdir():data,setPath:()=>{},
 getVersion:()=>JSON.parse(readFileSync(path.join(__dirname,'../package.json'),'utf8')).version,
 requestSingleInstanceLock:()=>{
  // Retire the PID lock used by early web builds. Container PIDs repeat after a
  // restart, so a dedicated SQLite transaction provides an OS-released lease.
  const legacy=path.join(data,'web.lock');
  if(existsSync(legacy)){const pid=Number(readFileSync(legacy,'utf8'));if(pid!==process.pid){try{process.kill(pid,0);throw Error('An older web server is still using this data directory.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}}unlinkSync(legacy);}
  try{lease=new DatabaseSync(path.join(data,'web-instance.sqlite'));lease.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;');return true;}
  catch{lease?.close();lease=undefined;throw Error('Another web server is already using this data directory.');}},
 whenReady:async()=>{},on:(name:string,fn:(...args:any[])=>void)=>lifecycle.on(name,fn),
 quit:()=>{lifecycle.emit('will-quit');lease?.close();process.exit(0);},
 exit:(code:number)=>{lease?.close();process.exit(code);}
} as unknown as typeof Electron.app;
// Only the desktop branch constructs a window; this export supplies its type.
export const BrowserWindow=undefined as unknown as typeof Electron.BrowserWindow;
const handlers=new Map<string,(event:any,...args:any[])=>any>();
export const ipcMain={handle:(name:string,fn:(event:any,...args:any[])=>any)=>handlers.set(name,fn)} as unknown as typeof Electron.ipcMain;
type Context={directory:string;upload?:{name:string;text:string};download?:string};
const context=new AsyncLocalStorage<Context>();
export const dialog={
 showErrorBox:(title:string,detail:string)=>console.error(title+'\n'+detail),
 showOpenDialog:async()=>{const c=context.getStore();if(!c?.upload)return {canceled:true,filePaths:[]};const file=path.join(c.directory,path.basename(c.upload.name));writeFileSync(file,c.upload.text,'utf8');return {canceled:false,filePaths:[file]};},
 showSaveDialog:async(_window:unknown,options:{defaultPath:string})=>{const c=context.getStore();if(!c)throw Error('No browser download request.');c.download=path.basename(options.defaultPath);return {canceled:false,filePath:path.join(c.directory,c.download)};}
} as unknown as typeof Electron.dialog;
export const clipboard={writeText:()=>{},readText:()=>''} as unknown as typeof Electron.clipboard;
export const shell={openPath:async()=>{throw Error('The data folder is on the server. Use report downloads or the persistent volume.');}} as unknown as typeof Electron.shell;
export const safeStorage={
 isEncryptionAvailable:()=>true,
 encryptString:(text:string)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(text,'utf8'),cipher.final(),cipher.getAuthTag()]);},
 decryptString:(buffer:Buffer)=>{const cipher=createDecipheriv('aes-256-gcm',key,buffer.subarray(0,12));cipher.setAuthTag(buffer.subarray(-16));return Buffer.concat([cipher.update(buffer.subarray(12,-16)),cipher.final()]).toString('utf8');}
} as unknown as typeof Electron.safeStorage;

const clients=new Set<ServerResponse>();
export function publish(name:string,value:unknown){for(const client of clients)client.write(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);}
const same=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
async function readBody(req:IncomingMessage,limit=32*1024*1024){let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request is too large (32 MB maximum).');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');}
const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.json':'application/json'};
export async function startWebPanel(){
 const port=Number(process.env.LMB_PORT||8080),host=process.env.LMB_HOST||'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('LMB_PORT must be between 1 and 65535.');
 const password=process.env.LMB_WEB_TOKEN||randomBytes(24).toString('base64url'),session=randomBytes(32).toString('base64url');
 const allowed=new Set(['localhost',os.hostname().toLowerCase(),...(process.env.LMB_ALLOWED_HOSTS||'').split(',').map(x=>x.trim().toLowerCase())]);
 const authenticated=(req:IncomingMessage)=>{const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('lmb_session='))?.slice(12)||'';return same(cookie,session);};
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  try{
   const authority=req.headers.host||'',base=new URL('http://'+authority),hostname=base.hostname.replace(/^\[|\]$/g,'').toLowerCase();
   if(!isIP(hostname)&&!allowed.has(hostname)){res.writeHead(403);res.end('Host is not allowed. Set LMB_ALLOWED_HOSTS for a custom hostname.');return;}
   const url=new URL(req.url||'/',base);
   if(url.pathname==='/healthz'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end('{"status":"ok"}');return;}
   if(req.method==='POST'){
    if(req.headers.origin&&req.headers.origin!==base.origin){res.writeHead(403);res.end('Cross-origin request refused.');return;}
   }
   if(url.pathname==='/login'){
    if(req.method==='POST'){
     if(!same(new URLSearchParams(await readBody(req,4096)).get('token')||'',password)){res.writeHead(401);res.end('Incorrect panel password.');return;}
     res.setHeader('Set-Cookie',`lmb_session=${session}; HttpOnly; SameSite=Strict; Path=/`);res.writeHead(303,{Location:'/'});res.end();return;
    }
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><title>Local Model Bench login</title></head><body style="font:18px system-ui;max-width:480px;margin:12vh auto;background:#101416;color:#eee"><h1>Local Model Bench</h1><p>Enter the panel password configured with LMB_WEB_TOKEN or printed when the server started.</p><form method="post" action="/login"><input type="password" name="token" required autocomplete="current-password" aria-label="Panel password"><button>Sign in</button></form></body></html>');return;
   }
   if(!authenticated(req)){res.writeHead(url.pathname.startsWith('/api/')?401:303,{Location:'/login'});res.end('Sign in to the web panel.');return;}
   if(url.pathname==='/api/events'&&req.method==='GET'){
    if(clients.size>=32)throw Error('Too many event connections.');res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clients.delete(res);clearInterval(heartbeat);});return;
   }
   if(url.pathname.startsWith('/api/call/')&&req.method==='POST'){
    if(req.headers['x-lmb-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))throw Error('Invalid API request.');
    const name=url.pathname.slice('/api/call/'.length),handler=handlers.get('bench:'+name);if(!handler){res.writeHead(404);res.end('Unknown operation.');return;}
    const body=JSON.parse(await readBody(req));if(!Array.isArray(body.args)||body.args.length>10)throw Error('Invalid arguments.');
    if(body.upload&&(typeof body.upload.name!=='string'||typeof body.upload.text!=='string'||!body.upload.name||body.upload.name.length>255))throw Error('Invalid upload.');
    const directory=mkdtempSync(path.join(os.tmpdir(),'lmb-web-'));
    try{
     const c:Context={directory,upload:body.upload};
     const result=await context.run(c,()=>handler({},...body.args));
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify(c.download?{result:c.download,download:{name:c.download,text:readFileSync(path.join(directory,c.download),'utf8')}}:{result:result??null}));
    }finally{rmSync(directory,{recursive:true,force:true});}
    return;
   }
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   const root=path.resolve(__dirname,'../dist'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep)||!existsSync(file)){res.writeHead(404);res.end('Not found');return;}
   res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(readFileSync(file));
  }catch(error){if(!res.headersSent){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:(error as Error).message}));}else res.end();}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>resolve());});
 console.log(`Local Model Bench web panel: http://${host}:${port}`);
 if(!process.env.LMB_WEB_TOKEN)console.log(`Panel password: ${password}`);
}
