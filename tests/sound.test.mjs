import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/sound.ts';
import { renderCue, SAMPLE_RATE, PEAK } from '../src/synth.ts';

test('sound is off until the person turns it on, and every cue starts allowed', () => {
  assert.equal(s.DEFAULT_SOUND.enabled, false);
  assert.ok(s.CUES.every(cue => s.DEFAULT_SOUND.cues[cue] === true));
  assert.equal(s.mayPlay(s.DEFAULT_SOUND, 'boot'), false, 'off means silent');
});

test('settings read back safely: junk, partial and out-of-range values fall back, never throw', () => {
  assert.deepEqual(s.parseSoundSettings('not json {'), s.DEFAULT_SOUND);
  assert.deepEqual(s.parseSoundSettings(null), s.DEFAULT_SOUND);
  assert.deepEqual(s.parseSoundSettings(42), s.DEFAULT_SOUND);
  const p = s.parseSoundSettings(JSON.stringify({ enabled: true, volume: 400, cues: { boot: false, nonsense: false, error: 'no' } }));
  assert.equal(p.enabled, true); assert.equal(p.volume, 100); assert.equal(p.cues.boot, false); assert.equal(p.cues.error, true);
  assert.equal(s.parseSoundSettings({ volume: -5 }).volume, 0);
  assert.equal(s.parseSoundSettings({ volume: NaN }).volume, s.DEFAULT_SOUND.volume);
});

test('each cue is independently switchable and volume 0 is silent', () => {
  const on = { ...s.DEFAULT_SOUND, enabled: true, cues: { ...s.DEFAULT_SOUND.cues } };
  assert.equal(s.mayPlay(on, 'error'), true);
  assert.equal(s.mayPlay({ ...on, cues: { ...on.cues, error: false } }, 'error'), false);
  assert.equal(s.mayPlay({ ...on, cues: { ...on.cues, error: false } }, 'boot'), true, 'the others are unaffected');
  assert.equal(s.mayPlay({ ...on, volume: 0 }, 'boot'), false);
  assert.ok(s.volumeToGain(0) === 0 && s.volumeToGain(100) === 1 && s.volumeToGain(50) < 0.5, 'a gentle curve');
});

test('boot, error and switch follow the projector states; plain changes make no sound', () => {
  const st = (o) => ({ terminal: 'off', ember: 'off', swish: 'off', ...o });
  assert.deepEqual(s.transitionCues(null, st({ ember: 'booting' }), null, 'ember'), [], 'the first look is not a change');
  assert.deepEqual(s.transitionCues(st({}), st({ ember: 'booting' }), null, 'ember'), ['boot']);
  assert.deepEqual(s.transitionCues(st({ ember: 'booting' }), st({ ember: 'active' }), 'ember', 'ember'), [], 'loading finishing is silent');
  assert.deepEqual(s.transitionCues(st({ ember: 'active' }), st({ ember: 'error' }), 'ember', 'ember'), ['error']);
  assert.deepEqual(s.transitionCues(st({ ember: 'error' }), st({ ember: 'error' }), 'ember', 'ember'), [], 'staying in error is silent');
  assert.deepEqual(s.transitionCues(st({ ember: 'active' }), st({ ember: 'shutting-down' }), 'ember', null), [], 'shutdown sounds when the retract starts, not here');
  const both = st({ terminal: 'active', ember: 'active' });
  assert.deepEqual(s.transitionCues(both, both, 'terminal', 'ember'), ['switch']);
  assert.deepEqual(s.transitionCues(st({ terminal: 'active' }), st({ terminal: 'active', ember: 'booting' }), 'terminal', 'ember'), ['boot'], 'a newly started module has its own sound, not a switch sound');
});

test('every placeholder cue is finite, no longer than its time, at the stated peak, and ends quietly', () => {
  for (const cue of s.CUES) {
    const a = renderCue(cue, s.CUE_MAX_S[cue]);
    assert.ok(a.length > SAMPLE_RATE * 0.05, `${cue} has some length`);
    assert.ok(a.length / SAMPLE_RATE <= s.CUE_MAX_S[cue], `${cue}: ${a.length / SAMPLE_RATE}s over ${s.CUE_MAX_S[cue]}s`);
    let peak = 0; for (const x of a) { assert.ok(Number.isFinite(x)); peak = Math.max(peak, Math.abs(x)); }
    assert.ok(Math.abs(peak - PEAK) < 1e-3, `${cue} peak ${peak}`);
    assert.ok(Math.abs(a[a.length - 1]) < 0.01, `${cue} ends without a click`);
    assert.deepEqual(a, renderCue(cue, s.CUE_MAX_S[cue]), `${cue} is deterministic`);
  }
});

test('the start-up, shutdown and switch time budgets are exactly the projection times, so sound and picture end together', async () => {
  const { BOOT_S, SHUT_S, SWITCH_S } = await import('../src/projection.ts');
  assert.equal(s.CUE_MAX_S.boot, BOOT_S); assert.equal(s.CUE_MAX_S.shutdown, SHUT_S); assert.equal(s.CUE_MAX_S.switch, SWITCH_S);
});
