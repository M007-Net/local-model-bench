import type {Model} from './types';

// Model identifiers and architecture names are opaque. Capability controls come
// from the server, never a list of recognized model families.
export function reasoningOptions(models:Model[],keys:string[]):string[]{
 if(!keys.length)return [];
 const selected=keys.map(key=>models.find(m=>m.key===key));
 const first=selected[0]?.capabilities?.reasoning?.allowed_options??[];
 return [...new Set(first)].filter(option=>option!=='default'&&selected.every(m=>m?.capabilities?.reasoning?.allowed_options?.includes(option)));
}

export function normalizeModels(input:unknown):Model[]{
 if(!Array.isArray(input))throw Error('LM Studio v1 model API is unavailable. Use a server with /api/v1/models support.');
 const seen=new Set<string>();
 return input.filter(m=>m&&m.type==='llm').map(m=>{
  if(typeof m.key!=='string'||!m.key.trim()||seen.has(m.key))throw Error('LM Studio returned missing or duplicate model identifiers. Refresh the server library.');
  seen.add(m.key);
  const caps=m.capabilities&&typeof m.capabilities==='object'?m.capabilities:{};
  const reasoning=caps.reasoning&&typeof caps.reasoning==='object'?caps.reasoning:undefined;
  return {...m,key:m.key,display_name:typeof m.display_name==='string'&&m.display_name.trim()?m.display_name:m.key,
   size_bytes:typeof m.size_bytes==='number'&&Number.isFinite(m.size_bytes)&&m.size_bytes>0?m.size_bytes:0,
   max_context_length:Number.isInteger(m.max_context_length)&&m.max_context_length>0?m.max_context_length:0,
   quantization:typeof m.quantization?.name==='string'?m.quantization:null,
   loaded_instances:Array.isArray(m.loaded_instances)?m.loaded_instances.filter((i:any)=>typeof i?.id==='string').map((i:any)=>({...i,config:i.config&&typeof i.config==='object'?i.config:{}})):[],
   capabilities:{...caps,vision:typeof caps.vision==='boolean'?caps.vision:undefined,reasoning:reasoning?{...reasoning,allowed_options:Array.isArray(reasoning.allowed_options)?reasoning.allowed_options.filter((v:unknown)=>typeof v==='string'&&v.length>0):[],default:typeof reasoning.default==='string'?reasoning.default:'default'}:undefined}
  } as Model;
 });
}
