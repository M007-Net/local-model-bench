import {summaries} from './export';
import {profilesFor,type ModelProfile} from '../src/model-profile';
import {familyOf,promptSizeOf,quantTier,sizeBucket,sizeLabel,type HistoryRow} from '../src/history';
import type {Model,Run,Sample} from '../src/types';
import {backendOf} from './runtime';
import {calibrationFor} from '../src/prefill';
// summaries() already groups a run into (model, test, concurrency) measurements and computes every rate,
// failure count and GPU statistic. This adds only what pooling across runs needs: which run a measurement
// came from, what the model was, and the counts and durations behind each average.
// The MTP depth is part of the key for the same reason it is part of a summary row: one run can
// hold several depths, and pooling them would average a setting against itself.
const groupKey=(s:Pick<Sample,'modelKey'|'testId'|'concurrency'>,depth:number|null)=>JSON.stringify([s.modelKey,s.testId,s.concurrency,depth]);
export function historyRows(runs:Run[],saved:Record<string,ModelProfile>):HistoryRow[]{
 return runs.flatMap(run=>{
  const profiles=profilesFor(run,[],saved);
  // One run is one engine, so this is resolved once per run rather than per measurement.
  const backend=backendOf(run);
  const measured=new Map<string,Sample[]>();
  for(const s of run.samples){if(s.warmup)continue;const key=groupKey(s,s.mtpTokens??null);const list=measured.get(key)??[];list.push(s);measured.set(key,list);}
  return summaries(run).map(r=>{
   const samples=measured.get(groupKey(r,r.mtpDepth))??[],ok=samples.filter(s=>s.status==='completed');
   const model=(run.modelInfo[r.modelKey] as {model?:Model}|undefined)?.model;
   const profile=profiles[r.modelKey]??{totalB:null,activeB:null,kind:'unknown' as const,source:'No saved model metadata'};
   const test=run.tests.find(t=>t.id===r.testId);
   const graded=(source:'local'|'external')=>ok.filter(s=>s.grades.some(g=>g.source===source)).length;
   return {...r,
    runId:run.id,runName:run.config.name,runCreated:run.created,runStatus:run.status,
    family:familyOf(model?.architecture as string|undefined,r.modelKey),kind:profile.kind,
    sizeLabel:sizeLabel(profile.totalB),sizeBucket:sizeBucket(profile.totalB),totalB:profile.totalB,activeB:profile.activeB,
    quantization:model?.quantization?.name??'',quantTier:quantTier(model?.quantization?.name),
    publisher:typeof model?.publisher==='string'?model.publisher:'',architecture:String(model?.architecture??''),
    promptSize:promptSizeOf(r.testId),testKind:test?.kind??'quality',benchmarkPack:test?.benchmark?.packId??null,
    backend:backend.label,backendRef:backend.ref,
    prefillCalibratedTps:calibrationFor(run,r.modelKey,r.mtpDepth)?.marginalTps??null,
    prefillOverheadMs:calibrationFor(run,r.modelKey,r.mtpDepth)?.overheadMs??null,
    reasoning:run.config.reasoning,temperature:run.config.temperature,contextLength:run.config.contextLength,
    maxTokens:run.config.maxTokens,waves:run.config.waves,
    completed:ok.length,durationsMs:ok.map(s=>s.metrics.durationMs).filter(n=>Number.isFinite(n)),
    objectiveCount:ok.filter(s=>s.objective.score!==null).length,
    localJudgeCount:graded('local'),externalJudgeCount:graded('external')};
  });
 });
}
