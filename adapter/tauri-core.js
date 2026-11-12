// Host adapter for `@tauri-apps/api/core`, swapped in when a module's bundle is built
// (scripts/build-modules.mjs). A module runs in an iframe of the host window. On Windows (WebView2)
// the iframe already has its own, permanent Tauri internals, so they cannot be replaced at run time
// (docs/CI.md, issue #52). Instead the module's imports are redirected here at build time, and every
// call goes through the HOST window's internals, with the module's commands sent to its own plugin.
// Only the surface the modules use is provided; anything else fails the module's build, loudly.
const module = new URLSearchParams(location.search).get('mod');
const host = () => window.parent.__TAURI_INTERNALS__;
const log = () => (window.__unhlw ??= { module, calls: [] });

/** Commands of the module go to `plugin:<module>|<command>`; `plugin:` commands (events, core) pass through. */
export async function invoke(cmd, args = {}, options) {
  const target = cmd.startsWith('plugin:') ? cmd : `plugin:${module}|${cmd}`;
  log().calls.push(`${cmd} -> ${target}`);
  // The host page tells a module's own writes from another program's by when the module last called a command
  // (docs/CHANGE-NOTICE-U15.md). Marked at the start and again when the call settles.
  const mark = () => { try { (window.parent.__unhlwActivity ??= {})[module] = Date.now(); } catch { /* not in the host */ } };
  mark();
  try { return await host().invoke(target, args, options); } finally { mark(); }
}

/** Callbacks must live in the host's table: the host evaluates them when an event arrives. */
export function transformCallback(callback, once = false) {
  return host().transformCallback(callback, once);
}

export function isTauri() {
  return !!window.parent.isTauri;
}

export function convertFileSrc(filePath, protocol = 'asset') {
  return host().convertFileSrc(filePath, protocol);
}
