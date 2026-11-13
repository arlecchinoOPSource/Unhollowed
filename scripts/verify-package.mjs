// Checks the bundles `scripts/package.mjs` built, on the platform that built them (docs/PACKAGING-U29.md). Prints PASS/FAIL per check
// and exits non-zero if any fails. It verifies what is true of the artifacts: identity, version, signing status exactly as claimed
// (ad-hoc / unsigned, not notarized), that the packaged app starts, that it keeps its data where the host contract says (module
// folders as siblings of the host's, owner-only on macOS) and ignores the debug-only data override, and that installing and
// uninstalling leaves the modules' data alone. Nothing here signs, uploads or publishes.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const universal = process.argv.includes('--universal');
const conf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const bundleRoot = join(root, 'target', ...(universal ? ['universal-apple-darwin'] : []), 'release', 'bundle');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${String(detail).replace(/\n/g, '\n      ')}`}`); };
const sh = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...options });
const sleep = ms => new Promise(done => setTimeout(done, ms));
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const MODULE_FOLDERS = ['com.arlecchino.terminal', 'com.arlecchino.ember', 'com.arlecchino.swish'];

/** Starts the packaged app with a throwaway home, lets it open, and stops it. Returns whatever it left in the home. */
async function launch(exe, env, ms = 8000) {
  const child = spawn(exe, [], { env: { ...process.env, ...env }, stdio: 'ignore' });
  let exited = null; child.on('exit', code => { exited = code; });
  await sleep(ms);
  const stillRunning = exited === null;
  if (stillRunning) child.kill();
  await sleep(1500);
  return { stillRunning, exited };
}

