import {mkdirSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {_electron} from 'playwright';
import {Store} from '../electron/store';
import {defaultConfig,starterTests} from '../src/defaults';
import {metrics} from '../electron/metrics';
import type {Run,Sample} from '../src/types';
const data=path.resolve('work/qa-no-group-data');mkdirSync(data,{recursive:true});
const run:Run={id:'no-group-fixture',created:new Date().toISOString(),updated:new Date().toISOString(),status:'completed',config:{...defaultConfig,name:'Four Qwen comparison',modelKeys:Array.from({length:4},(_,i)=>`qwen-34b-${i}`)},tests:[starterTests[0]],modelInfo:{},environment:{},logs:[],samples:[],waves:[]};
run.samples=Array.from({length:8},(_,i)=>({id:`s${i}`,runId:run.id,modelKey:run.config.modelKeys[Math.floor(i/2)],modelName:'Qwen 34B',testId:run.tests[0].id,testName:run.tests[0].name,concurrency:1,waveId:`w${i}`,wave:i%2,slot:0,warmup:false,prompt:'test',output:'answer',reasoning:'',status:'completed',metrics:metrics({tokens_per_second:10+i,total_output_tokens:20,input_tokens:10},1000,0,100,null),objective:{score:100,checks:[]},grades:[],rawStats:{},created:run.created,possibleTruncation:false} as Sample));
const store=new Store(path.join(data,'bench.sqlite'));store.saveRun(run);for(const s of run.samples)store.saveSample(s);store.db.close();
const app=await _electron.launch({args:[process.cwd()],env:{...process.env,LMB_DATA_DIR:data}});
try{
 const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.getByRole('button',{name:'Results',exact:true}).click();
 const selector=page.getByRole('combobox',{name:'Run group by'});await selector.waitFor();
 const table=page.locator('section').filter({has:page.getByRole('heading',{name:'Model comparison',exact:true})}).locator('tbody tr');
 assert.equal(await table.count(),4);
 await selector.selectOption('none');assert.equal(await table.count(),8);
 assert.equal(await page.locator('.auto-chart').first().locator('circle.point').count(),8);
 assert.equal(await page.locator('.auto-chart').first().locator('polyline').count(),0);
 await selector.selectOption('measurement');assert.equal(await table.count(),4);
 await page.getByRole('button',{name:'All runs overview',exact:true}).click();
 await page.getByRole('combobox',{name:'Group by',exact:true}).selectOption('none');
 assert.equal(await page.locator('.history-table tbody').count(),4);
 assert.deepEqual(errors,[]);console.log('Desktop check passed: 4 model rows → 8 individual rows → 4 model rows; ungrouped overview works.');
}finally{await app.close();}
