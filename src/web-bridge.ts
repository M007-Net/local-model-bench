import type {BenchAPI} from './types';
// Imported before UI modules capture window.bench. Electron supplies its own bridge.
if(!window.bench){
 let events:EventSource|undefined;
 const subscribe=(name:string,fn:(value:any)=>void)=>{events??=new EventSource('/api/events');const listener=(e:MessageEvent)=>fn(JSON.parse(e.data));events.addEventListener(name,listener as EventListener);return()=>events?.removeEventListener(name,listener as EventListener);};
 const chooseFile=()=>new Promise<{name:string;text:string}|undefined>((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='.json,.jsonl,.csv,.tsv,.txt';input.oncancel=()=>resolve(undefined);input.onchange=async()=>{try{const file=input.files?.[0];if(!file)return resolve(undefined);if(file.size>24*1024*1024)throw Error('Browser uploads must be smaller than 24 MB.');resolve({name:file.name,text:await file.text()});}catch(e){reject(e);}};input.click();});
 window.bench=new Proxy({} as BenchAPI,{get:(_target,property)=>{
  const name=String(property);
  if(name==='onProgress')return(fn:(value:any)=>void)=>subscribe('progress',fn);
  if(name==='onAgenticProgress')return(fn:(value:any)=>void)=>subscribe('agenticProgress',fn);
  if(name==='onHarnessProgress')return(fn:(value:any)=>void)=>subscribe('harnessProgress',fn);
  if(name==='onUpdate')return(fn:(value:any)=>void)=>subscribe('update',fn);
  return async(...args:unknown[])=>{
   const upload=['choosePackFile','importAgenticRun'].includes(name)?await chooseFile():undefined;
   if(['choosePackFile','importAgenticRun'].includes(name)&&!upload)return null;
   const response=await fetch('/api/call/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-LMB-Request':'1'},body:JSON.stringify({args,upload})});
   if(response.status===401){location.assign('/login');throw Error('Sign in to the web panel.');}
   const body=await response.json();if(!response.ok||body.error)throw Error(body.error||'Server request failed.');
   if(body.download){const url=URL.createObjectURL(new Blob([body.download.text],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download=body.download.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   if(name==='copyPackage'){try{await navigator.clipboard.writeText(body.result.text);body.result.copied=true;}catch{}}
   return body.result;
  };
 }});
}
