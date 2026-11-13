import { invoke } from '@tauri-apps/api/core';
import type { ModuleName } from './modules';

/**
 * Debug-only native self-test (inert unless the native side reports it is enabled). Drives each embedded
 * module's real UI inside its iframe with synthetic data and reports what happened, so a native run can
 * check the slice without a person clicking (scripts/native-selftest.mjs). When every module has finished
 * it starts the same close sequence a user's close would.
 */
const started = new Set<ModuleName>();
const EXPECTED: ModuleName[] = ['terminal', 'ember', 'swish'];

type Unhlw = { module: string; calls: string[]; effective: boolean; hadOwnInternals: boolean; ownWritable: boolean | null; ownConfigurable: boolean | null; problem: string | null };
type Win = Window & typeof globalThis & { __unhlw?: Unhlw; AudioContext: typeof AudioContext };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(what: string, probe: () => T | null | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** Set a field the way React and ProseMirror notice it. */
function setValue(w: Win, el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
}

async function common(frame: HTMLIFrameElement, report: Record<string, unknown>) {
  const w = frame.contentWindow as Win;
  const d = frame.contentDocument!;
  report.shim_installed = !!w.__unhlw;
  report.shim_effective = w.__unhlw?.effective ?? null;
  report.shim_details = w.__unhlw ? { hadOwnInternals: w.__unhlw.hadOwnInternals, ownWritable: w.__unhlw.ownWritable, ownConfigurable: w.__unhlw.ownConfigurable, problem: w.__unhlw.problem } : null;
  // A missing module bundle makes the dev server answer with the host's own page, which would look like a
  // rendered module. Stop at once with a clear reason instead.
  if (!w.__unhlw) throw new Error('the shim is not installed in the module frame: the module bundle is missing or was not built for the host');
  report.isTauri_in_frame = (w as unknown as { isTauri?: boolean }).isTauri === true;
  report.root_rendered = !!(await until('module root content', () => d.getElementById('root')?.childElementCount));
  await until('startup screen to finish', () => !d.querySelector('.startup'), 20000);
  report.startup_finished = true;
  report.frame_theme = d.documentElement.dataset.theme ?? null;
  report.host_theme = document.documentElement.dataset.theme ?? null;
  return { w, d };
}

function tail(w: Win, report: Record<string, unknown>) {
  try {
    const context = new w.AudioContext();
    report.audio_context_state_without_gesture = context.state;
    void context.close();
  } catch (error) { report.audio_context_error = String(error); }
  const calls = w.__unhlw?.calls ?? [];
  report.ipc_calls_through_adapter = [...new Set(calls.map(call => call.split(' -> ')[0]))];
  report.all_calls_prefixed = calls.length > 0 && calls.every(call => call.split(' -> ')[1].startsWith('plugin:'));
  report.local_storage_keys = Object.keys(w.localStorage).sort();
}

async function swish(frame: HTMLIFrameElement, report: Record<string, unknown>) {
  const { w, d } = await common(frame, report);
  const button = (label: string) => [...d.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);

  (await until('New Project button', () => button('New Project'))).click();
  const name = await until('Project name field', () => d.querySelector<HTMLInputElement>('dialog[open] input[id$="-name"]'));
  report.focus_on_project_name_after_open = d.activeElement === name;
  setValue(w, name, 'Slice synthetic project');
  setValue(w, d.querySelector<HTMLInputElement>('dialog[open] input[type="date"]')!, '2026-12-31');
  (await until('Create project button', () => button('Create project'))).click();
  await until('created project heading', () => [...d.querySelectorAll('h2')].some(h => h.textContent === 'Slice synthetic project'));
  report.project_visible_in_swish_ui = true;

  // Read it back through the module's own command, the way the app would after a restart.
  const stored = JSON.stringify(await invoke('plugin:swish|load_workspace'));
  report.project_stored_via_plugin = stored.includes('Slice synthetic project');

  // Backup and restore open native file dialogs, which a test cannot drive. These two never open one: they prove the
  // commands are routed and permitted and that their state is managed by the plugin (nothing was restored, so undo has nothing to undo).
  try { await invoke('plugin:swish|cancel_restore'); report.backup_commands_routed = true; } catch (error) { report.backup_commands_routed = false; report.backup_error = String(error); }
  try { await invoke('plugin:swish|undo_restore'); report.undo_without_restore_refused = false; } catch (error) { report.undo_without_restore_refused = JSON.stringify(error).includes('no restore to undo'); }
  tail(w, report);
}

async function terminal(frame: HTMLIFrameElement, report: Record<string, unknown>) {
  const { w, d } = await common(frame, report);
  const title = await until('Entry title field', () => d.querySelector<HTMLInputElement>('input[aria-label="Entry title"]'));
  const body = await until('Journal body editor', () => d.querySelector<HTMLElement>('[aria-label="Journal body"]'));
  const status = () => d.getElementById('storage-status')?.textContent?.trim() ?? '';
  await until('storage to open', () => status() === 'Empty draft' || status() === 'Saved');
  report.storage_opened = true;

  setValue(w, title, 'Terminal synthetic entry');
  body.focus();
  d.execCommand('insertText', false, 'Synthetic terminal paragraph.');
  report.body_text_typed = (body.textContent ?? '').includes('Synthetic terminal paragraph.');
  await until('the entry to be saved', () => status() === 'Saved', 20000);
  report.entry_saved_in_terminal_ui = true;

  // Read it back through the module's own command.
  const listed = JSON.stringify(await invoke('plugin:terminal|journal_list'));
  report.entry_stored_via_plugin = listed.includes('Terminal synthetic entry');
  tail(w, report);
}

async function ember(frame: HTMLIFrameElement, report: Record<string, unknown>) {
  const { w, d } = await common(frame, report);
  const button = (label: string) => [...d.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);

  (await until('Add habit button', () => button('Add habit'))).click();
  const name = await until('Habit name field', () => d.querySelector<HTMLInputElement>('#new-habit-name'));
  setValue(w, name, 'Ember synthetic habit');
  (await until('Save habit button', () => button('Save habit'))).click();
  await until('created habit in the grid', () => [...d.querySelectorAll('.habit-name')].some(h => h.textContent === 'Ember synthetic habit'));
  report.habit_visible_in_ember_ui = true;

  // Read it back through the module's own command, the way the app would after a restart.
  const listed = JSON.stringify(await invoke('plugin:ember|habits_list'));
  report.habit_stored_via_plugin = listed.includes('Ember synthetic habit');
  tail(w, report);
}

/** Frames wait here until every expected module has loaded, then the probes run one module at a time. */
const frames = new Map<ModuleName, HTMLIFrameElement>();
let running: Promise<void> | null = null;

async function probe(name: ModuleName, frame: HTMLIFrameElement): Promise<void> {
  const report: Record<string, unknown> = {};
  try {
    await ({ swish, terminal, ember }[name])(frame, report);
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error);
    // Say what the module looked like when it failed, so a CI log is enough to diagnose it.
    try {
      const w = frame.contentWindow as Win;
      report.failure_page_text = (frame.contentDocument?.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400);
      report.failure_ipc_calls = w.__unhlw?.calls ?? [];
    } catch (inner) { report.failure_diagnostics_error = String(inner); }
  }
  // Swish keeps the report name it had before there was a second module.
  await invoke('selftest_report', { name: name === 'swish' ? 'slice' : name, data: report });
}

