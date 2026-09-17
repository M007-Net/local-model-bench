// Seeds an isolated database with a run that carries GPU telemetry, then checks the Results
// screen renders the thermals panel, chart, and comparison column without page errors.
import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../electron/store';
import {metrics} from '../electron/metrics';
import {statsFrom,downsample} from '../src/gpu-stats';
import {starterTests,defaultConfig} from '../src/defaults';
import type {GpuTick,Run,Sample} from '../src/types';

const root=path.join(import.meta.dirname,'..'),dataDir=path.join(root,'work/qa-gpu/data');
fs.rmSync(path.join(root,'work/qa-gpu'),{recursive:true,force:true});
fs.mkdirSync(dataDir,{recursive:true});
const test=starterTests.find(t=>t.id==='reasoning')!,runId=randomUUID(),first=Date.now()-240000;
const ticks:GpuTick[]=Array.from({length:240},(_,i)=>({t:first+i*1000,tempCore:49+i*0.05,tempHotSpot:57+i*0.07+(i%9===0?2.5:0),tempMemory:53+i*0.045,power:i<15?45:150+(i%11)*9,load:i<15?12:97,clockCore:i<15?900:2980-(i%13)*12,fanRpm:1050+i*1.6,memoryUsed:i<15?900:13100}));
const sample=(index:number,concurrency:number,waveId:string):Sample=>{
 const from=first+30000+index*20000,to=from+15000;
 return {id:randomUUID(),runId,modelKey:'mock/model',modelName:'Mock Model',testId:test.id,testName:test.name,concurrency,waveId,wave:0,slot:index,warmup:false,prompt:test.prompt,output:'84',reasoning:'',status:'completed',metrics:metrics({input_tokens:900,total_output_tokens:180,tokens_per_second:46+index},15000,0,700,600),objective:{score:88,checks:[]},grades:[],rawStats:{},created:new Date(to).toISOString(),possibleTruncation:false,gpu:statsFrom(ticks.filter(t=>t.t>=from&&t.t<=to),true)};
};
const waveId=randomUUID(),samples=[sample(0,2,waveId),sample(1,2,waveId)];
const series=downsample(ticks,3000);
const run:Run={id:runId,created:new Date(first).toISOString(),updated:new Date().toISOString(),status:'completed',
 config:{...structuredClone(defaultConfig),name:'GPU thermals check',modelKeys:['mock/model'],testIds:[test.id],mode:'quality',concurrency:[2],waves:1},
 tests:[test],modelInfo:{},environment:{platform:'win32'},logs:['GPU telemetry started (1000 ms interval): AMD Radeon RX 9070.'],samples,waves:[],
 gpu:{available:true,device:'AMD Radeon RX 9070',devices:['AMD Radeon(TM) Graphics','AMD Radeon RX 9070'],intervalMs:1000,note:'Sampled every 1000 ms with LibreHardwareMonitor.',stats:statsFrom(ticks,true),perDevice:{'AMD Radeon RX 9070':statsFrom(ticks,true)},series,seriesNote:''}};
const store=new Store(path.join(dataDir,'bench.sqlite'));
store.saveRun(run);for(const s of samples)store.saveSample(s);store.close();

const app=await electron.launch({args:[root],env:{...process.env,LMB_DATA_DIR:dataDir},timeout:60000});
const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 await page.locator('nav').getByRole('button',{name:'Results',exact:true}).click();
 await page.getByLabel('Saved run').selectOption(runId);
 await page.getByRole('heading',{name:'GPU thermals'}).waitFor();
 const panel=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'GPU thermals'})});
 assert.ok((await panel.textContent())?.includes('AMD Radeon RX 9070'),'the recorded device is named');
 assert.equal(await panel.locator('.gpu-chart svg polyline').count()>0,true,'the timeline chart draws lines');
 assert.ok((await panel.textContent())?.includes('Peak hot spot'),'peak hot spot is summarised');
 const comparison=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Model comparison'})});
 assert.ok((await comparison.locator('table').textContent())?.includes('GPU hot spot'),'the comparison table gains a thermal column');
 await page.locator('.gpu-chart').scrollIntoViewIfNeeded();
 await page.screenshot({path:'work/qa-gpu/results.png',fullPage:true});
 await panel.screenshot({path:'work/qa-gpu/panel.png'});
 const html=await page.getByRole('button',{name:'Graph report'}).isEnabled();
 assert.ok(html,'the graph report stays available');
 assert.deepEqual(errors,[],'no renderer errors');
 console.log('GPU thermals UI check passed. Screenshots in work/qa-gpu/.');
}finally{await app.close();}
