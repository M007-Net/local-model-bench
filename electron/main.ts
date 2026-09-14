import { app, BrowserWindow, ipcMain, dialog, clipboard, safeStorage, shell } from 'electron';
import { Worker } from 'node:worker_threads';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { mtpArgs } from './mtp';
import { visionArgs, projectorToggle, noProjectorToggleNote } from './vision';
import { visionTests } from './vision-image';
import { Store } from './store';
import { defaultSettings, starterTests, performanceTest } from '../src/defaults';
import type { Run, RunConfig, Settings, PublicSettings, SettingsUpdate, TestCase, Sample, Progress } from '../src/types';
import { cli, listModels, resolveLms } from './lmstudio';
import { validateConfig, validateSettings, validateTest } from './validation';
import { gradingPackage, parseGrade } from './scoring';
import { exportText } from './export';
import { historyRows } from './history';
import { downloadInstaller, fetchLatestRelease, hashFile, type UpdateState } from './update';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { chartReport } from './chart-report';
import type { EngineEvent } from './engine';
import {builtInPacks,describePack,selectBenchmark} from '../src/benchmarks';
import {buildPack,maxPackBytes,packExtensions,parsePackFile,suggestScoring,type PackDraft,type PackItem} from '../src/benchmark-import';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';

let win:BrowserWindow,store:Store,worker:Worker|null=null,progress:Progress|null=null,activeRun:Run|null=null;
// Pooling every run re-reads every saved response, so the result is held until a run, a grade, or a saved
// model correction actually changes it.
let historyCache:{fingerprint:string;rows:ReturnType<typeof historyRows>}|null=null;
let updateState:UpdateState={phase:'idle',info:null,received:0,total:0,file:'',sha256:'',verified:false,error:'',checked:'',current:''};
let updateBusy=false;
const updateDir=()=>path.join(app.getPath('temp'),'local-model-bench-update');
function notifyUpdate(patch:Partial<UpdateState>){updateState={...updateState,...patch};win?.webContents.send('bench:update',updateState);}
// Nothing here runs unless a repository is named and the check is switched on, so the default install makes
// no outbound request at all.
async function checkForUpdate(manual:boolean){
 const saved=settings();
 if(!saved.updateRepo.trim()){notifyUpdate({phase:'idle',info:null,error:manual?'Name the GitHub repository to check, as owner/name, in Settings.':''});return updateState;}
 if(!saved.updateCheck&&!manual)return updateState;
 if(updateBusy)return updateState;
 updateBusy=true;notifyUpdate({phase:'checking',error:''});
 try{
  const info=await fetchLatestRelease(saved.updateRepo,app.getVersion());
  notifyUpdate(info?{phase:'available',info,error:'',checked:new Date().toISOString(),received:0,total:info.assetSize,file:'',sha256:'',verified:false}
   :{phase:'idle',info:null,error:'',checked:new Date().toISOString()});
 }catch(e){notifyUpdate({phase:'error',error:(e as Error).message,checked:new Date().toISOString()});}
 finally{updateBusy=false;}
 return updateState;
}
const dataPath=process.env.LMB_DATA_DIR||app.getPath('userData');
// Sensor library and sampling script ship outside the asar archive so PowerShell can read them.
const vendorDir=app.isPackaged?path.join(process.resourcesPath,'vendor'):path.join(__dirname,'..','vendor');
if(process.env.LMB_DATA_DIR)app.setPath('userData',dataPath);
// app.quit() is asynchronous, so a second instance keeps executing this file for a
// while yet. Nothing below may run in that instance: opening the same SQLite file
// twice lets recover() rewrite a run the first instance is still writing to.
const locked=app.requestSingleInstanceLock();if(!locked)app.quit();
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
// A failure before the window exists would otherwise be an invisible process: no
// window, no message, and the single-instance lock still held, so relaunching does
// nothing and only Task Manager clears it.
function fatal(stage:string,error:unknown){
 const detail=error instanceof Error?(error.stack||error.message):String(error);
 try{dialog.showErrorBox('Local Model Bench could not start',`${stage}\n\nData folder: ${dataPath}\n\n${detail}`);}catch{}
 app.exit(1);
}
process.on('uncaughtException',e=>fatal('An unexpected error stopped the app.',e));
process.on('unhandledRejection',e=>fatal('An unexpected error stopped the app.',e));
type StoredSettings=Settings&{encryptedToken?:string};
function storedSettings():StoredSettings{const saved=store.get<StoredSettings>('settings')??defaultSettings;return {...defaultSettings,...saved,lmsPath:saved.lmsPath||path.join(os.homedir(),'.lmstudio','bin','lms.exe')};}
// The decrypted token exists only here, on the paths that actually make a
// request. Everything the window can see goes through publicSettings(), which
// never decrypts it at all - a renderer compromise cannot read what it was
// never sent.
function settings():Settings{const saved=storedSettings();let token='';if(saved.encryptedToken){try{token=safeStorage.decryptString(Buffer.from(saved.encryptedToken,'base64'));}catch{}}const {encryptedToken,...plain}=saved;return {...plain,token};}
function publicSettings():PublicSettings{const {encryptedToken,token,...plain}=storedSettings();return {...plain,tokenConfigured:!!encryptedToken};}
function notify(){win?.webContents.send('bench:progress',progress);}
// The packs compiled into the build plus whatever you imported. Imported packs are always last, so a file can
// never take over the id of a published benchmark.
const allPacks=()=>[...builtInPacks,...store.packs()];
// A chosen file is parsed and held here until you confirm the name and scoring, so nothing is stored from a
// file you only looked at, and the questions do not cross the boundary twice.
let pendingPack:{items:PackItem[];fileName:string}|null=null;
function assertIdle(){if(worker)throw Error('A run is active. Cancel it or wait for it to finish.');}
function getPair(runId:string,sampleId:string){const run=store.getRun(runId),sample=run.samples.find(s=>s.id===sampleId);if(!sample)throw Error('Response not found');const test=run.tests.find(t=>t.id===sample.testId);if(!test)throw Error('Test snapshot not found');return {run,sample,test};}
function launch(run:Run,retries?:Sample[],gradeOnly=false){assertIdle();activeRun=run;const previousStatus=run.status;run.status=gradeOnly?'grading':'running';run.updated=new Date().toISOString();store.saveRun(run);progress={runId:run.id,phase:'starting',message:'Preparing benchmark…',completed:0,total:0,active:0};notify();
 worker=new Worker(path.join(__dirname,'worker.cjs'),{workerData:{run,settings:settings(),retries,gradeOnly,vendorDir,gpuIntervalMs:1000}});
 worker.on('message',(event:EngineEvent)=>{try{
  if(event.type==='sample')store.saveSample(event.sample);
  if(event.type==='wave')store.saveWave(event.wave);
  if(event.type==='grade'){const {sample}=getPair(run.id,event.sampleId);sample.grades.push(event.grade);store.saveSample(sample);}
  if(event.type==='model'){run.modelInfo[event.key]=event.info;store.saveRun(run);}
  if(event.type==='log'){run.logs.push(new Date().toLocaleTimeString()+' '+event.message);store.saveRun(run);}
  if(event.type==='gpu'){run.gpu=event.gpu;store.saveRun(run);}
  if(event.type==='progress'){progress=event.progress;if(event.progress.phase==='grading'&&run.status!=='grading'){run.status='grading';store.saveRun(run);}notify();}
  if(event.type==='finish'){run.status=gradeOnly?previousStatus:event.status;run.error=event.error;run.updated=new Date().toISOString();store.saveRun(run);}
 }catch(e){run.status='failed';run.error='Could not persist benchmark event: '+(e as Error).message;worker?.postMessage('cancel');store.saveRun(run);}});
 worker.on('error',e=>{run.status='failed';run.error=e.message;store.saveRun(run);});
 worker.on('exit',()=>{if(run.status==='running'||run.status==='grading'){run.status='interrupted';store.saveRun(run);}worker=null;activeRun=null;progress=null;notify();});return run.id;
}
async function newRun(config:RunConfig,retries?:Sample[],source?:Run){
 assertIdle();validateConfig(config,allPacks());const models=await listModels(settings());for(const key of config.modelKeys)if(!models.some(m=>m.key===key))throw Error('Selected model no longer available: '+key);
 for(const model of models.filter(m=>config.modelKeys.includes(m.key))){mtpArgs(model,config.mtp,config.mtpDraftTokens??2);visionArgs(model,config.vision);}
 const tests=source?.tests??[...(config.mode!=='quality'?config.performanceLengths.map(performanceTest):[]),...(config.mode!=='performance'?(config.benchmark?selectBenchmark(config.benchmark,allPacks()):store.tests().filter(t=>config.testIds.includes(t.id))):[]),...(config.vision==='on'?visionTests():[])];
 if(!tests.length)throw Error('Select at least one available test.');if(config.mode!=='performance'&&!source&&!config.benchmark&&config.testIds.some(id=>!tests.some(t=>t.id===id)))throw Error('A selected test was deleted. Refresh your selection.');
 const now=new Date().toISOString();let runtime='Unavailable';try{runtime=await cli(settings(),['runtime','ls']);}catch{}
 const run:Run={id:randomUUID(),created:now,updated:now,status:'running',config:{...config,name:config.name.trim()||new Date().toLocaleString()},tests,modelInfo:Object.fromEntries(models.filter(m=>config.modelKeys.includes(m.key)).map(model=>[model.key,{model}])),environment:{platform:os.platform(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemory:os.totalmem(),node:process.versions.node,electron:process.versions.electron,appVersion:app.getVersion(),runtime,endpoint:settings().baseUrl,judgePrompt:settings().judgePrompt,cachePolicy:'Fresh state, deterministic leading variants; prefix caching cannot be fully disabled through this API.',vision:{requested:config.vision??'auto',projectorToggle,note:noProjectorToggleNote}},logs:[],samples:[],waves:[]};
 if(retries)run.logs.push(`Retry of ${source?.id}. Only failed/cancelled requests are retried with exact original prompts. Partial waves use the actual retried request count; compare separately.`);
 return launch(run,retries);
}
function handle(name:string,fn:(...args:any[])=>any){ipcMain.handle('bench:'+name,async(event,...args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)throw Error('Untrusted window');return fn(...args);});}
if(locked)app.whenReady().then(()=>{
 try{mkdirSync(dataPath,{recursive:true});}catch(e){return fatal('The data folder could not be created.',e);}
 try{store=Store.open(path.join(dataPath,'bench.sqlite'));store.recover();}catch(e){return fatal('The saved benchmark database could not be opened.',e);}
 if(!store.get('seeded')){starterTests.forEach(t=>store.saveTest(t));store.set('seeded',true);}
 if(!store.get('accounting-v1-seeded')){const ids=new Set(store.tests().map(t=>t.id));starterTests.filter(t=>t.category==='Accounting'&&!ids.has(t.id)).forEach(t=>store.saveTest(t));store.set('accounting-v1-seeded',true);}
 handle('snapshot',()=>({settings:publicSettings(),tests:store.tests(),runs:store.list(),progress,dataPath,packs:allPacks().map(describePack)}));
 handle('modelProfiles',()=>store.profiles());
 handle('saveModelProfile',(key,profile)=>store.saveProfile(key,profile));
 handle('models',()=>listModels(settings()));
 handle('startServer',async()=>{assertIdle();const s=settings();const u=new URL(s.baseUrl);resolveLms(s);return cli(s,['server','start','--port',u.port||'1234']);});
 handle('saveSettings',(s:SettingsUpdate)=>{assertIdle();validateSettings(s);const current=storedSettings();
  // An omitted token means "leave the stored one alone". The window never
  // received it and so cannot send it back; only an explicit empty string
  // clears it.
  let encryptedToken=current.encryptedToken;
  if(s.token!==undefined){
   if(s.token&&!safeStorage.isEncryptionAvailable())throw Error('Windows credential encryption is unavailable. Token was not saved.');
   encryptedToken=s.token?safeStorage.encryptString(s.token).toString('base64'):undefined;
  }
  // Built field by field rather than by spreading what arrived. A rest spread would
  // persist any extra key the window sent and reload it into the Settings object that
  // later reaches the CLI and the HTTP client, and every field added here in future
  // would inherit that hole automatically.
  store.set('settings',{baseUrl:s.baseUrl,lmsPath:s.lmsPath,timeoutSec:s.timeoutSec,loadTimeoutSec:s.loadTimeoutSec,judgePrompt:s.judgePrompt,updateRepo:s.updateRepo,updateCheck:s.updateCheck,encryptedToken});});
 handle('saveTest',(t:TestCase)=>{validateTest(t);const old=store.tests().find(x=>x.id===t.id);const saved={...t,id:t.id||randomUUID(),kind:'quality' as const,version:old?old.version+1:1};store.saveTest(saved);return saved;});
 handle('deleteTest',(id:string)=>store.deleteTest(id));
 handle('choosePackFile',async()=>{
  const chosen=await dialog.showOpenDialog(win,{title:'Choose a question file',properties:['openFile'],filters:[{name:'Questions',extensions:packExtensions}]});
  if(chosen.canceled||!chosen.filePaths[0])return null;
  const file=chosen.filePaths[0];
  if(statSync(file).size>maxPackBytes)throw Error(`That file is larger than ${Math.round(maxPackBytes/1048576)} MB.`);
  const items=parsePackFile(readFileSync(file,'utf8'),path.basename(file));
  pendingPack={items,fileName:path.basename(file)};
  return {fileName:pendingPack.fileName,count:items.length,samples:items.slice(0,3),
   suggestedName:path.basename(file).replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').trim().slice(0,80)||'Imported questions',
   suggestedScoring:suggestScoring(items),allNumeric:suggestScoring(items)==='final-number'};
 });
 handle('importPack',(draft:PackDraft)=>{
  assertIdle();
  if(!pendingPack)throw Error('Choose a question file first.');
  const pack=buildPack(draft,pendingPack.items,pendingPack.fileName,text=>createHash('sha256').update(text).digest('hex'),new Date().toISOString());
  if(builtInPacks.some(p=>p.id===pack.id))throw Error('That pack id is already used by a published benchmark.');
  store.savePack(pack);pendingPack=null;
  return describePack(pack);
 });
 handle('deletePack',(id:string)=>{
  assertIdle();
  if(builtInPacks.some(p=>p.id===id))throw Error('Published benchmarks are part of the app and cannot be removed.');
  // Saved runs keep their own copy of every question they asked, so removing a pack never rewrites history.
  store.deletePack(id);
 });
 handle('startRun',(c:RunConfig)=>newRun(c));
 handle('cancel',()=>{worker?.postMessage('cancel');if(progress){progress={...progress,message:'Cancelling requests and unloading the benchmark model…'};notify();}});
 handle('getRun',(id:string)=>store.getRun(id));
 handle('retry',(id:string)=>{const old=store.getRun(id);const retries=old.samples.filter(s=>!s.warmup&&s.status!=='completed');if(!retries.length){if(old.status==='failed'||old.status==='interrupted')return newRun({...old.config,name:old.config.name+' (retry)',retryOf:id},undefined,old);throw Error('No failed requests to retry.');}return newRun({...old.config,name:old.config.name+' (retry)',modelKeys:[...new Set(retries.map(s=>s.modelKey))],retryOf:id},retries,old);});
 handle('grade',(id:string,judge:string)=>{assertIdle();if(!judge)throw Error('Choose a local judge model.');const run=store.getRun(id);run.config.judgeModel=judge;return launch(run,undefined,true);});
 handle('copyPackage',async(rid:string,sid:string)=>{const {sample,test,run}=getPair(rid,sid);const text=gradingPackage(sample,test,String(run.environment.judgePrompt||settings().judgePrompt));let copied=false;try{await clipboard.writeText(text);copied=(await clipboard.readText())===text;}catch{}return {copied,text};});
 handle('importGrade',(rid:string,sid:string,raw:string,judge:string)=>{if(raw.length>1000000)throw Error('Grade too large');const {run,sample,test}=getPair(rid,sid);sample.grades.push(parseGrade(raw,'external',judge,test.version));store.saveSample(sample);
  // The grade replaces an existing sample row rather than adding one, so neither the
  // sample count nor the run's timestamp would move on their own and the history cache
  // would keep serving rows that show no external judge. Touching the run is what makes
  // the imported grade visible without a restart.
  run.updated=new Date().toISOString();store.saveRun(run);});
 handle('exportRun',async(id:string,format:string)=>{if(!['html','csv','json','md'].includes(format))throw Error('Invalid export');const stored=store.getRun(id);const run={...stored,environment:{...stored.environment,comparisonProfiles:store.profiles()}};const target=await dialog.showSaveDialog(win,{title:'Export benchmark',defaultPath:`Local-Model-Bench-${id.slice(0,8)}.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]});if(target.canceled||!target.filePath)return null;
  // Written beside the target and renamed into place: a failure part-way through a
  // direct write leaves a truncated report that looks complete, and the usual cause
  // is a full disk or a USB stick pulled mid-save.
  const temp=target.filePath+'.part';
  try{
   let text:string;
   try{text=format==='html'?chartReport(run):exportText(run,format);}
   catch(e){throw Error(`This run is too large to export as ${format.toUpperCase()}. Try CSV, which is written row by row. (${(e as Error).message})`);}
   writeFileSync(temp,text,'utf8');renameSync(temp,target.filePath);
  }catch(e){rmSync(temp,{force:true});throw Error(`Could not write ${target.filePath}: ${(e as Error).message}`);}
  return target.filePath;});
 handle('history',()=>{const list=store.list(),profiles=store.profiles();const fingerprint=JSON.stringify([list.map(r=>[r.id,r.updated,r.sampleCount]),profiles]);if(historyCache?.fingerprint!==fingerprint)historyCache={fingerprint,rows:historyRows(list.map(r=>store.getRun(r.id)),profiles)};return historyCache.rows;});
 handle('updateState',()=>updateState);
 handle('checkUpdate',()=>checkForUpdate(true));
 handle('downloadUpdate',async()=>{
  const info=updateState.info;
  if(!info)throw Error('Check for an update first.');
  if(updateBusy)throw Error('An update check is already running.');
  updateBusy=true;notifyUpdate({phase:'downloading',received:0,total:info.assetSize,error:'',file:'',sha256:'',verified:false});
  try{
   rmSync(updateDir(),{recursive:true,force:true});
   // Progress is throttled: a hundred-megabyte download would otherwise post thousands of window messages.
   let last=0;
   const result=await downloadInstaller(info,updateDir(),received=>{const now=Date.now();if(received>=info.assetSize||now-last>250){last=now;notifyUpdate({received});}});
   notifyUpdate({phase:'ready',file:result.file,sha256:result.sha256,verified:result.verified,received:info.assetSize});
  }catch(e){notifyUpdate({phase:'available',error:(e as Error).message,received:0,file:'',sha256:'',verified:false});}
  finally{updateBusy=false;}
  return updateState;
 });
 handle('installUpdate',async()=>{
  assertIdle();
  if(updateState.phase!=='ready'||!updateState.file)throw Error('Download and verify the update first.');
  if(!updateState.verified)throw Error('That release published no checksum, so the installer cannot be vouched for. Download it from the release page yourself instead.');
  // The hash taken during the download describes the bytes that arrived. Between then
  // and this click the file has been sitting on disk, so it is read again here: what
  // runs is the file that still matches, not the file that once did.
  const now=await hashFile(updateState.file).catch(()=>'');
  if(now!==updateState.sha256){
   rmSync(updateState.file,{force:true});
   notifyUpdate({phase:'available',file:'',sha256:'',verified:false,received:0,error:'The downloaded installer changed after it was verified, so it was deleted. Download it again.'});
   throw Error('The downloaded installer changed after it was verified. It was deleted rather than run.');
  }
  // Nothing is fetched at this point, and the NSIS installer still asks before it replaces anything.
  spawn(updateState.file,[],{detached:true,stdio:'ignore'}).unref();
  setTimeout(()=>app.quit(),400);
  return updateState.file;
 });
 handle('openData',()=>shell.openPath(dataPath));
 win=new BrowserWindow({width:1440,height:960,minWidth:1050,minHeight:720,title:'Local Model Bench',icon:path.join(__dirname,'../assets/icon.png'),backgroundColor:'#101416',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 // Nothing here needs a camera, a microphone, a location, or a USB/serial/HID
 // device, so every request is refused rather than left to Electron's default.
 const ses=win.webContents.session;
 ses.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 ses.setPermissionCheckHandler(()=>false);
 ses.setDevicePermissionHandler(()=>false);
 ses.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
 win.loadFile(path.join(__dirname,'../dist/index.html'));
 win.webContents.once('did-finish-load',()=>{updateState={...updateState,current:app.getVersion()};checkForUpdate(false).catch(()=>{});});
 win.on('close',e=>{if(worker){e.preventDefault();dialog.showMessageBox(win,{type:'question',title:'Benchmark is running',message:'Cancel the active run and close?',detail:'Completed responses are already saved. The app will stop requests and unload its model before closing.',buttons:['Keep running','Cancel and close'],defaultId:0,cancelId:0}).then(({response})=>{if(response===1){worker?.postMessage('cancel');if(worker)worker.once('exit',()=>win.close());else win.close();}});}});
});
app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>store?.close());
