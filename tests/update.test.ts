import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertDownloadUrl,checksumFor,compareVersions,installerName,isChecksumAsset,isNewer,maxInstallerBytes,normalizeVersion,parseRepo,pickAsset,releaseToUpdate,type Release} from '../electron/update';
import {validateSettings} from '../electron/validation';
import {defaultSettings} from '../src/defaults';
const sha='a'.repeat(64);
const release=(patch:Partial<Release>={}):Release=>({tag_name:'v1.8.0',name:'1.8.0',body:'Notes',html_url:'https://github.com/owner/repo/releases/tag/v1.8.0',draft:false,prerelease:false,published_at:'2026-09-20T00:00:00.000Z',
 assets:[{name:installerName('1.8.0'),size:114_000_000,browser_download_url:'https://github.com/owner/repo/releases/download/v1.8.0/'+installerName('1.8.0')}],...patch});
test('a repository is only accepted as a plain owner/name',()=>{
 assert.deepEqual(parseRepo('owner/repo'),{owner:'owner',repo:'repo'});
 assert.deepEqual(parseRepo('  https://github.com/Owner/local-model-bench.git  '),{owner:'Owner',repo:'local-model-bench'});
 for(const bad of ['','owner','owner/repo/extra','owner//repo','../../etc','owner/repo?x=1','owner/re po','owner/-repo'.replace('-','../'),'https://evil.com/owner/repo'])
  assert.equal(parseRepo(bad),null,bad+' must not parse');
});
test('versions order numerically, and a prerelease never outranks its own release',()=>{
 assert.equal(compareVersions('1.8.0','1.7.0'),1);
 assert.equal(compareVersions('1.10.0','1.9.0'),1,'ten follows nine rather than sorting as text');
 assert.equal(compareVersions('1.7.0','1.7.0'),0);
 assert.equal(compareVersions('1.8.0-rc.1','1.8.0'),-1);
 assert.equal(compareVersions('1.8.0','1.8.0-rc.1'),1);
 assert.equal(compareVersions('1.8','1.7.0'),null,'an unparseable version is not guessed at');
 assert.equal(compareVersions('nonsense','1.7.0'),null);
 assert.equal(isNewer('1.7.0','1.7.1'),true);
 assert.equal(isNewer('1.7.0','1.7.0'),false);
 assert.equal(isNewer('1.7.0','1.6.9'),false);
 assert.equal(isNewer('1.7.0','definitely-newer-trust-me'),false);
 assert.equal(normalizeVersion('v1.8.0'),'1.8.0');
 assert.equal(normalizeVersion('release-1.8.0'),null);
});
test('only the exact installer this project builds is eligible',()=>{
 const name=installerName('1.8.0');
 assert.equal(name,'Local-Model-Bench-Setup-1.8.0.exe');
 assert.equal(pickAsset([{name,size:1,browser_download_url:'u'}],'1.8.0')?.name,name);
 for(const other of ['Local-Model-Bench-Setup-1.8.0.exe.blockmap','local-model-bench-setup-1.8.0.exe','Local-Model-Bench-Setup-1.8.0.exe ','setup.exe','Local-Model-Bench-Setup-1.7.0.exe'])
  assert.equal(pickAsset([{name:other,size:1,browser_download_url:'u'}],'1.8.0'),null,other+' must not be treated as the installer');
 assert.ok(isChecksumAsset('SHA256SUMS.txt')&&isChecksumAsset('SHA256SUMS'));
 assert.ok(!isChecksumAsset('SHA256SUMS.txt.exe'));
});
test('a published checksum is read from the sums file or from the release notes',()=>{
 const name=installerName('1.8.0');
 assert.equal(checksumFor(name,`${sha}  ${name}\n`),sha);
 assert.equal(checksumFor(name,`${sha} *${name}`),sha,'the binary-mode star form is the same line');
 assert.equal(checksumFor(name,null,`SHA-256 of ${name}: ${sha.toUpperCase()}`),sha,'notes may carry it instead, in either case');
 assert.equal(checksumFor(name,`${sha}  Some-Other-File.exe`),null,'a checksum for a different file is not borrowed');
 assert.equal(checksumFor(name,null,null),null);
});
test('a release only becomes an update when every part of it checks out',()=>{
 assert.equal(releaseToUpdate(release(),'1.7.0')?.version,'1.8.0');
 assert.equal(releaseToUpdate(release(),'1.8.0'),null,'the installed version is not an update');
 assert.equal(releaseToUpdate(release(),'1.9.0'),null,'an older release is not an update');
 assert.equal(releaseToUpdate(release({draft:true}),'1.7.0'),null);
 assert.equal(releaseToUpdate(release({prerelease:true}),'1.7.0'),null);
 assert.equal(releaseToUpdate(release({tag_name:'nightly'}),'1.7.0'),null);
 assert.equal(releaseToUpdate(release({assets:[]}),'1.7.0'),null,'a release with no installer offers nothing');
 assert.equal(releaseToUpdate(release({assets:[{name:'totally-not-the-installer.exe',size:10,browser_download_url:'https://github.com/x'}]}),'1.7.0'),null);
 assert.equal(releaseToUpdate(release({assets:[{name:installerName('1.8.0'),size:maxInstallerBytes+1,browser_download_url:'https://github.com/x'}]}),'1.7.0'),null,'an absurd size is refused before anything is fetched');
 assert.equal(releaseToUpdate(null,'1.7.0'),null);
 const withSums=releaseToUpdate(release(),'1.7.0',`${sha}  ${installerName('1.8.0')}`);
 assert.equal(withSums?.publishedSha256,sha);
 assert.equal(releaseToUpdate(release(),'1.7.0')?.publishedSha256,null,'no published checksum is reported as none, never as passing');
});
test('an update can only be downloaded from GitHub over HTTPS',()=>{
 for(const good of ['https://github.com/owner/repo/releases/download/v1.8.0/x.exe','https://objects.githubusercontent.com/x','https://release-assets.githubusercontent.com/x'])
  assert.equal(assertDownloadUrl(good).protocol,'https:');
 for(const bad of ['http://github.com/x','https://github.com.evil.example/x','https://evil.example/github.com/x','https://raw.githubusercontent.com/x','file:///C:/x.exe','not a url',''])
  assert.throws(()=>assertDownloadUrl(bad),/HTTPS|must come from GitHub|usable download address/,bad+' must be refused');
});
test('update checking is off until a repository is named',()=>{
 assert.equal(defaultSettings.updateRepo,'');
 assert.equal(defaultSettings.updateCheck,false);
 const base={baseUrl:'http://127.0.0.1:1234',lmsPath:'',timeoutSec:300,loadTimeoutSec:300,judgePrompt:defaultSettings.judgePrompt,tokenConfigured:false,updateRepo:'',updateCheck:false};
 validateSettings({...base});
 validateSettings({...base,updateRepo:'owner/repo',updateCheck:true});
 assert.throws(()=>validateSettings({...base,updateRepo:'not a repo'}),/owner\/name/);
 assert.throws(()=>validateSettings({...base,updateRepo:'x'.repeat(201)}),/owner\/name/);
 assert.throws(()=>validateSettings({...base,updateCheck:true}),/Name the repository/);
 assert.throws(()=>validateSettings({...base,updateCheck:'yes' as unknown as boolean}),/Invalid settings/);
});
// The bridged API is frozen, so the window cannot be driven into an update state from a test harness. These
// read the window code instead of pretending an update exists.
test('the window offers the update control only when there is one to act on',()=>{
 const ui=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
 assert.ok(ui.includes("['available','downloading','ready'].includes(updateState.phase)"),'the banner must appear only for an update that can be acted on');
 assert.ok(ui.includes("state.phase==='ready'&&(state.verified?"),'a finished download must say whether a published checksum vouched for it');
 assert.ok(ui.includes('onClick={onInstall}')&&ui.includes('onClick={onDownload}'),'downloading and installing must each be a press');
});
test('the main process never checks, downloads, or installs on its own',()=>{
 const main=readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8');
 assert.ok(main.includes("if(!saved.updateRepo.trim())"),'an unnamed repository must short-circuit the check');
 assert.ok(main.includes("if(!saved.updateCheck&&!manual)return updateState;"),'the startup check must respect the setting');
 assert.ok(/handle\('installUpdate',(?:async)?\(\)=>\{\s*assertIdle\(\);/.test(main),'installing must refuse while a benchmark is running');
 assert.ok(main.includes('if(!updateState.verified)throw Error('),'an installer with no published checksum must not be launched');
 assert.ok(/const now=await hashFile\(updateState\.file\)/.test(main),'the installer must be re-hashed at the moment it is launched, not only when it arrived');
 assert.ok(main.includes("if(updateState.phase!=='ready'||!updateState.file)throw Error"),'only a verified, downloaded file may be launched');
 assert.ok(!main.includes('autoUpdater'),'no background updater may install anything unattended');
});
