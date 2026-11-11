// Builds each pinned module's web bundle into public/modules/<name>/ (docs/HOST-CONTRACT-U35.md):
//   1. clone the module at its pinned full commit SHA into .modules/<name> (gitignored);
//   2. refuse the pin unless its manifests agree and equal the pinned version (docs/RELEASE-HYGIENE-U34.md);
//   3. build the app's own web bundle with a relative base and its Tauri API imports (core, event, window) redirected
//      to the host adapters in adapter/, which route every call through the host window; the app's source is untouched;
//   4. add the host shim as the first script of index.html.
// `--source-only` stops after step 2 (clone and verify; no private submodule, no bundle), which is all the
// Rust checks need. If the pinned commit is already checked out, nothing is fetched.
// Private dependencies (Swish pulls Core as a submodule) need your own GitHub access when cloning.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pins = JSON.parse(readFileSync(join(root, 'modules.json'), 'utf8'));
// On Windows npm and npx are .cmd shims, which Node will not spawn without a shell. Only these two fixed
// command names get one, with fixed arguments.
const shell = cmd => process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: shell(cmd) });
const out = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', shell: shell(cmd) }).trim();

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

function build(name, pin, { sourceOnly = false } = {}) {
  if (!/^[0-9a-f]{40}$/.test(pin.sha)) throw new Error(`${name}: pin must be a full 40-character commit SHA`);
  const source = join(root, '.modules', name);
  if (!existsSync(source)) {
    mkdirSync(dirname(source), { recursive: true });
    run('git', ['clone', '--quiet', pin.repo, source]);
  }
  // CI checks the pinned commit out itself (with its own credentials), so only touch the network when needed.
  if (out('git', ['rev-parse', 'HEAD'], source) !== pin.sha) {
    run('git', ['fetch', '--quiet', 'origin'], source);
    run('git', ['checkout', '--quiet', '--force', pin.sha], source);
  }
  const head = out('git', ['rev-parse', 'HEAD'], source);
  if (head !== pin.sha) throw new Error(`${name}: checked out ${head}, expected ${pin.sha}`);
  const manifests = checkManifests(name, pin, file => readFileSync(join(source, file), 'utf8'));
  if (sourceOnly) {
    // Enough for the Rust crates that depend on the module's data code; no private dependencies are fetched.
    console.log(`verified ${name} ${pin.version} (${head.slice(0, 7)}), source only`);
    return;
  }
  if (pin.submodules) {
    // A submodule is missing when git marks it uninitialized ("-") and its folder is empty. CI fills the folder
    // itself with its own credentials, so a populated folder is accepted as it is.
    const missing = out('git', ['submodule', 'status', '--recursive'], source).split('\n')
      .filter(line => line.startsWith('-'))
      .map(line => line.trim().split(/\s+/)[1])
      .filter(path => !existsSync(join(source, path)) || readdirSync(join(source, path)).length === 0);
    if (missing.length) run('git', ['submodule', 'update', '--init', '--recursive', '--quiet'], source);
  }

  // Most modules build from the repository root; Ember's app lives in a subfolder (pin.appDir).
  const app = join(source, pin.appDir ?? '.');
  run('npm', ['ci', '--no-audit', '--no-fund'], app);
  const dist = join(root, 'public', 'modules', name);
  rmSync(dist, { recursive: true, force: true });
  // The module's own Vite config, plus aliases that send its Tauri API imports to the host adapters (adapter/).
  const posix = path => path.replaceAll('\\', '/');
  const adapter = file => JSON.stringify(posix(join(root, 'adapter', file)));
  writeFileSync(join(app, 'vite.unhlw.config.ts'), [
    "import { defineConfig, mergeConfig } from 'vite';",
    "import base from './vite.config';",
    'export default defineConfig(async env => mergeConfig(typeof base === \'function\' ? await base(env) : base, { resolve: { alias: [',
    `  { find: /^@tauri-apps\\/api\\/core$/, replacement: ${adapter('tauri-core.js')} },`,
    `  { find: /^@tauri-apps\\/api\\/event$/, replacement: ${adapter('tauri-event.js')} },`,
    `  { find: /^@tauri-apps\\/api\\/window$/, replacement: ${adapter('tauri-window.js')} },`,
    '] } }));',
    '',
  ].join('\n'));
  run('npx', ['vite', 'build', '--config', 'vite.unhlw.config.ts', '--base=./', '--outDir', dist, '--emptyOutDir'], app);

  // The real Tauri API calls the frame's own internals directly; if any of that code survived, the alias did not apply.
  for (const file of readdirSync(join(dist, 'assets')).filter(f => f.endsWith('.js'))) {
    if (readFileSync(join(dist, 'assets', file), 'utf8').includes('__TAURI_INTERNALS__.invoke')) {
      throw new Error(`${name}: ${file} still calls the frame's own Tauri internals; the host adapter alias did not apply`);
    }
  }

  const index = join(dist, 'index.html');
  const html = readFileSync(index, 'utf8');
  if (!html.includes('<head>')) throw new Error(`${name}: index.html has no <head> to inject the shim into`);
  writeFileSync(index, html.replace('<head>', '<head><script src="../shim.js"></script>'));
  writeFileSync(join(dist, 'PROVENANCE.json'), JSON.stringify({ name, repo: pin.repo, sha: head, version: pin.version, manifests, builtWith: 'vite build --base=./ with the host Tauri API adapters (adapter/)' }, null, 2) + '\n');
  console.log(`built ${name} ${pin.version} (${head.slice(0, 7)}) -> public/modules/${name}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sourceOnly = process.argv.includes('--source-only');
  for (const [name, pin] of Object.entries(pins)) build(name, pin, { sourceOnly });
}
