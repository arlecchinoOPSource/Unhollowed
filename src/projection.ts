/**
 * The hologram (U-24, docs/HOLOGRAM-U24.md): the live interface is beamed from the unit's projection screen onto the stage
 * when its I key is pressed and retracts into it on power-off. Pure and framework-free so the rules are unit tested; the
 * drawing is `Hologram.tsx`. The art and its assembly recipe are the owner's (docs/RACK-ASSETS-U17-U22.md).
 *
 * One progress value `p` per module (0 = nothing projected, 1 = fully projected) drives every piece. Booting runs 0 -> 1 in
 * 0.7 s, but holds at 0.5 until the frame has really loaded; power-off holds at 1 while the module saves and only then
 * runs 1 -> 0 in 0.9 s, so the interface never looks gone before it is saved. An error shows the interface in full at once.
 */
import type { ProjectorState } from './lifecycle';

export const BOOT_S = 0.7;
export const SHUT_S = 0.9;
export const SWITCH_S = 0.45;
export const ERROR_RISE_PER_S = 4;
/** Booting stops here until the frame reports that it loaded (the interface is not revealed before it exists). */
export const BOOT_HOLD = 0.5;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Stage margin M around the interface, from the window height: the frame, landing glow and beam need this room. */
export const stageMargin = (windowHeight: number) => Math.min(24, Math.max(12, Math.round(windowHeight * 0.028)));

export type Pieces = { aperture: number; charge: number; beam: number; beamOpacity: number; lensOpacity: number; screenOpacity: number };
export type Drive = { p: number; sw: number; retarget: boolean; err: boolean; rm: boolean };
const none: Pieces = { aperture: 0, charge: 0, beam: 0, beamOpacity: 0, lensOpacity: 0, screenOpacity: 0 };

/**
 * What one unit's own pieces (emitter screen, ring, lens, beam) show. `front` owns the stage; `prev` is the unit it just
 * took the stage from (fading out during a switch); any other unit shows nothing of the hologram.
 */
export function unitPieces(role: 'front' | 'prev' | 'none', d: Drive, errorStep = 0): Pieces {
  const settle = smooth(0.95, 1, d.p);
  if (role === 'front') {
    const k = d.retarget ? smooth(0.3, 1, d.sw) : 1; // a switch builds the new beam late
    let aperture = smooth(0, 0.25, d.p) * k, charge = smooth(0, 0.15, d.p) * (1 - 0.65 * settle) * k, beam = smooth(0.15, 0.5, d.p) * k;
    let beamOpacity = lerp(0.85, 0.22, settle), lensOpacity = aperture * lerp(0.9, 0.35, settle), screenOpacity = lerp(1, 0.6, settle);
    if (d.rm) { aperture = 1; beam = 1; beamOpacity = 0.25 * d.p * k; screenOpacity = 0.6 * d.p * k; lensOpacity = 0.35 * d.p * k; charge = 0.35 * d.p * k; }
    if (d.err && d.p > 0) { aperture = 0.5; charge = 0; beam = 1; beamOpacity = d.rm ? 0.25 : errorStep ? 0.34 : 0.16; lensOpacity = 0.5; screenOpacity = 0.8; }
    return { aperture, charge, beam, beamOpacity, lensOpacity, screenOpacity };
  }
  if (role === 'prev') {
    const out = 1 - smooth(0, 0.5, d.sw);
    return { aperture: d.rm ? 1 : 1 - smooth(0, 0.6, d.sw), charge: 0.35 * out, beam: 1, beamOpacity: 0.22 * out, lensOpacity: 0.35 * out, screenOpacity: 0.6 * out };
  }
  return none;
}

export type StagePieces = {
  live: boolean;
  /** 0..1: how much of the interface is revealed from the left; also the clip of the frame. */
  reveal: number;
  /** Whether the interface may be visible at all (reduced motion shows it at once from p = 0.5, never half-transparent). */
  appVisible: boolean;
  landingOpacity: number;
  frameOpacity: number;
  frameJitterPx: number;
  sweepOpacity: number;
};

export function stagePieces(d: Drive, errorStep = 0): StagePieces {
  const live = d.p > 0;
  const settle = smooth(0.95, 1, d.p), surface = smooth(0.5, 0.95, d.p), land = smooth(0.45, 0.6, d.p);
  const dip = d.retarget ? 0.4 + 0.6 * Math.abs(2 * d.sw - 1) : 1;
  const err = d.err && live;
  const reveal = err || d.rm ? 1 : surface;
  return {
    live,
    reveal,
    appVisible: d.rm && !err ? live && d.p >= 0.5 : live,
    landingOpacity: live ? (err ? 0.5 : d.rm ? 0.4 * d.p : land * lerp(1, 0.4, settle)) * dip : 0,
    frameOpacity: live ? (err ? 0.9 : d.rm ? 0.6 * d.p : reveal > 0 ? lerp(1, 0.6, settle) : 0) * dip : 0,
    frameJitterPx: err && !d.rm ? (errorStep ? 2 : -1) : 0,
    sweepOpacity: live && !err && !d.rm && surface > 0 && surface < 1 ? 0.8 * Math.sqrt(Math.sin(Math.PI * surface)) : 0,
  };
}

