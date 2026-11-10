// Builds each pinned module's web bundle into public/modules/<name>/ (docs/HOST-CONTRACT-U35.md):
//   1. clone the module at its pinned full commit SHA into .modules/<name> (gitignored);
//   2. refuse the pin unless its manifests agree and equal the pinned version (docs/RELEASE-HYGIENE-U34.md);
//   3. build the app's own web bundle with a relative base, unmodified;
//   4. add the host shim as the first script of index.html.
// Private dependencies (Swish pulls Core as a submodule) need your own GitHub access when cloning.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pins = JSON.parse(readFileSync(join(root, 'modules.json'), 'utf8'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const out = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

/** The version in a manifest, however it is written. */
export function versionOf(file, text) {
  if (file.endsWith('.toml')) return text.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  return JSON.parse(text).version;
}

/** Throws unless every manifest reports the pinned version. */
export function checkManifests(name, pin, read) {
  const found = Object.fromEntries(pin.manifests.map(file => [file, versionOf(file, read(file))]));
  const bad = Object.entries(found).filter(([, version]) => version !== pin.version);
  if (bad.length) throw new Error(`${name}: manifests disagree with pinned ${pin.version}: ${JSON.stringify(found)}`);
  return found;
}

function build(name, pin) {
  if (!/^[0-9a-f]{40}$/.test(pin.sha)) throw new Error(`${name}: pin must be a full 40-character commit SHA`);
  const source = join(root, '.modules', name);
  if (!existsSync(source)) {
    mkdirSync(dirname(source), { recursive: true });
    run('git', ['clone', '--quiet', pin.repo, source]);
  }
  run('git', ['fetch', '--quiet', 'origin'], source);
  run('git', ['checkout', '--quiet', '--force', pin.sha], source);
  if (pin.submodules) run('git', ['submodule', 'update', '--init', '--recursive', '--quiet'], source);
  const head = out('git', ['rev-parse', 'HEAD'], source);
  if (head !== pin.sha) throw new Error(`${name}: checked out ${head}, expected ${pin.sha}`);
  const manifests = checkManifests(name, pin, file => readFileSync(join(source, file), 'utf8'));

  run('npm', ['ci', '--no-audit', '--no-fund'], source);
  const dist = join(root, 'public', 'modules', name);
  rmSync(dist, { recursive: true, force: true });
  run('npx', ['vite', 'build', '--base=./', '--outDir', dist, '--emptyOutDir'], source);

  const index = join(dist, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (!html.includes('<head>')) throw new Error(`${name}: index.html has no <head> to inject the shim into`);
  writeFileSync(index, html.replace('<head>', '<head><script src="../shim.js"></script>'));
  writeFileSync(join(dist, 'PROVENANCE.json'), JSON.stringify({ name, repo: pin.repo, sha: head, version: pin.version, manifests, builtWith: 'vite build --base=./' }, null, 2) + '\n');
  console.log(`built ${name} ${pin.version} (${head.slice(0, 7)}) -> public/modules/${name}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, pin] of Object.entries(pins)) build(name, pin);
}
