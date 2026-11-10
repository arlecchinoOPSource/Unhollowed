// Runs the debug build of Unhollowed against a throwaway data root, lets the host page drive the
// embedded Swish UI, and checks the JSON it reports. Opens a window for about 20 seconds.
// Needs `npm run build:modules` and a debug build first (see README).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'target', 'debug', process.platform === 'win32' ? 'unhollowed.exe' : 'unhollowed');
if (!existsSync(bin)) { console.error(`Build first: npm run build:web && cargo build -p unhollowed --features custom-protocol (missing ${bin})`); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), 'unhlw-selftest-'));
const outFile = join(dir, 'results.json');
const dataRoot = join(dir, 'data');
const child = spawn(bin, [], { env: { ...process.env, UNHLW_SELFTEST_OUT: outFile, UNHLW_DATA_ROOT: dataRoot }, stdio: 'inherit' });
const timer = setTimeout(() => { console.error('Timed out after 90 s'); child.kill(); }, 90000);
const code = await new Promise(done => child.on('exit', done));
clearTimeout(timer);

const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(results, null, 2));

const slice = results.slice ?? {};
const close = results.close_handshake ?? {};
const checks = {
  'exit code 0': code === 0,
  'Swish rendered in the iframe': slice.root_rendered === true,
  'startup screen finished': slice.startup_finished === true,
  'shim installed and isTauri set': slice.shim_installed === true && slice.isTauri_in_frame === true,
  'project created through the real UI': slice.project_visible_in_swish_ui === true,
  'project stored through the plugin': slice.project_stored_via_plugin === true,
  'name field focused after the dialog opens': slice.focus_on_project_name_after_open === true,
  'every command was routed to plugin:swish': slice.all_calls_prefixed === true,
  'iframe theme independent of host': slice.frame_theme !== slice.host_theme,
  'close handshake: swish flushed before exit': close.timed_out === false && (close.active_modules ?? []).includes('swish'),
  'database file written in the throwaway root': close.swish_database_exists === true && close.swish_database_bytes > 0,
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
console.log(`Recorded, not asserted: resize ${slice.frame_width_after_resize}px in frame / ${slice.window_width_after_resize}px in host; AudioContext without a gesture: ${slice.audio_context_state_without_gesture}`);
process.exit(failed ? 1 : 0);