async function macos() {
  const appDir = join(bundleRoot, 'macos');
  const app = existsSync(appDir) ? join(appDir, readdirSync(appDir).find(n => n.endsWith('.app')) ?? '') : '';
  check('the .app bundle exists', existsSync(app) && app.endsWith('.app'), appDir);
  if (!existsSync(app) || !app.endsWith('.app')) return;
  const plist = key => sh('plutil', ['-extract', key, 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')]).stdout.trim();
  check(`identity: ${conf.identifier}, version ${conf.version}, minimum macOS 11.0`, plist('CFBundleIdentifier') === conf.identifier && plist('CFBundleShortVersionString') === conf.version && plist('LSMinimumSystemVersion') === '11.0', [plist('CFBundleIdentifier'), plist('CFBundleShortVersionString'), plist('LSMinimumSystemVersion')].join(' '));
  const bundled = join(app, 'Contents', 'Resources', 'icon.icns');
  check('the app icon is the repository\'s icon (src-tauri/icons/icon.icns)', existsSync(bundled) && sha256(bundled) === sha256(join(root, 'src-tauri/icons/icon.icns')), bundled);
  const notices = join(app, 'Contents', 'Resources', 'THIRD-PARTY-NOTICES.txt');
  check('the third-party notices ship inside the app and match the repository\'s', existsSync(notices) && sha256(notices) === sha256(join(root, 'THIRD-PARTY-NOTICES.txt')), notices);
  const exe = join(app, 'Contents', 'MacOS', 'unhollowed');
  const archs = sh('lipo', ['-archs', exe]).stdout.trim().split(/\s+/).sort().join(' ');
  check(universal ? 'universal binary (arm64 and x86_64)' : `binary architecture: ${archs}`, universal ? archs === 'arm64 x86_64' : archs.length > 0, archs);
  const verify = sh('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  check('the code signature is intact (codesign --verify --deep --strict)', verify.status === 0, verify.stderr);
  const detail = sh('codesign', ['-dv', '--verbose=4', app]).stderr;
  check('signed ad-hoc and nothing more (no Developer ID, as decided in U-36)', /Signature=adhoc/.test(detail) && !/Authority=Developer ID/.test(detail), detail);
  const stapled = sh('xcrun', ['stapler', 'validate', app]);
  check('NOT notarized: no notarization ticket is stapled (so the release notes must say so)', stapled.status !== 0, stapled.stdout);
  const gate = sh('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  console.log(`      (Gatekeeper's verdict, recorded: ${(gate.stderr || gate.stdout).trim().split('\n')[0]})`);

  // The packaged app starts, and keeps its data where the host contract says, ignoring the debug-only override.
  const home = mkdtempSync(join(tmpdir(), 'unhlw-pkg-home-')), ignored = join(tmpdir(), `unhlw-pkg-ignored-${process.pid}`);
  const ran = await launch(exe, { HOME: home, UNHLW_DATA_ROOT: ignored });
  check('the packaged app starts and stays running', ran.stillRunning, `exited with ${ran.exited}`);
  const support = join(home, 'Library', 'Application Support');
  const made = existsSync(support) ? readdirSync(support) : [];
  check('each module gets its own data folder directly under Application Support (the release data root, shared with the standalone apps)', MODULE_FOLDERS.every(f => made.includes(f)), made.join(', '));
  check('the debug-only data override is ignored by the packaged app', !existsSync(ignored), ignored);
  const modes = MODULE_FOLDERS.filter(f => existsSync(join(support, f))).map(f => (statSync(join(support, f)).mode & 0o777).toString(8));
  check('module data folders are owner-only (0700)', modes.length === 3 && modes.every(m => m === '700'), modes.join(' '));
  rmSync(home, { recursive: true, force: true });

  // The disk image.
  const dmgDir = join(bundleRoot, 'dmg');
  const dmg = existsSync(dmgDir) ? join(dmgDir, readdirSync(dmgDir).find(n => n.endsWith('.dmg')) ?? '') : '';
  check('the .dmg exists', dmg.endsWith('.dmg') && existsSync(dmg), dmgDir);
  if (dmg.endsWith('.dmg') && existsSync(dmg)) {
    const verifyDmg = sh('hdiutil', ['verify', dmg]);
    check('the .dmg verifies (hdiutil verify)', verifyDmg.status === 0, verifyDmg.stderr);
    const mount = mkdtempSync(join(tmpdir(), 'unhlw-pkg-mount-'));
    const attach = sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, dmg]);
    const listing = attach.status === 0 ? readdirSync(mount) : [];
    check('the .dmg contains the app and an Applications shortcut', listing.some(n => n.endsWith('.app')) && listing.includes('Applications'), `${attach.stderr}\n${listing.join(', ')}`);
    sh('hdiutil', ['detach', mount, '-force']); rmSync(mount, { recursive: true, force: true });
  }
}

async function windows() {
  const nsisDir = join(bundleRoot, 'nsis'), msiDir = join(bundleRoot, 'msi');
  const nsis = existsSync(nsisDir) ? join(nsisDir, readdirSync(nsisDir).find(n => n.endsWith('-setup.exe')) ?? '') : '';
  const msi = existsSync(msiDir) ? join(msiDir, readdirSync(msiDir).find(n => n.endsWith('.msi')) ?? '') : '';
  check('the NSIS installer exists', nsis.endsWith('.exe') && existsSync(nsis), nsisDir);
  check('the MSI installer exists', msi.endsWith('.msi') && existsSync(msi), msiDir);
  const version = conf.version;
  check('installer file names carry the product name and version', basename(nsis).includes(version) && basename(nsis).startsWith(conf.productName), basename(nsis));
  const signature = sh('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature '${nsis}').Status`]);
  check('NOT code-signed (as decided in U-36; the release notes must say so)', /NotSigned/.test(signature.stdout), signature.stdout);

  if (!nsis.endsWith('.exe') || !existsSync(nsis)) return;
  // The installer writes to the real user profile (NSIS and Windows ignore overridden environment variables), so installing and
  // uninstalling is done only on a disposable machine: a CI runner, or when asked for with --allow-real-install.
  if (process.env.CI !== 'true' && !process.argv.includes('--allow-real-install')) {
    console.log('SKIP  install, start and uninstall (they would touch this user\'s real profile; run in CI or pass --allow-real-install on a disposable machine)');
    return;
  }
  const until = async (test, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(1000); } return test(); };
  const local = process.env.LOCALAPPDATA, roamingRoot = process.env.APPDATA;
  const exeCandidates = [join(local, conf.productName, 'unhollowed.exe'), join(local, 'Programs', conf.productName, 'unhollowed.exe')];
  check('nothing is installed yet', !exeCandidates.some(existsSync), exeCandidates.join('\n'));
  const install = sh(nsis, ['/S']);
  const found = await until(() => exeCandidates.some(existsSync));
  const exe = exeCandidates.find(existsSync);
  check('silent per-user install puts the app under the user profile (no administrator needed)', found && !!exe, `${install.stderr}\n${exeCandidates.join('\n')}`);
  if (!exe) return;
  const installDir = dirname(exe);
  // Data that already exists (as if the standalone apps had been used) must survive everything below.
  const existed = MODULE_FOLDERS.map(f => existsSync(join(roamingRoot, f)));
  const sentinel = MODULE_FOLDERS.map(f => { const dir = join(roamingRoot, f); mkdirSync(dir, { recursive: true }); const file = join(dir, 'sentinel.txt'); writeFileSync(file, 'kept'); return file; });
  check('the third-party notices were installed beside the program', existsSync(join(installDir, 'THIRD-PARTY-NOTICES.txt')), installDir);
  const ran = await launch(exe, {});
  check('the installed app starts and stays running', ran.stillRunning, `exited with ${ran.exited}`);
  const roaming = readdirSync(roamingRoot);
  check('each module gets its own data folder directly under the roaming profile (the release data root, shared with the standalone apps)', MODULE_FOLDERS.every(f => roaming.includes(f)), roaming.join(', '));
  const uninstaller = join(installDir, 'uninstall.exe');
  check('the installer left an uninstaller', existsSync(uninstaller), installDir);
  if (existsSync(uninstaller)) {
    sh(uninstaller, ['/S']);
    const gone = await until(() => !existsSync(exe));
    check('uninstalling removes the program files', gone, installDir);
    check('uninstalling leaves every module\'s data alone (shared with the standalone apps)', sentinel.every(existsSync), sentinel.filter(f => !existsSync(f)).join('\n'));
  }
  // leave nothing behind on a machine that was not disposable after all
  sentinel.forEach(f => rmSync(f, { force: true }));
  MODULE_FOLDERS.forEach((f, i) => { if (!existed[i]) rmSync(join(roamingRoot, f), { recursive: true, force: true }); });
}

if (process.platform === 'darwin') await macos();
else if (process.platform === 'win32') await windows();
else { console.error('Verification runs on macOS or Windows only.'); process.exit(1); }
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
