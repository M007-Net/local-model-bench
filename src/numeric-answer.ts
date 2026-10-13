// Compare decimal answers without converting their significant digits to Number.
// The key stores digits and a power of ten, so formatting cannot change equality.
export function numericAnswerKey(answer:string):string|null{
 const raw=answer.trim();
 const match=/^([+-]?)(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
 if(!match||!Number.isFinite(Number(raw.replaceAll(',',''))))return null;
 const fraction=match[3]??'';
 let digits=(match[2].replaceAll(',','')+fraction).replace(/^0+/,'');
 if(!digits)return '0';
 const trailing=digits.length-digits.replace(/0+$/,'').length;
 digits=digits.slice(0,digits.length-trailing);
 const exponent=BigInt(match[4]??'0')+BigInt(trailing)-BigInt(fraction.length);
 return `${match[1]==='-'?'-':''}${digits}e${exponent}`;
}
