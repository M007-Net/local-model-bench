// A model asked for "only JSON" very often returns it inside a ```json fence. That is markup around
// the answer, not prose instead of it, and this app already unwraps exactly the same wrapper when it
// reads a judge's reply (see parseGrade). Not doing it here scored a perfect answer zero: Gemma 4
// 26B A4B returned all five subnet values correctly, fenced, and every check failed with
// "Unexpected token '`'". Only a single fence that opens the text and closes it is removed; prose
// around the JSON is still a failure, because that is a different thing to get wrong.
export function unfence(text:string):{json:string;fenced:boolean}{
 const trimmed=text.trim();
 if(!trimmed.startsWith('```'))return {json:trimmed,fenced:false};
 const opener=/^```[A-Za-z0-9_-]*[^\S\r\n]*\r?\n?/;
 const closer=/\r?\n?```$/;
 // A fence that never closes is not a wrapper, so it is left exactly as it was.
 if(!closer.test(trimmed))return {json:trimmed,fenced:false};
 const inner=trimmed.replace(opener,'').replace(closer,'');
 // A fence that never closes, or that wraps several blocks, is left exactly as it was.
 return inner.includes('```')?{json:trimmed,fenced:false}:{json:inner.trim(),fenced:true};
}
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
