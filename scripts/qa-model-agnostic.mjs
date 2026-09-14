import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=path.resolve('work/model-agnostic-qa');fs.mkdirSync(dir,{recursive:true});
const app=await electron.launch({args:[process.cwd()],env:{...process.env,LMB_DATA_DIR:path.join(dir,'data')},timeout:60000});
try{
 await app.evaluate(()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>String(url).endsWith('/api/v1/models')?new Response(JSON.stringify({models:[
   {type:'llm',key:'unseen-vendor/new-family@custom-quant',capabilities:{reasoning:{allowed_options:['off','future-level'],default:'off'}}},
   {type:'llm',key:'private/no-reasoning-model'},
   {type:'embedding',key:'not-a-chat-model'}
  ]})):original(url,options);
 });
 const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.reload();
 await page.getByRole('button',{name:'Refresh models',exact:true}).click();
 assert.equal(await page.locator('.model-card').count(),2);
 await page.locator('.model-card').filter({hasText:'unseen-vendor'}).click();
 await page.getByRole('button',{name:'Configure benchmark'}).click();
 await page.getByText('Model settings and timeouts',{exact:true}).click();
 const select=page.locator('select').filter({has:page.locator('option[value="default"]')});
 assert.deepEqual(await select.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value)),['default','off','future-level']);
 await select.selectOption('future-level');
 await page.locator('.selection-list label').filter({hasText:'private/no-reasoning-model'}).locator('input').check();
 assert.equal(await page.getByRole('button',{name:'Start benchmark',exact:true}).isEnabled(),false);
 await select.selectOption('default');
 assert.equal(await page.getByRole('button',{name:'Start benchmark',exact:true}).isEnabled(),true);
 await page.getByLabel('Enable native MTP',{exact:true}).check();
 assert.equal(await page.getByRole('button',{name:'Start benchmark',exact:true}).isEnabled(),false);
 await page.getByLabel('Enable native MTP',{exact:true}).uncheck();
 await page.screenshot({path:path.join(dir,'unknown-models.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('UI passed: arbitrary models, dynamic reasoning, unsupported setting guard, optional MTP');
}finally{await app.close();}
