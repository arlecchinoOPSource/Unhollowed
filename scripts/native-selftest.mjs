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

const swish = results.slice ?? {};
const terminal = results.terminal ?? {};
const layout = results.layout ?? {};
const close = results.close_handshake ?? {};
const prefixed = module => module.all_calls_prefixed === true;
const keys = module => new Set(module.local_storage_keys ?? []);
const sharedKeys = [...keys(swish)].filter(key => keys(terminal).has(key));
const checks = {
  'exit code 0': code === 0,
  'Swish rendered in the iframe': swish.root_rendered === true && swish.startup_finished === true,
  'Terminal rendered in the iframe': terminal.root_rendered === true && terminal.startup_finished === true,
  'shim installed and isTauri set (both)': [swish, terminal].every(m => m.shim_installed === true && m.isTauri_in_frame === true),
  'Swish: project created through the real UI': swish.project_visible_in_swish_ui === true,
  'Swish: project stored through the plugin': swish.project_stored_via_plugin === true,
  'Swish: name field focused after the dialog opens': swish.focus_on_project_name_after_open === true,
  'Terminal: storage opened': terminal.storage_opened === true,
  'Terminal: text typed into the editor': terminal.body_text_typed === true,
  'Terminal: entry saved (UI says Saved)': terminal.entry_saved_in_terminal_ui === true,
  'Terminal: entry stored through the plugin': terminal.entry_stored_via_plugin === true,
  'every command was routed to its plugin (both)': prefixed(swish) && prefixed(terminal),
  'iframe themes independent of the host': swish.frame_theme !== swish.host_theme && terminal.frame_theme !== terminal.host_theme,
  'no localStorage key shared by the two modules (informational: both were empty at that point)': sharedKeys.length === 0,
  'close handshake: both modules flushed before exit': close.timed_out === false && ['swish', 'terminal'].every(m => (close.active_modules ?? []).includes(m)),
  'database files written in the throwaway root': close.swish_database_exists === true && close.swish_database_bytes > 0 && close.terminal_database_exists === true && close.terminal_database_bytes > 0,
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
console.log(`Recorded, not asserted: frame widths after resizing to 800 px: ${JSON.stringify(layout.frame_widths_after_resize)} (host ${layout.host_width}); AudioContext without a gesture: swish ${swish.audio_context_state_without_gesture}, terminal ${terminal.audio_context_state_without_gesture}; localStorage keys: swish ${JSON.stringify(swish.local_storage_keys)}, terminal ${JSON.stringify(terminal.local_storage_keys)}`);
process.exit(failed ? 1 : 0);
