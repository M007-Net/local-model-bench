// End-to-end check for the agent sweep. It runs a real host-only sweep, so it needs no LM Studio,
// no model and no GPU — only this machine's CPU.
import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.cwd();
const out='work/qa-agents';
fs.mkdirSync(out,{recursive:true});
const app=await electron.launch({args:[root],env:{...process.env,LMB_DATA_DIR:path.join(root,out,'data')},timeout:60000});
const page=await app.firstWindow();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Agents',exact:true}).click();
 await page.getByRole('heading',{name:'The GPU thinks. The CPU does everything else.'}).waitFor();
 await page.screenshot({path:path.join(out,'agents-empty.png'),fullPage:true});

 await page.getByRole('button',{name:'New agent sweep'}).click();
 await page.getByLabel('Sweep name').fill('QA host-only sweep');
 await page.getByLabel('Agent turns').fill('16');
 await page.getByLabel('Host work scale').fill('2');
 await page.getByLabel('Repeats per worker count').fill('2');
 for(const w of ['16w','32w','48w','64w','96w','128w']){
  const pill=page.getByRole('group',{name:'Worker counts to sweep'}).getByRole('button',{name:w,exact:true});
  if(await pill.getAttribute('aria-pressed')==='true')await pill.click();
 }
 await page.screenshot({path:path.join(out,'agents-setup.png'),fullPage:true});
 await page.getByRole('button',{name:'Start agent sweep'}).click();

 // The sweep replays 16 turns at 1, 2, 4 and 8 workers; wait for the last worker count to land.
 await page.locator('.sweep-table tbody tr').nth(3).waitFor({timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.live-panel'),null,{timeout:180000});

 const run=await page.evaluate(async()=>{const s=await window.bench.snapshot();return window.bench.getAgenticRun(s.agenticRuns[0].id);});
 assert.equal(run.status,'completed',`sweep status was ${run.status}: ${run.error??''}`);
 assert.deepEqual(run.points.map(p=>p.workers),[1,2,4,8]);
 for(const point of run.points){
  assert.equal(point.completed,16,`${point.workers} workers completed ${point.completed} turns`);
  assert.equal(point.failed,0);
  assert.ok(point.wallMs>0);
  assert.equal(point.wallSamples.length,2,'each worker count was replayed twice');
  assert.ok(point.wallSamples.every(v=>v>0));
  const sorted=[...point.wallSamples].sort((a,b)=>a-b);
  assert.ok(point.wallMs>=sorted[0]&&point.wallMs<=sorted[sorted.length-1],'the reported wall clock is one of the repeats');
  for(const turn of point.turns){
   assert.equal(turn.segments.length,6,'host-only turns have six stages and no model call');
   assert.ok(!turn.segments.some(s=>s.stage==='llm'));
   assert.ok(turn.end>turn.start);
  }
 }
 assert.ok(String(run.logs.join(' ')).includes('Model call off'));
 assert.ok(run.environment.hostThreads>=1);
 assert.ok(run.environment.workloadVersion>=1,'the sweep records which workload it measured');

 // The sweep must actually separate per-core speed from whole-chip throughput, or it cannot be used
 // to compare two CPUs at all.
 const wall=Object.fromEntries(run.points.map(p=>[p.workers,p.wallMs]));
 assert.ok(wall[2]<wall[1]*0.75,`two workers must be clearly faster than one (${wall[1].toFixed(0)}ms -> ${wall[2].toFixed(0)}ms)`);
 assert.ok(wall[4]<wall[2]*0.8,`four workers must still gain (${wall[2].toFixed(0)}ms -> ${wall[4].toFixed(0)}ms)`);
 const spread=Math.max(...run.points.map(p=>(Math.max(...p.wallSamples)-Math.min(...p.wallSamples))/p.wallMs));
 assert.ok(spread<0.5,`repeat spread was ${(spread*100).toFixed(1)}%, too noisy to compare machines`);

 const verdicts=await page.locator('.verdict').allInnerTexts();
 assert.match(verdicts[0],/One worker finishes an agent turn in \d/);
 assert.match(verdicts[0],/whole CPU tops out at/);
 assert.ok(await page.getByRole('button',{name:'Import'}).isVisible(),'another machine\'s sweep can be brought in for comparison');
 assert.ok((await page.locator('.sweep-table th').allInnerTexts()).map(t=>t.toLowerCase()).includes('spread %'));

 await page.screenshot({path:path.join(out,'agents-sweep.png'),fullPage:true});

 // The controls have to actually drive the view.
 await page.getByRole('group',{name:'PARALLEL AGENT WORKERS'}).getByRole('button',{name:'8w',exact:true}).click();
 await page.locator('.timeline-panel .chart-surface svg rect.turn-segment').first().waitFor();
 const lanes=await page.locator('.timeline-panel .hint').first().innerText();
 assert.match(lanes,/8 worker lanes/);

 await page.locator('.stage-chip[data-stage="hash"]').click();
 assert.ok(await page.locator('.turn-segment.dim').count()>0,'isolating a stage dims the others');
 await page.getByRole('button',{name:'Show every stage'}).click();

 await page.locator('.timeline-panel .chart-surface svg rect.turn-segment').first().click();
 await page.getByText('AGENT TURN 1',{exact:true}).waitFor();
 assert.equal(await page.locator('.turn-stage').count(),6);
 await page.screenshot({path:path.join(out,'agents-turn.png'),fullPage:true});
 await page.getByRole('button',{name:'Close turn'}).click();

 await page.locator('.sweep-table tbody tr').first().click();
 assert.match(await page.locator('.timeline-panel .hint').first().innerText(),/1 worker lane/);
 await page.getByLabel('Scaling measurement').selectOption('efficiency');
 await page.getByRole('img',{name:'Efficiency against worker count'}).waitFor();

 await page.getByLabel('Lock time axis to slowest run').uncheck();
 await page.getByLabel('Lock time axis to slowest run').check();

 await page.evaluate(()=>window.bench.exportAgenticRun('nope','xml').catch(()=>{}));
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(out,'agents-result.json'),JSON.stringify({passed:true,points:run.points.map(p=>({workers:p.workers,wallMs:p.wallMs,completed:p.completed})),environment:run.environment},null,2));
 console.log('Agent sweep checks passed: '+run.points.map(p=>`${p.workers}w ${(p.wallMs/1000).toFixed(2)}s`).join(', '));
}finally{await app.close();}
