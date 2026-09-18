import { build } from 'esbuild';
await build({entryPoints:['electron/main.ts','electron/preload.ts','electron/worker.ts','electron/agentic-worker.ts','electron/agentic-host.ts'],outdir:'dist-electron',bundle:true,platform:'node',target:'node24',format:'cjs',outExtension:{'.js':'.cjs'},external:['electron'],sourcemap:true});
