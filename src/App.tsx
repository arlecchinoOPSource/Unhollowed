import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ModuleFrame } from './ModuleFrame';
import { MODULES, type ModuleName } from './modules';

/**
 * Placeholder host for the foundation slice: one projector slot per module with a power switch.
 * Power-off, the projector state machine and the rack artwork come later (U-11, U-23, U-21).
 */
export function App() {
  const [on, setOn] = useState<ModuleName | null>(null);
  const active = MODULES.find(module => module.name === on);
  // Debug-only native self-test: press the power switch ourselves (inert in release builds).
  useEffect(() => { void invoke<boolean>('selftest_enabled').then(enabled => { if (enabled) setOn('swish'); }); }, []);
  return <main className="host">
    <header className="host-bar">
      <h1>Unhollowed</h1>
      <nav aria-label="Projectors">
        {MODULES.map(module => <button key={module.name} type="button" className="power" aria-pressed={on === module.name}
          disabled={on !== null} onClick={() => setOn(module.name)}>{module.title}: {on === module.name ? 'on' : 'power on'}</button>)}
      </nav>
      <p className="note">Foundation slice. Power-off and the rack arrive in later issues; close the window to quit.</p>
    </header>
    <section className="stage" aria-label="Active module">
      {active ? <ModuleFrame key={active.name} name={active.name} title={active.title} /> : <p className="idle">All projectors are off.</p>}
    </section>
  </main>;
}
