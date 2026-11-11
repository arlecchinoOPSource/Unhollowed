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
  await invoke('selftest_report', { name: 'layout', data: { host_width: window.innerWidth, frame_widths_after_resize: widths } });
  await invoke('selftest_finish');
}

export async function runSelfTest(name: ModuleName, frame: HTMLIFrameElement | null): Promise<void> {
  if (started.has(name) || !frame || !(await invoke<boolean>('selftest_enabled'))) return;
  started.add(name);
  frames.set(name, frame);
  if (EXPECTED.every(module => frames.has(module)) && !running) running = runAll();
  await running;
}
