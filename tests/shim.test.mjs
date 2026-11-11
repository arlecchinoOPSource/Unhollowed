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

test('reports whether it took effect, and why not when the frame keeps its own internals', () => {
  const { context } = frame();
  assert.equal(context.__unhlw.effective, true);
  assert.equal(context.__unhlw.hadOwnInternals, false);
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

/** Runs the shim in a fake iframe that has an HTMLElement, with a host that answers `mayFocus`. */
function focusFrame(hostAnswer) {
  const focused = [];
  class HTMLElement { focus(...args) { focused.push(args); return 'focused'; } }
  const parent = { isTauri: true, __TAURI_INTERNALS__: Object.freeze({ invoke() {}, transformCallback: () => 1 }), __TAURI_EVENT_PLUGIN_INTERNALS__: {}, __unhlwHost: hostAnswer };
  const context = vm.createContext({ parent, location: { search: '?mod=ember' }, URLSearchParams, Object, HTMLElement });
  context.window = context;
  vm.runInContext(shim, context);
  return { element: new context.HTMLElement(), focused };
}

test('a module in the background cannot take focus (docs/LIFECYCLE-U11.md)', () => {
  const asked = [];
  const { element, focused } = focusFrame({ mayFocus: name => { asked.push(name); return false; } });
  assert.equal(element.focus(), undefined);
  assert.equal(focused.length, 0);
  assert.deepEqual(asked, ['ember']);
});

test('the module in front keeps focus() and its arguments', () => {
  const { element, focused } = focusFrame({ mayFocus: () => true });
  assert.equal(element.focus({ preventScroll: true }), 'focused');
  assert.deepEqual(focused, [[{ preventScroll: true }]]);
});

test('with no host answer, focus is not restricted', () => {
  assert.equal(focusFrame(undefined).element.focus(), 'focused');
  assert.equal(focusFrame({ mayFocus() { throw new Error('host gone'); } }).element.focus(), 'focused');
});
