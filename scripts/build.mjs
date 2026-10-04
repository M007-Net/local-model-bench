import { build } from 'esbuild';
await build({entryPoints:['electron/main.ts','electron/preload.ts','electron/worker.ts','electron/agentic-worker.ts','electron/agentic-host.ts'],outdir:process.env.LMB_BUILD_DIR||'dist-electron',bundle:true,platform:'node',target:'node24',format:'cjs',outExtension:{'.js':'.cjs'},external:['electron'],sourcemap:true});
