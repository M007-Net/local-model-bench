import type {Model} from '../src/types';

// What LM Studio actually offers, verified on 2026-09-13 against the installed lms CLI
// (commit 07b7252) and the local v1 server, not assumed:
//  * `lms load --help` exposes no vision/mmproj/projector flag of any kind.
//  * POST /api/v1/models/load validates its body strictly and answers
//    "Unrecognized key(s) in object" for vision, vision_mode, multimodal, mmproj,
//    mm_proj, projector_path, vision_projector, enable_vision, disable_vision,
//    no_mmproj, image_input, vision_config, clip_model and mmproj_model. The only
//    load options it accepts are model, context_length, parallel, ttl_seconds,
//    flash_attention and the speculative_draft_* family used for native MTP.
//  * A loaded instance's returned config carries no vision or projector field at all,
//    so unlike MTP there is nothing to read back that could confirm a projector state.
// Vision is fixed when LM Studio indexes a model: a base GGUF is vision-capable exactly
// when an mmproj-*.gguf sits beside it in the same folder, and LM Studio surfaces that
// pairing as its own model key whose capabilities.vision is true. The same GGUF bytes
// indexed without a neighbouring mmproj report capabilities.vision false. A projector
// therefore cannot be attached or detached at load time, and text-only can only ever
// mean "send no image" — never "the vision weights were unloaded".
export const projectorToggle=false;
export const noProjectorToggleNote='LM Studio has no load-time option to attach or detach a vision projector. The projector belongs to the model entry itself (an mmproj file stored beside the GGUF), so text-only means no image is sent with any request; it does not unload vision weights.';

export type VisionMode='auto'|'off'|'on';
// Ids of the deterministic local image smoke test added when vision is on. Kept here,
// beside the mode itself, so the renderer can size a run without importing the image
// builder and its node-only dependencies.
export const visionTestIds=['vision-colour','vision-count','vision-halves'];
export type VisionSupport={supported:boolean|null;reason:string};
export type VisionState={requested:VisionMode;effective:string;imagesSent:boolean;projectorUnloaded:boolean;confirmed:boolean;limitation:string};

// Capability comes from the server's own report, never from a model name or family.
// normalizeModels leaves vision undefined when LM Studio reports nothing, which stays
// distinct from an explicit false: unknown is never treated as capable.
export function visionSupport(model:Model|undefined):VisionSupport{
 const reported=model?.capabilities?.vision;
 if(reported===true)return {supported:true,reason:'LM Studio reports this model entry as vision-capable, so a vision projector is attached to it.'};
 if(reported===false)return {supported:false,reason:'LM Studio reports this model entry has no vision projector attached.'};
 return {supported:null,reason:'LM Studio did not report a vision capability for this model entry.'};
}

// Vision adds no load arguments because LM Studio has none. The function still exists so
// an unsupported request is refused before a model is loaded, exactly like MTP.
export function visionArgs(model:Model,mode:VisionMode|undefined):string[]{
 if(mode==='on'){
  const support=visionSupport(model);
  if(support.supported!==true)throw Error(`${model.display_name}: vision is not confirmed for this model. ${support.reason} Choose Vision off, or select a model LM Studio reports as vision-capable.`);
 }
 return [];
}

// Confirmation after loading. The instance config holds no vision field, so the only
// positive evidence LM Studio offers is the capability it reports for the freshly
// reloaded model entry. Vision on stops the benchmark unless that evidence is present;
// off and auto are confirmed by this app not attaching an image, and say plainly that
// the projector itself was never unloaded.
export function verifyVision(fresh:Model|undefined,mode:VisionMode|undefined):VisionState{
 const requested=mode??'auto';
 const support=visionSupport(fresh);
 if(mode==='on'){
  if(!fresh)throw Error('LM Studio did not return the loaded model entry, so vision could not be confirmed. No measurements were taken.');
  if(support.supported!==true)throw Error(`LM Studio did not confirm vision for the loaded model. ${support.reason} No measurements were taken. Choose Vision off, or select a model LM Studio reports as vision-capable.`);
  return {requested,effective:'On — LM Studio confirms an attached vision projector; image requests were sent.',imagesSent:true,projectorUnloaded:false,confirmed:true,limitation:''};
 }
 const stillAttached=support.supported===true?' This model entry is vision-capable, so its projector remained attached and loaded for the whole run.':'';
 if(mode==='off')return {requested,effective:'Off — no image was sent with any request.',imagesSent:false,projectorUnloaded:false,confirmed:true,limitation:noProjectorToggleNote+stillAttached};
 return {requested,effective:"Auto — LM Studio's own defaults; this app sent no image with any request.",imagesSent:false,projectorUnloaded:false,confirmed:true,limitation:noProjectorToggleNote+stillAttached};
}

// One line for run logs and Markdown exports.
export const visionSummary=(state:VisionState)=>`Vision: requested ${state.requested}; ${state.effective}${state.limitation?' Limitation: '+state.limitation:''}`;
