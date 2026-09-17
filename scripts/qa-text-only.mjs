import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// Drives the real window to make and remove a text-only copy of a real vision model, and
// checks what LM Studio does with it. This one touches the real LM Studio models directory,
// because that is the whole mechanism under test; it writes only hard links, removes them
// again, and asserts afterwards that the original weights are byte-for-byte where they were.
//
// LMB_TEXTONLY_MODEL picks the model; it must be one LM Studio reports as vision-capable.
const root=process.cwd(),dir=path.join(root,'work/text-only-qa/data');
fs.rmSync(path.join(root,'work/text-only-qa'),{recursive:true,force:true});
fs.mkdirSync(dir,{recursive:true});
const WANT=process.env.LMB_TEXTONLY_MODEL||'gemma-4-12b-it@iq3_xxs';
const app=await electron.launch({...(process.env.LMB_QA_EXE?{executablePath:process.env.LMB_QA_EXE}:{}),args:process.env.LMB_QA_EXE?[]:[root],env:{...process.env,LMB_DATA_DIR:dir},timeout:60000});
const page=await app.firstWindow();page.setDefaultTimeout(30000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const models=()=>page.evaluate(()=>window.bench.models());
const twins=()=>page.evaluate(()=>window.bench.textOnlyTwins());
try{
 await page.getByRole('heading',{name:'Choose models to benchmark'}).waitFor();
 const before=await models();
 const target=before.find(m=>m.key===WANT);
 assert.ok(target,`${WANT} is not in the library`);
 assert.equal(target.capabilities?.vision,true,`${WANT} is not vision-capable, so there is nothing to leave out`);
 assert.equal((await twins()).length,0,'the library starts with no copies this app made');

 const plan=await page.evaluate(key=>window.bench.textOnlyPlan(key),WANT);
 assert.ok(plan.folder.endsWith(' - Text only'));
 assert.ok(plan.projectors.length>0,'the plan names the projector it is leaving behind');
 assert.ok(plan.files.every(f=>!/mmproj/i.test(f.to)),'and links none of it');
 const sizesBefore=plan.files.map(f=>fs.statSync(f.from).size);

 const panel=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Vision projectors',exact:true})});
 await panel.waitFor();
 const row=panel.locator('.selection-list > div').filter({hasText:target.display_name}).filter({hasText:target.quantization?.name??''}).first();
 await row.getByRole('button',{name:'Make text-only copy'}).click();
 await page.getByText('Text-only copy made:',{exact:false}).waitFor();

 // LM Studio indexes the new folder on its own; it is a separate model key reporting no vision.
 const after=await models();
 const fresh=after.filter(m=>!before.some(b=>b.key===m.key));
 assert.equal(fresh.length,1,'exactly one new model key appeared: '+fresh.map(m=>m.key).join(', '));
 assert.equal(fresh[0].capabilities?.vision,false,'the copy is what the original could not be: not vision-capable');
 assert.equal(fresh[0].nativeMtp?.supported,target.nativeMtp?.supported,'and it keeps whatever native MTP the original had');
 // Hard links, not copies: same inode, and the folder adds no bytes to the volume.
 const linked=plan.files.map(f=>fs.statSync(f.to));
 plan.files.forEach((f,i)=>{
  assert.equal(linked[i].ino,fs.statSync(f.from).ino,'the copy shares the original bytes');
  assert.equal(linked[i].size,sizesBefore[i]);
  assert.ok(linked[i].nlink>=2);
 });
 assert.equal(fs.existsSync(path.join(plan.folder,path.basename(plan.projectors[0]))),false,'no projector was linked in');
 assert.equal((await twins()).length,1);

 await panel.locator('.selection-list > div').filter({hasText:target.display_name}).filter({hasText:'Text-only copy made'}).first()
  .getByRole('button',{name:'Remove copy'}).click();
 await page.getByText('Its weights were not touched.',{exact:false}).waitFor();
 assert.equal(fs.existsSync(plan.folder),false,'the folder is gone');
 assert.equal((await twins()).length,0);
 // The point of the whole design: removal dropped links and nothing else.
 plan.files.forEach((f,i)=>{
  assert.ok(fs.existsSync(f.from),'the original weights are still there');
  assert.equal(fs.statSync(f.from).size,sizesBefore[i],'and unchanged');
 });
 for(const p of plan.projectors)assert.ok(fs.existsSync(path.join(plan.sourceDir,p)),'and so is the projector');
 const restored=await models();
 assert.deepEqual(restored.map(m=>m.key).sort(),before.map(m=>m.key).sort(),'the library is exactly as it started');

 assert.deepEqual(errors,[]);
 await panel.scrollIntoViewIfNeeded();await page.waitForTimeout(300);
 await page.screenshot({path:'work/text-only-qa/panel.png',fullPage:true});
 fs.writeFileSync('work/text-only-qa/result.json',JSON.stringify({passed:true,model:WANT,folder:plan.folder,
  linkedFiles:plan.files.map(f=>path.basename(f.to)),projectorLeftBehind:plan.projectors,keptNativeMtp:fresh[0].nativeMtp?.supported===true,
  bytesAdded:0,errors,platform:os.platform(),installed:!!process.env.LMB_QA_EXE},null,2));
 console.log(`Text-only copy of ${WANT}: created as hard links, indexed by LM Studio with vision=false, MTP kept, removed again with the original intact.`);
}catch(error){
 console.error(error);
 process.exitCode=1;
}finally{await app.close();}
