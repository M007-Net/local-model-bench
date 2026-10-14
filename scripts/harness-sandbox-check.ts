// Validates real isolation and objective task verification using a PREINSTALLED
// Python-capable image. Does not install dependencies or invoke an agent/model.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dockerCommand,sandboxArgs,removeSandbox} from '../electron/harness-sandbox';
import {defaultHarnessConfig} from '../src/harness';
import {harnessTasks} from '../electron/harness-tasks';
import {harderRepairs} from '../tests/fixtures/harness-reference';
const image=process.env.LMB_SANDBOX_TEST_IMAGE;if(!image)throw Error('Specify a preinstalled Python-capable image with LMB_SANDBOX_TEST_IMAGE; this script never pulls images.');
const c={...defaultHarnessConfig,timeoutSec:30};
async function python(source:string,input=''){
 const name='lmb-harness-qa-'+randomUUID();const args=sandboxArgs(name,image!,c,'sandbox-qa');args.splice(args.indexOf('python'),3,'python3','-u','-c',source);
 try{return await dockerCommand(args,input,undefined,30000);}finally{await removeSandbox(name);}
}
const isolation=await python('import os,json,socket; print(json.dumps({"uid":os.getuid(),"caps":[s.strip() for s in open("/proc/self/status") if s.startswith("CapEff")],"routes":open("/proc/net/route").read()}))');assert.equal(isolation.code,0,isolation.stderr);const state=JSON.parse(isolation.stdout);assert.equal(state.uid,10001);assert.ok(state.caps[0].endsWith('0000000000000000'));assert.equal(state.routes.trim().split('\n').length,1);
const repairs=[
 'def solve(values):\n    return sum(values)/len(values) if values else 0\n',
 'def solve(values):\n    return list(dict.fromkeys(values))\n',
 harnessTasks[2].files['solution.py'],
 'def solve(attempt):\n    return 2 ** max(0,min(attempt,5))\n',
 'def solve(rows):\n    return [x for row in rows for x in row]\n',
 'def solve(text):\n    return "-".join(text.lower().split())\n',
 harnessTasks[6].files['solution.py'],
 'def solve(prefix):\n    return 2**(32-prefix) if prefix>=31 else 2**(32-prefix)-2\n'
];
const verifier=readFileSync('harness/verifier.py','utf8');
const selected=process.argv.includes('--task')?harnessTasks.filter(t=>t.id===process.argv[process.argv.indexOf('--task')+1]):harnessTasks;assert.ok(selected.length);
for(const task of selected){const i=harnessTasks.indexOf(task);
 const original=await python(verifier,JSON.stringify({files:task.files,entry:task.entry,cases:task.cases})+'\n');assert.equal(original.code,1,task.id+' original must fail: '+original.stderr);
 const files={...task.files,...(i<8?{'solution.py':repairs[i]}:harderRepairs[task.id])};if(task.id==='port-config')files['service.json']=JSON.stringify({host:'127.0.0.1',port:8080,debug:false});if(task.id==='inventory')files['inventory.py']='def total(items):\n    return sum(i["price"]*i.get("quantity",1) for i in items)\n';
 const fixed=await python(verifier,JSON.stringify({files,entry:task.entry,cases:task.cases})+'\n');assert.equal(fixed.code,0,task.id+' reference repair must pass: '+fixed.stdout+fixed.stderr);
}
console.log(`Real Docker isolation passed; all ${selected.length} broken tasks failed and all ${selected.length} reference repairs passed. No agent or model inference performed.`);
