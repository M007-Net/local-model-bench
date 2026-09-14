import type {Model} from './types';

export const sortOptions = {
  name: 'Name · A–Z',
  'name-desc': 'Name · Z–A',
  vision: 'Vision models first',
  quant: 'Quantization · A–Z',
  'size-asc': 'File size · smallest first',
  'size-desc': 'File size · largest first',
  context: 'Context · largest first',
  loaded: 'Loaded models first',
} as const;
export type LibraryView = {
  search: string;
  vision: ''|'yes'|'no'|'unknown';
  mtp?: ''|'yes'|'no'|'unknown';
  quant: string;
  publisher: string;
  loaded: ''|'yes'|'no';
  sort: keyof typeof sortOptions;
};
export const defaultLibraryView:LibraryView = {search:'',vision:'',mtp:'',quant:'',publisher:'',loaded:'',sort:'name'};
export const unknownValue = '__unknown__';
export const quantName = (model:Model)=>model.quantization?.name?.trim() || unknownValue;
export const publisherName = (model:Model)=>typeof model.publisher==='string'&&model.publisher.trim()?model.publisher.trim():unknownValue;
const compareText=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
export function libraryOptions(models:Model[],value:(m:Model)=>string){
  return [...new Set(models.map(value))].sort((a,b)=>a===unknownValue?1:b===unknownValue?-1:compareText(a,b));
}
export function visibleModels(models:Model[],view:LibraryView):Model[]{
  const terms=view.search.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered=models.filter(m=>{
    const haystack=[m.display_name,m.key,quantName(m),publisherName(m),m.architecture,m.format].join(' ').toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term))
      && (!view.vision || (view.vision==='yes'?m.capabilities?.vision===true:view.vision==='no'?m.capabilities?.vision===false:m.capabilities?.vision===undefined))
      && (!view.mtp || (view.mtp==='yes'?m.nativeMtp?.supported===true:view.mtp==='no'?m.nativeMtp?.supported===false:m.nativeMtp?.supported==null))
      && (!view.quant || quantName(m)===view.quant)
      && (!view.publisher || publisherName(m)===view.publisher)
      && (!view.loaded || (view.loaded==='yes'?m.loaded_instances.length>0:m.loaded_instances.length===0));
  });
  const numeric=(a:number|undefined,b:number|undefined,descending:boolean)=>{
    const av=typeof a==='number'&&Number.isFinite(a)&&a>0?a:null,bv=typeof b==='number'&&Number.isFinite(b)&&b>0?b:null;
    return av===null?(bv===null?0:1):bv===null?-1:descending?bv-av:av-bv;
  };
  return filtered.sort((a,b)=>{
    let order=0;
    switch(view.sort){
      case 'name-desc':order=compareText(b.display_name,a.display_name);break;
      case 'vision':order=(b.capabilities?.vision===true?2:b.capabilities?.vision===false?1:0)-(a.capabilities?.vision===true?2:a.capabilities?.vision===false?1:0);break;
      case 'quant':order=quantName(a)===unknownValue?(quantName(b)===unknownValue?0:1):quantName(b)===unknownValue?-1:compareText(quantName(a),quantName(b));break;
      case 'size-asc':case 'size-desc':order=numeric(a.size_bytes,b.size_bytes,view.sort==='size-desc');break;
      case 'context':order=numeric(a.max_context_length,b.max_context_length,true);break;
      case 'loaded':order=Number(b.loaded_instances.length>0)-Number(a.loaded_instances.length>0);break;
    }
    return order||compareText(a.display_name,b.display_name)||compareText(a.key,b.key);
  });
}
export function selectVisible(selected:string[],visible:Model[]):string[]{
  const ids=new Set(visible.map(m=>m.key));
  return visible.length&&visible.every(m=>selected.includes(m.key))?selected.filter(id=>!ids.has(id)):[...new Set([...selected,...ids])];
}
export function restoreLibraryView(value:unknown):LibraryView{
  if(!value||typeof value!=='object')return {...defaultLibraryView};
  const v=value as Partial<LibraryView>;
  return {mtp:['','yes','no','unknown'].includes(v.mtp??'')?v.mtp??'':'',search:typeof v.search==='string'?v.search:'',quant:typeof v.quant==='string'?v.quant:'',publisher:typeof v.publisher==='string'?v.publisher:'',vision:['','yes','no','unknown'].includes(v.vision??'')?v.vision??'':'',loaded:['','yes','no'].includes(v.loaded??'')?v.loaded??'':'',sort:v.sort&&Object.hasOwn(sortOptions,v.sort)?v.sort:'name'};
}
