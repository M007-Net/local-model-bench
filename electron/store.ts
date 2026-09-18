import {validateProfile,type ModelProfile} from '../src/model-profile';
import { DatabaseSync } from 'node:sqlite';
import { renameSync } from 'node:fs';
import type { Run, RunSummary, Sample, Wave, TestCase } from '../src/types';
import type { BenchmarkPack } from '../src/benchmarks';
import type { AgenticPoint, AgenticRun, AgenticSummary } from '../src/agentic';
// One unreadable row must not take the whole list with it. A write interrupted by a
// power loss leaves a single truncated doc; parsing the batch in one expression would
// make every saved run unreachable because of it.
function docs<T>(rows:{doc:unknown}[]):T[]{const out:T[]=[];for(const r of rows){try{out.push(JSON.parse(String(r.doc)) as T);}catch{}}return out;}
export class Store {
 db:DatabaseSync;
 // A database that cannot be opened at all - a corrupt file, a leftover -wal from a
 // killed process, a half-written header - would otherwise stop the app permanently,
 // with no window to say why. Move it aside and start clean, keeping the old file so
 // nothing is destroyed and it can still be recovered by hand.
 static open(file:string):Store{
  try{return new Store(file);}catch(error){
   const kept=`${file}.corrupt-${new Date().toISOString().replace(/[:.]/g,'-')}`;
   for(const suffix of ['','-wal','-shm']){try{renameSync(file+suffix,kept+suffix);}catch{}}
   const store=new Store(file);
   store.set('recovered-from',{file:kept,when:new Date().toISOString(),reason:(error as Error).message});
   return store;
  }
 }
 constructor(file:string){this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tests(id TEXT PRIMARY KEY, doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS samples(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS waves(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, doc TEXT NOT NULL); CREATE INDEX IF NOT EXISTS samples_run ON samples(run_id); CREATE INDEX IF NOT EXISTS waves_run ON waves(run_id); CREATE TABLE IF NOT EXISTS model_profiles(key TEXT PRIMARY KEY, doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS benchmark_packs(id TEXT PRIMARY KEY, doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agentic_runs(id TEXT PRIMARY KEY, doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agentic_points(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, workers INTEGER NOT NULL, doc TEXT NOT NULL); CREATE INDEX IF NOT EXISTS agentic_points_run ON agentic_points(run_id); PRAGMA user_version=4;');}
 // Imported packs live in the database beside the runs that used them, so they survive an app update and an
 // export folder move, and they are never mixed into the packs compiled into the build.
 packs():BenchmarkPack[]{return docs<BenchmarkPack>(this.db.prepare('SELECT doc FROM benchmark_packs ORDER BY rowid').all() as {doc:unknown}[]);}
 savePack(pack:BenchmarkPack){this.db.prepare('INSERT OR REPLACE INTO benchmark_packs VALUES (?,?)').run(pack.id,JSON.stringify(pack));}
 deletePack(id:string){this.db.prepare('DELETE FROM benchmark_packs WHERE id=?').run(id);}
 saveAgenticRun(run:AgenticRun){const {points,...doc}=run;this.db.prepare('INSERT OR REPLACE INTO agentic_runs VALUES (?,?)').run(run.id,JSON.stringify(doc));}
 saveAgenticPoint(runId:string,point:AgenticPoint){this.db.prepare('INSERT OR REPLACE INTO agentic_points VALUES (?,?,?,?)').run(`${runId}:${point.workers}`,runId,point.workers,JSON.stringify(point));}
 getAgenticRun(id:string):AgenticRun{const row=this.db.prepare('SELECT doc FROM agentic_runs WHERE id=?').get(id);if(!row)throw Error('Agent sweep not found');
  let doc:AgenticRun;try{doc=JSON.parse(String(row.doc));}catch{throw Error('That sweep is saved but unreadable; its record is damaged.');}
  return {...doc,points:docs<AgenticPoint>(this.db.prepare('SELECT doc FROM agentic_points WHERE run_id=? ORDER BY workers').all(id) as {doc:unknown}[])};}
 deleteAgenticRun(id:string){this.db.prepare('DELETE FROM agentic_points WHERE run_id=?').run(id);this.db.prepare('DELETE FROM agentic_runs WHERE id=?').run(id);}
 // The list never reads agentic_points: a sweep's trace is thousands of segment records, and the
 // sweep picker only needs the run document.
 listAgentic():AgenticSummary[]{return docs<AgenticSummary>(this.db.prepare('SELECT doc FROM agentic_runs ORDER BY rowid DESC').all() as {doc:unknown}[]);}
 profiles():Record<string,ModelProfile>{const out:Record<string,ModelProfile>={};for(const r of this.db.prepare('SELECT key,doc FROM model_profiles').all()){try{out[String(r.key)]=JSON.parse(String(r.doc));}catch{}}return out;}
 saveProfile(key:string,profile:ModelProfile){if(typeof key!=='string'||!key.trim()||key.length>4096)throw Error('Invalid model key');const p=validateProfile(profile);this.db.prepare('INSERT OR REPLACE INTO model_profiles VALUES (?,?)').run(key,JSON.stringify(p));}
 get<T>(key:string):T|undefined{const row=this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);return row?JSON.parse(String(row.value)):undefined;}
 set(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO kv VALUES (?,?)').run(key,JSON.stringify(value));}
 tests():TestCase[]{return docs<TestCase>(this.db.prepare('SELECT doc FROM tests ORDER BY rowid').all() as {doc:unknown}[]);}
 saveTest(t:TestCase){this.db.prepare('INSERT OR REPLACE INTO tests VALUES (?,?)').run(t.id,JSON.stringify(t));}
 deleteTest(id:string){this.db.prepare('DELETE FROM tests WHERE id=?').run(id);}
 saveRun(run:Run){const {samples,waves,...doc}=run;this.db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(run.id,JSON.stringify(doc));}
 saveSample(s:Sample){this.db.prepare('INSERT OR REPLACE INTO samples VALUES (?,?,?)').run(s.id,s.runId,JSON.stringify(s));}
 saveWave(w:Wave){this.db.prepare('INSERT OR REPLACE INTO waves VALUES (?,?,?)').run(w.id,w.runId,JSON.stringify(w));}
 getRun(id:string):Run{const row=this.db.prepare('SELECT doc FROM runs WHERE id=?').get(id);if(!row)throw Error('Run not found');
  let doc:Run;try{doc=JSON.parse(String(row.doc));}catch{throw Error('That run is saved but unreadable; its record is damaged.');}
  return {...doc,samples:docs<Sample>(this.db.prepare('SELECT doc FROM samples WHERE run_id=? ORDER BY rowid').all(id) as {doc:unknown}[]),waves:docs<Wave>(this.db.prepare('SELECT doc FROM waves WHERE run_id=? ORDER BY rowid').all(id) as {doc:unknown}[])};}
 list():RunSummary[]{const out:RunSummary[]=[];for(const r of this.db.prepare('SELECT runs.doc, (SELECT COUNT(*) FROM samples WHERE samples.run_id=runs.id) AS count FROM runs ORDER BY rowid DESC').all()){
  try{out.push({...JSON.parse(String(r.doc)),sampleCount:Number(r.count)});}catch{}}
  return out;}
 // Both pipelines mark unfinished work the same way, and both are recovered by one call so a new
 // pipeline cannot be left out of startup recovery. Neither reads child rows: only the run document
 // changes, and saving it never touches samples, waves or points.
 private reopen<T extends {id:string;status:string;updated:string;logs:string[]}>(rows:T[],unfinished:string[],message:string,save:(row:T)=>void){
  for(const row of rows)if(unfinished.includes(row.status)){row.status='interrupted';row.updated=new Date().toISOString();row.logs.push(message);save(row);}
 }
 recover(){
  this.reopen(this.list(),['running','grading'],'App closed before completion. Saved results recovered; unfinished requests were not resumed.',r=>this.saveRun({...r,samples:[],waves:[]}));
  this.reopen(this.listAgentic(),['running'],'App closed before the sweep finished. Completed worker counts were kept; the remaining ones were not run.',r=>this.saveAgenticRun({...r,points:[]}));
 }
 close(){this.db.close();}
}
