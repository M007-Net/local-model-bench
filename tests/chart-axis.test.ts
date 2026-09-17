import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chartSpecs,renderChart,xAxisLabels,xValueOf,type ChartRow} from '../src/charts';

// A sweep run at one concurrency level: the case where the old axis had nothing to spread along.
const sweep=(depth:number,gen:number):ChartRow=>({
 modelKey:'qwen3.8-27b@q4_k_s',model:'Qwen3.8 27B',test:'Short prompt throughput',testId:'perf-short',
 concurrency:1,mtpDepth:depth,generationTps:gen,estimatedPrefillTps:100,throughput:gen,
 medianMs:1000,p95Ms:1200,ttftMs:200,failureRate:0,requests:2,failures:0,objective:null,
 localJudge:null,externalJudge:null,gpuHotSpotAvg:null,gpuHotSpotMax:null,
} as unknown as ChartRow);
const rows=[0,1,2,3,4,5].map(d=>sweep(d,[6.4,6.2,5.7,5.0,4.6,4.1][d]));
const gen=chartSpecs('objective').find(s=>s.key==='generationTps')!;

test('depth is read off the row, and a run with no sweep sits at MTP off',()=>{
 assert.equal(xValueOf(rows[3],'mtpDepth'),3);
 assert.equal(xValueOf(rows[3],'concurrency'),1);
 assert.equal(xValueOf({...rows[0],mtpDepth:null} as ChartRow,'mtpDepth'),0,'no depth measured is MTP off, not a gap');
});

test('a sweep at one concurrency collapses on the old axis and spreads on the new one',()=>{
 const onConcurrency=renderChart(rows,gen,'objective','concurrency');
 const xs=[...onConcurrency.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map(m=>m[1]);
 assert.equal(xs.length,6,'all six depths are plotted either way');
 assert.equal(new Set(xs).size,1,'…but on the concurrency axis they share one x, which is the complaint');

 const onDepth=renderChart(rows,gen,'objective','mtpDepth');
 const dxs=[...onDepth.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map(m=>Number(m[1]));
 assert.equal(new Set(dxs).size,6,'on the depth axis each depth gets its own x');
 assert.deepEqual([...dxs].sort((a,b)=>a-b),dxs.slice().sort((a,b)=>a-b));
 assert.ok(Math.min(...dxs)<Math.max(...dxs),'the axis actually spans a range');
 // And a line is drawn through them, which a single-x chart cannot produce.
 assert.match(onDepth,/<polyline points="[^"]+"/);
 assert.ok(onDepth.includes(xAxisLabels.mtpDepth),`axis caption missing; expected ${xAxisLabels.mtpDepth}`);
});

test('the tooltip names the depth when depth is the axis',()=>{
 const onDepth=renderChart(rows,gen,'objective','mtpDepth');
 assert.match(onDepth,/MTP off/);
 assert.match(onDepth,/3 draft tokens/);
 assert.match(onDepth,/1 draft token •/,'singular for one');
 // Concurrency is still stated, because a depth curve is only meaningful at a known concurrency.
 assert.match(onDepth,/concurrency 1/);
});

test('the concurrency axis is untouched for an ordinary run',()=>{
 const across=[1,2,4].map((c,i)=>({...sweep(0,60-i*10),concurrency:c}));
 const svg=renderChart(across as ChartRow[],gen,'objective');
 const xs=[...svg.matchAll(/<circle[^>]*cx="([\d.]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(xs).size,3);
 assert.match(svg,/Concurrent requests/);
});
