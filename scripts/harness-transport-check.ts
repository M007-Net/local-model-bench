// Real upstream runtimes and Docker transport; cancels at their first model
// request without forwarding it. This is not a model-quality benchmark.
import assert from 'node:assert/strict';
import {harnessDiagnostics,runSandbox} from '../electron/harness-sandbox';
import {defaultHarnessConfig} from '../src/harness';
import {harnessTasks} from '../electron/harness-tasks';
const d=await harnessDiagnostics();assert.equal(d.ready,true,d.message);
for(const harness of ['mini-swe-agent','opencode'] as const){
 const controller=new AbortController();let requested=false;
 const config={...defaultHarnessConfig,contextLength:16384,timeoutSec:30};
 await assert.rejects(runSandbox({image:d.imageId!,config,runId:'transport-check',signal:controller.signal,payload:{config,harness,model:'fixture',task:{files:harnessTasks[0].files,description:harnessTasks[0].description}},onEvent:async e=>{if(e.kind==='error')throw Error(e.message);if(e.kind==='request'){assert.equal(e.body.model,'fixture');requested=true;controller.abort();}}}),/Cancelled/);
 assert.equal(requested,true);console.log(harness+': real runtime reached isolated model relay; cancelled and cleaned up (no model inference).');
}
