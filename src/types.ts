export type Rule = { id: string; label: string; type: 'exact'|'contains'|'heading'|'number'|'json'|'json-equal'|'field'|'words'|'lines'|'final-number'|'ifeval'; expected?: string; path?: string; tolerance?: number; min?: number; max?: number; weight: number };
// allowCodeFence lets a test accept an answer wrapped in a single ```json fence. It defaults to
// false, because a prompt that says "no prose or code fences" — as the accounting pack's does —
// is testing instruction following as much as content, and a fence there is a real failure. Tests
// whose prompt asks only for "JSON only" set it true: scoring those 0 measures a markdown habit
// the prompt never mentioned.
export type TestCase = { allowCodeFence?:boolean; benchmark?:import('./benchmarks').BenchmarkMeta; id:string; name:string; category:string; version:number; prompt:string; answerKey:string; rubric:string; maxTokens:number; rules:Rule[]; kind:'quality'|'performance'; image?:string; imageDigest?:string };
export type Model = {nativeMtp?:{supported:boolean|null;reason:string;resource?:string;kind?:'bundled'|'sidecar';draftResource?:string;draftPath?:string};key:string; display_name:string; size_bytes:number; quantization:{name:string}|null; max_context_length:number; type:string; loaded_instances:{id:string; config:{context_length:number;parallel?:number;[key:string]:unknown}}[]; capabilities?:{vision?:boolean;reasoning?:{allowed_options:string[];default:string}}; [key:string]:unknown};
export type Settings = {baseUrl:string; token:string; lmsPath:string; timeoutSec:number; loadTimeoutSec:number; judgePrompt:string; updateRepo:string; updateCheck:boolean};
// What the window is allowed to see. The token itself never crosses the IPC
// boundary, so the renderer learns only whether one is stored.
export type PublicSettings = Omit<Settings,'token'> & {tokenConfigured:boolean};
// A save can leave the stored token alone (omit `token`), replace it, or clear
// it by sending an empty string.
export type SettingsUpdate = PublicSettings & {token?:string};
// runtime is LM Studio's engine reference (`llama.cpp-win-x86_64-amd-rocm-avx2@2.40.0`), left
// undefined to mean "whatever LM Studio already has selected", which is what every run made
// before this field existed did. cacheK/cacheV quantize the KV cache, the part of a run's memory
// that grows with concurrency rather than with the weights. flashAttention defaults to on, which
// is worth about five times the prompt processing; runs saved before the field existed leave it
// undefined and were measured under whatever LM Studio had set, so they are not evidence of it.
export type RunConfig = {benchmark?:import('./benchmarks').BenchmarkSelection;vision?:import('../electron/vision').VisionMode;mtp?:'off'|'on';mtpDraftTokens?:number;mtpSweep?:number[];mtpPreflight?:boolean;runtime?:string;cacheK?:import('./cache-quant').CacheQuant;cacheV?:import('./cache-quant').CacheQuant;flashAttention?:'on'|'off';name:string; modelKeys:string[]; testIds:string[]; mode:'combined'|'performance'|'quality'; preset:string; concurrency:number[]; waves:number; maxTokens:number; contextLength:number; temperature:number; gpu:string; reasoning:string; judgeModel:string; performanceLengths:string[]; timeoutSec:number; retryOf?:string};
// unscorable marks a check the grader could not evaluate at all, as opposed to one the
// response failed. It is left off both sides of the score rather than counted as a miss.
export type Check = {id:string;label:string;passed:boolean;weight:number;detail:string;unscorable?:boolean};
export type Objective = {score:number|null;checks:Check[]};
export type Grade = {source:'local'|'external';score:number;criteria:{name:string;score:number;reason:string}[];summary:string;judge:string;rubricVersion:number;created:string;raw:string};
export type GpuStat = {min:number;avg:number;max:number};
export type GpuTick = {t:number;tempCore:number|null;tempHotSpot:number|null;tempMemory:number|null;power:number|null;load:number|null;clockCore:number|null;fanRpm:number|null;memoryUsed:number|null};
export type GpuStats = {samples:number;exact:boolean;tempCore:GpuStat|null;tempHotSpot:GpuStat|null;tempMemory:GpuStat|null;power:GpuStat|null;load:GpuStat|null;clockCore:GpuStat|null;fanRpm:GpuStat|null;memoryUsedMax:number|null};
export type RunGpu = {available:boolean;device:string|null;devices:string[];intervalMs:number;note:string;stats:GpuStats|null;perDevice:Record<string,GpuStats|null>;series:GpuTick[];seriesNote:string};
export type Metrics = {inputTokens:number|null;outputTokens:number|null;reasoningTokens:number|null;generationTps:number|null;prefillTps:number|null;prefillMs:number|null;ttftMs:number|null;durationMs:number;firstContentMs:number|null;prefillMethod:string;cacheNote:string};
export type Sample = {mtpTokens?:number;id:string;runId:string;modelKey:string;modelName:string;testId:string;testName:string;concurrency:number;waveId:string;wave:number;slot:number;warmup:boolean;prompt:string;output:string;reasoning:string;status:'completed'|'failed'|'cancelled'|'timeout';error?:string;metrics:Metrics;objective:Objective;grades:Grade[];rawStats:Record<string,unknown>;created:string;retryOf?:string;possibleTruncation:boolean;gpu?:GpuStats|null};
export type Wave = {mtpTokens?:number;id:string;runId:string;modelKey:string;testId:string;concurrency:number;durationMs:number;outputTokens:number|null;throughput:number|null;completed:number;failed:number;gpu?:GpuStats|null;draft?:import('../electron/engine-log').DraftAcceptance|null};
export type Run = {id:string;created:string;updated:string;status:'running'|'grading'|'completed'|'cancelled'|'failed'|'interrupted';config:RunConfig;tests:TestCase[];modelInfo:Record<string,unknown>;environment:Record<string,unknown>;logs:string[];samples:Sample[];waves:Wave[];error?:string;gpu?:RunGpu};
export type RunSummary = Omit<Run,'samples'|'waves'> & {sampleCount:number};
export type Progress = {runId:string;phase:string;message:string;completed:number;total:number;active:number;model?:string};
export type Snapshot = {settings:PublicSettings;tests:TestCase[];runs:RunSummary[];progress:Progress|null;dataPath:string;packs:import('./benchmarks').PackSummary[]};
export type BenchAPI = {modelProfiles():Promise<Record<string,import('./model-profile').ModelProfile>>;saveModelProfile(key:string,profile:import('./model-profile').ModelProfile):Promise<void>;snapshot():Promise<Snapshot>;models():Promise<Model[]>;runtimes():Promise<import('../electron/runtime').Runtime[]>;startServer():Promise<string>;saveSettings(s:SettingsUpdate):Promise<void>;saveTest(t:TestCase):Promise<TestCase>;deleteTest(id:string):Promise<void>;choosePackFile():Promise<import('./benchmark-import').PackPreview|null>;importPack(draft:import('./benchmark-import').PackDraft):Promise<import('./benchmarks').PackSummary>;deletePack(id:string):Promise<void>;startRun(c:RunConfig):Promise<string>;cancel():Promise<void>;getRun(id:string):Promise<Run>;retry(id:string):Promise<string>;grade(id:string,judge:string):Promise<void>;copyPackage(runId:string,sampleId:string):Promise<{copied:boolean;text:string}>;importGrade(runId:string,sampleId:string,raw:string,judge:string):Promise<void>;exportRun(id:string,format:string):Promise<string|null>;onProgress(fn:(p:Progress|null)=>void):()=>void;history():Promise<import('./history').HistoryRow[]>;updateState():Promise<import('../electron/update').UpdateState>;checkUpdate():Promise<import('../electron/update').UpdateState>;downloadUpdate():Promise<import('../electron/update').UpdateState>;installUpdate():Promise<string>;onUpdate(fn:(s:import('../electron/update').UpdateState)=>void):()=>void;textOnlyPlan(key:string):Promise<import('../electron/text-only').TwinPlan>;makeTextOnly(key:string):Promise<string>;textOnlyTwins():Promise<import('../electron/text-only').Twin[]>;removeTextOnly(folder:string):Promise<void>;openData():Promise<void>};
declare global { interface Window { bench:BenchAPI } }
