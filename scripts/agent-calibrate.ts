// Prints what one agent turn's host stages cost on this machine, so the host work scale on the
// Agents page can be chosen deliberately instead of guessed. Run: npx tsx scripts/agent-calibrate.ts [scale]
//
// It measures the way a sweep does: whole turns, one after another, each with its own turn index.
// Measuring a stage 48 times in a row instead would keep its corpus in cache and report a turn
// roughly a fifth cheaper than it really is.
import {runStage} from '../electron/agentic-host';
import {hostStages} from '../src/agentic';
const scale=Math.max(1,Number(process.argv[2]??1)|0),turns=48;
const totals=Object.fromEntries(hostStages.map(s=>[s,0])) as Record<string,number>;
for(let i=0;i<4;i++)for(const stage of hostStages)runStage(stage,900+i,scale);
const each:number[]=[];
for(let turn=0;turn<turns;turn++){
 let ms=0;
 for(const stage of hostStages){const started=performance.now();runStage(stage,turn,scale);const took=performance.now()-started;totals[stage]+=took;ms+=took;}
 each.push(ms);
}
each.sort((a,b)=>a-b);
const median=each[Math.floor(turns/2)],total=each.reduce((a,b)=>a+b,0)/turns;
console.log(`Host stage cost at scale ${scale}, ${turns} whole turns:\n`);
for(const stage of hostStages)console.log(`  ${stage.padEnd(9)} ${(totals[stage]/turns).toFixed(2).padStart(8)} ms  ${(totals[stage]/turns/total*100).toFixed(0).padStart(3)}% of turn`);
console.log(`\n  ${'one turn'.padEnd(9)} ${total.toFixed(2).padStart(8)} ms mean, ${median.toFixed(2)} ms median, of single-core CPU work before any model call.`);
console.log(`  ${'range'.padEnd(9)} ${each[0].toFixed(2).padStart(8)}–${each[turns-1].toFixed(2)} ms across the ${turns} turns.`);
console.log(`\n  A 48-turn sweep at one worker would take about ${(total*48/1000).toFixed(1)} s of wall clock here.`);
