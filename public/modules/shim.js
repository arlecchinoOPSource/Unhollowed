// Host IPC shim for an unmodified app bundle running inside an iframe (docs/HOST-CONTRACT-U35.md).
// Loaded as a classic script before the app's own scripts. It makes the iframe look like a Tauri
// window to @tauri-apps/api, and routes the app's unprefixed commands to its module plugin.
(() => {
  const module = new URLSearchParams(location.search).get('mod');
  const host = parent.__TAURI_INTERNALS__;
  if (!module || !host) return;
  const calls = [];
  const internals = Object.create(host);
  // Tauri defines invoke as non-writable, so it cannot be assigned.
  Object.defineProperty(internals, 'invoke', {
    value: (cmd, args, options) => {
      const target = cmd.startsWith('plugin:') ? cmd : `plugin:${module}|${cmd}`;
      calls.push(`${cmd} -> ${target}`);
      return host.invoke(target, args, options);
    },
  });
  // WebView2 (Windows) runs Tauri's initialization script in every frame, so the iframe may already have its own
  // internals; WKWebView does not. Try a plain assignment, then a redefinition, and record what happened.
  const before = Object.getOwnPropertyDescriptor(window, '__TAURI_INTERNALS__');
  let problem = null;
  try { window.__TAURI_INTERNALS__ = internals; } catch (error) { problem = String(error); }
  if (window.__TAURI_INTERNALS__ !== internals) {
    try { Object.defineProperty(window, '__TAURI_INTERNALS__', { value: internals, configurable: true, writable: true }); } catch (error) { problem = String(error); }
  }
  // isTauri() in @tauri-apps/api reads its own global.
  window.isTauri = parent.isTauri === true;
  for (const key of Object.keys(parent)) {
    if (key.startsWith('__TAURI') && key !== '__TAURI_INTERNALS__') window[key] = parent[key];
  }
  // Only the module in front may take keyboard focus (docs/LIFECYCLE-U11.md). A page has one focused element, so a
  // module that focuses itself in the background (an autofocus at load, a timer) would take the keyboard from the
  // module in use. The host answers per module; with no host answer the module is not restricted.
  if (typeof HTMLElement !== 'undefined') {
    const focus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...args) {
      let allowed = true;
      try { allowed = parent.__unhlwHost?.mayFocus(module) !== false; } catch { /* host unavailable: do not restrict */ }
      if (allowed) return focus.apply(this, args);
    };
  }
  window.__unhlw = {
    module,
    calls,
    // false on Windows (WebView2 gives every frame its own permanent internals); the build-time adapters route the
    // module's calls through the host window instead (adapter/), so this only matters for code that bypasses them.
    effective: window.__TAURI_INTERNALS__ === internals,
    hadOwnInternals: !!before,
    ownWritable: before ? before.writable ?? null : null,
    ownConfigurable: before ? before.configurable : null,
    problem,
  };
})();
