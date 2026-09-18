// Shared argument checks. This lives in `src` so the renderer and the main process can both use it
// without the renderer pulling in Node-only modules through `electron/validation`.
export function integer(n:unknown,min:number,max:number,name:string){if(typeof n!=='number'||!Number.isInteger(n)||n<min||n>max)throw Error(`${name} must be an integer from ${min} to ${max}.`);}
