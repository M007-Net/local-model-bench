import {createHash} from 'node:crypto';
import {createReadStream, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
// Writes the SHA256SUMS.txt that SECURITY.md tells people to check an installer against, and that the app's
// own update check reads before it will run anything it downloaded. Upload it alongside the installer.
const dir='outputs',{version}=JSON.parse(readFileSync('package.json','utf8'));
const wanted=`Local-Model-Bench-Setup-${version}.exe`;
const names=readdirSync(dir).filter(name=>name===wanted);
if(!names.length){console.error(`No ${wanted} in ${dir}/. Run the packaging step first.`);process.exit(1);}
const lines=[];
for(const name of names){
 const hash=createHash('sha256');
 await new Promise((resolve,reject)=>createReadStream(path.join(dir,name)).on('data',chunk=>hash.update(chunk)).on('end',resolve).on('error',reject));
 lines.push(`${hash.digest('hex')}  ${name}`);
}
writeFileSync(path.join(dir,'SHA256SUMS.txt'),lines.join('\n')+'\n','utf8');
console.log(lines.join('\n'));
console.log(`Wrote ${path.join(dir,'SHA256SUMS.txt')}. Upload it with the installer so the update check can verify the download.`);
