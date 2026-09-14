// JSON.parse accepts duplicate keys. Reject those so conflicting answers cannot
// silently collapse to whichever value appeared last.
export function parseAnswer(text:string):unknown {
 const value=JSON.parse(text);
 const tokens=text.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)!;
 let i=0;
 function walk():void {
  const token=tokens[i++];
  if(token==='{'){
   const keys=new Set<string>();
   if(tokens[i]==='}'){i++;return;}
   do {
    const key=JSON.parse(tokens[i++]);
    if(keys.has(key))throw Error(`Duplicate JSON key: ${key}`);
    keys.add(key);i++;walk();
   }while(tokens[i++]===',');
  } else if(token==='['){
   if(tokens[i]===']'){i++;return;}
   do {walk();}while(tokens[i++]===',');
  }
 }
 walk();return value;
}
export function equalAnswer(actual:unknown,expected:unknown,path='$'):string|null {
 if(typeof expected==='number')return typeof actual==='number'&&Number.isFinite(actual)&&actual===expected?null:`${path}: expected ${expected}; received ${JSON.stringify(actual)}`;
 if(expected===null||typeof expected!=='object')return actual===expected?null:`${path}: value differs`;
 if(actual===null||typeof actual!=='object'||Array.isArray(actual)!==Array.isArray(expected))return `${path}: wrong JSON structure`;
 const a=actual as Record<string,unknown>,e=expected as Record<string,unknown>;
 const ak=Object.keys(a).sort(),ek=Object.keys(e).sort();
 if(JSON.stringify(ak)!==JSON.stringify(ek))return `${path}: missing or extra keys; expected ${ek.join(', ')}`;
 for(const key of ek){const error=equalAnswer(a[key],e[key],`${path}.${key}`);if(error)return error;}
 return null;
}
