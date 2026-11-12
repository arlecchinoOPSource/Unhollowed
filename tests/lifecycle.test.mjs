import test from 'node:test';
import assert from 'node:assert/strict';
import * as rack from '../src/lifecycle.ts';

const three = () => rack.initial(['terminal', 'ember', 'swish']);
const on = (r, ...names) => names.reduce(rack.powerOn, r);

test('powering a module on puts it in front; the others stay mounted', () => {
  const r = on(three(), 'terminal', 'swish');
  assert.equal(r.front, 'swish');
  assert.deepEqual(rack.mounted(r), ['terminal', 'swish']);
  assert.equal(r.phase.ember, 'off');
});

test('only the module in front may take focus', () => {
  const r = on(three(), 'terminal', 'ember');
  assert.equal(rack.mayFocus(r, 'ember'), true);
  assert.equal(rack.mayFocus(r, 'terminal'), false);
  assert.equal(rack.mayFocus(r, 'swish'), false);
});

test('bringing a module to the front never unmounts anything', () => {
  const r = rack.bringToFront(on(three(), 'terminal', 'ember', 'swish'), 'terminal');
  assert.equal(r.front, 'terminal');
  assert.deepEqual([...rack.mounted(r)].sort(), ['ember', 'swish', 'terminal']);
});

test('a module that is off cannot be brought to the front or focused', () => {
  const r = on(three(), 'terminal');
  assert.equal(rack.bringToFront(r, 'ember'), r);
  assert.equal(rack.mayFocus(r, 'ember'), false);
});

test('power-off keeps the frame mounted until the module confirms it saved', () => {
  const closing = rack.beginPowerOff(on(three(), 'terminal', 'ember'), 'ember');
  assert.equal(closing.phase.ember, 'closing');
  assert.ok(rack.mounted(closing).includes('ember'), 'still mounted while closing');
  assert.equal(rack.mayFocus(closing, 'ember'), false, 'a closing module may not take focus');
  const done = rack.finishPowerOff(closing, 'ember');
  assert.equal(done.phase.ember, 'off');
  assert.ok(!rack.mounted(done).includes('ember'));
});

test('closing the module in front hands the front to the most recent other module', () => {
  const r = rack.beginPowerOff(on(three(), 'terminal', 'swish', 'ember'), 'ember');
  assert.equal(r.front, 'swish');
  assert.equal(rack.beginPowerOff(rack.beginPowerOff(on(three(), 'swish'), 'swish'), 'swish').front, null);
});

test('a module that did not confirm can be kept open without losing its place', () => {
  const closing = rack.beginPowerOff(on(three(), 'terminal', 'ember'), 'ember');
  const kept = rack.keepOpen(closing, 'ember');
  assert.equal(kept.phase.ember, 'on');
  assert.equal(kept.front, 'ember');
  assert.ok(rack.mounted(kept).includes('ember'));
});

test('a closed module can be powered on again; repeated or out-of-order actions change nothing', () => {
  let r = rack.finishPowerOff(rack.beginPowerOff(on(three(), 'ember'), 'ember'), 'ember');
  assert.equal(rack.finishPowerOff(r, 'ember'), r);
  assert.equal(rack.beginPowerOff(r, 'ember'), r);
  r = rack.powerOn(r, 'ember');
  assert.equal(r.phase.ember, 'on');
  assert.equal(rack.powerOn(r, 'ember'), r);
});

test('every power-on is a new frame identity, even when power-off and power-on happen back to back', () => {
  const first = on(three(), 'ember');
  const again = rack.powerOn(rack.finishPowerOff(rack.beginPowerOff(first, 'ember'), 'ember'), 'ember');
  assert.notEqual(again.epoch.ember, first.epoch.ember);
  assert.equal(again.epoch.terminal, first.epoch.terminal, 'other modules keep their identity');
  assert.equal(rack.keepOpen(rack.beginPowerOff(first, 'ember'), 'ember').epoch.ember, first.epoch.ember, 'keeping a module open is not a new frame');
});

// ---- U-23: the five projector states and their transitions ----
const state = (r, name) => rack.projectorState(r, name);

