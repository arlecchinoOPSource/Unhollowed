import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { moduleUrl, type ModuleName } from './modules';
import { runSelfTest } from './selftest';

/**
 * One module in its own same-origin iframe (docs/SPIKE-U31.md). The iframe boundary isolates the module's DOM, CSS,
 * theme and global listeners; the shim in the page routes its commands to `plugin:<module>|<command>`. The host tells
 * the native side when the module becomes active so a close request knows whom to wait for (docs/LIFECYCLE-U11.md).
 * The frame is never unmounted by navigation: only power-off removes it, so drafts and timers survive.
 */
export function ModuleFrame({ name, title, front, leaving, onFront, onReady }: {
  name: ModuleName; title: string; front: boolean; leaving: boolean; onFront: (name: ModuleName) => void; onReady: (name: ModuleName) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    void invoke('host_module_activated', { module: name });
    return () => { void invoke('host_module_deactivated', { module: name }); };
  }, [name]);
  // Bringing a module to the front (a button, or a change made by the host) gives it the keyboard.
  useEffect(() => { if (front) frame.current?.contentWindow?.focus(); }, [front]);
  function loaded() {
    const win = frame.current?.contentWindow;
    onReady(name); // the frame loaded: its projector goes from booting to active
    // Using a module (a click, or Tab moving into its frame) brings it to the front.
    win?.addEventListener('pointerdown', () => onFront(name), true);
    win?.addEventListener('focus', () => onFront(name));
    void runSelfTest(name, frame.current);
  }
  return <div className="module-slot" data-front={front} data-leaving={leaving}>
    <iframe ref={frame} className="module-frame" title={title} src={moduleUrl(name)} onLoad={loaded} />
  </div>;
}
