import type {Model, Run} from './types';
export type ModelProfile={totalB:number|null;activeB:number|null;kind:'dense'|'moe'|'unknown';source:string};
const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
// "moe", "mixtral", and 8x7b-style names all mark a mixture-of-experts model.
const moeHint=/\bmoe\b|mixtral|(?:^|[\s_-])\d+x\d+(?:\.\d+)?b\b/i;
export function inferProfile(model:Partial<Model>):ModelProfile{
 const name=String(model.key??'')+' '+String(model.display_name??'');
 const params=String(model.params_string??'');
 const architecture=String(model.architecture??'').trim();
 const active=(name+' '+params).match(/(?:^|[\s_-])a(\d+(?:\.\d+)?)b\b/i);
 const total=params.match(/^(\d+(?:\.\d+)?)\s*([bm])\b/i)??name.match(/(?:^|[\s_-])(\d+(?:\.\d+)?)\s*(b)\b/i);
 const totalB=total?Number(total[1])/(total[2].toLowerCase()==='m'?1000:1):null;
 const activeB=active?Number(active[1]):null;
 const moe=activeB!==null||/moe|mixtral/i.test(architecture)||moeHint.test(name)||moeHint.test(params);
 // An architecture reported by LM Studio (qwen35 versus qwen35moe) is positive evidence of a
 // dense model; a bare model name is not, so models without one stay unknown.
 const kind=moe?'moe':architecture?'dense':'unknown';
 return {totalB:positive(totalB),activeB:positive(activeB),kind,source:params?'LM Studio parameter label; architecture/name hints':'Model name/architecture hints'};
}
export function validateProfile(p:ModelProfile):ModelProfile{
 if(!p||!['dense','moe','unknown'].includes(p.kind))throw Error('Choose Dense, MoE, or Unknown.');
 for(const v of [p.totalB,p.activeB])if(v!==null&&positive(v)===null)throw Error('Parameter counts must be positive numbers or blank.');
 if(p.totalB!==null&&p.activeB!==null&&p.activeB>p.totalB)throw Error('Active parameters cannot exceed total parameters.');
 return {totalB:p.totalB,activeB:p.kind==='moe'?p.activeB:null,kind:p.kind,source:'User supplied'};
}
export function profilesFor(run:Run,models:Model[],saved:Record<string,ModelProfile>){
 return Object.fromEntries([...new Set([...run.config.modelKeys,...run.samples.map(s=>s.modelKey)])].map(key=>{
  const info=run.modelInfo[key] as {model?:Model}|undefined;
  return [key,saved[key]??inferProfile(info?.model??models.find(m=>m.key===key)??{key})];
 }));
}
export type ComparisonFilter={kind:'all'|'dense'|'moe'|'unknown';basis:'totalB'|'activeB';min:string;max:string;search:string;excluded:string[]};
export const defaultComparisonFilter:ComparisonFilter={kind:'all',basis:'totalB',min:'',max:'',search:'',excluded:[]};
export function matchesProfile(key:string,p:ModelProfile,f:ComparisonFilter){
 if(f.kind!=='all'&&p.kind!==f.kind)return false;
 if(!key.toLowerCase().includes(f.search.toLowerCase()))return false;
 const n=p[f.kind==='moe'?f.basis:'totalB'];
 if(f.min!==''&&(!Number.isFinite(+f.min)||n===null||n<+f.min))return false;
 if(f.max!==''&&(!Number.isFinite(+f.max)||n===null||n>+f.max))return false;
 return true;
}
