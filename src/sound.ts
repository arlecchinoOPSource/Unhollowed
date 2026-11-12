/**
 * The host's rack sounds (U-26, docs/SOUND-U26.md): which sound goes with which event, the settings, and the time each may
 * take. Pure and framework-free so the rules are unit tested; playing is `hostSound.ts`, and the sounds themselves are
 * `synth.ts` (placeholders) or files in `public/rack-audio/` (later). Modules keep their own sounds (docs/HOST-CONTRACT-U35.md);
 * the host plays only rack and projector sounds.
 *
 * Rules (spec F8): sound is optional (off until the person turns it on), independently adjustable (master volume and one
 * switch per cue), failure-tolerant (a missing device or a broken file never blocks power-on, power-off or saving) and never
 * tied to reduced motion (that is a separate setting, and does not mute anything).
 */
import type { ProjectorState } from './lifecycle';

export const CUES = ['key-on', 'key-off', 'boot', 'shutdown', 'error', 'switch', 'blocked'] as const;
export type Cue = (typeof CUES)[number];

/** What the person sees in the settings: a plain name for each cue. */
export const CUE_LABELS: Record<Cue, string> = {
  'key-on': 'Power key (I)', 'key-off': 'Power key (O)', boot: 'Projector starting', shutdown: 'Projector shutting down',
  error: 'Error', switch: 'Switching module', blocked: 'Key that cannot be used now',
};

/**
 * The longest each cue may be, in seconds. A start-up sound must be over by the time the projector is up and a shutdown sound
 * by the time the interface has retracted, so sound and picture end together; the rest are short on purpose.
 */
export const CUE_MAX_S: Record<Cue, number> = { 'key-on': 0.2, 'key-off': 0.2, boot: 0.7, shutdown: 0.9, error: 0.6, switch: 0.45, blocked: 0.2 };
// (0.7 / 0.9 / 0.45 are `BOOT_S` / `SHUT_S` / `SWITCH_S` in projection.ts; a test fails if they ever drift apart)

export type SoundSettings = { enabled: boolean; volume: number; cues: Record<Cue, boolean> };
export const SOUND_KEY = 'unhlw.host.sound.v1';
export const DEFAULT_SOUND: Readonly<SoundSettings> = Object.freeze({
  enabled: false, volume: 70, cues: Object.freeze(Object.fromEntries(CUES.map(cue => [cue, true])) as Record<Cue, boolean>) as Record<Cue, boolean>,
});

/** Reads stored settings; anything unreadable falls back to the defaults, never to a thrown error. */
export function parseSoundSettings(raw: unknown): SoundSettings {
  let value: unknown = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { value = null; } }
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const cuesIn = (v.cues && typeof v.cues === 'object' ? v.cues : {}) as Record<string, unknown>;
  const volume = typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.round(Math.min(100, Math.max(0, v.volume))) : DEFAULT_SOUND.volume;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : DEFAULT_SOUND.enabled,
    volume,
    cues: Object.fromEntries(CUES.map(cue => [cue, typeof cuesIn[cue] === 'boolean' ? cuesIn[cue] : DEFAULT_SOUND.cues[cue]])) as Record<Cue, boolean>,
  };
}

/** Perceptual volume: 0..100 on screen, a gentle curve in gain so the low end is usable. */
export const volumeToGain = (volume: number): number => { const v = Math.min(1, Math.max(0, volume / 100)); return v * v; };

/** Whether `cue` may sound at all with these settings. */
export const mayPlay = (s: SoundSettings, cue: Cue): boolean => s.enabled && s.volume > 0 && s.cues[cue];

/**
 * The cues a change of projector states calls for. Key clicks and the shutdown sound are not here: a click is made by the key
 * handler (it must sound at once, in the gesture that unlocks audio), and shutdown starts when the retract does, which is
 * after the save is confirmed, not when power-off is pressed.
 */
export function transitionCues(prev: Record<string, ProjectorState> | null, next: Record<string, ProjectorState>, prevOwner: string | null, nextOwner: string | null): Cue[] {
  if (!prev) return [];
  const cues: Cue[] = [];
  for (const name of Object.keys(next)) {
    const before = prev[name], after = next[name];
    if (before === after) continue;
    if (before === 'off' && after === 'booting') cues.push('boot');
    if (after === 'error' && before !== 'error') cues.push('error');
  }
  // the stage changed hands between two modules that are both up (a module that just started has its own boot sound)
  if (prevOwner && nextOwner && prevOwner !== nextOwner && prev[nextOwner] === 'active' && next[nextOwner] === 'active' && next[prevOwner] === 'active') cues.push('switch');
  return cues;
}
