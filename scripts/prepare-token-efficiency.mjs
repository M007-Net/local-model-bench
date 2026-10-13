// Original deterministic tasks; no model judge, downloads, or candidate execution.
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const id='token-efficiency', tests=[];
const protocol='efficiency-v1; 6 families x 10 variants; balanced nested sampling; strict JSON equality; failures and truncations miss; endpoint token accounting';
function add(category,i,task,key){
 const itemId=category.toLowerCase().replaceAll(' ','-')+'-'+(i+1);
 const answer=JSON.stringify(key);
 tests.push({id:id+':'+itemId,name:'Token efficiency · '+itemId,category,version:1,kind:'quality',
  prompt:'Solve using only the supplied facts. Return only the requested JSON value, without explanation or code fences. All fields must be correct.\n\n'+task,
  answerKey:answer,rubric:'Strict complete JSON equality; no partial credit or model judge.',maxTokens:2048,
  rules:[{id:'answer',label:'Complete correct answer',type:'json-equal',expected:answer,weight:1}],
  benchmark:{packId:id,itemId,datasetHash:'',protocol}});
}
for(let i=0;i<10;i++){
 const stock=73+i*7,boxes=4+i,units=6+i%3,sold=29+i;
 add('Arithmetic',i,`Start with ${stock} units. Receive ${boxes} boxes of ${units} units, sell ${sold}, then discard 3. Return {"remaining": integer}.`,{remaining:stock+boxes*units-sold-3});
 const rows=Array.from({length:7},(_,j)=>({id:'R'+j,value:(j*13+i*7)%41,active:(j+i)%3!==0}));
 add('Data filtering',i,`Records: ${JSON.stringify(rows)}. Select active records with value >= 15. Sort by value descending then id ascending. Return {"ids": array of IDs, "sum": sum of selected values}.`,{ids:rows.filter(r=>r.active&&r.value>=15).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id)).map(r=>r.id),sum:rows.filter(r=>r.active&&r.value>=15).reduce((s,r)=>s+r.value,0)});
 const start=11+i,a=2+i%3,b=5+i;
 add('State tracking',i,`Integer x starts at ${start}. Repeat exactly 4 times in order: add ${a}; if x is even divide by 2, otherwise add ${b}. Return {"x": final integer}.`,{x:(()=>{let x=start;for(let j=0;j<4;j++){x+=a;x=x%2===0?x/2:x+b;}return x;})()});
 const people=['A','B','C','D'],scores=[i+4,20-i,8+i*2,11];
 add('Rule decisions',i,`Candidates ${JSON.stringify(people.map((name,j)=>({name,score:scores[j],eligible:j!==i%4})))}. Choose eligible candidate with highest score, ties by name ascending. Return {"winner": name}.`,{winner:people.map((name,j)=>({name,score:scores[j],eligible:j!==i%4})).filter(r=>r.eligible).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name))[0].name});
 const day=3+i,hours=7+i*3;
 add('Time calculation',i,`A job starts day ${day} at 18:00 and lasts ${hours} hours. Days have 24 hours; day numbers continue indefinitely. Return {"day": integer finish day, "hour": integer finish hour in 0..23}.`,{day:day+Math.floor((18+hours)/24),hour:(18+hours)%24});
 const records=[{id:'a'+i,status:'open'},{id:'b'+i,status:'closed'},{id:'c'+i,status:'open'}];
 add('Structured extraction',i,`Source records: ${JSON.stringify(records)}. Return {"open": IDs whose status is exactly open in source order, "closed_count": integer}.`,{open:[records[0].id,records[2].id],closed_count:1});
}
const datasetHash=createHash('sha256').update(JSON.stringify(tests)).digest('hex');
for(const t of tests)t.benchmark.datasetHash=datasetHash;
writeFileSync('src/benchmark-data/token-efficiency.json',JSON.stringify({id,source:'Original Local Model Bench deterministic token-efficiency suite',datasetHash,protocol,originalCount:tests.length,count:tests.length,tests},null,2)+'\n');
