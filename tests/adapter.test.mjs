import test from 'node:test';
import assert from 'node:assert/strict';

/** Loads the adapters against a fake host window; each call gets fresh module instances. */
async function load({ search = '?mod=swish' } = {}) {
  const hostCalls = [], callbacks = [], unregistered = [];
  const host = {
    invoke: async (...args) => { hostCalls.push(args); return 42; },
    transformCallback: cb => { callbacks.push(cb); return callbacks.length; },
    convertFileSrc: (p, protocol) => `${protocol}://${p}`,
  };
  globalThis.location = { search };
  globalThis.window = { parent: { isTauri: true, __TAURI_INTERNALS__: host, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (...a) => unregistered.push(a) } } };
  const stamp = `?t=${Math.random()}`;
  const core = await import(`../adapter/tauri-core.js${stamp}`);
  const event = await import(`../adapter/tauri-event.js${stamp}`);
  return { core, event, hostCalls, callbacks, unregistered };
}

test('module commands go to the module plugin, through the host internals', async () => {
  const { core, hostCalls } = await load();
  assert.equal(await core.invoke('load_workspace', { a: 1 }), 42);
  assert.deepEqual(hostCalls[0], ['plugin:swish|load_workspace', { a: 1 }, undefined]);
  assert.deepEqual(globalThis.window.__unhlw.calls, ['load_workspace -> plugin:swish|load_workspace']);
});

test('plugin commands such as event listening pass through unprefixed', async () => {
  const { core, hostCalls } = await load();
  await core.invoke('plugin:event|emit', {});
  assert.equal(hostCalls[0][0], 'plugin:event|emit');
});

test('isTauri and callbacks come from the host window', async () => {
  const { core, callbacks } = await load();
  assert.equal(core.isTauri(), true);
  assert.equal(core.transformCallback(() => 1), 1);
  assert.equal(callbacks.length, 1);
  assert.equal(core.convertFileSrc('/x'), 'asset:///x');
});

test('listen registers the handler in the host callback table and can unlisten', async () => {
  const { event, hostCalls, callbacks, unregistered } = await load();
  const handler = () => {};
  const stop = await event.listen('swish-close-requested', handler);
  assert.equal(callbacks[0], handler);
  assert.deepEqual(hostCalls[0], ['plugin:event|listen', { event: 'swish-close-requested', target: { kind: 'Any' }, handler: 1 }, undefined]);
  await stop();
  assert.deepEqual(unregistered[0], ['swish-close-requested', 42]);
  assert.equal(hostCalls[1][0], 'plugin:event|unlisten');
});

test('a label target becomes an AnyLabel target', async () => {
  const { event, hostCalls } = await load();
  await event.listen('x', () => {}, { target: 'main' });
  assert.deepEqual(hostCalls[0][1].target, { kind: 'AnyLabel', label: 'main' });
});

test('the window adapter gives a module no say over close: it registers nothing and returns a no-op unsubscribe', async () => {
  const { getCurrentWindow } = await import(`../adapter/tauri-window.js?t=${Math.random()}`);
  const unlisten = await getCurrentWindow().onCloseRequested(() => { throw new Error('must never be called'); });
  assert.equal(typeof unlisten, 'function');
  assert.equal(unlisten(), undefined);
});

test('every command call stamps the module\'s activity on the host window, at start and when it settles, even on failure', async () => {
  const { core } = await load();
  const host = globalThis.window.parent;
  assert.equal(host.__unhlwActivity, undefined);
  await core.invoke('load_workspace');
  const first = host.__unhlwActivity.swish;
  assert.equal(typeof first, 'number');
  host.__TAURI_INTERNALS__.invoke = async () => { throw new Error('refused'); };
  host.__unhlwActivity.swish = 0;
  await assert.rejects(core.invoke('load_workspace'), /refused/);
  assert.ok(host.__unhlwActivity.swish > 0, 'stamped even though the call failed');
});
