import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ModuleFrame } from './ModuleFrame';
import { MODULES, type ModuleName } from './modules';
import * as rackModel from './lifecycle';
import { runExternalScenario, runMigrationScenario, runRestoreScenario } from './selftest';
import { RestoreDialog } from './RestoreDialog';
import { listen } from '@tauri-apps/api/event';
import { isExternalChange } from './changes';
import { Rack } from './Rack';

const NAMES = MODULES.map(module => module.name);
/** How long a frame may take to load before its projector shows an error. */
const BOOT_TIMEOUT_MS = 20000;
type PowerOff = { flushed: boolean; waitedMs: number; lingerMs: number };

/** What the debug-only self-test and the module shim ask of the host (inert in normal use). */
declare global { interface Window { __unhlwActivity?: Record<string, number>; __unhlwChangeLog?: { module: string; external: boolean; at: number }[]; __unhlwHost?: {
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
  // Told once at start: e.g. a verified copy was made before a module's data was upgraded (docs/DATA-SAFETY-U14.md).
  const [notices, setNotices] = useState<{ module: string; message: string }[]>([]);
  const refreshNotices = useCallback(() => { void invoke<{ module: string; message: string }[]>('host_data_notices').then(setNotices).catch(() => undefined); }, []);
  useEffect(refreshNotices, [refreshNotices]);
  // A module whose data is older than it writes is not opened until the person confirms (docs/DATA-SAFETY-U14.md).
  const [waiting, setWaiting] = useState<Record<string, { from: number; to: number }>>({});
  const [asking, setAsking] = useState<ModuleName | null>(null);
  const [restoring, setRestoring] = useState(false);
  // Another program (for example a standalone app) changed a running module's data: its screen shows what it read earlier.
  const [changedElsewhere, setChangedElsewhere] = useState<ModuleName[]>([]);
  useEffect(() => {
    let stop: (() => void) | undefined; let gone = false;
    void listen<string>('unhlw-data-changed', event => {
      const name = event.payload as ModuleName;
      if (rackRef.current.phase[name] !== 'on') return; // off: it reads fresh when powered on
      const external = isExternalChange(window.__unhlwActivity?.[name], Date.now());
      (window.__unhlwChangeLog ??= []).push({ module: name, external, at: Date.now() }); // read by the debug-only self-test
      if (!external) return;
      setChangedElsewhere(current => current.includes(name) ? current : [...current, name]);
    }).then(unlisten => { if (gone) unlisten(); else stop = unlisten; });
    return () => { gone = true; stop?.(); };
  }, []);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  useEffect(() => {
    void Promise.all(NAMES.map(name => invoke<{ state: string; from?: number; to?: number }>('host_module_status', { module: name }).then(status => [name, status] as const)))
      .then(all => setWaiting(Object.fromEntries(all.filter(([, status]) => status.state === 'needsConfirmation').map(([name, status]) => [name, { from: status.from!, to: status.to! }]))))
      .catch(() => undefined);
  }, []);
  async function confirmUpgrade(name: ModuleName) {
    setUpgrading(true); setUpgradeError('');
    try {
      await invoke('host_confirm_migration', { module: name });
      setWaiting(({ [name]: _gone, ...rest }) => rest);
      setAsking(null);
      refreshNotices();
      powerOn(name);
    } catch (error) { setUpgradeError(String(error)); }
    setUpgrading(false);
  }

  const powerOn = useCallback((name: ModuleName) => update(r => rackModel.powerOn(r, name)), [update]);
  const bringToFront = useCallback((name: ModuleName) => update(r => rackModel.bringToFront(r, name)), [update]);
  const wantOn = useCallback((name: ModuleName) => { if (waiting[name]) { setUpgradeError(''); setAsking(name); } else powerOn(name); }, [waiting, powerOn]);

  /** Asks the module to save; removes its frame only once it confirms. Returns null when it was not on. */
  const powerOff = useCallback(async (name: ModuleName): Promise<PowerOff | null> => {
    if (rackRef.current.phase[name] !== 'on' && rackRef.current.phase[name] !== 'error') return null; // 'error' is the retry
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
      update(r => rackModel.fail(r, name)); // error: still mounted, nothing lost; the owner decides below
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

  async function reload(name: ModuleName) {
    setChangedElsewhere(current => current.filter(n => n !== name));
    const result = await powerOff(name); // saves first; if it cannot confirm, the unsaved alert takes over
    if (result?.flushed) powerOn(name);
  }

  useEffect(() => {
    window.__unhlwHost = { mayFocus: name => rackModel.mayFocus(rackRef.current, name), front: () => rackRef.current.front, powerOn, bringToFront, powerOff };
    return () => { delete window.__unhlwHost; };
  }, [powerOn, bringToFront, powerOff]);
  // Debug-only native self-test: press the power switches ourselves (inert in release builds).
  useEffect(() => { void invoke<boolean>('selftest_enabled').then(async enabled => { if (!enabled) return; const scenario = await invoke<string | null>('selftest_scenario'); if (scenario === 'migration') void runMigrationScenario(); else if (scenario === 'restore') void runRestoreScenario(); else if (scenario === 'external') void runExternalScenario(); else MODULES.forEach(module => powerOn(module.name)); }); }, [powerOn]);

  const ready = useCallback((name: ModuleName) => update(r => rackModel.markReady(r, name)), [update]);
  // A module whose frame never reports that it loaded is an error (the owner can keep waiting, retry or power it off).
  useEffect(() => {
    const timers = NAMES.filter(name => rack.phase[name] === 'on' && !rack.ready[name]).map(name => setTimeout(() => update(r => r.phase[name] === 'on' && !r.ready[name] ? rackModel.fail(r, name) : r), BOOT_TIMEOUT_MS));
    return () => timers.forEach(clearTimeout);
  }, [rack, update]);
  const projectorStates = Object.fromEntries(NAMES.map(name => [name, rackModel.projectorState(rack, name)])) as Record<ModuleName, rackModel.ProjectorState>;
  const keepOpen = useCallback((name: ModuleName) => { setUnsaved(({ [name]: _gone, ...rest }) => rest); update(r => rackModel.keepOpen(r, name)); }, [update]);

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
              ? <button type="button" className="power" aria-pressed="false" onClick={() => wantOn(name)}>{title}: power on</button>
              : <>
                <button type="button" className="power" aria-pressed="true" disabled={phase === 'closing'} onClick={() => void powerOff(name)}>{title}: {phase === 'closing' ? 'saving…' : 'power off'}</button>
                {phase === 'on' && rack.front !== name && <button type="button" className="power" onClick={() => bringToFront(name)}>Bring {title} to front</button>}
              </>}
          </span>;
        })}
        <button type="button" className="power" onClick={() => setRestoring(true)}>Restore data…</button>
      </nav>
      <p className="note">Foundation slice. Power a module off to save and close it; close the window to quit.</p>
    </header>
    {asking && waiting[asking] && <div role="alertdialog" aria-modal="true" aria-labelledby="upgrade-title" aria-describedby="upgrade-body" className="upgrade" onKeyDown={event => { if (event.key === 'Escape' && !upgrading) setAsking(null); }}>
      <h2 id="upgrade-title">Upgrade {MODULES.find(m => m.name === asking)?.title}'s data?</h2>
      <p id="upgrade-body">{MODULES.find(m => m.name === asking)?.title}'s data is on schema {waiting[asking].from}; this version of Unhollowed uses schema {waiting[asking].to}. Opening it will upgrade the file. A verified copy is made first, and if that copy cannot be made nothing is changed. Older standalone releases of {MODULES.find(m => m.name === asking)?.title} will refuse the upgraded file; restoring the copy is the only way back.</p>
      {upgradeError && <p role="alert">{upgradeError}</p>}
      <button type="button" className="power" autoFocus disabled={upgrading} onClick={() => setAsking(null)}>Not now</button>
      <button type="button" className="power" disabled={upgrading} onClick={() => void confirmUpgrade(asking)}>{upgrading ? 'Backing up…' : 'Back up and upgrade'}</button>
    </div>}
    {restoring && <RestoreDialog modules={MODULES.map(({ name, title }) => ({ name, title }))} onClose={() => setRestoring(false)} />}
    {changedElsewhere.filter(name => rack.phase[name] === 'on').map(name => { const title = MODULES.find(m => m.name === name)?.title; return <div key={name} role="status" className="notice changed"><strong>{title}'s data was changed by another program</strong> (for example a standalone {title}). The screen may show what it read earlier. Reloading saves {title} first, then opens it again from the current data.
      <button type="button" className="power" onClick={() => void reload(name)}>Reload {title}</button>
      <button type="button" className="power" onClick={() => setChangedElsewhere(current => current.filter(n => n !== name))}>Dismiss</button>
    </div>; })}
    {notices.map((notice, index) => <div key={index} role="status" className="notice"><strong>{notice.module}</strong> {notice.message}<button type="button" className="power" onClick={() => setNotices(current => current.filter((_, i) => i !== index))}>Dismiss</button></div>)}
    {Object.entries(unsaved).map(([name, reason]) => <div key={name} role="alert" className="unsaved">
      <strong>{MODULES.find(m => m.name === name)?.title} did not confirm that it saved.</strong> {reason}
      <button type="button" className="power" onClick={() => { setUnsaved(({ [name]: _gone, ...rest }) => rest); update(r => rackModel.keepOpen(r, name as ModuleName)); }}>Keep it open</button>
      <button type="button" className="power" onClick={() => { setUnsaved(({ [name]: _gone, ...rest }) => rest); update(r => rackModel.finishPowerOff(r, name as ModuleName)); }}>Power off anyway (unsaved changes are lost)</button>
    </div>)}
    </div>
    <div className="workspace">
      <Rack units={MODULES} states={projectorStates} actions={{ powerOn: wantOn, front: bringToFront, powerOff: name => void powerOff(name), keepOpen }} />
      <section className="stage" aria-label="Active modules">
        {shown.length
          ? shown.map(module => <ModuleFrame key={`${module.name}-${rack.epoch[module.name]}`} name={module.name} title={module.title} front={rack.front === module.name || (rack.front === null && rack.phase[module.name] === 'error')} leaving={leaving.includes(module.name)} onFront={bringToFront} onReady={ready} />)
          : <p className="idle">All projectors are off.</p>}
      </section>
    </div>
  </main>;
}
