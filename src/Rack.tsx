import type { CSSProperties } from 'react';
import manifest from './rack-manifest.json';
import type { ProjectorState } from './lifecycle';
import type { ModuleName } from './modules';

/**
 * The rack (U-21): the rendered case and the three projectors, assembled from the layers and coordinates in
 * `rack-manifest.json` (docs/RACK-U21-U23.md). Every layer is a decorative image; the only interactive parts are real
 * `<button>`s laid over the I and O rocker keys, so focus, keyboard use and screen-reader names belong to real controls.
 * What each projector shows comes from the state machine (`projectorState`), never from this file.
 */
type Rect = readonly [number, number, number, number]; // x0, x1, z0, z1 in rack units (x right, z up)
type Layer = { file: string; world_rect: Rect };
/** The manifest is plain JSON; a rectangle with a missing number would place a layer wrongly, so fail loudly. */
const rect = (v: readonly number[]): Rect => {
  if (v.length !== 4 || v.some(n => !Number.isFinite(n))) throw new Error('rack manifest: a rectangle must be four numbers');
  return v as unknown as Rect;
};
const layers = manifest.layers as unknown as Layer[];
const layer = (file: string): Layer => {
  const found = layers.find(l => l.file === file);
  if (!found) throw new Error(`rack layer missing from the manifest: ${file}`);
  return found;
};
const PLATE = layer('rack-plate.png').world_rect;
export const RACK_ASPECT = (PLATE[1] - PLATE[0]) / (PLATE[3] - PLATE[2]);
// Relative, like the module URLs: the page is served from the app's own origin root.
const BASE = 'rack/';

/** Places `r` inside the rectangle `within`, in percent of it. */
function place(r: Rect, within: Rect = PLATE): CSSProperties {
  const w = within[1] - within[0], h = within[3] - within[2];
  return { left: `${(r[0] - within[0]) / w * 100}%`, top: `${(within[3] - r[3]) / h * 100}%`, width: `${(r[1] - r[0]) / w * 100}%`, height: `${(r[3] - r[2]) / h * 100}%` };
}

const Img = ({ file, className }: { file: string; className?: string }) => <img className={className} src={`${BASE}${file}`} alt="" draggable={false} />;

export type RackActions = {
  /** The I key while the projector is off. */
  powerOn(name: ModuleName): void;
  /** The I key while it is running: bring it to the front. */
  front(name: ModuleName): void;
  /** The O key: save and close (also the retry from an error). */
  powerOff(name: ModuleName): void;
  /** The I key during an error: keep the module open. */
  keepOpen(name: ModuleName): void;
};

export function Rack({ units, states, actions }: {
  units: readonly { name: ModuleName; title: string }[];
  states: Record<ModuleName, ProjectorState>;
  actions: RackActions;
}) {
  const anyPower = units.some(u => states[u.name] !== 'off');
  const meter = manifest.meters;
  const needle = layer('vu-needle.png');
  const pivotInLayer = (manifest.layers.find(l => l.file === 'vu-needle.png') as unknown as { pivot_in_layer_world: [number, number] }).pivot_in_layer_world;
  return <div className="rack" data-powered={anyPower} style={{ '--rack-aspect': String(RACK_ASPECT) } as CSSProperties} role="group" aria-label="Projector rack">
    <Img file="rack-plate.png" />
    {meter.map((m, i) => {
      const dx = m.pivot[0] - pivotInLayer[0], dz = m.pivot[1] - pivotInLayer[1];
      const r: Rect = [needle.world_rect[0] + dx, needle.world_rect[1] + dx, needle.world_rect[2] + dz, needle.world_rect[3] + dz];
      const origin = `${(m.pivot[0] - r[0]) / (r[1] - r[0]) * 100}% ${(r[3] - m.pivot[1]) / (r[3] - r[2]) * 100}%`;
      return <div key={i} className={`rack-window m${i + 1}`} style={place(rect(m.window_rect))}>
        <div className="rack-needle" style={{ ...place(r, rect(m.window_rect)), transformOrigin: origin }}><Img file="vu-needle.png" /></div>
      </div>;
    })}
    {units.map(({ name, title }) => {
      const state = states[name];
      const unit = layer(`${name}-off.png`).world_rect;
      const keys = manifest.controls[name];
      const closing = state === 'shutting-down';
      const keyButton = (k: 'i' | 'o') => {
        const keyRect = rect(k === 'i' ? keys.key_i_rect : keys.key_o_rect);
        const pressed = k === 'i' ? state !== 'off' : state === 'off';
        const label = k === 'i' ? (state === 'off' ? `Power on ${title}` : state === 'error' ? `Keep ${title} open` : `Bring ${title} to front`) : (state === 'error' ? `Retry saving and power off ${title}` : `Power off ${title}`);
        const inert = (k === 'o' && (state === 'off')) || closing;
        const click = () => {
          if (inert) return;
          if (k === 'i') { if (state === 'off') actions.powerOn(name); else if (state === 'error') actions.keepOpen(name); else actions.front(name); }
          else actions.powerOff(name);
        };
        return <button key={k} type="button" className={`rack-key key-${k}`} style={place(keyRect, unit)} aria-label={label} aria-pressed={pressed} aria-disabled={inert || undefined} onClick={click}>
          <Img file={`${name}-key-${k}-pressed.png`} className="pressed" />
          <Img file={`${name}-key-${k}-hover.png`} className="hover" />
        </button>;
      };
      return <div key={name} className={`rack-unit s-${state}`} data-state={state} data-unit={name} style={place(unit)}>
        <Img file={`${name}-off.png`} />
        <div className="rack-box" style={place(layer(`${name}-keys-disabled.png`).world_rect, unit)}><Img file={`${name}-keys-disabled.png`} className="disabled-art" /></div>
        {keyButton('i')}{keyButton('o')}
        <Img file={`${name}-glow.png`} className="glow" />
        {/* U-24: the projection screen opens and its ring charges; `--ap`, `--so`, `--ch` are set by the hologram layer */}
        <div className="rack-box emit emit-screen" style={place(layer(`${name}-emitter-screen.png`).world_rect, unit)}><Img file={`${name}-emitter-screen.png`} /></div>
        <div className="rack-box emit emit-ring" style={place(layer(`${name}-emitter-ring.png`).world_rect, unit)}><Img file={`${name}-emitter-ring.png`} /></div>
        {[1, 2, 3].map(i => <div key={i} className={`rack-box chase c${i}`} style={place(layer(`${name}-chase-${i}.png`).world_rect, unit)}><Img file={`${name}-chase-${i}.png`} /></div>)}
        <div className="rack-box error" style={place(layer(`${name}-error.png`).world_rect, unit)}><Img file={`${name}-error.png`} /></div>
        <span className="rack-status" role="status">{title}: {state.replace('-', ' ')}</span>
      </div>;
    })}
  </div>;
}
