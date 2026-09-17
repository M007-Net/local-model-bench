import type {Model} from './types';
import type {Twin} from '../electron/text-only';

// Making "Off / text-only" mean what it says.
//
// The vision toggle only ever controlled whether an image was *sent*. It could not stop the
// projector loading, because LM Studio attaches one from the model's index entry and from nowhere
// else — no command-line flag, no load-config key, no field of the load endpoint. Checked again
// against LM Studio 2.40.0: none of the 24 `llm.load.*` keys in its bundle mentions vision, and its
// llama-server carries no --mmproj flag at all, because it drives the engine through its own
// bindings rather than a command line.
//
// What can be done is give LM Studio a second folder holding the same weights and no projector —
// which this app already builds, as a tree of hard links costing no disk. That produces a separate
// model key that genuinely loads without vision weights. This module is the bridge: it works out,
// for the models a run has selected, which ones still carry a projector and what to select instead.

export type TextOnlyPlan={
 // Selected models that would still load a projector, and so are not text-only whatever the toggle says.
 projectored:Model[];
 // Those of them that already have a twin LM Studio has indexed, with the key to select instead.
 swappable:{from:string;to:string;name:string}[];
 // Those with no usable twin yet; a twin has to be made before they can be swapped.
 needTwin:Model[];
 // The selection with every available swap applied, ready to hand back to the config.
 nextKeys:string[];
};

const isProjectored=(m:Model|undefined):m is Model=>!!m&&m.capabilities?.vision===true;

export function planTextOnlySwap(selected:string[],models:Model[],twins:Twin[]):TextOnlyPlan{
 const byKey=new Map(models.map(m=>[m.key,m]));
 // A twin is only useful once LM Studio has indexed it and given it a key of its own.
 const twinFor=new Map(twins.filter(t=>t.key&&t.sourceKey).map(t=>[t.sourceKey,t.key!]));
 const projectored:Model[]=[],swappable:TextOnlyPlan['swappable']=[],needTwin:Model[]=[];
 const nextKeys=selected.map(key=>{
  const model=byKey.get(key);
  if(!isProjectored(model))return key;
  projectored.push(model);
  const to=twinFor.get(key);
  // A twin whose key is not in the model list is one LM Studio has forgotten about; treat it as
  // missing rather than selecting a key that would fail to load.
  if(to&&byKey.has(to)){swappable.push({from:key,to,name:model.display_name});return to;}
  needTwin.push(model);
  return key;
 });
 return {projectored,swappable,needTwin,nextKeys};
}

// Whether the toggle is making a promise it cannot keep as things stand.
export const textOnlyIncomplete=(plan:TextOnlyPlan):boolean=>plan.needTwin.length>0;

export function textOnlySummary(plan:TextOnlyPlan):string{
 if(!plan.projectored.length)return 'None of the selected models has a vision projector, so every load is already text-only.';
 const parts:string[]=[];
 if(plan.swappable.length)parts.push(`${plan.swappable.length} can be swapped to a text-only copy now`);
 if(plan.needTwin.length)parts.push(`${plan.needTwin.length} need a text-only copy making first`);
 return `${plan.projectored.length} selected model${plan.projectored.length===1?'':'s'} would still load a projector: ${parts.join(', ')}.`;
}
