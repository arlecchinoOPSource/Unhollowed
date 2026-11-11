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
