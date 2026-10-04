import type {BenchmarkPack} from './benchmarks';
import type {TestCase} from './types';
import {emailPrediction} from './email-classification';

export const emailChallengeId='berkeley-enron-challenge';
export const emailChallengeProtocol='berkeley-enron-challenge-v1; 20 highest-complexity full emails per genre from consensus corpus; complexity = log2(1 + body characters) + 2 * capped thread markers; deduplicate normalized full messages; seeded balanced round-robin sampling; strict genre JSON; accuracy and six-class macro-F1';
// Complexity is a model-independent selection proxy, not a claim that these are
// empirically the hardest emails. Original human gold labels and prompts stay intact.
export function emailComplexity(test:TestCase){
 const marker='Email (JSON encoded):\n',start=test.prompt.indexOf(marker);
 if(start<0)throw Error('Expected a complete encoded email.');
 const email=JSON.parse(test.prompt.slice(start+marker.length));
 if(typeof email!=='string')throw Error('Expected email text.');
 const split=email.search(/\r?\n\r?\n/),body=split>=0?email.slice(split).trim():email;
 const threadMarkers=(body.match(/(?:^|\n)\s*(?:>+|From:|Sent:|Subject:|To:|[- ]*(?:Original Message|Forwarded by|Begin forwarded message))/gi)??[]).length;
 return {email,bodyCharacters:body.length,threadMarkers,score:Math.log2(1+body.length)+2*Math.min(threadMarkers,20)};
}
export function buildEmailChallenge(source:BenchmarkPack,hash:(s:string)=>string){
 const groups=Array.from({length:6},()=>[] as {test:TestCase;complexity:ReturnType<typeof emailComplexity>}[]);
 const seen=new Set<string>();
 const ranked=source.tests.map(test=>({test,complexity:emailComplexity(test)})).sort((a,b)=>b.complexity.score-a.complexity.score||a.test.id.localeCompare(b.test.id,'en'));
 for(const item of ranked){
  const category=emailPrediction(item.test.answerKey);if(!category)throw Error('Missing email genre.');
  const signature=item.complexity.email.toLowerCase().replace(/\s+/g,' ').trim();
  if(seen.has(signature))continue;seen.add(signature);groups[category-1].push(item);
 }
 if(groups.some(g=>g.length<20))throw Error('Need at least 20 unique consensus emails per genre.');
 const selected=groups.flatMap(g=>g.slice(0,20));
 const datasetHash=hash(JSON.stringify({protocol:emailChallengeProtocol,parentHash:source.datasetHash,items:selected.map(({test})=>[test.benchmark?.itemId,test.prompt,test.rules])}));
 const tests=selected.map(({test})=>({...structuredClone(test),maxTokens:8192,id:`${emailChallengeId}:${test.benchmark!.itemId}`,name:`Berkeley email challenge · ${test.benchmark!.itemId}`,benchmark:{...test.benchmark!,packId:emailChallengeId,datasetHash,protocol:emailChallengeProtocol}}));
 const pack:BenchmarkPack={...source,id:emailChallengeId,protocol:emailChallengeProtocol,datasetHash,count:tests.length,tests};
 const selection=selected.map(({test,complexity:{email:_email,...complexity}})=>({itemId:test.benchmark!.itemId,genre_id:emailPrediction(test.answerKey),...complexity}));
 return {pack,selection};
}
export function balancedEmailSelection(tests:TestCase[],seed:number,count:number){
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const shuffle=<T,>(items:T[])=>{for(let i=items.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;};
 const groups=Array.from({length:6},(_,i)=>shuffle(tests.filter(t=>emailPrediction(t.answerKey)===i+1)));
 if(groups.reduce((n,g)=>n+g.length,0)!==tests.length)throw Error('Every challenge email needs a valid gold genre.');
 const order=shuffle([0,1,2,3,4,5]),selected:TestCase[]=[];
 for(let row=0;selected.length<tests.length;row++)for(const group of order)if(groups[group][row])selected.push(groups[group][row]);
 return structuredClone(selected.slice(0,count));
}