/** U-11 (docs/LIFECYCLE-U11.md): the focus rule, navigation without loss, and power-off that saves before removing. */
async function lifecycle(): Promise<void> {
  const report: Record<string, unknown> = {};
  const host = window.__unhlwHost!;
  const frameOf = (title: string) => document.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`);
  try {
    // 1. Navigation destroys nothing: a page variable and a running timer in a background module survive being
    //    in the background and coming back (an unmounted frame would lose both).
    const swishFrame = frameOf('Swish')!;
    const sw = swishFrame.contentWindow as Win & { __marker?: string; __ticks?: number };
    sw.__marker = 'kept'; sw.__ticks = 0;
    const timer = sw.setInterval(() => { sw.__ticks = (sw.__ticks ?? 0) + 1; }, 100);
    host.bringToFront('terminal');
    await sleep(100);
    host.bringToFront('ember');
    await sleep(600);
    report.same_frame_after_navigation = frameOf('Swish') === swishFrame && swishFrame.isConnected;
    report.page_state_kept_in_background = sw.__marker === 'kept';
    report.timer_kept_running_in_background = (sw.__ticks ?? 0) >= 4;
    sw.clearInterval(timer);

    // 2. Focus: with Ember in front, Terminal may not take the keyboard; once Terminal is in front, it may.
    const tFrame = frameOf('Terminal')!;
    const td = tFrame.contentDocument!;
    const field = td.querySelector<HTMLInputElement>('input[aria-label="Entry title"]')!;
    (td.activeElement as HTMLElement | null)?.blur();
    field.focus();
    report.background_focus_blocked = td.activeElement !== field;
    host.bringToFront('terminal');
    await sleep(150);
    (td.activeElement as HTMLElement | null)?.blur();
    field.focus();
    report.front_focus_allowed = td.activeElement === field;
    report.front_is_terminal = host.front() === 'terminal';

    // 3. Power-off: Ember saves first, only then is its frame removed; the others are untouched; a later power-on
    //    reads the habit back from the saved database.
    const oldEmber = frameOf('Ember')!;
    const result = await host.powerOff('ember');
    report.ember_confirmed_save = result?.flushed === true;
    await until('Ember frame removed', () => frameOf('Ember') === null, 5000).catch(() => undefined);
    report.ember_frame_removed = frameOf('Ember') === null && !oldEmber.isConnected;
    report.others_untouched = !!frameOf('Swish') && !!frameOf('Terminal')
      && [...frameOf('Swish')!.contentDocument!.querySelectorAll('h2')].some(h => h.textContent === 'Slice synthetic project');
    report.power_off_again_is_refused = (await host.powerOff('ember')) === null;
    host.powerOn('ember');
    const eFrame = await until('a new Ember frame', () => { const f = frameOf('Ember'); return f && f !== oldEmber ? f : null; });
    report.new_frame_after_power_on = eFrame !== oldEmber;
    const ed = await until('Ember document', () => eFrame.contentDocument?.getElementById('root')?.childElementCount ? eFrame.contentDocument : null, 20000);
    await until('Ember startup screen to finish', () => !ed.querySelector('.startup'), 20000);
    await until('saved habit in the reloaded Ember', () => [...ed.querySelectorAll('.habit-name')].some(h => h.textContent === 'Ember synthetic habit'), 20000);
    report.habit_survived_power_cycle = true;
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error);
  }
  await invoke('selftest_report', { name: 'lifecycle', data: report });
}

async function runAll(): Promise<void> {
  // One module at a time: a page has a single focused element, so a module that focuses itself while another
  // is being probed (Chromium and WebView2 blur the other frame's element) would change what the probe sees.
  for (const name of EXPECTED) {
    const frame = frames.get(name)!;
    // The frame being probed holds the page's focus; modules that autofocus at load have already settled.
    await until(`${name} startup screen to finish`, () => !frame.contentDocument?.querySelector('.startup'), 25000).catch(() => undefined);
    window.__unhlwHost?.bringToFront(name);
    frame.contentWindow?.focus();
    await probe(name, frame);
  }
  await lifecycle();
  // Resize last, with both modules mounted, and record what each frame saw.
  await invoke('selftest_resize', { width: 800, height: 600 });
  await sleep(600);
  const widths = [...document.querySelectorAll('iframe')].map(f => f.contentWindow?.innerWidth ?? null);
  const heights = [...document.querySelectorAll('iframe')].map(f => f.getBoundingClientRect().height);
  const stage = document.querySelector('.stage')!.getBoundingClientRect();
  // The rack (docs/RACK-U21-U23.md): states shown, real named buttons, fitted inside the window, one module visible at a time.
  const rackBox = document.querySelector('.rack')?.getBoundingClientRect();
  const rackKeys = [...document.querySelectorAll('.rack button')] as HTMLButtonElement[];
  const rack = {
    states: [...document.querySelectorAll('.rack-unit')].map(u => (u as HTMLElement).dataset.state),
    keys: rackKeys.length,
    keys_named: rackKeys.every(b => (b.getAttribute('aria-label') ?? '').length > 3),
    // WCAG 2.2 target size: probing around each key, the area that really hits that key is at least 24 x 24 px (it is bigger than the drawing)
    hit_24: rackKeys.every(b => { const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let dx = -20; dx <= 20; dx++) for (let dy = -20; dy <= 20; dy++) if (document.elementsFromPoint(cx + dx, cy + dy)[0] === b) { x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy); } return x1 - x0 >= 23 && y1 - y0 >= 23; }),
    box: rackBox ? [rackBox.left, rackBox.top, rackBox.right, rackBox.bottom, rackBox.width / rackBox.height] : null,
    fits_window: !!rackBox && rackBox.top >= 0 && rackBox.bottom <= window.innerHeight + 1 && rackBox.right <= window.innerWidth,
    visible_frames: [...document.querySelectorAll('.module-slot')].filter(slot => getComputedStyle(slot).visibility === 'visible').length,
    images_loaded: [...document.querySelectorAll('.rack img')].every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
  };
  // The hologram (docs/HOLOGRAM-U24.md): drawn, decorative, and never over the revealed interface.
  const overlay = document.querySelector('.holo') as HTMLElement | null;
  const beamCanvas = overlay?.querySelector('canvas') as HTMLCanvasElement | null;
  let beamPixels = 0;
  if (beamCanvas && beamCanvas.width > 0) { const px = beamCanvas.getContext('2d')!.getImageData(0, 0, beamCanvas.width, beamCanvas.height).data; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) beamPixels++; }
  const stageEl = document.querySelector('.stage') as HTMLElement;
  const holo = {
    overlay: !!overlay, aria_hidden: overlay?.getAttribute('aria-hidden') === 'true',
    pointer_none: !!overlay && [overlay, ...overlay.querySelectorAll('*')].every(e => getComputedStyle(e).pointerEvents === 'none'),
    beam_pixels: beamPixels, margin_px: parseFloat(getComputedStyle(stageEl).paddingTop),
    interface_unclipped: [...document.querySelectorAll('.module-slot')].filter(slot => getComputedStyle(slot).visibility === 'visible').every(slot => { const c = getComputedStyle(slot).clipPath; return c === 'none' || /inset\(0(px)? 0(px|%)? 0(px|%)? 0(px|%)?\)/.test(c); }),
  };
  // The rack sounds (docs/SOUND-U26.md): requested at the right moments, silent by default, safe when audio is locked, and the
  // settings dialog works from the keyboard. Whether anything is audible is a listening check, not something a test can prove.
  const hostSound = window.__unhlwHost?.sound;
  const asked = hostSound ? [...new Set(hostSound.log.map(entry => entry.cue))].sort() : [];
  const playedWhileOff = hostSound ? hostSound.log.filter(entry => entry.played).length : -1;
  let attempt = 'none';
  if (hostSound) { const before = hostSound.settings; hostSound.setSettings({ ...before, enabled: true }, false); try { hostSound.play('key-on'); attempt = hostSound.log.at(-1)?.reason ?? 'none'; } catch { attempt = 'threw'; } hostSound.setSettings(before, false); }
  const soundButton = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Sound…') as HTMLButtonElement | undefined;
  soundButton?.focus(); soundButton?.click(); await sleep(150);
  const dialog = document.querySelector('[role="dialog"].sound-dialog');
  const dialogFocus = (document.activeElement?.textContent ?? '').trim();
  const dialogControls = dialog ? dialog.querySelectorAll('input[type="checkbox"], input[type="range"], button').length : 0;
  dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(150);
  const soundUi = { dialog_opened: !!dialog, focus_starts_on_close: dialogFocus === 'Close', controls: dialogControls, escape_closes: !document.querySelector('[role="dialog"].sound-dialog'), focus_returned: document.activeElement === soundButton };
  await invoke('selftest_report', { name: 'layout', data: { sound: { asked, played_while_off: playedWhileOff, attempt_when_enabled: attempt, ui: soundUi }, holo, rack, front_frame_width: Math.max(...widths.map(w => w ?? 0)), host_width: window.innerWidth, host_height: window.innerHeight, frame_widths_after_resize: widths, frame_heights_after_resize: heights, stage_height: stage.height, stage_content_height: stage.height - parseFloat(getComputedStyle(stageEl).paddingTop) - parseFloat(getComputedStyle(stageEl).paddingBottom), stage_bottom: stage.bottom } });
  await invoke('selftest_finish');
}

export async function runSelfTest(name: ModuleName, frame: HTMLIFrameElement | null): Promise<void> {
  if (started.has(name) || !frame || !(await invoke<boolean>('selftest_enabled'))) return;
  started.add(name);
  frames.set(name, frame);
  if (EXPECTED.every(module => frames.has(module)) && !running) running = runAll();
  await running;
}

/**
 * Phase 4 (docs/CHANGE-NOTICE-U15.md): Swish is powered on and left alone: no notice may appear while nothing else touches its
 * file. Then the runner writes to Swish's file from another process, and the page must offer a reload, which saves, removes
 * the frame and opens a fresh one. (A module's own write being classed as its own is covered by unit tests of the rule and
 * of the adapter's stamping; this scenario cannot make Swish write without driving its UI.)
 */
export async function runExternalScenario(): Promise<void> {
  const report: Record<string, unknown> = {};
  const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  const banner = () => document.querySelector('.notice.changed');
  try {
    (await until('Swish power-on button', () => document.querySelector<HTMLButtonElement>('button[aria-label="Power on Swish"]'))).click();
    const first = await until('the Swish frame', () => document.querySelector('iframe[title="Swish"]'), 20000);
    await sleep(8000); // the runner starts writing only after this
    report.quiet_without_changes = !banner() && ((window as Window).__unhlwChangeLog ?? []).length === 0;
    const shown = await until('the changed-elsewhere notice', banner, 45000);
    report.notice_names_module = /Swish/.test(shown.textContent ?? '') && /another program/.test(shown.textContent ?? '');
    (await until('Reload Swish', () => button('Reload Swish'))).click();
    const fresh = await until('a new Swish frame', () => { const f = document.querySelector('iframe[title="Swish"]'); return f && f !== first ? f : null; }, 20000);
    report.reload_made_a_new_frame = !!fresh;
    report.notice_gone_after_reload = !banner();
    report.ok = true;
  } catch (error) { report.ok = false; report.error = String(error); }
  await invoke('selftest_report', { name: 'external', data: report });
  await invoke('selftest_finish');
}

/** Phase 3: the host was started with a restore scheduled; it must have been applied before Ember opened. */
export async function runRestoreScenario(): Promise<void> {
  const report: Record<string, unknown> = {};
  try {
    report.notices = (await invoke<{ module: string; message: string }[]>('host_data_notices')).map(n => `${n.module}: ${n.message}`);
    report.pending = (await invoke<{ pending: string | null }>('host_list_backups', { module: 'ember' })).pending;
    report.ember_opens = !(await invoke('plugin:ember|habits_list').then(() => false, () => true));
    report.ok = true;
  } catch (error) { report.ok = false; report.error = String(error); }
  await invoke('selftest_report', { name: 'restore', data: report });
  await invoke('selftest_finish');
}

/**
 * U-14 scenario (docs/DATA-SAFETY-U14.md). The host was started on existing data with a debug-only override that makes
 * every file look one version old, so no module is open yet. This drives the real page: declining leaves a module closed and
 * untouched, confirming through the dialog (or the command) makes the verified copy and opens it, and a confirmed module works.
 */
export async function runMigrationScenario(): Promise<void> {
  const report: Record<string, unknown> = {};
  const status = async (module: string) => (await invoke<{ state: string }>('host_module_status', { module })).state;
  const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  const dialog = () => document.querySelector('[role="alertdialog"]');
  const frame = (title: string) => document.querySelector(`iframe[title="${title}"]`);
  const refused = (command: string) => invoke(command).then(() => false, () => true);
  try {
    report.start_states = [await status('terminal'), await status('ember'), await status('swish')];
    report.no_frames_at_start = document.querySelectorAll('iframe').length === 0;
    report.commands_absent_before = await Promise.all(['plugin:swish|load_workspace', 'plugin:terminal|journal_list', 'plugin:ember|habits_list'].map(refused));

    // Terminal: ask, read the dialog, decline.
    (await until('Terminal power-on button', () => document.querySelector<HTMLButtonElement>('button[aria-label="Power on Terminal"]'))).click();
    const asked = await until('the upgrade dialog', dialog);
    const text = asked.textContent ?? '';
    report.dialog_explains = /Terminal/.test(text) && /schema 1/.test(text) && /schema 2/.test(text) && /verified copy/.test(text) && /refuse/.test(text);
    (await until('Not now', () => button('Not now'))).click();
    await until('the dialog to close', () => !dialog());
    report.declined_stays_closed = (await status('terminal')) === 'needsConfirmation' && !frame('Terminal') && await refused('plugin:terminal|journal_list');

    // A confirm whose verified copy cannot be made (the runner made Terminal's backup location unusable): an honest error,
    // nothing opened, nothing changed, and it is still waiting.
    report.failed_copy_refused = await invoke('host_confirm_migration', { module: 'terminal' }).then(() => false, error => /safety copy could not be made/.test(String(error)) && /Nothing was changed/.test(String(error)));
    report.still_closed_after_failed_copy = (await status('terminal')) === 'needsConfirmation' && await refused('plugin:terminal|journal_list') && !frame('Terminal');

    // Ember: confirm in the real dialog; it makes the copy, opens, and powers on.
    (await until('Ember power-on button', () => document.querySelector<HTMLButtonElement>('button[aria-label="Power on Ember"]'))).click();
    await until('the upgrade dialog', dialog);
    (await until('Back up and upgrade', () => button('Back up and upgrade'))).click();
    await until('the Ember frame', () => frame('Ember'), 20000);
    report.ember_ready = (await status('ember')) === 'ready' && !(await refused('plugin:ember|habits_list'));

    // Swish: confirm through the command; its commands exist afterwards.
    await invoke('host_confirm_migration', { module: 'swish' });
    report.swish_ready = (await status('swish')) === 'ready' && !(await refused('plugin:swish|load_workspace'));

    // Restore (docs/DATA-SAFETY-U14.md): the confirmed upgrade left one copy; it can be scheduled (nothing replaced now),
    // paths and unknown files are refused, and a schedule can be cancelled.
    const listed = await invoke<{ backups: { file: string; kind: string }[]; pending: string | null }>('host_list_backups', { module: 'ember' });
    report.backup_listed = listed.backups.length === 1 && listed.backups[0].kind === 'upgrade' && listed.pending === null;
    report.restore_bad_names_refused = (await Promise.all(['../ember.sqlite3', 'nope.sqlite3'].map(file => invoke('host_schedule_restore', { module: 'ember', file }).then(() => false, () => true)))).every(Boolean);
    await invoke('host_schedule_restore', { module: 'ember', file: listed.backups[0].file });
    const scheduled = (await invoke<{ pending: string | null }>('host_list_backups', { module: 'ember' })).pending;
    await invoke('host_cancel_restore', { module: 'ember' });
    report.restore_schedule_roundtrip = scheduled === listed.backups[0].file && (await invoke<{ pending: string | null }>('host_list_backups', { module: 'ember' })).pending === null;

    // Nothing waiting, nothing to confirm; and only the confirmed modules produced a notice.
    report.repeat_confirm_refused = await invoke('host_confirm_migration', { module: 'ember' }).then(() => false, () => true);
    report.notices_for = (await invoke<{ module: string }[]>('host_data_notices')).map(n => n.module).sort();
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error);
  }
  await invoke('selftest_report', { name: 'migration', data: report });
  await invoke('selftest_finish');
}
