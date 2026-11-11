import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ModuleFrame } from './ModuleFrame';
import { MODULES, type ModuleName } from './modules';

/**
 * Placeholder host for the foundation slice: one projector slot per module with a power switch, and the active
 * modules side by side. Power-off, the projector state machine and the rack artwork come later (U-11, U-23, U-21).
 */
export function App() {
  const [on, setOn] = useState<ModuleName[]>([]);
  const active = MODULES.filter(module => on.includes(module.name));
  // Debug-only native self-test: press the power switches ourselves (inert in release builds).
  useEffect(() => { void invoke<boolean>('selftest_enabled').then(enabled => { if (enabled) setOn(MODULES.map(module => module.name)); }); }, []);
  return <main className="host">
    <header className="host-bar">
      <h1>Unhollowed</h1>
      <nav aria-label="Projectors">
        {MODULES.map(module => <button key={module.name} type="button" className="power" aria-pressed={on.includes(module.name)}
          disabled={on.includes(module.name)} onClick={() => setOn(current => [...current, module.name])}>{module.title}: {on.includes(module.name) ? 'on' : 'power on'}</button>)}
      </nav>
      <p className="note">Foundation slice. Power-off and the rack arrive in later issues; close the window to quit.</p>
    </header>
    <section className="stage" aria-label="Active modules" style={{ gridTemplateColumns: `repeat(${Math.max(active.length, 1)}, minmax(0, 1fr))` }}>
      {active.length ? active.map(module => <ModuleFrame key={module.name} name={module.name} title={module.title} />) : <p className="idle">All projectors are off.</p>}
    </section>
  </main>;
}
