/**
 * Placeholder rack sounds, made from maths (U-26, docs/SOUND-U26.md): original, nothing to license, and deterministic, so
 * their length, level and shape are unit tested. They stand in until the sounds the owner chooses are in `public/rack-audio/`;
 * the engine prefers a file there when it exists. They are plain, short and quiet: relay clicks, a rising and a falling
 * power sweep, a double low pulse for an error, a two-note blip for a switch, and a dull thud for a key that is not usable.
 */
import type { Cue } from './sound';

export const SAMPLE_RATE = 44100;
/** Peak level of every cue (linear, 0..1): headroom so overlapping cues and the master volume never clip. */
export const PEAK = 0.5;

function noise(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2147483648 - 1; }; }
const env = (t: number, attack: number, decay: number) => Math.min(1, t / attack) * Math.exp(-t / decay);

/** Mono samples for `cue`, a little shorter than `maxSeconds` (its time budget, `CUE_MAX_S`), peaking at `PEAK`. */
export function renderCue(cue: Cue, maxSeconds: number, sampleRate = SAMPLE_RATE): Float32Array {
  const seconds = maxSeconds * (cue === 'boot' || cue === 'shutdown' ? 0.92 : 0.9);
  const n = Math.floor(seconds * sampleRate), out = new Float32Array(n), rnd = noise(cue.length * 7919 + cue.charCodeAt(0));
  const click = (t: number, at: number, level: number, pitch: number) => { const x = t - at; if (x < 0 || x > 0.12) return 0; return level * (rnd() * 0.55 * env(x, 0.0006, 0.006) + Math.sin(2 * Math.PI * pitch * x) * env(x, 0.001, 0.035)); };
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate; let v = 0;
    switch (cue) {
      case 'key-on': v = click(t, 0, 1, 95); break;
      case 'key-off': v = click(t, 0, 0.85, 70); break;
      case 'blocked': v = 0.7 * Math.sin(2 * Math.PI * 62 * t) * env(t, 0.002, 0.04); break;
      case 'boot': { // relay, then a power sweep rising to the moment the beam lands, then a soft lock tick
        const p = Math.min(1, t / (seconds * 0.7)); const f = 110 + 430 * p * p; phase += 2 * Math.PI * f / sampleRate;
        v = click(t, 0, 0.9, 90) + 0.38 * (Math.sin(phase) + 0.35 * Math.sin(2 * phase)) * Math.min(1, t / 0.08) * (1 - smoothTail(t, seconds * 0.7, seconds * 0.95)) + click(t, seconds * 0.7, 0.45, 640);
        break;
      }
      case 'shutdown': { // a falling sweep that dies away, ending in a dull thud
        const p = Math.min(1, t / (seconds * 0.85)); const f = 480 - 400 * p; phase += 2 * Math.PI * f / sampleRate;
        v = 0.42 * (Math.sin(phase) + 0.3 * Math.sin(2 * phase)) * (1 - p) * (1 - p * 0.3) + click(t, seconds * 0.85, 0.7, 60);
        break;
      }
      case 'error': // two low pulses: the shape, not only the pitch, tells it apart from the rest
        v = 0.8 * Math.sign(Math.sin(2 * Math.PI * 140 * t)) * 0.5 * (Math.sin(2 * Math.PI * 140 * t) * 0.5 + 0.5) * (gate(t, 0, 0.12) + gate(t, 0.22, 0.34)) * 0.8; break;
      case 'switch': v = 0.5 * (Math.sin(2 * Math.PI * 520 * t) * gate(t, 0, 0.09) + Math.sin(2 * Math.PI * 690 * t) * gate(t, 0.09, 0.2)) * Math.exp(-((t % 0.09) / 0.07)); break;
    }
    out[i] = v;
  }
  // no click at the end of the buffer, and a known peak
  const tail = Math.min(n, Math.floor(0.004 * sampleRate));
  for (let i = 0; i < tail; i++) out[n - 1 - i] *= i / tail;
  let peak = 0; for (const x of out) peak = Math.max(peak, Math.abs(x));
  const k = peak > 0 ? PEAK / peak : 0; for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}
const smoothTail = (t: number, a: number, b: number) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const gate = (t: number, a: number, b: number) => (t >= a && t < b ? Math.min(1, (t - a) / 0.004, (b - t) / 0.01) : 0);
