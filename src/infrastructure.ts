import type {TestCase,Run,Sample} from './types';
export const infrastructureId='infrastructure-reasoning';
// Shuffle each domain and the domain order once; round robin makes every prefix
// nested and gives balanced coverage instead of accidentally selecting one topic.
export function balancedInfrastructureSelection(tests:TestCase[],seed:number,count:number){
 let state=seed>>>0;
 const shuffle=<T,>(a:T[])=>{for(let i=a.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=Math.floor(state/4294967296*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 const names=[...new Set(tests.map(t=>t.category))].sort();
 const groups=names.map(name=>shuffle(tests.filter(t=>t.category===name)));
 const order=shuffle(groups),out:TestCase[]=[];
 for(let row=0;out.length<tests.length;row++)for(const group of order)if(group[row])out.push(group[row]);
 return structuredClone(out.slice(0,count));
}
export function infrastructureMetrics(samples:Sample[],tests:Run['tests']){
 const byId=new Map(tests.map(t=>[t.id,t]));
 const domains=[...new Set(tests.map(t=>t.category))].sort().map(domain=>{
  const selected=tests.filter(t=>t.category===domain);
  const attempted=samples.filter(s=>byId.get(s.testId)?.category===domain);
  const passed=attempted.filter(s=>s.status==='completed'&&!s.possibleTruncation&&s.objective.score===100).length;
  return {domain,selected:selected.length,distinct:new Set(attempted.map(s=>s.testId)).size,attempted:attempted.length,passed,score:attempted.length?100*passed/attempted.length:null};
 });
 return {domains,represented:domains.filter(d=>d.attempted>0).length,totalDomains:18,macroAccuracy:domains.length?domains.reduce((n,d)=>n+(d.score??0),0)/domains.length:null};
}
