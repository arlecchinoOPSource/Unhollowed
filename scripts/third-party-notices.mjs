// Writes THIRD-PARTY-NOTICES.txt: every third-party package that ships in the app, with its licence and the licence text found in
// the package itself (docs/REVIEW-U28.md). Covers the Rust crates in the host build (normal dependencies only) and the npm packages
// that end up in the host page and in each module's bundle (production dependencies, followed transitively).
//
//   node scripts/third-party-notices.mjs           writes THIRD-PARTY-NOTICES.txt and prints a summary
//   node scripts/third-party-notices.mjs --check   fails if the committed file is out of date
//
// Needs the pinned modules built first (`node scripts/build-modules.mjs`) so that their node_modules exist. Exits non-zero when a
// shipped package has no licence text or a licence that needs a decision (anything that is not on the permissive list below).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'THIRD-PARTY-NOTICES.txt');
const PERMISSIVE = /^(MIT|MIT-0|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|Zlib|Unlicense|CC0-1\.0|Unicode-3\.0|Unicode-DFS-2016|0BSD|BSL-1\.0|OFL-1\.1|Python-2\.0|CC-BY-3\.0|BlueOak-1\.0\.0)$/;
/** Licences that are accepted but worth a line in the summary: weak, file-level copyleft (fine unmodified, source stays available). */
const NOTE = /^(MPL-2\.0)$/;
const licenceFile = /^(licen[sc]e|copying|unlicense|notice)(\.|-|$)/i;

export function spdxParts(expr) { return String(expr || '').replace(/[()]/g, ' ').split(/\s+(?:OR|AND|WITH)\s+|\s*\/\s*/).map(s => s.trim()).filter(Boolean); }
/** An expression is acceptable when at least one alternative of every OR group is permissive (we may choose it); AND needs all. */
export function acceptable(expr) {
  const text = String(expr || '').trim();
  if (!text) return false;
  return text.split(/\s+AND\s+/).every(group => group.replace(/[()]/g, ' ').split(/\s+OR\s+|\s*\/\s*/).map(s => s.trim()).filter(Boolean).some(id => PERMISSIVE.test(id) || NOTE.test(id)));
}

function textOf(dir) {
  if (!dir || !existsSync(dir)) return '';
  const files = readdirSync(dir).filter(n => licenceFile.test(n)).sort();
  // Line endings are normalised: some crates ship CRLF texts, and Git (and Windows checkouts) rewrite line endings, so the file and the check must not depend on them.
  return files.map(n => { try { return readFileSync(join(dir, n), 'utf8').replace(/\r\n?/g, '\n').trim(); } catch { return ''; } }).filter(Boolean).join('\n\n');
}

