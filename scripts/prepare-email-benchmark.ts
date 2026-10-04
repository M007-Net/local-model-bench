import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {emailPrompt,emailProtocol} from '../src/email-classification';
import type {BenchmarkPack} from '../src/benchmarks';
import type {TestCase} from '../src/types';

// The Python loader joins raw .txt messages to .cats annotations without extracting
// the untrusted tar archive. This step builds normal app TestCases and fingerprints
// the full protocol and complete prepared email texts/labels.
const input=process.argv[2]??'work/email-source/prepared.json';
const output=process.argv[3]??'src/benchmark-data/berkeley-enron.json';
const source=JSON.parse(readFileSync(input,'utf8'));
if(source.dataset!=='UC Berkeley Enron'||!Array.isArray(source.emails)||!source.emails.length)throw Error('Expected prepared Berkeley email data.');
const ids=new Set<string>();
for(const e of source.emails){
 if(typeof e.id!=='string'||!e.id||ids.has(e.id)||typeof e.email!=='string'||!e.email.trim()||!Number.isInteger(e.genre_id)||e.genre_id<1||e.genre_id>6)throw Error('Invalid or duplicate prepared email.');
 ids.add(e.id);
}
const datasetHash=createHash('sha256').update(JSON.stringify({protocol:emailProtocol,emails:source.emails})).digest('hex');
const id='berkeley-enron';
const tests:TestCase[]=source.emails.map((e:{id:string;email:string;genre_id:number})=>({id:`${id}:${e.id}`,name:`Berkeley email classification · ${e.id}`,category:'Email classification',version:1,kind:'quality',prompt:emailPrompt(e.email),answerKey:JSON.stringify({genre_id:e.genre_id}),rubric:'Choose the human-annotated primary email purpose. Return exactly the requested JSON schema.',maxTokens:2048,rules:[{id:'genre',label:'Exact category JSON',type:'json-equal',expected:JSON.stringify({genre_id:e.genre_id}),weight:1}],benchmark:{packId:id,itemId:e.id,datasetHash,protocol:emailProtocol}}));
const pack:BenchmarkPack={id,source:`https://bailando.berkeley.edu/enron_email.html; archive SHA-256 ${source.archiveSha256}`,datasetHash,protocol:emailProtocol,originalCount:source.originalCount,count:tests.length,tests};
mkdirSync(path.dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(pack));
writeFileSync(output.replace(/\.json$/,'.manifest.json'),JSON.stringify({...source,emails:undefined,protocol:emailProtocol,datasetHash,preparedCount:tests.length},null,2));
console.log(JSON.stringify({id,count:tests.length,datasetHash,exclusions:source.exclusions}));
