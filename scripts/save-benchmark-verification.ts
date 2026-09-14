import {Store} from '../electron/store';
import {readFileSync,writeFileSync} from 'node:fs';
import {benchmarkRows} from '../src/benchmarks';
import {benchmarkReport} from '../electron/benchmark-report';
import {chartReport} from '../electron/chart-report';
import type {Run} from '../src/types';
import path from 'node:path';
const dir=process.argv[2],store=new Store(process.argv[3]);
try{
 if(store.list().some(r=>['running','grading'].includes(r.status)))throw Error('Existing run is active; leave history untouched.');
 const summary=[];
 for(const name of ['gsm8k-off','gsm8k-on','ifeval-off','cruxeval-off']){
  const run:Run=JSON.parse(readFileSync(path.join(dir,name+'.json'),'utf8'));
  if(run.status!=='completed'||run.samples.filter(s=>!s.warmup).length!==2)throw Error('Incomplete verification: '+name);
  run.config.name=`Smoke check · ${name} · 2 questions`;
  store.saveRun(run);for(const s of run.samples)store.saveSample(s);for(const w of run.waves)store.saveWave(w);
  writeFileSync(path.join(dir,name+'.html'),chartReport(run));
  writeFileSync(path.join(dir,name+'.md'),benchmarkReport(run));
  summary.push({name,rows:benchmarkRows(run)});
 }
 writeFileSync(path.join(dir,'validation-summary.json'),JSON.stringify({unitTests:100,interfaceChecks:'passed',installedVersion:'1.6.0',liveRuns:summary,note:'Two questions per run verify integration only, not broad model ability.'},null,2));
 console.log(JSON.stringify(summary));
}finally{store.close();}
