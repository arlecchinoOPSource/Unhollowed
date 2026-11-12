/**
 * Plays the host's rack sounds (U-26, docs/SOUND-U26.md). Everything a caller can do here is safe: `play` never throws,
 * never waits and never blocks power-on, power-off or a save; with sound off, no device, a locked audio context or a broken
 * file it simply reports that nothing sounded. The environment (audio context, sound source, storage) is injected so the
 * failure paths are unit tested with fakes; `hostSoundDefault.ts` binds the real ones.
 */
import type { Cue, SoundSettings } from './sound';

export interface BufferLike { readonly duration: number }
export interface SourceLike { buffer: BufferLike | null; connect(node: unknown): unknown; start(when?: number): void; stop(): void; onended: (() => void) | null }
export interface GainLike { gain: { value: number }; connect(node: unknown): unknown }
export interface ContextLike {
  readonly state: string; readonly destination: unknown;
  resume(): Promise<void>; createGain(): GainLike; createBufferSource(): SourceLike;
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike & { getChannelData(channel: number): Float32Array };
}
export type Deps = {
  createContext: () => ContextLike | null;
  /** The sound for a cue (placeholder synth now, a file later): mono samples at the context's sample rate. */
  render: (cue: Cue, sampleRate: number) => Float32Array;
  settings: { mayPlay: (s: SoundSettings, cue: Cue) => boolean; gain: (volume: number) => number };
  initial: SoundSettings;
  save: (s: SoundSettings) => void;
};
export type LogEntry = { cue: Cue; played: boolean; reason: string };
const SAMPLE_RATE = 44100;
/** A cue that had to wait for the audio to unlock still sounds if that took no longer than this. */
const UNLOCK_GRACE_MS = 400;

export class HostSound {
  private context: ContextLike | null = null;
  private master: GainLike | null = null;
  private buffers = new Map<Cue, BufferLike>();
  private live = new Set<SourceLike>();
  private _settings: SoundSettings;
  /** Every request and what became of it (read by the debug-only self-test and the settings dialog's tests). */
  readonly log: LogEntry[] = [];
  private deps: Deps;
  constructor(deps: Deps) { this.deps = deps; this._settings = deps.initial; }

  get settings(): SoundSettings { return this._settings; }

  /** Applies new settings and (unless `persist` is false, as the self-test does) stores them for the next run. */
  setSettings(next: SoundSettings, persist = true): void {
    this._settings = next;
    if (persist) { try { this.deps.save(next); } catch { /* storage may be unavailable; the settings still apply for this run */ } }
    if (!next.enabled || next.volume === 0) this.stopAll();
    if (this.master) this.master.gain.value = this.deps.settings.gain(next.volume);
  }

  /** Plays `cue` if the settings allow it. Safe to call from any handler, in a user gesture or not. */
  play(cue: Cue): boolean {
    if (!this.deps.settings.mayPlay(this._settings, cue)) return this.record(cue, false, 'switched off');
    return this.start(cue);
  }

  /** Plays `cue` for the settings dialog even while sound is off (volume still applies). */
  preview(cue: Cue): boolean {
    if (this._settings.volume === 0) return this.record(cue, false, 'volume is 0');
    return this.start(cue);
  }

  stopAll(): void {
    for (const source of [...this.live]) { try { source.stop(); } catch { /* already finished */ } }
    this.live.clear();
  }

  private record(cue: Cue, played: boolean, reason: string): boolean {
    this.log.push({ cue, played, reason }); if (this.log.length > 200) this.log.shift();
    return played;
  }

  private start(cue: Cue): boolean {
    try {
      const context = this.ensureContext();
      if (!context) return this.record(cue, false, 'no audio device');
      // A context starts suspended until a gesture, and `resume()` finishes a moment later even inside one: the very first
      // click would otherwise be lost. So when it is not running yet, ask it to resume and sound the cue as soon as it does
      // (only if that is quick enough to still belong to the click). The caller never waits.
      if (context.state !== 'running') {
        const asked = Date.now();
        void context.resume().then(() => {
          if (context.state === 'running' && Date.now() - asked <= UNLOCK_GRACE_MS) this.sound(context, cue, 'played after the audio unlocked');
        }).catch(() => undefined);
        return this.record(cue, false, 'audio locked until a click or key press');
      }
      return this.sound(context, cue, 'played');
    } catch (error) {
      return this.record(cue, false, `audio failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private sound(context: ContextLike, cue: Cue, reason: string): boolean {
    try {
      let buffer = this.buffers.get(cue);
      if (!buffer) {
        const samples = this.deps.render(cue, SAMPLE_RATE);
        const made = context.createBuffer(1, samples.length, SAMPLE_RATE);
        made.getChannelData(0).set(samples);
        this.buffers.set(cue, made); buffer = made;
      }
      const source = context.createBufferSource();
      source.buffer = buffer; source.connect(this.master); source.onended = () => this.live.delete(source);
      this.live.add(source); source.start();
      return this.record(cue, true, reason);
    } catch (error) {
      return this.record(cue, false, `audio failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ensureContext(): ContextLike | null {
    if (this.context) return this.context;
    // (a creation that threw is simply tried again on the next request: the device may come back)
    const context = this.deps.createContext();
    if (!context) return null;
    const master = context.createGain(); master.gain.value = this.deps.settings.gain(this._settings.volume); master.connect(context.destination);
    this.context = context; this.master = master;
    return context;
  }
}
