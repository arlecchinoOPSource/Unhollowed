// Runs the debug build of Unhollowed against a throwaway data root, lets the host page drive the
// embedded Swish UI, and checks the JSON it reports. Opens a window for about 20 seconds.
// Needs `npm run build:modules` and a debug build first (see README).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

// Phase 2 (U-14, docs/DATA-SAFETY-U14.md): start the host again on the same synthetic data, but tell it (debug builds only)
// that every module now writes schema 2, so each existing file looks one version old. No module may be opened until the person
// confirms. The page then runs a scripted scenario through the real confirmation dialog: Terminal is declined (it must stay
// closed and its file untouched), Ember is confirmed in the dialog, Swish through the command; each confirmed module gets one
// verified copy first. This phase needs no window driving from here: the host closes itself when the scenario ends.
const modules = { terminal: ['com.arlecchino.terminal', 'journal.sqlite3', 'entries'], ember: ['com.arlecchino.ember', 'ember.sqlite3', 'habits'], swish: ['com.arlecchino.swish', 'swish.sqlite3', 'projects'] };
const backupsOf = name => { const folder = join(dataRoot, modules[name][0], 'backups'); return existsSync(folder) && statSync(folder).isDirectory() ? readdirSync(folder).filter(f => f.startsWith('before-migrate-v1-to-v2-') && f.endsWith('.sqlite3')).map(f => join(folder, f)) : []; };
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const safety = {};
let migration = {};
if (code === 0) {
  const terminalFile = join(dataRoot, modules.terminal[0], modules.terminal[1]);
  const terminalBefore = sha(terminalFile);
  // Make Terminal's backup location unusable (a file where the folder must go), so confirming its upgrade cannot get a safety copy.
  writeFileSync(join(dataRoot, modules.terminal[0], 'backups'), 'in the way', { mode: 0o600 });
  const out2 = join(dir, 'results-migration.json');
  const second = spawn(bin, [], { env: { ...process.env, UNHLW_DATA_ROOT: dataRoot, UNHLW_TEST_SCHEMA_VERSION: '2', UNHLW_SELFTEST_OUT: out2, UNHLW_SELFTEST_SCENARIO: 'migration' }, stdio: 'inherit' });
  const timer2 = setTimeout(() => { console.error('Migration phase timed out after 90 s'); second.kill(); }, 90000);
  safety.exit_code = await new Promise(done => second.on('exit', done));
  clearTimeout(timer2);
  migration = existsSync(out2) ? (JSON.parse(readFileSync(out2, 'utf8')).migration ?? {}) : {};
  const read = (path, sql) => { const db = new DatabaseSync(path, { readOnly: true }); try { return db.prepare(sql).get(); } finally { db.close(); } };
  for (const [name, [folder, file, table]] of Object.entries(modules)) {
    const copies = backupsOf(name);
    safety[name] = { copies: copies.length };
    if (copies.length === 1) {
      const original = join(dataRoot, folder, file);
      safety[name].copy_integrity = read(copies[0], 'PRAGMA integrity_check').integrity_check;
      safety[name].copy_version = read(copies[0], 'PRAGMA user_version').user_version;
      safety[name].copy_rows = read(copies[0], `SELECT count(*) AS n FROM ${table}`).n;
      safety[name].original_version = read(original, 'PRAGMA user_version').user_version;
      safety[name].original_rows = read(original, `SELECT count(*) AS n FROM ${table}`).n;
    }
  }
  safety.terminal.file_untouched = sha(terminalFile) === terminalBefore;
}
const verified = name => { const m = safety[name] ?? {}; return m.copies === 1 && m.copy_integrity === 'ok' && m.copy_version === 1 && m.copy_rows >= 1 && m.original_version === 1 && m.original_rows === m.copy_rows; };
const drop = new Set();

// Privacy (docs/DATA-AUDIT-U12.md F1): every module's data folder and everything in it, including the -wal/-shm files and the
// host's backups, must be unreadable by other users. Unix modes only; Windows profile folders are per-user already.
const exposed = [];
if (process.platform !== 'win32' && existsSync(dataRoot)) {
  const walk = path => { for (const entry of [path, ...(statSync(path).isDirectory() ? readdirSync(path).flatMap(n => walk(join(path, n))) : [])]) if (!exposed.includes(entry) && (statSync(entry).mode & 0o077) !== 0) exposed.push(entry); return []; };
  for (const [folder] of Object.values(modules)) if (existsSync(join(dataRoot, folder))) walk(join(dataRoot, folder));
}
const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : {};
rmSync(dir, { recursive: true, force: true });
results.data_safety = safety;
results.migration = migration;
results.group_or_world_accessible = exposed.map(p => p.replace(dataRoot, '<root>'));
console.log(JSON.stringify(results, null, 2));

