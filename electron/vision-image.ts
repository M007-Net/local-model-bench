import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import type {Rule,TestCase} from '../src/types';
import {visionTestIds} from './vision';

// Images for the vision smoke test are drawn here rather than shipped as binary assets,
// so every run uses byte-identical input that can be regenerated and audited. Nothing is
// downloaded and nothing leaves the machine: the v1 chat API takes a base64 data URL and
// explicitly refuses an http(s) URL ("Unexpected HTTP URL in input.data_url for image
// content item."), so the whole vision path is local.
type Rgb=[number,number,number];
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
const crc32=(b:Buffer)=>{let r=0xFFFFFFFF;for(const x of b)r=crcTable[(r^x)&0xFF]^(r>>>8);return (r^0xFFFFFFFF)>>>0;};
const chunk=(type:string,data:Buffer)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const typed=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(typed));return Buffer.concat([len,typed,crc]);};

export function png(width:number,height:number,paint:(x:number,y:number)=>Rgb):Buffer{
 const stride=1+width*3,raw=Buffer.alloc(height*stride);
 for(let y=0;y<height;y++){const row=y*stride;for(let x=0;x<width;x++){const [r,g,b]=paint(x,y),at=row+1+x*3;raw[at]=r;raw[at+1]=g;raw[at+2]=b;}}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2; // 8-bit truecolour
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
export const dataUrl=(image:Buffer)=>'data:image/png;base64,'+image.toString('base64');
export const imageDigest=(image:Buffer)=>createHash('sha256').update(image).digest('hex');

const white:Rgb=[255,255,255],red:Rgb=[220,30,30],blue:Rgb=[30,60,200],black:Rgb=[20,20,20];
const box=(x:number,y:number,left:number,top:number,size:number)=>x>=left&&x<left+size&&y>=top&&y<top+size;
// Large, high-contrast, axis-aligned shapes stay legible after a vision encoder resizes them.
export const visionImages={
 colour:()=>png(224,224,(x,y)=>box(x,y,56,56,112)?red:white),
 count:()=>png(224,224,(x,y)=>[24,92,160].some(left=>box(x,y,left,88,40))?black:white),
 halves:()=>png(224,224,(_x,y)=>y<112?blue:white)
};

const rule=(id:string,label:string,type:Rule['type'],extra:Partial<Rule>={}):Rule=>({id,label,type,weight:1,...extra});
const rubric='Score whether the answer correctly and concisely describes what the image actually shows. A short, direct answer is correct; extra commentary is not rewarded.';
// kind:'quality' so objective checks and the optional local judge apply, exactly as for
// text tests. Each expected answer is one word or number, but a reasoning model spends
// its budget before answering, so the cap leaves room for that rather than measuring
// budget exhaustion. The run's own output limit still applies on top of this.
const visionTest=(id:string,name:string,prompt:string,image:Buffer,rules:Rule[],answerKey:string):TestCase=>
 ({id,name,category:'Vision',prompt,rules,answerKey,maxTokens:512,version:1,rubric,kind:'quality',image:dataUrl(image),imageDigest:imageDigest(image)});

export function visionTests():TestCase[]{
 // Ids must match the list the renderer uses to size a run.
 return [
  visionTest('vision-colour','Identify a colour from an image','Look at the image. It shows a single solid-coloured square on a white background. Reply with the colour of that square as one lowercase word and nothing else.',visionImages.colour(),[rule('red','Names the colour red','contains',{expected:'red'})],'red'),
  visionTest('vision-count','Count shapes in an image','Look at the image. Count the dark squares on the white background. Reply with the number of squares and nothing else.',visionImages.count(),[rule('three','Counts three squares','final-number',{expected:'3'})],'3'),
  visionTest('vision-halves','Locate a colour within an image','Look at the image. One half of it is solid blue and the other half is white. Reply with which half is blue, using exactly one lowercase word from: top, bottom, left, right.',visionImages.halves(),[rule('top','Identifies the top half','contains',{expected:'top'})],'top')
 ];
}

if(visionTests().map(t=>t.id).join()!==visionTestIds.join())throw Error("Vision test ids are out of step with visionTestIds.");
