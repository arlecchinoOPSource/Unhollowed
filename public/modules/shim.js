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
  window.__TAURI_INTERNALS__ = internals;
  // isTauri() in @tauri-apps/api reads its own global.
  window.isTauri = parent.isTauri === true;
  for (const key of Object.keys(parent)) {
    if (key.startsWith('__TAURI') && key !== '__TAURI_INTERNALS__') window[key] = parent[key];
  }
  window.__unhlw = { module, calls };
})();
