import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ModuleFrame } from './ModuleFrame';
import { MODULES, type ModuleName } from './modules';
import * as rackModel from './lifecycle';

const NAMES = MODULES.map(module => module.name);
type PowerOff = { flushed: boolean; waitedMs: number; lingerMs: number };

/** What the debug-only self-test and the module shim ask of the host (inert in normal use). */
declare global { interface Window { __unhlwHost?: {
  mayFocus(name: string): boolean; front(): string | null; powerOn(name: ModuleName): void; bringToFront(name: ModuleName): void; powerOff(name: ModuleName): Promise<PowerOff | null>;
}; } }

/**
 * Placeholder host for the foundation slice: one slot per module with a power switch, and the powered-on modules side
 * by side. The rules (one module in front, only it may take focus, power-off saves before removing the frame) are
 * docs/LIFECYCLE-U11.md; the projector artwork comes later (U-21, U-23).
 */
export function App() {
  const [rack, setRack] = useState(() => rackModel.initial(NAMES));
  const rackRef = useRef(rack);
  const update = useCallback((change: (rack: rackModel.Rack) => rackModel.Rack) => {
    // The ref is the truth and changes at once, so the host's answers (and a second call right after the first) never lag
    // behind a render; the state only makes the page redraw.
    rackRef.current = change(rackRef.current);
    setRack(rackRef.current);
  }, []);
  const [leaving, setLeaving] = useState<ModuleName[]>([]);
  const [unsaved, setUnsaved] = useState<Record<string, string>>({});

  const powerOn = useCallback((name: ModuleName) => update(r => rackModel.powerOn(r, name)), [update]);
  const bringToFront = useCallback((name: ModuleName) => update(r => rackModel.bringToFront(r, name)), [update]);

  /** Asks the module to save; removes its frame only once it confirms. Returns null when it was not on. */
  const powerOff = useCallback(async (name: ModuleName): Promise<PowerOff | null> => {
    if (rackRef.current.phase[name] !== 'on') return null;
    update(r => rackModel.beginPowerOff(r, name));
    setUnsaved(current => { const { [name]: _gone, ...rest } = current; return rest; });
    let result: PowerOff;
    try {
      result = await invoke<PowerOff>('host_power_off', { module: name });
    } catch (error) {
      result = { flushed: false, waitedMs: 0, lingerMs: 0 };
      setUnsaved(current => ({ ...current, [name]: String(error) }));
    }
    if (!result.flushed) {
      setUnsaved(current => ({ ...current, [name]: current[name] ?? 'It did not confirm that it saved.' }));
      return result;
    }
    // Saved: hide it at once and leave its close sound time to play, as the standalone apps do, then remove it.
    setLeaving(current => [...current, name]);
    await new Promise(resolve => setTimeout(resolve, result.lingerMs));
    setLeaving(current => current.filter(n => n !== name));
    update(r => rackModel.finishPowerOff(r, name));
    return result;
  }, [update]);

  useEffect(() => {
    window.__unhlwHost = { mayFocus: name => rackModel.mayFocus(rackRef.current, name), front: () => rackRef.current.front, powerOn, bringToFront, powerOff };
    return () => { delete window.__unhlwHost; };
  }, [powerOn, bringToFront, powerOff]);
  // Debug-only native self-test: press the power switches ourselves (inert in release builds).
  useEffect(() => { void invoke<boolean>('selftest_enabled').then(enabled => { if (enabled) MODULES.forEach(module => powerOn(module.name)); }); }, [powerOn]);

  const mounted = rackModel.mounted(rack) as ModuleName[];
  const shown = MODULES.filter(module => mounted.includes(module.name));
  return <main className="host">
    <div className="host-top">
    <header className="host-bar">
      <h1>Unhollowed</h1>
      <nav aria-label="Projectors">
        {MODULES.map(({ name, title }) => {
          const phase = rack.phase[name];
          return <span key={name} className="slot-controls">
            {phase === 'off'
              ? <button type="button" className="power" aria-pressed="false" onClick={() => powerOn(name)}>{title}: power on</button>
              : <>
                <button type="button" className="power" aria-pressed="true" disabled={phase === 'closing'} onClick={() => void powerOff(name)}>{title}: {phase === 'closing' ? 'saving…' : 'power off'}</button>
                {phase === 'on' && rack.front !== name && <button type="button" className="power" onClick={() => bringToFront(name)}>Bring {title} to front</button>}
              </>}
          </span>;
        })}
      </nav>
      <p className="note">Foundation slice. Power a module off to save and close it; close the window to quit.</p>
    </header>
    {Object.entries(unsaved).map(([name, reason]) => <div key={name} role="alert" className="unsaved">
      <strong>{MODULES.find(m => m.name === name)?.title} did not confirm that it saved.</strong> {reason}
      <button type="button" className="power" onClick={() => { setUnsaved(({ [name]: _gone, ...rest }) => rest); update(r => rackModel.keepOpen(r, name as ModuleName)); }}>Keep it open</button>
      <button type="button" className="power" onClick={() => { setUnsaved(({ [name]: _gone, ...rest }) => rest); update(r => rackModel.finishPowerOff(r, name as ModuleName)); }}>Power off anyway (unsaved changes are lost)</button>
    </div>)}
    </div>
    <section className="stage" aria-label="Active modules" style={{ gridTemplateColumns: `repeat(${Math.max(shown.length, 1)}, minmax(0, 1fr))` }}>
      {shown.length
        ? shown.map(module => <ModuleFrame key={`${module.name}-${rack.epoch[module.name]}`} name={module.name} title={module.title} front={rack.front === module.name} leaving={leaving.includes(module.name)} onFront={bringToFront} />)
        : <p className="idle">All projectors are off.</p>}
    </section>
  </main>;
}
