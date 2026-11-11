import { invoke } from '@tauri-apps/api/core';
import type { ModuleName } from './modules';

/**
 * Debug-only native self-test (inert unless the native side reports it is enabled). Drives each embedded
 * module's real UI inside its iframe with synthetic data and reports what happened, so a native run can
 * check the slice without a person clicking (scripts/native-selftest.mjs). When every module has finished
 * it starts the same close sequence a user's close would.
 */
const started = new Set<ModuleName>();
const finished = new Set<ModuleName>();
const EXPECTED: ModuleName[] = ['terminal', 'swish'];

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

export async function runSelfTest(name: ModuleName, frame: HTMLIFrameElement | null): Promise<void> {
  if (started.has(name) || !frame || !(await invoke<boolean>('selftest_enabled'))) return;
  started.add(name);
  const report: Record<string, unknown> = {};
  try {
    await (name === 'swish' ? swish : terminal)(frame, report);
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
  finished.add(name);
  if (EXPECTED.every(module => finished.has(module))) {
    // Resize last, with both modules mounted, and record what each frame saw.
    await invoke('selftest_resize', { width: 800, height: 600 });
    await sleep(600);
    const widths = [...document.querySelectorAll('iframe')].map(f => f.contentWindow?.innerWidth ?? null);
    await invoke('selftest_report', { name: 'layout', data: { host_width: window.innerWidth, frame_widths_after_resize: widths } });
    await invoke('selftest_finish');
  }
}
