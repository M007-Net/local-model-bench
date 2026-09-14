import type {Model} from '../src/types';
export function liveModel(models:Model[],requireMtp=false):Model{
 const key=process.env.LMB_MODEL_KEY;
 if(!key)throw Error('Set LMB_MODEL_KEY to an exact identifier from the app Models screen. No model is chosen automatically.');
 const model=models.find(m=>m.key===key);
 if(!model)throw Error('LMB_MODEL_KEY is not in the current LM Studio model library.');
 if(requireMtp&&model.nativeMtp?.supported!==true)throw Error('The selected model does not have confirmed native MTP support.');
 return model;
}
