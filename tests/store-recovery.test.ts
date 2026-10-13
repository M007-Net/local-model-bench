import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../electron/store';

test('a genuinely corrupt database is preserved and replaced with a usable store',()=>{
 const dir=mkdtempSync(path.join(process.env.TMPDIR||tmpdir(),'lmb-store-corrupt-'));
 const file=path.join(dir,'bench.sqlite');
 const damaged='This is not a SQLite database';
 writeFileSync(file,damaged);
 let store:Store|undefined;
 try{
  store=Store.open(file);
  const recovery=store.get<{file:string}>('recovered-from');
  assert.ok(recovery);
  assert.equal(readFileSync(recovery.file,'utf8'),damaged);
  store.set('usable',true);
  assert.equal(store.get('usable'),true);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});

test('a busy database is never renamed or replaced as corrupt',()=>{
 const dir=mkdtempSync(path.join(process.env.TMPDIR||tmpdir(),'lmb-store-lock-'));
 const file=path.join(dir,'bench.sqlite');
 const owner=new Store(file);
 let other:Store|undefined;
 try{
  owner.set('kept',{value:42});
  owner.db.exec('BEGIN IMMEDIATE;');
  assert.throws(()=>{other=Store.open(file);},/locked|busy/i);
  assert.deepEqual(readdirSync(dir).filter(name=>name.includes('.corrupt-')),[]);
  owner.db.exec('ROLLBACK;');
  assert.deepEqual(owner.get('kept'),{value:42});
 }finally{
  other?.close();
  try{owner.db.exec('ROLLBACK;');}catch{}
  owner.close();
  // Failed constructors must release SQLite handles; otherwise Windows cannot remove the directory.
  rmSync(dir,{recursive:true,force:true});
 }
});
