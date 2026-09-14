import {test} from 'node:test';
import assert from 'node:assert/strict';
import {accountingCases,accountingTests} from '../src/accounting';
import {objectiveScore} from '../electron/scoring';
import {validateTest} from '../electron/validation';

for(const t of accountingTests){
 test(`${t.id}: valid key; wrong, missing, extra and malformed answers fail`,()=>{
  validateTest(t);assert.equal(objectiveScore(t.answerKey,t).score,100);
  for(const bad of ['', '{}','[]','null','```json\n'+t.answerKey+'\n```',t.answerKey+' prose'])assert.equal(objectiveScore(bad,t).score,0);
  const key=JSON.parse(t.answerKey);
  assert.equal(objectiveScore(JSON.stringify({...key,extra:0}),t).score,0);
  const missing=structuredClone(key);delete missing[Object.keys(missing)[0]];
  assert.equal(objectiveScore(JSON.stringify(missing),t).score,0);
  function mutate(o:any,fn:(n:number)=>any){for(const k of Object.keys(o)){if(typeof o[k]==='number'){const old=o[k];o[k]=fn(old);assert.equal(objectiveScore(JSON.stringify(oRoot),t).score,0,`${t.id} ${k}`);o[k]=old;}else mutate(o[k],fn);}}
  const oRoot=structuredClone(key);mutate(oRoot,n=>n+0.01);mutate(oRoot,n=>String(n));mutate(oRoot,()=>null);
  function reorder(o:any):any{return o&&typeof o==='object'?Object.fromEntries(Object.entries(o).reverse().map(([k,v])=>[k,reorder(v)])):o;}
  assert.equal(objectiveScore(JSON.stringify(reorder(key),null,2),t).score,100);
  if(key.T1){for(const entry of Object.values(key) as any[]){let debit=0,credit=0;for(const line of Object.values(entry) as any[]){assert.ok(line.debit>=0&&line.credit>=0);assert.ok((line.debit===0)!==(line.credit===0));debit+=Math.round(line.debit*100);credit+=Math.round(line.credit*100);}assert.equal(debit,credit);}
   const reversed=structuredClone(key);for(const entry of Object.values(reversed) as any[])for(const line of Object.values(entry) as any[])[line.debit,line.credit]=[line.credit,line.debit];assert.equal(objectiveScore(JSON.stringify(reversed),t).score,0);
  }
 });
}
test('independent worksheet arithmetic checks every case and balances month end',()=>{
 const a=Object.fromEntries(accountingCases.map(c=>[c.id,c.answer])) as Record<string,any>;
 const debit=(id:string,tx:string,account:string)=>a[id][tx][account].debit;
 assert.equal(debit('cash-capital','T1','Cash'),12500);assert.equal(debit('cash-capital','T2','RentExpense'),875);
 assert.equal(debit('receivable','T1','AccountsReceivable')-debit('receivable','T2','Cash'),2955);
 assert.equal(debit('receivable','T2','Cash'),1725);
 assert.equal(debit('payable','T1','Equipment'),9450);assert.equal(a.payable.T1.Cash.credit,2250);
 assert.equal(a.payable.T1.AccountsPayable.credit-debit('payable','T2','AccountsPayable'),5400);
 assert.equal(debit('prepaid','T1','InsuranceExpense'),3600/12);
 assert.equal(debit('accrual','T1','WagesExpense'),3*16*22.5);assert.equal(debit('accrual','T2','WagesPayable'),1080);
 assert.equal(debit('deferred','T1','Cash'),7200);assert.equal(debit('deferred','T2','UnearnedRevenue'),7200*2/6);
 assert.equal(debit('depreciation','T1','DepreciationExpense'),(26400-2400)/60);
 assert.equal(debit('interest','T1','InterestExpense'),18250*8*45/(100*365));
 assert.equal(debit('inventory','T1','Inventory'),30*15);assert.equal(debit('inventory','T2','Cash'),50*25);assert.equal(debit('inventory','T3','CostOfGoodsSold'),40*12+10*15);
 assert.equal(debit('supplies','T1','SuppliesExpense'),760+1140-425);
 assert.equal(a.bank.adjusted_bank_cash,8420+1350-975);assert.equal(a.bank.adjusted_book_cash,9080-25-310+50);
 // Independently post all month-end activity to signed ledger balances.
 const ledger:Record<string,number>={};
 const post=(lines:Record<string,number>)=>{assert.equal(Object.values(lines).reduce((x,y)=>x+y,0),0);for(const [k,v] of Object.entries(lines))ledger[k]=(ledger[k]??0)+v;};
 [{cash:20000,capital:-20000},{equipment:6000,cash:-6000},{supplies:1200,ap:-1200},{cash:5000,ar:3000,revenue:-8000},{cash:1000,ar:-1000},{rent:1200,cash:-1200},{wages:2000,cash:-2000},{ap:700,cash:-700},{drawings:500,cash:-500},{suppliesExpense:900,supplies:-900},{depreciation:100,accumulated:-100},{wages:400,wp:-400}].forEach(x=>post(x as unknown as Record<string,number>));
 const expenses=ledger.rent+ledger.wages+ledger.suppliesExpense+ledger.depreciation;
 const income=-ledger.revenue-expenses,assets=ledger.cash+ledger.ar+ledger.supplies+ledger.equipment+ledger.accumulated;
 assert.deepEqual(a['month-end'],{cash:ledger.cash,accounts_receivable:ledger.ar,supplies:ledger.supplies,equipment_net:ledger.equipment+ledger.accumulated,accounts_payable:-ledger.ap,wages_payable:-ledger.wp,revenue:-ledger.revenue,expenses,net_income:income,total_assets:assets,total_liabilities:-ledger.ap-ledger.wp,ending_equity:-ledger.capital+income-ledger.drawings});
 assert.equal(assets,-ledger.ap-ledger.wp-ledger.capital+income-ledger.drawings);
});
test('duplicate keys and non-finite numeric answers cannot pass',()=>{
 const t=accountingTests.find(x=>x.id==='accounting-bank')!;
 for(const s of ['{"adjusted_bank_cash":0,"adjusted_bank_cash":8795,"adjusted_book_cash":8795}','{"adjusted_bank_cash":1e999,"adjusted_book_cash":8795}'])assert.equal(objectiveScore(s,t).score,0);
 const j=accountingTests[0];assert.equal(objectiveScore(j.answerKey.replace('"debit":12500','"debit":0,"debit":12500'),j).score,0);
});

