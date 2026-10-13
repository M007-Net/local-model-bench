import {build} from 'esbuild';
import path from 'node:path';
await build({entryPoints:['electron/main.ts'],outfile:'dist-web/server.cjs',bundle:true,platform:'node',target:'node24',format:'cjs',plugins:[{name:'web-platform',setup(b){b.onResolve({filter:/^\.\/platform$/},()=>({path:path.resolve('electron/platform-web.ts')}));}}],external:['electron'],define:{'process.env.LMB_WEB_BUILD':'"1"'}});
await build({entryPoints:['electron/worker.ts','electron/agentic-worker.ts','electron/agentic-host.ts','electron/harness-worker.ts'],outdir:'dist-web',bundle:true,platform:'node',target:'node24',format:'cjs',outExtension:{'.js':'.cjs'}});
