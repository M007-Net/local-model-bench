// Writes THIRD-PARTY-NOTICES.txt from the installed production dependency tree.
//
// Vite bundles react, react-dom, scheduler and lucide-react into dist/assets/index-*.js
// and the minifier strips their copyright banners, so the installer would otherwise
// distribute MIT and ISC code without the notice both licences require to travel with
// it. This regenerates the notices as part of the build, and fails the build rather
// than emitting an incomplete file, so a new dependency cannot slip through unnoticed.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license', 'License'];

function readManifest(dir) {
  const file = path.join(dir, 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

// Production dependencies only: devDependencies build the app, they are not in it.
function collect(dir, found = new Map(), depth = 0) {
  if (depth > 6) return found;
  const manifest = readManifest(dir);
  if (!manifest) return found;
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (found.has(name)) continue;
    const installed = path.join(root, 'node_modules', name);
    const dep = readManifest(installed);
    if (!dep) throw new Error(`${name} is declared as a dependency but is not installed. Run npm ci before building.`);
    const licenseFile = LICENSE_FILES.map(f => path.join(installed, f)).find(existsSync);
    if (!licenseFile) throw new Error(`${name}@${dep.version} ships no licence text. Its notice cannot be reproduced, so the build is refused.`);
    found.set(name, {
      version: dep.version,
      license: dep.license ?? dep.licenses?.map(l => l.type).join(' OR ') ?? 'UNKNOWN',
      text: readFileSync(licenseFile, 'utf8').trimEnd(),
    });
    collect(installed, found, depth + 1);
  }
  return found;
}

const deps = collect(root);
if (!deps.size) throw new Error('No production dependencies were found, which is unexpected for this project.');

const unknown = [...deps].filter(([, d]) => d.license === 'UNKNOWN').map(([n]) => n);
if (unknown.length) throw new Error(`No licence declared for: ${unknown.join(', ')}. Resolve before shipping.`);

const rule = '='.repeat(78);
const body = [...deps]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, d]) => `${rule}\n${name} ${d.version} — ${d.license}\n${rule}\n\n${d.text}\n`)
  .join('\n');

// Deliberately no build date: the committed copy is checked against a fresh build in
// CI, and a timestamp would make that check fail every day for no real reason. What
// identifies this file is the package versions it names.
writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.txt'), `Local Model Bench — third-party notices

The application's own source is MIT licensed; see LICENSE. The packages below are
compiled into the application bundle and keep their own terms, reproduced in full
as those terms require.

Components that are shipped alongside the application rather than compiled into
it — the LibreHardwareMonitor and HidSharp sensor libraries, and the benchmark
datasets — are covered separately in THIRD_PARTY.md, with their licence texts
under vendor/.

${body}`, 'utf8');

console.log(`THIRD-PARTY-NOTICES.txt written for ${deps.size} bundled package(s): ${[...deps.keys()].sort().join(', ')}`);
