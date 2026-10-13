import data from '../src/benchmark-data/berkeley-enron.json';
import type {BenchmarkPack} from '../src/benchmarks';
import {buildEmailChallenge} from '../src/email-challenge';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const {pack,selection}=buildEmailChallenge(data as unknown as BenchmarkPack,s=>createHash('sha256').update(s).digest('hex'));
writeFileSync('src/benchmark-data/berkeley-enron-challenge.json',JSON.stringify(pack));
writeFileSync('src/benchmark-data/berkeley-enron-challenge.manifest.json',JSON.stringify({parentHash:data.datasetHash,datasetHash:pack.datasetHash,protocol:pack.protocol,categoryCounts:[20,20,20,20,20,20],selection},null,2));
console.log(JSON.stringify({id:pack.id,count:pack.count,datasetHash:pack.datasetHash}));
