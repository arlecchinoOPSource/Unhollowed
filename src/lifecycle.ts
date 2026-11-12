/**
 * The host's activation model (docs/LIFECYCLE-U11.md). Pure and framework-free so its rules are unit tested.
 *
 * - A module is `off`, `on` or `closing`. Only power-off unmounts a frame; bringing another module to the front
 *   never does, so drafts and running timers survive navigation.
 * - Exactly one `on` module is in front. Only the module in front may take keyboard focus.
 * - `closing` is the time between asking a module to save and its confirmation. It ends in `off` (saved) or back
 *   in `on` (the owner chose to keep it open because it did not confirm).
 * - `error` is a module that failed to start or did not confirm that it saved. It stays mounted and keeps its data; the
 *   owner keeps it open, retries the save, or powers it off anyway. Nothing leaves `error` by itself.
 *
 * What the projector shows (U-23) is derived from the phase and whether the frame has reported that it loaded:
 * off, booting, active, shutting-down or error (`projectorState`). The five states and their transitions:
 *
 *   off --powerOn--> booting --markReady--> active --beginPowerOff--> shutting-down --finishPowerOff--> off
 *   booting --fail--> error;  shutting-down --fail--> error;  error --keepOpen--> active (or booting if it never loaded)
 *   error --beginPowerOff--> shutting-down (retry the save);  error --finishPowerOff--> off (owner accepts the loss)
 */
export type Phase = 'off' | 'on' | 'closing' | 'error';

/** What a projector shows. */
export type ProjectorState = 'off' | 'booting' | 'active' | 'shutting-down' | 'error';

export type Rack = {
  phase: Record<string, Phase>;
  /** Modules that are on or closing, least recently in front first. */
  order: string[];
  /** The module in front, or null when none is on. */
  front: string | null;
  /**
   * Counts power-ons per module. It is part of the frame's identity: a module that was told to close has run its
   * close handling and must not be reused, so every power-on gets a brand-new frame even when the previous power-off
   * and this power-on land in the same render.
   */
  epoch: Record<string, number>;
  /** Whether the module's current frame has reported that it loaded. False from power-on until `markReady`. */
  ready: Record<string, boolean>;
};

export const initial = (names: readonly string[]): Rack => ({
  phase: Object.fromEntries(names.map(name => [name, 'off' as Phase])),
  order: [],
  front: null,
  epoch: Object.fromEntries(names.map(name => [name, 0])),
  ready: Object.fromEntries(names.map(name => [name, false])),
});

/** What the projector for `name` shows right now. */
export function projectorState(rack: Rack, name: string): ProjectorState {
  switch (rack.phase[name]) {
    case 'on': return rack.ready[name] ? 'active' : 'booting';
    case 'closing': return 'shutting-down';
    case 'error': return 'error';
    default: return 'off';
  }
}

const lastOn = (rack: Rack, except?: string): string | null =>
  [...rack.order].reverse().find(name => name !== except && rack.phase[name] === 'on') ?? null;

export function powerOn(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'off') return rack;
  return { phase: { ...rack.phase, [name]: 'on' }, order: [...rack.order, name], front: name, epoch: { ...rack.epoch, [name]: rack.epoch[name] + 1 }, ready: { ...rack.ready, [name]: false } };
}

export function bringToFront(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'on' || rack.front === name) return rack;
  return { ...rack, order: [...rack.order.filter(n => n !== name), name], front: name };
}

/** The frame loaded: the projector goes from booting to active. */
export function markReady(rack: Rack, name: string): Rack {
  if ((rack.phase[name] !== 'on' && rack.phase[name] !== 'error') || rack.ready[name]) return rack;
  return { ...rack, ready: { ...rack.ready, [name]: true } };
}

/** The module failed to start, or did not confirm that it saved. It stays mounted with its data; the owner decides. */
export function fail(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'on' && rack.phase[name] !== 'closing') return rack;
  const phase = { ...rack.phase, [name]: 'error' as Phase };
  return { ...rack, phase, front: rack.front === name ? lastOn({ ...rack, phase }, name) : rack.front };
}

/** Asks the module to save. It keeps running and keeps its state until `finishPowerOff`. Also the retry from `error`. */
export function beginPowerOff(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'on' && rack.phase[name] !== 'error') return rack;
  const phase = { ...rack.phase, [name]: 'closing' as Phase };
  return { ...rack, phase, front: rack.front === name ? lastOn({ ...rack, phase }, name) : rack.front };
}

/** The module confirmed it saved: only now is its frame removed. */
export function finishPowerOff(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'closing' && rack.phase[name] !== 'error') return rack;
  return { ...rack, phase: { ...rack.phase, [name]: 'off' }, order: rack.order.filter(n => n !== name), ready: { ...rack.ready, [name]: false } };
}

/** The module did not confirm and the owner keeps it open: nothing is lost, it is simply on again and in front. */
export function keepOpen(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'closing' && rack.phase[name] !== 'error') return rack;
  return { ...rack, phase: { ...rack.phase, [name]: 'on' }, order: [...rack.order.filter(n => n !== name), name], front: name };
}

/** Whether `name` may take keyboard focus right now. */
export const mayFocus = (rack: Rack, name: string): boolean => rack.front === name && rack.phase[name] === 'on';

/** Frames that must be mounted: everything that is not off. */
export const mounted = (rack: Rack): string[] => rack.order;

/**
 * Who owns the stage right now: the module in front, or, when none is in front, the module that is saving or in error
 * (its frame stays visible until it has retracted or the owner decided, so nothing unsaved is ever hidden).
 */
export function stageOwner(rack: Rack): string | null {
  if (rack.front) return rack.front;
  return [...rack.order].reverse().find(name => rack.phase[name] === 'closing' || rack.phase[name] === 'error') ?? null;
}
