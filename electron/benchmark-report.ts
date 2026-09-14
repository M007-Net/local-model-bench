import type {Run} from '../src/types';
import {benchmarkRows,describeMeta,scoreBands} from '../src/benchmarks';
export function benchmarkReport(run:Run){
 const test=run.tests.find(t=>t.benchmark);const meta=test?.benchmark;if(!meta)return '';
 // An imported pack names its tests "<pack> · <item id>", so the part before the first
 // separator is the pack's own name - the only copy of it a saved run still holds.
 const d=describeMeta(meta,test?.name.split(' · ')[0]);
 return `${d.name} — benchmark meaning\n\n${d.meaning}\n\n${d.limit}\n\n${d.protocol} These are local adapted scores, not official leaderboard scores.\n\nScore = passed / attempted responses × 100. Failures count as misses. Warm-ups excluded. An incomplete run is provisional. Repeated attempts are not distinct questions.\n\n`+benchmarkRows(run).map(r=>`${r.key} | concurrency ${r.concurrency} | ${r.score?.toFixed(1)??'No score'} / 100 | ${r.passed}/${r.attempted} passed | ${r.expected} planned | ${r.uniqueQuestions} distinct questions | ${r.failed} failures | ${r.truncated} output limits | ${r.provisional?'PROVISIONAL':'complete'}`).join('\n')+'\n\nPlain-English guide (not official ability cutoffs):\n'+scoreBands.map(b=>`${b.label}: ${b.title}. ${b.text}`).join('\n')+`\n\nSmall samples and small differences require caution.\nDataset SHA-256: ${meta.datasetHash}\nProtocol: ${meta.protocol}\n\nRun settings:\n${JSON.stringify(run.config,null,2)}\n`;
}