const swish = results.slice ?? {};
const terminal = results.terminal ?? {};
const ember = results.ember ?? {};
const layout = results.layout ?? {};
const life = results.lifecycle ?? {};
const close = results.close_handshake ?? {};
const prefixed = module => module.all_calls_prefixed === true;
const keys = module => new Set(module.local_storage_keys ?? []);
const sharedKeys = [...keys(swish)].filter(key => keys(terminal).has(key) || keys(ember).has(key));
const filled = (layout.frame_heights_after_resize ?? []).length === 3 && layout.stage_bottom >= layout.host_height - 2 && layout.frame_heights_after_resize.every(h => h >= layout.stage_height * 0.95) && layout.stage_height >= layout.host_height * 0.7;
const checks = {
  'exit code 0': code === 0,
  'the modules fill the window (no black band below them)': filled,
  'Swish rendered in the iframe': swish.root_rendered === true && swish.startup_finished === true,
  'Terminal rendered in the iframe': terminal.root_rendered === true && terminal.startup_finished === true,
  'Ember rendered in the iframe': ember.root_rendered === true && ember.startup_finished === true,
  'shim installed and isTauri set (all)': [swish, terminal, ember].every(m => m.shim_installed === true && m.isTauri_in_frame === true),
  'Swish: project created through the real UI': swish.project_visible_in_swish_ui === true,
  'Swish: project stored through the plugin': swish.project_stored_via_plugin === true,
  'Swish: backup/restore commands routed, undo refused when nothing was restored': swish.backup_commands_routed === true && swish.undo_without_restore_refused === true,
  'Swish: name field focused after the dialog opens': swish.focus_on_project_name_after_open === true,
  'Terminal: storage opened': terminal.storage_opened === true,
  'Terminal: text typed into the editor': terminal.body_text_typed === true,
  'Terminal: entry saved (UI says Saved)': terminal.entry_saved_in_terminal_ui === true,
  'Terminal: entry stored through the plugin': terminal.entry_stored_via_plugin === true,
  'Ember: habit created through the real UI': ember.habit_visible_in_ember_ui === true,
  'Ember: habit stored through the plugin': ember.habit_stored_via_plugin === true,
  'U-11: switching modules keeps the frame, its page state and its running timer': life.same_frame_after_navigation === true && life.page_state_kept_in_background === true && life.timer_kept_running_in_background === true,
  'U-11: a background module cannot take focus; the module in front can': life.background_focus_blocked === true && life.front_focus_allowed === true && life.front_is_terminal === true,
  'U-11: power-off saved first, removed only that frame, and was refused when repeated': life.ember_confirmed_save === true && life.ember_frame_removed === true && life.others_untouched === true && life.power_off_again_is_refused === true,
  'U-11: a power-on is a new frame, and the habit survived the power cycle': life.new_frame_after_power_on === true && life.habit_survived_power_cycle === true && life.ok === true,
  'every command was routed to its plugin (all)': prefixed(swish) && prefixed(terminal) && prefixed(ember),
  'iframe themes independent of the host': swish.frame_theme !== swish.host_theme && terminal.frame_theme !== terminal.host_theme && ember.frame_theme !== ember.host_theme,
  'no localStorage key shared by the modules (informational: they may have been empty at that point)': sharedKeys.length === 0,
  'close handshake: all modules flushed before exit': close.timed_out === false && ['swish', 'terminal', 'ember'].every(m => (close.active_modules ?? []).includes(m)),
  'U-14: with older files, no module opened or changed anything at start, and the dialog explained the upgrade': migration.start_states?.every(state => state === 'needsConfirmation') === true && migration.no_frames_at_start === true && migration.commands_absent_before?.every(Boolean) === true && migration.dialog_explains === true,
  'U-14: declining, and a confirm whose safety copy could not be made, both left that module closed, with an honest error and its file untouched': migration.declined_stays_closed === true && migration.failed_copy_refused === true && migration.still_closed_after_failed_copy === true && safety.terminal?.copies === 0 && safety.terminal?.file_untouched === true,
  'U-14: confirming made one verified copy first and opened the module (dialog for Ember, command for Swish); originals intact': migration.ember_ready === true && migration.swish_ready === true && verified('ember') && verified('swish'),
  'U-14: a second confirm is refused, and only confirmed modules produced a notice': migration.repeat_confirm_refused === true && JSON.stringify(migration.notices_for) === JSON.stringify(['ember', 'swish']) && migration.ok === true && safety.exit_code === 0,
  'data folders and files are owner-only (no group or world access)': exposed.length === 0,
  'database files written in the throwaway root': close.swish_database_exists === true && close.swish_database_bytes > 0 && close.terminal_database_exists === true && close.terminal_database_bytes > 0 && close.ember_database_exists === true && close.ember_database_bytes > 0,
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; }
console.log(`Recorded, not asserted: frame widths after resizing to 800 px: ${JSON.stringify(layout.frame_widths_after_resize)}, heights ${JSON.stringify(layout.frame_heights_after_resize)} (host ${layout.host_width}x${layout.host_height}); AudioContext without a gesture: swish ${swish.audio_context_state_without_gesture}, terminal ${terminal.audio_context_state_without_gesture}, ember ${ember.audio_context_state_without_gesture}; localStorage keys: swish ${JSON.stringify(swish.local_storage_keys)}, terminal ${JSON.stringify(terminal.local_storage_keys)}, ember ${JSON.stringify(ember.local_storage_keys)}`);
process.exit(failed ? 1 : 0);
