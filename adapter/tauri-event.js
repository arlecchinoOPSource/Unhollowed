// Host adapter for `@tauri-apps/api/event`; see tauri-core.js. Mirrors the real package's behavior,
// but registers listeners through the host window so events reach the module's iframe on every platform.
import { invoke, transformCallback } from './tauri-core.js';

async function unlistenEvent(event, eventId) {
  window.parent.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke('plugin:event|unlisten', { event, eventId });
}

export async function listen(event, handler, options) {
  const target = typeof options?.target === 'string' ? { kind: 'AnyLabel', label: options.target } : (options?.target ?? { kind: 'Any' });
  const eventId = await invoke('plugin:event|listen', { event, target, handler: transformCallback(handler) });
  return async () => unlistenEvent(event, eventId);
}

export async function once(event, handler, options) {
  return listen(event, eventData => {
    void unlistenEvent(event, eventData.id);
    handler(eventData);
  }, options);
}

export async function emit(event, payload) {
  await invoke('plugin:event|emit', { event, payload });
}
