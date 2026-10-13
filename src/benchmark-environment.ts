type Reported<T>={value:T|null;source:string};
type ModelInput=Record<string,unknown>|null|undefined;
type RuntimeInput={label?:string|null;ref?:string|null;version?:string|null}|null;

const record=(value:unknown):Record<string,unknown>|null=>
 value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const reported=<T>(value:T|null|undefined,source:string):Reported<T>=>({value:value??null,source:value===null||value===undefined?'not exposed by endpoint':source});
const stringField=(value:unknown):string|null=>typeof value==='string'&&value.trim()?value.trim():null;
const numberField=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;

export type ClientEnvironmentInput={
 platform?:string;release?:string;architecture?:string;cpu?:string|null;logicalCpus?:number|null;
 availableParallelism?:number|null;totalMemoryBytes?:number|null;node?:string;electron?:string;appVersion?:string;
};
export type BenchmarkEnvironmentInput={
 client:ClientEnvironmentInput;provider?:string;endpoint?:string;models?:{id?:string;model:ModelInput}[];
 effectiveConfigurations?:Record<string,Record<string,unknown>|null|undefined>;effectiveRuntime?:RuntimeInput;
};

const modelIdentity=(model:ModelInput)=>{
 const m=record(model),quant=record(m?.quantization),source='model discovery API';
 return {
  key:reported(stringField(m?.key),source),name:reported(stringField(m?.display_name),source),
  format:reported(stringField(m?.format),source),sizeBytes:reported(numberField(m?.size_bytes),source),
  quantization:reported(stringField(quant?.name),source),
  architecture:reported(stringField(m?.architecture??m?.arch),source),
  hash:reported(stringField(m?.sha256??m?.hash??m?.digest),source),
 };
};

/** Keep machine facts attached to the process that actually measured client-observed work. */
export function createBenchmarkEnvironment(input:BenchmarkEnvironmentInput){
 const c=input.client;
 const identities:Record<string,ReturnType<typeof modelIdentity>>={};
 const configs:Record<string,Reported<Record<string,unknown>>>={};
 for(const item of input.models??[]){
  const m=record(item.model),modelKey=stringField(m?.key),id=stringField(item.id)||modelKey;
  if(!id)continue;
  identities[id]=modelIdentity(m);
  const config=input.effectiveConfigurations?.[id];
  configs[id]=reported(config&&Object.keys(config).length?config:null,'loaded instance configuration returned by endpoint');
 }
 const runtime=input.effectiveRuntime;
 return {
  client:{
   platform:reported(c.platform??null,'local operating system'),release:reported(c.release??null,'local operating system'),
   architecture:reported(c.architecture??null,'local process'),cpu:reported(c.cpu??null,'local operating system'),
   logicalCpus:reported(c.logicalCpus??null,'local operating system'),availableParallelism:reported(c.availableParallelism??null,'local process'),
   totalMemoryBytes:reported(c.totalMemoryBytes??null,'local operating system'),
   runtime:{node:reported(c.node??null,'local process'),electron:reported(c.electron??null,'local process'),application:reported(c.appVersion??null,'local application')},
  },
  inferenceServer:{
   provider:reported(stringField(input.provider),'application endpoint settings'),
   endpoint:reported(stringField(input.endpoint),'application endpoint settings'),
   hostOperatingSystem:reported<string>(null,'not exposed by endpoint'),
   hostArchitecture:reported<string>(null,'not exposed by endpoint'),
   hostCpu:reported<string>(null,'not exposed by endpoint'),
   hostMemoryBytes:reported<number>(null,'not exposed by endpoint'),
   version:reported<string>(null,'not exposed by endpoint'),
   build:reported<string>(null,'not exposed by endpoint'),
   runtime:{
    label:reported(stringField(runtime?.label),'verified runtime listing or loaded instance'),
    ref:reported(stringField(runtime?.ref),'verified runtime listing or loaded instance'),
    version:reported(stringField(runtime?.version),'verified runtime listing or loaded instance'),
   },
   modelIdentityByKey:identities,
   effectiveConfigurationByModel:configs,
  },
 };
}
