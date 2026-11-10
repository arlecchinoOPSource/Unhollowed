import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const shim = readFileSync(new URL('../public/modules/shim.js', import.meta.url), 'utf8');

/** Runs the shim in a fake iframe whose parent has Tauri internals; returns the iframe window. */
function frame({ search = '?mod=swish', parentInternals = true } = {}) {
  const hostCalls = [];
  const parent = { isTauri: true, __TAURI_INTERNALS__: parentInternals ? Object.freeze({ invoke: (...a) => { hostCalls.push(a); return 'host'; }, transformCallback: () => 7 }) : undefined, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} } };
  const window = { location: { search }, parent };
  const context = vm.createContext({ ...window, window: null, parent, location: window.location, URLSearchParams, Object });
  context.window = context;
  vm.runInContext(shim, context);
  return { context, hostCalls };
}

test('prefixes unprefixed commands with the module plugin and passes arguments through', () => {
  const { context, hostCalls } = frame();
  context.__TAURI_INTERNALS__.invoke('load_workspace', { a: 1 }, { headers: {} });
  assert.deepEqual(hostCalls[0], ['plugin:swish|load_workspace', { a: 1 }, { headers: {} }]);
});

test('leaves already prefixed commands alone (events, core)', () => {
  const { context, hostCalls } = frame();
  context.__TAURI_INTERNALS__.invoke('plugin:event|listen', {});
  assert.equal(hostCalls[0][0], 'plugin:event|listen');
});

test('works even though the parent defines invoke as read-only', () => {
  const { context } = frame();
  assert.equal(Object.getOwnPropertyDescriptor(context.__TAURI_INTERNALS__, 'invoke').writable, false);
  assert.equal(typeof context.__TAURI_INTERNALS__.invoke, 'function');
});

test('sets isTauri, inherits other internals, and copies other __TAURI globals', () => {
  const { context } = frame();
  assert.equal(context.isTauri, true);
  assert.equal(context.__TAURI_INTERNALS__.transformCallback(), 7);
  assert.ok(context.__TAURI_EVENT_PLUGIN_INTERNALS__);
});

test('records the routed calls for the self-test', () => {
  const { context } = frame();
  context.__TAURI_INTERNALS__.invoke('create_project', {});
  assert.deepEqual([...context.__unhlw.calls], ['create_project -> plugin:swish|create_project']);
});

test('does nothing without a module name or without a Tauri parent', () => {
  assert.equal(frame({ search: '' }).context.__TAURI_INTERNALS__, undefined);
  assert.equal(frame({ parentInternals: false }).context.__TAURI_INTERNALS__, undefined);
});
