import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream, mkdirSync, rmSync} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
// Checking for a release is the only outbound request this app can make, and it happens only after you name a
// repository and turn the check on. Everything here is written so that what gets run on your machine is a file
// whose name, size, origin, and checksum were all decided before a byte was fetched.
export type ReleaseAsset={name:string;size:number;browser_download_url:string};
export type Release={tag_name?:string;name?:string;body?:string;html_url?:string;draft?:boolean;prerelease?:boolean;published_at?:string;assets?:ReleaseAsset[]};
export type UpdateInfo={version:string;title:string;notes:string;releaseUrl:string;published:string;assetName:string;assetSize:number;assetUrl:string;publishedSha256:string|null};
export type UpdateState={phase:'idle'|'checking'|'available'|'downloading'|'ready'|'error';info:UpdateInfo|null;received:number;total:number;file:string;sha256:string;verified:boolean;error:string;checked:string;current:string};
export const installerName=(version:string)=>`Local-Model-Bench-Setup-${version}.exe`;
export const maxInstallerBytes=600*1024*1024;
export const maxChecksumBytes=1024*1024;
const segment=/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export function parseRepo(value:string|undefined|null){
 const trimmed=String(value??'').trim().replace(/^https:\/\/(www\.)?github\.com\//i,'').replace(/\.git$/i,'').replace(/^\/+|\/+$/g,'');
 if(!trimmed)return null;
 const parts=trimmed.split('/');
 if(parts.length!==2)return null;
 const [owner,repo]=parts;
 return segment.test(owner)&&segment.test(repo)?{owner,repo}:null;
}
const parsed=(v:string|undefined|null)=>{const m=/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v??'').trim());return m?{numbers:[+m[1],+m[2],+m[3]],pre:m[4]??''}:null;};
export function compareVersions(a:string,b:string){
 const x=parsed(a),y=parsed(b);
 if(!x||!y)return null;
 for(let i=0;i<3;i++)if(x.numbers[i]!==y.numbers[i])return x.numbers[i]<y.numbers[i]?-1:1;
 if(x.pre===y.pre)return 0;
 // 1.8.0-rc.1 comes before 1.8.0, so a plain release always wins a tie against a prerelease of itself.
 if(!x.pre)return 1;
 if(!y.pre)return -1;
 return x.pre<y.pre?-1:1;
}
export const isNewer=(current:string,candidate:string)=>compareVersions(candidate,current)===1;
export const normalizeVersion=(tag:string|undefined|null)=>{const p=parsed(tag);return p?p.numbers.join('.')+(p.pre?'-'+p.pre:''):null;};
// Only the exact installer this version of the app would have produced is eligible. A release carrying some
// other executable has nothing here to offer.
export const pickAsset=(assets:ReleaseAsset[],version:string)=>assets.find(a=>String(a?.name??'')===installerName(version))??null;
export const isChecksumAsset=(name:string)=>/^SHA256SUMS(\.txt)?$/i.test(String(name??''));
// A published checksum travels either as a SHA256SUMS.txt asset or inside the release notes. Both are the
// "<hex>  <filename>" line SECURITY.md already tells you to compare against before running an installer.
export function checksumFor(fileName:string,...sources:(string|null|undefined)[]){
 const escaped=fileName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 for(const text of sources){
  if(!text)continue;
  const match=new RegExp('([A-Fa-f0-9]{64})[ \\t]*\\*?[ \\t]*'+escaped,'i').exec(text)??new RegExp(escaped+'[^A-Fa-f0-9]{1,40}([A-Fa-f0-9]{64})','i').exec(text);
  if(match)return match[1].toLowerCase();
 }
 return null;
}
export function releaseToUpdate(release:Release|null|undefined,currentVersion:string,sums?:string|null):UpdateInfo|null{
 if(!release||release.draft||release.prerelease)return null;
 const version=normalizeVersion(release.tag_name);
 if(!version||!isNewer(currentVersion,version))return null;
 const asset=pickAsset(release.assets??[],version);
 if(!asset)return null;
 const size=Number(asset.size);
 if(!Number.isFinite(size)||size<=0||size>maxInstallerBytes)return null;
 return {version,title:release.name?.trim()||version,notes:String(release.body??'').slice(0,20000),releaseUrl:String(release.html_url??''),published:String(release.published_at??''),
  assetName:asset.name,assetSize:size,assetUrl:String(asset.browser_download_url??''),publishedSha256:checksumFor(asset.name,sums,release.body)};
}
// GitHub serves release files from github.com and redirects to its own object storage. Anything else, and a
// release that pointed somewhere unexpected could choose what this app executes.
const downloadHosts=new Set(['github.com','objects.githubusercontent.com','release-assets.githubusercontent.com']);
export function assertDownloadUrl(url:string){
 let parsedUrl:URL;
 try{parsedUrl=new URL(url);}catch{throw Error('The release did not provide a usable download address.');}
 if(parsedUrl.protocol!=='https:')throw Error('Updates must be downloaded over HTTPS.');
 if(!downloadHosts.has(parsedUrl.hostname))throw Error(`Refusing to download an update from ${parsedUrl.hostname}. Release files must come from GitHub.`);
 return parsedUrl;
}
const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'LocalModelBench'};
async function get(url:string,init:RequestInit={},timeoutMs=20000){
 const timeout=AbortSignal.timeout(timeoutMs);
 const response=await fetch(url,{...init,headers:{...headers,...init.headers},signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
 if(response.status===404)throw Error('No published release was found for that repository. Check the owner/name, and that the release is published rather than a draft.');
 if(response.status===403||response.status===429)throw Error('GitHub rate-limited this check. Try again later.');
 if(!response.ok)throw Error(`GitHub returned ${response.status} for the update check.`);
 return response;
}
export async function fetchLatestRelease(repoValue:string,currentVersion:string):Promise<UpdateInfo|null>{
 const repo=parseRepo(repoValue);
 if(!repo)throw Error('Set the update repository as owner/name, for example your-account/local-model-bench.');
 const release=await (await get(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`)).json() as Release;
 let sums:string|null=null;
 const sumsAsset=(release.assets??[]).find(a=>isChecksumAsset(a?.name));
 if(sumsAsset&&Number(sumsAsset.size)>0&&Number(sumsAsset.size)<=maxChecksumBytes){
  try{sums=await (await get(assertDownloadUrl(sumsAsset.browser_download_url).href)).text();}catch{sums=null;}
 }
 return releaseToUpdate(release,currentVersion,sums);
}
export async function downloadInstaller(info:UpdateInfo,directory:string,onProgress:(received:number)=>void,signal?:AbortSignal){
 if(info.assetName!==installerName(info.version))throw Error('The release names its installer something this app did not build.');
 if(!(info.assetSize>0)||info.assetSize>maxInstallerBytes)throw Error('The update download is an unexpected size.');
 assertDownloadUrl(info.assetUrl);
 const response=await get(info.assetUrl,{signal},120000);
 if(!response.body)throw Error('GitHub returned no update file.');
 assertDownloadUrl(response.url||info.assetUrl);
 mkdirSync(directory,{recursive:true});
 const file=path.join(directory,info.assetName),hash=createHash('sha256');
 let received=0;
 try{
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),async function*(source){
   for await (const chunk of source){
    received+=(chunk as Buffer).length;
    if(received>info.assetSize)throw Error('The update file is larger than the release said it would be.');
    hash.update(chunk as Buffer);onProgress(received);
    yield chunk;
   }
  },createWriteStream(file));
 }catch(e){rmSync(file,{force:true});throw e;}
 if(received!==info.assetSize){rmSync(file,{force:true});throw Error('The update download ended early and was deleted.');}
 const sha256=hash.digest('hex');
 // A checksum that was published with the release is the only thing that can vouch for the bytes, so a
 // mismatch deletes the file rather than leaving a runnable installer behind.
 if(info.publishedSha256&&info.publishedSha256!==sha256){rmSync(file,{force:true});throw Error('The downloaded installer does not match the checksum published with the release. It was deleted.');}
 return {file,sha256,verified:!!info.publishedSha256};
}
// The hash above covers the bytes as they arrived. Minutes or hours can pass before
// the user presses Install, and the file sits at a path any process running as this
// user can write. Re-reading it at the moment of launch is what makes the checksum
// mean something about the file that actually runs.
export async function hashFile(file:string){
 const hash=createHash('sha256');
 await pipeline(createReadStream(file),async function*(source){for await(const chunk of source)hash.update(chunk as Buffer);});
 return hash.digest('hex');
}