test('a power-on is booting until the frame reports that it loaded, then active', () => {
  let r = rack.powerOn(three(), 'ember');
  assert.equal(state(r, 'ember'), 'booting');
  assert.equal(rack.mayFocus(r, 'ember'), true, 'the frame is mounted and in front while booting');
  r = rack.markReady(r, 'ember');
  assert.equal(state(r, 'ember'), 'active');
  assert.equal(rack.markReady(r, 'ember'), r, 'repeating changes nothing');
  assert.equal(state(r, 'terminal'), 'off');
  assert.equal(rack.markReady(three(), 'ember').ready.ember, false, 'an off module cannot become ready');
});

test('shutting-down lasts from the save request to its confirmation, then off; a new power-on boots again', () => {
  let r = rack.markReady(rack.powerOn(three(), 'ember'), 'ember');
  r = rack.beginPowerOff(r, 'ember');
  assert.equal(state(r, 'ember'), 'shutting-down');
  r = rack.finishPowerOff(r, 'ember');
  assert.equal(state(r, 'ember'), 'off');
  assert.equal(state(rack.powerOn(r, 'ember'), 'ember'), 'booting', 'ready does not carry over to the next frame');
});

test('a module that did not confirm is in error: still mounted, data kept, and the owner decides', () => {
  const active = rack.markReady(on(three(), 'terminal', 'ember'), 'ember');
  const failed = rack.fail(rack.beginPowerOff(active, 'ember'), 'ember');
  assert.equal(state(failed, 'ember'), 'error');
  assert.ok(rack.mounted(failed).includes('ember'), 'the frame and its unsaved data stay');
  assert.equal(rack.mayFocus(failed, 'ember'), false);
  assert.equal(failed.front, 'terminal', 'the front moves to a working module');
  // keep it open: back to active (it had loaded)
  const kept = rack.keepOpen(failed, 'ember');
  assert.equal(state(kept, 'ember'), 'active');
  assert.equal(kept.front, 'ember');
  assert.equal(kept.epoch.ember, active.epoch.ember, 'keeping it open is not a new frame');
  // retry the save: shutting-down again, and it can then finish
  assert.equal(state(rack.beginPowerOff(failed, 'ember'), 'ember'), 'shutting-down');
  // accept the loss: off
  assert.equal(state(rack.finishPowerOff(failed, 'ember'), 'ember'), 'off');
});

test('a module that never loaded fails from booting, and keeping it open returns it to booting', () => {
  const failed = rack.fail(rack.powerOn(three(), 'swish'), 'swish');
  assert.equal(state(failed, 'swish'), 'error');
  assert.equal(state(rack.keepOpen(failed, 'swish'), 'swish'), 'booting');
  assert.equal(state(rack.markReady(failed, 'swish'), 'swish'), 'error', 'a late report does not clear an error by itself');
  assert.equal(rack.markReady(failed, 'swish').ready.swish, true, 'but it is remembered, so keeping it open shows active');
});

test('out-of-order transitions change nothing', () => {
  const r = three();
  assert.equal(rack.fail(r, 'ember'), r, 'an off module cannot fail');
  assert.equal(rack.keepOpen(r, 'ember'), r);
  assert.equal(rack.beginPowerOff(r, 'ember'), r);
  const active = rack.markReady(rack.powerOn(r, 'ember'), 'ember');
  assert.equal(rack.keepOpen(active, 'ember'), active, 'only closing or error modules are kept open');
  assert.equal(rack.fail(rack.fail(active, 'ember'), 'ember').phase.ember, 'error');
});

test('every state is reachable and every transition is deterministic for the same input', () => {
  const run = () => {
    let r = rack.powerOn(three(), 'terminal');
    const seen = [state(r, 'terminal')];
    r = rack.markReady(r, 'terminal'); seen.push(state(r, 'terminal'));
    r = rack.beginPowerOff(r, 'terminal'); seen.push(state(r, 'terminal'));
    r = rack.fail(r, 'terminal'); seen.push(state(r, 'terminal'));
    r = rack.finishPowerOff(r, 'terminal'); seen.push(state(r, 'terminal'));
    return seen;
  };
  assert.deepEqual(run(), ['booting', 'active', 'shutting-down', 'error', 'off']);
  assert.deepEqual(run(), run());
});