function rust() {
  const meta = JSON.parse(spawnSync('cargo', ['metadata', '--format-version', '1', '--locked'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
  const dirs = new Map(meta.packages.map(p => [`${p.name}@${p.version}`, { dir: dirname(p.manifest_path), license: p.license, repository: p.repository, source: p.source }]));
  // Only what ships: the macOS (both architectures) and Windows builds, not Linux, Android or iOS crates, and not proc-macro crates (they
  // run at build time and their host-dependent dependencies would make the list differ between the machines that generate it).
  const tree = ['aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc'].map(target => spawnSync('cargo', ['tree', '-p', 'unhollowed', '-e', 'normal,no-proc-macro', '--target', target, '--prefix', 'none', '--format', '{p}', '--locked'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout).join('\n');
  const seen = new Map();
  for (const line of tree.split('\n')) {
    const m = /^(\S+) v(\S+)/.exec(line.replace(/ \(\*\)$/, ''));
    if (!m) continue;
    const info = dirs.get(`${m[1]}@${m[2]}`);
    if (!info || !info.source) continue; // path crates are this project's own code
    seen.set(`${m[1]}@${m[2]}`, { kind: 'rust', name: m[1], version: m[2], license: info.license, repository: info.repository, text: textOf(info.dir) });
  }
  return [...seen.values()];
}

function resolvePackage(from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return null;
  }
}
function npm() {
  const roots = [['host', root], ['terminal', join(root, '.modules/terminal')], ['ember', join(root, '.modules/ember/desktop')], ['swish', join(root, '.modules/swish')]];
  const seen = new Map();
  const walk = (dir, name, from) => {
    const found = resolvePackage(from, name);
    if (!found) return;
    const pkg = JSON.parse(readFileSync(join(found, 'package.json'), 'utf8'));
    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) return;
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (pkg.licenses ?? []).map(l => l.type).join(' OR ');
    seen.set(key, { kind: 'npm', name: pkg.name, version: pkg.version, license, repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url, text: textOf(found) });
    // optional dependencies are platform-specific native add-ons of build tools; they are not part of what ships and would make the list machine-dependent
    for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dir, dep, found);
  };
  for (const [, dir] of roots) {
    const pkgPath = join(dir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) walk(dir, dep, dir);
  }
  return [...seen.values()];
}

export function build() {
  const all = [...npm(), ...rust()].filter(p => !p.name.startsWith('@arlecchino/') && p.name !== 'unhollowed').sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const problems = [];
  // Some crates do not carry their licence text in the published package (it lives in their workspace root). For those, the standard
  // text of an Apache-2.0 or MPL-2.0 alternative is taken from another package that has it (neither text has a per-author line); for
  // MIT/BSD-style licences, which do name a copyright holder, the notice points to the source repository instead of inventing one.
  const standard = {
    'Apache-2.0': all.find(p => /Apache License\s+Version 2\.0/.test(p.text))?.text,
    'MPL-2.0': all.find(p => /Mozilla Public License Version 2\.0/.test(p.text))?.text,
  };
  for (const p of all) {
    if (!acceptable(p.license)) problems.push(`${p.kind} ${p.name}@${p.version}: licence "${p.license || '(none declared)'}" needs a decision`);
    if (!p.text) {
      const ids = spdxParts(p.license);
      const id = ids.find(i => standard[i] && (i === 'MPL-2.0' || ids.length > 0));
      if (id && standard[id]) { p.text = `${standard[id]}\n\n(The published package does not include its own licence file; this is the standard text of ${id}. See the source repository above.)`; p.fallback = true; }
      else { p.text = `(The published package does not include its licence file. Declared licence: ${p.license}. See the source repository above for the text and the copyright holder.)`; p.fallback = true; }
    }
  }
  // Credits that are not packages: sounds and fonts that Terminal, Ember and Swish bundle (their own records are in each app's
  // docs: Terminal docs/AUDIO-ASSETS-v2.0.md, Ember packages/suite-ui/LICENSES.md and AUDIO-PROVENANCE.md).
  const credits = [
    'Sounds in Terminal: key sounds "Clicky": Copyright 2012 eklee (freesound.org/people/eklee) and Copyright 2012 qubodup (freesound.org/people/qubodup), extraction of single sounds, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Modified for Terminal: trimmed and levelled.',
    'Sounds in Terminal: key sounds "Thock": Keyboard Soundpack #1 by unicaegames (opengameart.org/node/122745), CC0. Interface clicks by Kenney (kenney.nl), CC0.',
    'Sounds in Terminal, Ember and Swish: startup, close, interface, completion and error sounds are original recordings and cues by Arlecchino.',
    'Fonts: IBM Plex Mono, IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Serif, Literata and Orbitron are bundled under the SIL Open Font License 1.1; their licence texts are included below with the @fontsource packages.',
  ];
  const header = `THIRD-PARTY NOTICES\n\nUnhollowed includes the open-source packages below. Each is listed with its licence and the licence text shipped with it.\nTerminal, Ember and Swish are Arlecchino's own applications and keep their own notices (including the audio and font credits in their settings).\nGenerated by scripts/third-party-notices.mjs; do not edit by hand.\n\nOTHER CREDITS\n\n${credits.map(c => `- ${c}`).join('\n')}\n\n${all.length} packages\n`;
  const body = all.map(p => `\n${'='.repeat(78)}\n${p.name} ${p.version}  (${p.kind})\nLicense: ${p.license || '(not declared)'}${p.repository ? `\nSource: ${String(p.repository).replace(/^git\+/, '')}` : ''}\n${'-'.repeat(78)}\n${p.text || '(no licence text found in the package)'}\n`).join('');
  return { all, problems, text: header + body };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { all, problems, text } = build();
  const byLicence = {};
  for (const p of all) byLicence[p.license || '(none)'] = (byLicence[p.license || '(none)'] ?? 0) + 1;
  console.log(`${all.length} third-party packages (${all.filter(p => p.kind === 'npm').length} npm, ${all.filter(p => p.kind === 'rust').length} Rust)`);
  console.log(Object.entries(byLicence).sort((a, b) => b[1] - a[1]).map(([l, n]) => `  ${String(n).padStart(4)}  ${l}`).join('\n'));
  const fallbacks = all.filter(p => p.fallback);
  if (fallbacks.length) console.log(`\n${fallbacks.length} packages ship no licence file of their own (standard text or a pointer to the source was used): ${fallbacks.map(p => p.name).join(', ')}`);
  if (problems.length) console.log(`\n${problems.length} to look at:\n  ${problems.join('\n  ')}`);
  if (process.argv.includes('--check')) {
    const same = existsSync(outFile) && readFileSync(outFile, 'utf8').replace(/\r\n?/g, '\n') === text;
    console.log(same ? '\nTHIRD-PARTY-NOTICES.txt is up to date.' : '\nTHIRD-PARTY-NOTICES.txt is out of date: run node scripts/third-party-notices.mjs');
    process.exit(same && problems.length === 0 ? 0 : 1);
  }
  writeFileSync(outFile, text);
  console.log(`\nWrote ${outFile} (${(text.length / 1024).toFixed(0)} KB)`);
  process.exit(problems.length ? 1 : 0);
}
