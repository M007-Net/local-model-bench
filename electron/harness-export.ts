import {aggregateHarness,type HarnessRun} from '../src/harness';
import {cell} from './export';
export function harnessText(run:HarnessRun,format:string){
 if(format==='json')return JSON.stringify({...run,aggregates:aggregateHarness(run.trials)},null,2);
 const rows=run.trials.map(t=>({protocol:run.protocol,run:run.id,model:t.modelKey,harness:t.harness,task:t.taskId,version:t.taskVersion,trial:t.trial,status:t.status,failure:t.failure,...t.metrics}));
 if(format==='csv'){const headers=rows.length?Object.keys(rows[0]):['protocol','model','harness','task','trial','status'];return '\uFEFF'+[headers.map(cell).join(','),...rows.map(row=>headers.map(h=>cell((row as Record<string,unknown>)[h]??'Unavailable')).join(','))].join('\r\n');}
 if(format!=='md')throw Error('Unsupported harness export');
 return `# Harness evaluation\n\nProtocol: ${run.protocol}. Status: ${run.status}.\n\nSuccess is automated verification. These authored tasks are not official SWE-bench. Single runs are observations, not conclusive rankings. Repeated trials on shared tasks are correlated; displayed Wilson intervals are descriptive.\n\n| Model | Harness | Successes / attempts | Mean successful ms | Tool calls per success | Total measured tokens |\n| --- | --- | --- | --- | --- | --- |\n`+aggregateHarness(run.trials).map(g=>`| ${g.model.replace(/[|\r\n]/g,' ')} | ${g.harness} | ${g.successes} / ${g.attempts} | ${g.successfulMs??'Unavailable'} | ${g.toolsPerSuccess??'Unavailable'} | ${g.totalTokens??'Unavailable'} |`).join('\n')+`\n\n## Reproduction data\n\n\`\`\`json\n${JSON.stringify({config:run.config,environment:run.environment,tasks:run.tasks},null,2)}\n\`\`\`\n\nDetailed traces and individual trials are preserved in JSON exports.\n`;
}
