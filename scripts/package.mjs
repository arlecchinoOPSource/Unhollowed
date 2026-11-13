// Builds the distributable bundles for this platform (docs/PACKAGING-U29.md) and writes checksums and the status note.
//
//   node scripts/package.mjs                 macOS: app + dmg for this Mac's architecture; Windows: nsis + msi
//   node scripts/package.mjs --universal     macOS only: one universal (arm64 + x86_64) build; needs both Rust targets
//
// It never signs, notarizes, uploads or publishes anything: builds are ad-hoc signed (macOS) or unsigned (Windows), as the owner decided
// (docs/DECISIONS.md, U-36). Output goes to `release-out/` (ignored by git) together with SHA256SUMS.txt and STATUS.txt.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const universal = process.argv.includes('--universal');
const out = join(root, 'release-out');

/** The three places that carry the version must agree, or a bundle would be labelled inconsistently. */
export function versions(read = file => readFileSync(join(root, file), 'utf8')) {
  const pkg = JSON.parse(read('package.json')).version;
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json')).version;
  // The host crate inherits its version (`version.workspace = true`), so the number lives in the workspace's [workspace.package].
  const cargo = /\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(read('Cargo.toml'))?.[1];
  return { pkg, tauri, cargo };
}
export const agree = v => v.pkg === v.tauri && v.tauri === v.cargo;

export const STATUS = {
  darwin: 'macOS: ad-hoc signed, NOT notarized (no Apple Developer ID). macOS will warn on first launch; see "First launch" in the README of the release. There is no automatic updater: install new versions by hand.',
  win32: 'Windows: NOT code-signed. SmartScreen will warn on first run ("More info", then "Run anyway"). There is no automatic updater: install new versions by hand.',
};

function run(cmd, args, options = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...options });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')} (exit ${r.status})`); process.exit(r.status ?? 1); }
}
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function find(dir, test, found = []) {
  if (!existsSync(dir)) return found;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (test(path, name)) found.push(path);
    else if (statSync(path).isDirectory() && !name.endsWith('.app')) find(path, test, found);
  }
  return found;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = versions();
  if (!agree(v)) { console.error(`The versions disagree: package.json ${v.pkg}, tauri.conf.json ${v.tauri}, Cargo.toml [workspace.package] ${v.cargo}.`); process.exit(1); }
  const platform = process.platform;
  if (platform !== 'darwin' && platform !== 'win32') { console.error('Packaging is supported on macOS and Windows only.'); process.exit(1); }
  if (universal && platform !== 'darwin') { console.error('--universal is macOS only.'); process.exit(1); }

  // The pinned modules must be built into the page first (the bundle's `beforeBuildCommand` builds only the host page).
  run('node', ['scripts/build-modules.mjs']);
  // The notices file ships inside the app; it must match the packages that really go in (docs/REVIEW-U28.md).
  run('node', ['scripts/third-party-notices.mjs', '--check']);
  const bundles = platform === 'darwin' ? 'app,dmg' : 'nsis,msi';
  const args = ['tauri', 'build', '--bundles', bundles, ...(universal ? ['--target', 'universal-apple-darwin'] : [])];
  run('npx', args);

  const bundleRoot = join(root, 'target', ...(universal ? ['universal-apple-darwin'] : []), 'release', 'bundle');
  const wanted = platform === 'darwin' ? (p, n) => n.endsWith('.dmg') || n.endsWith('.app') : (p, n) => n.endsWith('-setup.exe') || n.endsWith('.msi');
  const artifacts = find(bundleRoot, wanted);
  if (artifacts.length === 0) { console.error(`No bundles found under ${bundleRoot}`); process.exit(1); }
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const lines = [];
  for (const artifact of artifacts) {
    if (statSync(artifact).isDirectory()) { console.log(`(kept in place, not copied: ${artifact})`); continue; } // the .app: its dmg is the distributable
    const dest = join(out, basename(artifact)); copyFileSync(artifact, dest);
    lines.push(`${sha(dest)}  ${basename(artifact)}`);
  }
  writeFileSync(join(out, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  writeFileSync(join(out, 'STATUS.txt'), `Unhollowed ${v.pkg}\n\n${STATUS[platform]}\n\nBuilt from a clean checkout of the pinned modules in modules.json. Verify the download against SHA256SUMS.txt.\n`);
  console.log(`\nBundles are in ${out}:\n${lines.join('\n')}`);
  console.log(`\nNext: node scripts/verify-package.mjs${universal ? ' --universal' : ''}`);
}
