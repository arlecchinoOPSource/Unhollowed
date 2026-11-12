import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSound } from '../src/hostSound.ts';

// Fakes: a context whose state, creation and source can be made to fail, so F8's "failure-tolerant" is exercised.
function world({ state = 'running', unlocks = false, createThrows = false, noContext = false, sourceThrows = false, saveThrows = false } = {}) {
  const started = [], saved = [], gains = [];
  const ctx = {
    state, destination: {}, resumes: 0,
    resume() { this.resumes++; if (unlocks) this.state = 'running'; return Promise.resolve(); },
    createGain() { const g = { gain: { set value(v) { gains.push(v); } }, connect() {} }; return g; },
    createBuffer(c, len) { return { duration: len / 44100, getChannelData: () => new Float32Array(len) }; },
    createBufferSource() { if (sourceThrows) throw new Error('no source'); const s = { buffer: null, connect() {}, start() { started.push(s.buffer); }, stop() { s.stopped = true; }, onended: null }; world.sources.push(s); return s; },
  };
  world.sources = [];
  const deps = {
    createContext: () => { if (createThrows) throw new Error('no device'); return noContext ? null : ctx; },
    render: (cue) => new Float32Array(4410),
    settings: { mayPlay: (s, cue) => s.enabled && s.volume > 0 && s.cues[cue], gain: v => (v / 100) ** 2 },
    initial: { enabled: true, volume: 70, cues: { 'key-on': true, 'key-off': true, boot: true, shutdown: true, error: true, switch: true, blocked: false } },
    save: s => { if (saveThrows) throw new Error('storage full'); saved.push(s); },
  };
  return { deps, ctx, started, saved, gains };
}

test('a cue that is allowed plays once, and the request is logged', () => {
  const w = world(); const h = new HostSound(w.deps);
  assert.equal(h.play('boot'), true);
  assert.equal(w.started.length, 1);
  assert.deepEqual(h.log.at(-1), { cue: 'boot', played: true, reason: 'played' });
});

test('switched off, a cue switched off, or volume 0: nothing sounds and nothing is created', () => {
  const w = world(); const h = new HostSound({ ...w.deps, initial: { ...w.deps.initial, enabled: false } });
  assert.equal(h.play('boot'), false); assert.equal(h.log.at(-1).reason, 'switched off');
  const h2 = new HostSound(world().deps); assert.equal(h2.play('blocked'), false, 'that cue is off');
  const h3 = new HostSound({ ...world().deps, initial: { ...w.deps.initial, volume: 0 } }); assert.equal(h3.play('boot'), false);
  assert.equal(w.started.length, 0);
});

test('failure never reaches the caller: no device, a throwing device, a throwing source, a locked context', () => {
  for (const opts of [{ noContext: true }, { createThrows: true }, { sourceThrows: true }, { state: 'suspended' }]) {
    const w = world(opts); const h = new HostSound(w.deps);
    let result; assert.doesNotThrow(() => { result = h.play('error'); });
    assert.equal(result, false, JSON.stringify(opts));
    assert.equal(h.log.at(-1).played, false);
  }
  const locked = world({ state: 'suspended' }); new HostSound(locked.deps).play('boot');
  assert.ok(locked.ctx.resumes >= 1, 'a locked context is asked to resume, without waiting');
});

test('a device that failed once is tried again on the next request', () => {
  const w = world(); let fail = true;
  const h = new HostSound({ ...w.deps, createContext: () => { if (fail) throw new Error('busy'); return w.ctx; } });
  assert.equal(h.play('boot'), false); fail = false;
  assert.equal(h.play('boot'), true);
});

test('settings are saved when changed, survive a storage failure, and volume reaches the master gain', () => {
  const w = world(); const h = new HostSound(w.deps); h.play('boot');
  h.setSettings({ ...h.settings, volume: 50 });
  assert.equal(w.saved.length, 1); assert.equal(w.gains.at(-1), 0.25);
  const bad = world({ saveThrows: true }); const h2 = new HostSound(bad.deps);
  assert.doesNotThrow(() => h2.setSettings({ ...h2.settings, volume: 10 })); assert.equal(h2.settings.volume, 10, 'applies for this run');
});

test('switching sound off stops what is sounding', () => {
  const w = world(); const h = new HostSound(w.deps); h.play('boot'); h.play('shutdown');
  const sources = world.sources.slice();
  h.setSettings({ ...h.settings, enabled: false });
  assert.ok(sources.length >= 2 && sources.every(s => s.stopped === true));
});

test('the settings dialog can preview a cue while sound is off, but not at volume 0', () => {
  const w = world(); const h = new HostSound({ ...w.deps, initial: { ...w.deps.initial, enabled: false } });
  assert.equal(h.preview('boot'), true);
  const h0 = new HostSound({ ...world().deps, initial: { ...w.deps.initial, volume: 0 } }); assert.equal(h0.preview('boot'), false);
});

test('settings applied without persisting leave storage untouched', () => {
  const w = world(); const h = new HostSound(w.deps);
  h.setSettings({ ...h.settings, volume: 20 }, false);
  assert.equal(w.saved.length, 0); assert.equal(h.settings.volume, 20);
});

test('the first click is not lost: a locked context that unlocks right away still sounds the cue', async () => {
  const w = world({ state: 'suspended', unlocks: true }); const h = new HostSound(w.deps);
  assert.equal(h.play('key-on'), false, 'the call itself never waits');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(w.started.length, 1);
  assert.deepEqual(h.log.at(-1), { cue: 'key-on', played: true, reason: 'played after the audio unlocked' });
});

test('a context that stays locked never sounds anything and never throws', async () => {
  const w = world({ state: 'suspended' }); const h = new HostSound(w.deps);
  h.play('key-on'); await new Promise(r => setTimeout(r, 5));
  assert.equal(w.started.length, 0);
});
