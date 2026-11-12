import test from 'node:test';
import assert from 'node:assert/strict';
import * as h from '../src/projection.ts';
import * as rack from '../src/lifecycle.ts';

const names = ['terminal', 'ember', 'swish'];
const states = (o = {}) => ({ terminal: 'off', ember: 'off', swish: 'off', ...o });
const run = (proj, seconds, input, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) proj.step(dt, input); };
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps, `${a} is not near ${b}`);

test('booting reaches the hold point halfway through the boot time and waits there until the frame has loaded', () => {
  const proj = new h.Projection(names);
  const booting = { states: states({ ember: 'booting' }), owner: 'ember', rm: false };
  run(proj, 3, booting);
  near(proj.p.ember, h.BOOT_HOLD, 1e-9);
  run(proj, 0.6, { ...booting, states: states({ ember: 'active' }) });
  near(proj.p.ember, 1, 1e-9);
});

test('a normal boot takes about BOOT_S end to end when the frame loads in time', () => {
  const proj = new h.Projection(names);
  run(proj, h.BOOT_S * 0.25, { states: states({ ember: 'booting' }), owner: 'ember', rm: false });
  run(proj, h.BOOT_S * 0.75 + 0.02, { states: states({ ember: 'active' }), owner: 'ember', rm: false });
  near(proj.p.ember, 1, 0.03);
  assert.ok(h.BOOT_S <= 0.8, 'a prompt boot');
});

test('while the module saves the interface stays; only after the save is confirmed does it retract in 0.9 s', async () => {
  const proj = new h.Projection(names);
  const active = { states: states({ ember: 'active' }), owner: 'ember', rm: false };
  run(proj, 2, active);
  const closing = { states: states({ ember: 'shutting-down' }), owner: 'ember', rm: false };
  run(proj, 5, closing); // a slow save
  assert.equal(proj.p.ember, 1, 'holds at 1 for as long as the save takes');
  let done = false;
  const retracted = proj.retract('ember').then(() => { done = true; });
  run(proj, 0.45, closing);
  near(proj.p.ember, 0.5, 0.03);
  await Promise.resolve(); assert.equal(done, false, 'not finished halfway');
  run(proj, 0.5, closing);
  await retracted; assert.equal(done, true);
  assert.equal(proj.p.ember, 0);
});

test('retracting a module that is not on the stage resolves at once', async () => {
  const proj = new h.Projection(names);
  run(proj, 2, { states: states({ terminal: 'active', ember: 'active' }), owner: 'terminal', rm: false });
  await proj.retract('ember');
  assert.equal(proj.p.ember, 0);
});

test('an error shows the interface in full almost at once and keeps it', () => {
  const proj = new h.Projection(names);
  run(proj, 0.5, { states: states({ swish: 'booting' }), owner: 'swish', rm: false });
  run(proj, 0.4, { states: states({ swish: 'error' }), owner: 'swish', rm: false });
  assert.equal(proj.p.swish, 1);
  assert.equal(h.stagePieces(proj.drive(false, true), 0).reveal, 1);
});

test('reduced motion: no animation in the progress, the interface appears at once and a retract resolves at once', async () => {
  const proj = new h.Projection(names);
  proj.step(0.001, { states: states({ ember: 'booting' }), owner: 'ember', rm: true });
  assert.equal(proj.p.ember, h.BOOT_HOLD);
  assert.equal(h.stagePieces(proj.drive(true, false)).appVisible, true, 'visible from p = 0.5, never half-transparent');
  proj.step(0.001, { states: states({ ember: 'active' }), owner: 'ember', rm: true });
  assert.equal(proj.p.ember, 1);
  const closing = { states: states({ ember: 'shutting-down' }), owner: 'ember', rm: true };
  const retracted = proj.retract('ember'); proj.step(0.001, closing); await retracted;
  assert.equal(proj.p.ember, 0);
});

test('switching the module in front hands the stage over in 0.45 s and builds the new beam late', () => {
  const proj = new h.Projection(names);
  const both = (owner) => ({ states: states({ terminal: 'active', ember: 'active' }), owner, rm: false });
  run(proj, 2, both('terminal'));
  proj.step(0.001, both('ember'));
  assert.equal(proj.prev, 'terminal');
  assert.equal(proj.retargeting, true);
  const early = h.unitPieces('front', proj.drive(false, false));
  assert.equal(early.beam, 0, 'the new beam has not started');
  const old = h.unitPieces('prev', proj.drive(false, false));
  assert.ok(old.beamOpacity > 0.2);
  run(proj, 0.5, both('ember'));
  assert.equal(proj.retargeting, false);
  assert.equal(proj.prev, null);
});

