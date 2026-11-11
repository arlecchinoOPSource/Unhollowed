import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { moduleUrl, type ModuleName } from './modules';
import { runSelfTest } from './selftest';

/**
 * One module in its own same-origin iframe (docs/SPIKE-U31.md). The iframe boundary isolates the
 * module's DOM, CSS, theme and global listeners; the shim in the page routes its commands to
 * `plugin:<module>|<command>`. The host tells the native side when the module becomes active so
 * a close request knows whom to wait for.
 */
export function ModuleFrame({ name, title }: { name: ModuleName; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    void invoke('host_module_activated', { module: name });
    return () => { void invoke('host_module_deactivated', { module: name }); };
  }, [name]);
  return <iframe ref={frame} className="module-frame" title={title} src={moduleUrl(name)} onLoad={() => void runSelfTest(name, frame.current)} />;
}
