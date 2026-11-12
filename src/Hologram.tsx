import { useEffect, useRef } from 'react';
import manifest from './rack-manifest.json';
import type { ProjectorState } from './lifecycle';
import type { ModuleName } from './modules';
import { beamSlices, Projection, stagePieces, unitPieces } from './projection';

/**
 * The hologram layer (U-24, docs/HOLOGRAM-U24.md). Everything here is decorative: the overlay is `aria-hidden` and ignores
 * the pointer, and no piece is ever drawn over interface pixels that are already revealed (the frame's inner part is
 * transparent, the beam and landing glow end at the stage edge, the reveal line sits on the not-yet-revealed side). The
 * live interface itself is only *clipped* (CSS variable `--surface-<unit>` read by `.module-slot`), never covered or copied.
 * Drawing follows `Projection` (pure, tested); the beam is drawn on a canvas in thin slices, not with a `matrix3d` quad,
 * because WebKit (macOS) maps that quad the wrong way.
 */
type Box = { x: number; y: number; w: number; h: number };
type Rect = readonly [number, number, number, number];
const holo = manifest.hologram;
const PLATE = (manifest.layers.find(l => l.file === 'rack-plate.png') as unknown as { world_rect: Rect }).world_rect;
const rgb = (c: readonly number[]) => `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
const EMITTER = holo.emitters as unknown as Record<ModuleName, { screen_rect_E: Rect; colour_css_rgb: number[] }>;
const ERROR_RGB = rgb(holo.error_colour_css_rgb);
const BASE = 'rack/';
const SLICES = 96;

const loadImage = (file: string) => new Promise<HTMLImageElement>((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = BASE + file; });
function tinted(img: HTMLImageElement, colour: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d')!; x.drawImage(img, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = colour; x.fillRect(0, 0, c.width, c.height);
  return c;
}

type Art = { strip: HTMLImageElement; stripError: HTMLImageElement; tile: HTMLImageElement };
type Beam = { E: Box; T: Box; fraction: number; colour: string; error: boolean; opacity: number };

function drawBeams(canvas: HTMLCanvasElement, beams: Beam[], art: Art, cache: Map<string, HTMLCanvasElement>) {
  const dpr = window.devicePixelRatio || 1, ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter'; // additive, like the rest of the light
  const colored = (img: HTMLImageElement, key: string, colour: string) => { const k = key + colour; let c = cache.get(k); if (!c) { c = tinted(img, colour); cache.set(k, c); } return c; };
  for (const b of beams) {
    if (b.opacity <= 0 || b.fraction <= 0) continue;
    const src = b.error ? art.stripError : art.strip;
    const strip = colored(src, b.error ? 'e' : 's', b.colour);
    const sw = strip.width, sh = strip.height;
    ctx.globalAlpha = b.opacity;
    for (const s of beamSlices(b.E, b.T, sw, sh, b.fraction, SLICES)) {
      const a = s.dw / s.sw;
      ctx.setTransform(dpr * a, dpr * a * s.slope, 0, dpr * (s.height / sh), dpr * (s.dx - s.sx * a), dpr * (s.top - s.sx * a * s.slope));
      ctx.drawImage(strip, s.sx, 0, s.sw, sh, s.sx, 0, s.sw, sh);
    }
    // a faint scanning texture inside the beam, clipped to the grown part of it
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x0 = b.E.x + b.E.w / 2, x1 = x0 + (b.T.x - x0) * b.fraction, f = b.fraction;
    ctx.save(); ctx.beginPath();
    ctx.moveTo(x0, b.E.y); ctx.lineTo(x1, b.E.y + (b.T.y - b.E.y) * f); ctx.lineTo(x1, b.E.y + b.E.h + (b.T.y + b.T.h - b.E.y - b.E.h) * f); ctx.lineTo(x0, b.E.y + b.E.h); ctx.closePath(); ctx.clip();
    const pattern = ctx.createPattern(colored(art.tile, 't', b.colour), 'repeat');
    if (pattern) { ctx.globalAlpha = b.opacity * 0.5; ctx.fillStyle = pattern; ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr); }
    ctx.restore();
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

export function Hologram({ projection, units, states, owner }: {
  projection: Projection; units: readonly ModuleName[]; states: Record<ModuleName, ProjectorState>; owner: string | null;
}) {
  const root = useRef<HTMLDivElement>(null);
  const live = useRef({ states, owner });
  live.current = { states, owner };

  useEffect(() => {
    const overlay = root.current!;
    const workspace = overlay.parentElement as HTMLElement;
    const canvas = overlay.querySelector('canvas')!;
    const part = <T extends HTMLElement>(sel: string) => overlay.querySelector(sel) as T;
    const lenses = Object.fromEntries(units.map(u => [u, part<HTMLDivElement>(`[data-lens="${u}"]`)])) as Record<ModuleName, HTMLDivElement>;
    const landing = part<HTMLDivElement>('[data-part="landing"]'), frame = part<HTMLDivElement>('[data-part="frame"]');
    const sweepBox = part<HTMLDivElement>('[data-part="sweep-box"]'), sweep = part<HTMLDivElement>('[data-part="sweep"]');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let rm = media.matches; const onMedia = () => { rm = media.matches; signature = ''; kick(); }; media.addEventListener('change', onMedia);
    let art: Art | null = null; const cache = new Map<string, HTMLCanvasElement>();
    let frameId = 0, last = 0, signature = '', stopped = false;

    const measure = () => {
      const w = workspace.getBoundingClientRect(), r = workspace.querySelector('.rack')?.getBoundingClientRect(), st = workspace.querySelector('.stage');
      if (!r || !st) return null;
      const sr = st.getBoundingClientRect(), cs = getComputedStyle(st);
      const pl = parseFloat(cs.paddingLeft), pt = parseFloat(cs.paddingTop), pr = parseFloat(cs.paddingRight), pb = parseFloat(cs.paddingBottom);
      const T: Box = { x: sr.left - w.left + pl, y: sr.top - w.top + pt, w: sr.width - pl - pr, h: sr.height - pt - pb };
      const k = r.height / (PLATE[3] - PLATE[2]), ox = r.left - w.left, oy = r.top - w.top;
      const px = (e: Rect): Box => ({ x: ox + (e[0] - PLATE[0]) * k, y: oy + (PLATE[3] - e[3]) * k, w: (e[1] - e[0]) * k, h: (e[3] - e[2]) * k });
      return { W: w, T, M: pt / 1.5, px };
    };

    const render = (now: number) => {
      frameId = 0;
      const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
      const { states: st, owner: own } = live.current;
      projection.step(dt, { states: st, owner: own, rm });
      const g = measure();
      const err = !!own && st[own as ModuleName] === 'error';
      const step = Math.floor(projection.t * 2) % 2;
      const drive = projection.drive(rm, err);
      const stage = stagePieces(drive, step);
      // the interface: only ever clipped, from the left; the slot's own visibility follows who owns the stage
      for (const u of units) workspace.style.setProperty(`--surface-${u}`, u === own && stage.appVisible ? String(stage.reveal) : u === own ? '0' : '1');
      if (g && art) {
        const col = (u: ModuleName) => rgb(EMITTER[u].colour_css_rgb);
        const beams: Beam[] = [];
        for (const u of units) {
          const role = u === own ? 'front' : u === projection.prev && projection.retargeting ? 'prev' : 'none';
          const pieces = unitPieces(role, drive, step);
          const el = workspace.querySelector(`.rack-unit[data-unit="${u}"]`) as HTMLElement | null;
          el?.style.setProperty('--ap', String(pieces.aperture)); el?.style.setProperty('--so', String(pieces.screenOpacity)); el?.style.setProperty('--ch', String(pieces.charge));
          const E = g.px(EMITTER[u].screen_rect_E), cx = E.x + E.w / 2, cy = E.y + E.h / 2, ls = E.w * 2.4;
          const colour = err && role === 'front' ? ERROR_RGB : col(u);
          Object.assign(lenses[u].style, { left: `${cx - ls / 2}px`, top: `${cy - ls / 2}px`, width: `${ls}px`, height: `${ls}px`, opacity: String(pieces.lensOpacity), background: colour });
          if (pieces.beam > 0 && pieces.beamOpacity > 0) beams.push({ E, T: g.T, fraction: pieces.beam, colour, error: err && role === 'front', opacity: pieces.beamOpacity });
        }
        const dpr = window.devicePixelRatio || 1, cw = Math.round(g.W.width * dpr), ch = Math.round(g.W.height * dpr);
        if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; signature = ''; }
        const sig = JSON.stringify([beams.map(b => [b.E.x, b.E.y, b.fraction.toFixed(4), b.opacity.toFixed(3), b.colour, b.error]), g.T, cw, ch]);
        if (sig !== signature) { signature = sig; drawBeams(canvas, beams, art, cache); }
        // stage pieces take the colour of whichever unit owns the stage (the previous one for the first half of a switch)
        const ownerNow = projection.retargeting && projection.sw < 0.5 ? projection.prev : own;
        const colour = err ? ERROR_RGB : ownerNow ? col(ownerNow as ModuleName) : 'transparent';
        const T = g.T, M = g.M;
        Object.assign(landing.style, { left: `${T.x - M}px`, top: `${T.y}px`, width: `${M}px`, height: `${T.h}px`, background: colour, opacity: String(stage.landingOpacity) });
        Object.assign(frame.style, { left: `${T.x - M + stage.frameJitterPx}px`, top: `${T.y - M}px`, width: `${T.w + 2 * M}px`, height: `${T.h + 2 * M}px`, borderWidth: `${1.5 * M}px`, opacity: String(stage.frameOpacity),
          clipPath: stage.reveal < 1 ? `inset(0 ${(1 - stage.reveal) * (T.w + M) / (T.w + 2 * M) * 100}% 0 0)` : 'none' });
        frame.style.borderImage = `url(${BASE}${err ? 'hologram-frame-error-9slice.png' : `${ownerNow ?? 'terminal'}-hologram-frame-9slice.png`}) 96 / ${1.5 * M}px ${err ? 'round' : 'stretch'}`;
        Object.assign(sweepBox.style, { left: `${T.x}px`, top: `${T.y}px`, width: `${T.w}px`, height: `${T.h}px` });
        Object.assign(sweep.style, { left: `${stage.reveal * T.w}px`, width: `${T.w * 0.06}px`, background: colour, opacity: String(stage.sweepOpacity) });
        overlay.dataset.shimmer = !rm && !err && projection.owner && st[projection.owner as ModuleName] === 'active' ? 'on' : 'off';
      }
      if (projection.busy(st) || err || signature === '') frameId = requestAnimationFrame(render);
    };
    const kick = () => { if (!frameId && !stopped) { last = performance.now(); frameId = requestAnimationFrame(render); } };
    // the host asks for another frame whenever its inputs change
    (overlay as HTMLElement & { kick?: () => void }).kick = kick;
    projection.onWake = kick;

    void Promise.all([loadImage('hologram-beam-strip.png'), loadImage('hologram-beam-strip-error.png'), loadImage('hologram-tile-scan.png')])
      .then(([strip, stripError, tile]) => { art = { strip, stripError, tile }; signature = ''; kick(); }).catch(() => undefined);
    const resize = new ResizeObserver(() => { signature = ''; kick(); }); resize.observe(workspace);
    kick();
    return () => { stopped = true; projection.onWake = null; cancelAnimationFrame(frameId); resize.disconnect(); media.removeEventListener('change', onMedia); };
  }, [projection, units]);

  // inputs changed: draw again (the loop stops itself when nothing moves)
  useEffect(() => { (root.current as (HTMLElement & { kick?: () => void }) | null)?.kick?.(); }, [states, owner]);

  const masked = (file: string) => ({ WebkitMaskImage: `url(${BASE}${file})`, maskImage: `url(${BASE}${file})` });
  return <div ref={root} className="holo" aria-hidden="true">
    <canvas className="holo-beam" />
    {units.map(u => <div key={u} className="holo-tint holo-lens" data-lens={u} style={masked('hologram-lens.png')} />)}
    <div className="holo-tint" data-part="landing" style={masked('hologram-landing.png')} />
    <div className="holo-frame" data-part="frame" />
    <div className="holo-sweep-box" data-part="sweep-box"><div className="holo-tint" data-part="sweep" style={masked('hologram-sweep.png')} /></div>
  </div>;
}
