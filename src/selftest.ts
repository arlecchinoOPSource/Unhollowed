import { invoke } from '@tauri-apps/api/core';

/**
 * Debug-only native self-test (inert unless the native side reports it is enabled). Drives the real
 * Swish UI inside its iframe with synthetic data and reports what happened, so a native run can
 * check the slice without a person clicking (scripts/native-selftest.mjs).
 */
let started = false;

type Win = Window & typeof globalThis & { __unhlw?: { module: string; calls: string[]; effective: boolean; hadOwnInternals: boolean; ownWritable: boolean | null; ownConfigurable: boolean | null; problem: string | null }; AudioContext: typeof AudioContext };

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

export async function runSelfTest(frame: HTMLIFrameElement | null): Promise<void> {
  if (started || !frame || !(await invoke<boolean>('selftest_enabled'))) return;
  started = true;
  const report: Record<string, unknown> = {};
  try {
    const w = frame.contentWindow as Win;
    const d = frame.contentDocument!;
    report.shim_installed = !!w.__unhlw;
    // A missing module bundle makes the dev server answer with the host's own page, which would look like a
    // rendered module. Stop at once with a clear reason instead.
    report.shim_effective = w.__unhlw?.effective ?? null;
    report.shim_details = w.__unhlw ? { hadOwnInternals: w.__unhlw.hadOwnInternals, ownWritable: w.__unhlw.ownWritable, ownConfigurable: w.__unhlw.ownConfigurable, problem: w.__unhlw.problem } : null;
    if (!w.__unhlw) throw new Error('the shim is not installed in the module frame: the Swish bundle is missing or was not built for the host');
    report.isTauri_in_frame = (w as unknown as { isTauri?: boolean }).isTauri === true;
    report.root_rendered = !!(await until('Swish root content', () => d.getElementById('root')?.childElementCount));
    // Swish shows its startup screen for at least 2.2 s; wait for it to leave.
    await until('startup screen to finish', () => !d.querySelector('.startup'), 20000);
    report.startup_finished = true;
    report.frame_theme = d.documentElement.dataset.theme ?? null;
    report.host_theme = document.documentElement.dataset.theme ?? null;

    const button = (label: string) => [...d.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label);
    const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const proto = el instanceof w.HTMLTextAreaElement ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
      el.dispatchEvent(new w.Event('input', { bubbles: true }));
    };

    (await until('New Project button', () => button('New Project'))).click();
    const name = await until('Project name field', () => d.querySelector<HTMLInputElement>('dialog[open] input[id$="-name"]'));
    report.focus_on_project_name_after_open = d.activeElement === name;
    setValue(name, 'Slice synthetic project');
    setValue(d.querySelector<HTMLInputElement>('dialog[open] input[type="date"]')!, '2026-12-31');
    (await until('Create project button', () => button('Create project'))).click();
    await until('created project heading', () => [...d.querySelectorAll('h2')].some(h => h.textContent === 'Slice synthetic project'));
    report.project_visible_in_swish_ui = true;

    // Read it back through the module's own command, the way the app would after a restart.
    const stored = JSON.stringify(await invoke('plugin:swish|load_workspace'));
    report.project_stored_via_plugin = stored.includes('Slice synthetic project');

    await invoke('selftest_resize', { width: 800, height: 600 });
    await sleep(600);
    report.frame_width_after_resize = w.innerWidth;
    report.window_width_after_resize = window.innerWidth;

    try {
      const context = new w.AudioContext();
      report.audio_context_state_without_gesture = context.state;
      void context.close();
    } catch (error) { report.audio_context_error = String(error); }

    report.ipc_calls_through_shim = [...new Set((w.__unhlw?.calls ?? []).map(call => call.split(' -> ')[0]))];
    const calls = w.__unhlw?.calls ?? [];
    report.all_calls_prefixed = calls.length > 0 && calls.every(call => call.split(' -> ')[1].startsWith('plugin:'));
    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = String(error);
    // Say what the module looked like when it failed, so a CI log is enough to diagnose it.
    try {
      const w = frame.contentWindow as Win;
      report.failure_page_text = (frame.contentDocument?.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400);
      report.failure_ipc_calls = w.__unhlw?.calls ?? [];
      report.failure_load_workspace = await invoke('plugin:swish|load_workspace').then(v => `ok: ${JSON.stringify(v).slice(0, 120)}`, e => `error: ${JSON.stringify(e).slice(0, 300)}`);
    } catch (inner) { report.failure_diagnostics_error = String(inner); }
  }
  await invoke('selftest_report', { name: 'slice', data: report });
  await invoke('selftest_finish');
}
