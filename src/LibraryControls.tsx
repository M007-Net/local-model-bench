import type {Model} from './types';
import {defaultLibraryView,sortOptions,libraryOptions,quantName,publisherName,unknownValue,type LibraryView} from './library';

export function LibraryControls({models,view,onChange}:{models:Model[];view:LibraryView;onChange:(view:LibraryView)=>void}){
  const update=(key:keyof LibraryView,value:string)=>onChange({...view,[key]:value});
  const options=(field:'quant'|'publisher')=>{
    const values=libraryOptions(models,field==='quant'?quantName:publisherName);
    if(view[field]&&!values.includes(view[field]))values.push(view[field]);
    return values.map(v=><option key={v} value={v}>{v===unknownValue?'Unknown':v}</option>);
  };
  return <div className="panel library-controls">
    <div className="library-primary">
      <label className="field"><span>Search models</span><input type="search" placeholder="Name, quantization, publisher…" value={view.search} onChange={e=>update('search',e.target.value)}/></label>
      <label className="field"><span>Sort by</span><select aria-label="Sort by" value={view.sort} onChange={e=>update('sort',e.target.value)}>{Object.entries(sortOptions).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
    </div>
    <div className="library-filters">
      <label className="field"><span>Vision support</span><select aria-label="Vision support" value={view.vision} onChange={e=>update('vision',e.target.value)}><option value="">All models</option><option value="yes">Vision capable</option><option value="no">Text only</option><option value="unknown">Unknown support</option></select></label>
      <label className="field"><span>Native MTP</span><select aria-label="Native MTP support" value={view.mtp??''} onChange={e=>update('mtp',e.target.value)}><option value="">All models</option><option value="yes">Native MTP available</option><option value="no">No native MTP</option><option value="unknown">Support unknown</option></select></label>
      <label className="field"><span>Quantization</span><select aria-label="Quantization" value={view.quant} onChange={e=>update('quant',e.target.value)}><option value="">All quantizations</option>{options('quant')}</select></label>
      <label className="field"><span>Publisher</span><select aria-label="Publisher" value={view.publisher} onChange={e=>update('publisher',e.target.value)}><option value="">All publishers</option>{options('publisher')}</select></label>
      <label className="field"><span>Load status</span><select aria-label="Load status" value={view.loaded} onChange={e=>update('loaded',e.target.value)}><option value="">All models</option><option value="yes">Loaded</option><option value="no">Not loaded</option></select></label>
      <button onClick={()=>onChange({...defaultLibraryView})}>Reset view</button>
    </div>
  </div>;
}