test('the steady state overlays nothing over the interface and keeps the beam faint', () => {
  const d = { p: 1, sw: 1, retarget: false, err: false, rm: false };
  const s = h.stagePieces(d);
  assert.equal(s.reveal, 1); assert.equal(s.sweepOpacity, 0, 'the reveal line is gone once revealed');
  const u = h.unitPieces('front', d);
  near(u.beamOpacity, 0.22, 1e-9); near(u.screenOpacity, 0.6, 1e-9);
});

test('during the reveal the line sits on the not-yet-revealed side and the frame is clipped like the interface', () => {
  const half = h.stagePieces({ p: 0.72, sw: 1, retarget: false, err: false, rm: false });
  assert.ok(half.reveal > 0 && half.reveal < 1);
  assert.ok(half.sweepOpacity > 0 && half.sweepOpacity <= 0.8);
  assert.equal(h.stagePieces({ p: 0.4, sw: 1, retarget: false, err: false, rm: false }).reveal, 0, 'nothing revealed before p = 0.5');
});

test('error differs from active in shape and motion as well as colour: half-open aperture, stepped beam, jitter', () => {
  const d = { p: 1, sw: 1, retarget: false, err: true, rm: false };
  const a = h.unitPieces('front', d, 0), b = h.unitPieces('front', d, 1);
  assert.equal(a.aperture, 0.5); assert.equal(a.charge, 0);
  assert.notEqual(a.beamOpacity, b.beamOpacity);
  assert.notEqual(h.stagePieces(d, 0).frameJitterPx, h.stagePieces(d, 1).frameJitterPx);
  const quiet = h.unitPieces('front', { ...d, rm: true }, 1);
  near(quiet.beamOpacity, 0.25, 1e-9);
  assert.equal(h.stagePieces({ ...d, rm: true }, 1).frameJitterPx, 0, 'no stepping with reduced motion');
});

test('the beam slices run from the emitter to the stage edge with the right heights and no gaps', () => {
  const E = { x: 300, y: 100, w: 60, h: 36 }, T = { x: 520, y: 20, w: 700, h: 500 };
  const slices = h.beamSlices(E, T, 512, 128, 1, 96);
  assert.equal(slices.length, 96);
  near(slices[0].dx, 330, 1e-9);
  near(slices[95].dx + slices[95].dw, 520, 1e-9);
  near(slices[0].height, 36 + (500 - 36) / 192, 0.1);
  assert.ok(slices[95].height > 480 && slices[95].height <= 500);
  for (let i = 1; i < slices.length; i++) near(slices[i].dx, slices[i - 1].dx + slices[i - 1].dw, 1e-9);
  assert.ok(slices.every(s => s.slope < 0), 'the beam rises toward a taller stage edge that starts higher');
  assert.equal(h.beamSlices(E, T, 512, 128, 0.5, 96).length, 48);
  assert.equal(h.beamSlices(E, T, 512, 128, 0, 96).length, 0);
});

test('the stage margin follows the window height within 12 to 24 px', () => {
  assert.equal(h.stageMargin(300), 12); assert.equal(h.stageMargin(568), 16); assert.equal(h.stageMargin(2000), 24);
});

test('who owns the stage: the module in front, else the one saving or in error, so unsaved work is never hidden', () => {
  const r = rack.initial(names);
  assert.equal(rack.stageOwner(r), null);
  const on = rack.markReady(rack.powerOn(r, 'ember'), 'ember');
  assert.equal(rack.stageOwner(on), 'ember');
  const closing = rack.beginPowerOff(on, 'ember');
  assert.equal(closing.front, null);
  assert.equal(rack.stageOwner(closing), 'ember', 'still on stage while it saves');
  assert.equal(rack.stageOwner(rack.fail(closing, 'ember')), 'ember', 'and in error');
  const two = rack.markReady(rack.powerOn(on, 'terminal'), 'terminal');
  assert.equal(rack.stageOwner(rack.beginPowerOff(two, 'ember')), 'terminal', 'a module in front keeps the stage');
});

test('asking for a retract wakes the frame loop, which may have stopped because nothing was moving', () => {
  const proj = new h.Projection(names);
  let woke = 0; proj.onWake = () => { woke++; };
  run(proj, 2, { states: states({ ember: 'active' }), owner: 'ember', rm: false });
  assert.equal(proj.busy(states({ ember: 'shutting-down' })), false, 'saving: nothing moves, so the loop may stop');
  void proj.retract('ember');
  assert.equal(woke, 1);
  assert.equal(proj.busy(states({ ember: 'shutting-down' })), true, 'a pending retract keeps the loop running');
});
