/**
 * The host's activation model (docs/LIFECYCLE-U11.md). Pure and framework-free so its rules are unit tested.
 *
 * - A module is `off`, `on` or `closing`. Only power-off unmounts a frame; bringing another module to the front
 *   never does, so drafts and running timers survive navigation.
 * - Exactly one `on` module is in front. Only the module in front may take keyboard focus.
 * - `closing` is the time between asking a module to save and its confirmation. It ends in `off` (saved) or back
 *   in `on` (the owner chose to keep it open because it did not confirm).
 */
export type Phase = 'off' | 'on' | 'closing';

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
};

export const initial = (names: readonly string[]): Rack => ({
  phase: Object.fromEntries(names.map(name => [name, 'off' as Phase])),
  order: [],
  front: null,
  epoch: Object.fromEntries(names.map(name => [name, 0])),
});

const lastOn = (rack: Rack, except?: string): string | null =>
  [...rack.order].reverse().find(name => name !== except && rack.phase[name] === 'on') ?? null;

export function powerOn(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'off') return rack;
  return { phase: { ...rack.phase, [name]: 'on' }, order: [...rack.order, name], front: name, epoch: { ...rack.epoch, [name]: rack.epoch[name] + 1 } };
}

export function bringToFront(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'on' || rack.front === name) return rack;
  return { ...rack, order: [...rack.order.filter(n => n !== name), name], front: name };
}

/** Asks the module to save. It keeps running and keeps its state until `finishPowerOff`. */
export function beginPowerOff(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'on') return rack;
  const phase = { ...rack.phase, [name]: 'closing' as Phase };
  return { ...rack, phase, front: rack.front === name ? lastOn({ ...rack, phase }, name) : rack.front };
}

/** The module confirmed it saved: only now is its frame removed. */
export function finishPowerOff(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'closing') return rack;
  return { ...rack, phase: { ...rack.phase, [name]: 'off' }, order: rack.order.filter(n => n !== name) };
}

/** The module did not confirm and the owner keeps it open: nothing is lost, it is simply on again and in front. */
export function keepOpen(rack: Rack, name: string): Rack {
  if (rack.phase[name] !== 'closing') return rack;
  return { ...rack, phase: { ...rack.phase, [name]: 'on' }, order: [...rack.order.filter(n => n !== name), name], front: name };
}

/** Whether `name` may take keyboard focus right now. */
export const mayFocus = (rack: Rack, name: string): boolean => rack.front === name && rack.phase[name] === 'on';

/** Frames that must be mounted: everything that is not off. */
export const mounted = (rack: Rack): string[] => rack.order;
