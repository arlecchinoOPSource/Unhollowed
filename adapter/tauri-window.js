// Host adapter for `@tauri-apps/api/window`, swapped in when a module's bundle is built (scripts/build-modules.mjs).
// The host owns the window: a module never sees close requests, never prevents a close and never quits
// (docs/HOST-CONTRACT-U35.md). Ember asks for `getCurrentWindow().onCloseRequested(...)`; here that registers
// nothing and hands back a no-op unsubscribe, and the host tells the module to flush through its close event.
// Only the surface the modules use is provided; anything else fails the module's build, loudly.
export function getCurrentWindow() {
  return {
    async onCloseRequested() {
      return () => {};
    },
  };
}