/** One thin vertical piece of the beam (see `beamSlices`). */
export type Slice = { sx: number; sw: number; dx: number; dw: number; top: number; height: number; slope: number };
type Box = { x: number; y: number; w: number; h: number };

/**
 * The beam is a trapezoid with vertical sides: its left side is the vertical line through the emitter's centre over the
 * emitter's height, its right side is the stage's left edge. The art strip (`srcW` x `srcH`) is drawn across it in thin
 * vertical slices, each a small shear, so the result is the same in every browser engine (the `matrix3d` mapping of the
 * original preview points the beam the wrong way in WebKit). `fraction` is how much of the length is grown (0..1).
 */
export function beamSlices(E: Box, T: Box, srcW: number, srcH: number, fraction: number, n = 96): Slice[] {
  const x0 = E.x + E.w / 2, x1 = T.x;
  const slices: Slice[] = [];
  const count = Math.max(0, Math.min(n, Math.ceil(n * fraction)));
  for (let i = 0; i < count; i++) {
    const f0 = i / n, f1 = (i + 1) / n, fm = (f0 + f1) / 2;
    const topAt = (f: number) => lerp(E.y, T.y, f), bottomAt = (f: number) => lerp(E.y + E.h, T.y + T.h, f);
    slices.push({
      sx: f0 * srcW, sw: (f1 - f0) * srcW, dx: lerp(x0, x1, f0), dw: lerp(x0, x1, f1) - lerp(x0, x1, f0),
      top: topAt(f0), height: bottomAt(fm) - topAt(fm), slope: (topAt(f1) - topAt(f0)) / Math.max(1e-6, lerp(x0, x1, f1) - lerp(x0, x1, f0)),
    });
  }
  void srcH;
  return slices;
}

export type StepInput = { states: Record<string, ProjectorState>; owner: string | null; rm: boolean };

/** Per-module progress and the stage hand-over, advanced by time. */
export class Projection {
  p: Record<string, number> = {};
  owner: string | null = null;
  prev: string | null = null;
  sw = 1;
  t = 0;
  private waiting = new Map<string, () => void>();
  /** Called when something outside the frame loop needs it to run again (a retract was requested). */
  onWake: (() => void) | null = null;
  constructor(names: readonly string[]) { for (const name of names) this.p[name] = 0; }

  get retargeting() { return this.prev !== null && this.sw < 1; }

  /** Resolves once `name` has fully retracted; at once when it is not on the stage or nothing is projected. */
  retract(name: string): Promise<void> {
    if (this.p[name] === 0 || name !== this.owner) { this.p[name] = 0; return Promise.resolve(); }
    return new Promise(resolve => { this.waiting.set(name, resolve); this.onWake?.(); });
  }

  step(dt: number, { states, owner, rm }: StepInput): void {
    this.t += dt;
    if (owner !== this.owner) {
      if (this.owner && owner && this.p[this.owner] > 0 && !rm) { this.prev = this.owner; this.sw = 0; }
      this.owner = owner;
    }
    if (this.prev) {
      this.sw = rm ? 1 : Math.min(1, this.sw + dt / SWITCH_S);
      if (this.sw >= 1) this.prev = null;
    }
    for (const name of Object.keys(this.p)) {
      const state = states[name], mine = name === this.owner;
      let p = this.p[name];
      switch (state) {
        case 'off': p = 0; break;
        case 'booting': if (mine) p = rm ? BOOT_HOLD : Math.min(BOOT_HOLD, p + dt / BOOT_S); break;
        case 'active': p = rm || !mine ? 1 : Math.min(1, p + dt / BOOT_S); break;
        case 'shutting-down':
          if (this.waiting.has(name)) p = rm || !mine ? 0 : Math.max(0, p - dt / SHUT_S);
          break; // otherwise it holds: the module is still saving and must not look gone
        case 'error': p = rm || !mine ? 1 : Math.min(1, p + dt * ERROR_RISE_PER_S); break;
      }
      this.p[name] = p;
      if (p === 0 && this.waiting.has(name)) { this.waiting.get(name)!(); this.waiting.delete(name); }
    }
  }

  /** The drive values for the stage and for `role`'s pieces. */
  drive(rm: boolean, err: boolean): Drive {
    return { p: this.owner ? this.p[this.owner] : 0, sw: this.sw, retarget: this.retargeting, err, rm };
  }

  /** Whether anything is still moving (the caller stops its frame loop when this is false). */
  busy(states: Record<string, ProjectorState>): boolean {
    if (this.retargeting || this.waiting.size > 0) return true;
    return Object.keys(this.p).some(name => {
      const s = states[name], p = this.p[name];
      return s === 'error' || (s === 'booting' && p < BOOT_HOLD) || (s === 'active' && p < 1);
    });
  }
}
