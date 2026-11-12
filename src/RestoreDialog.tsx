import { invoke } from '@tauri-apps/api/core';
import { useEffect, useRef, useState } from 'react';

type Backup = { file: string; userVersion: number; bytes: number; modifiedMs: number; kind: 'upgrade' | 'restore' };
type Listing = { backups: Backup[]; pending: string | null };

/**
 * Restore a module's data from one of its verified copies (docs/DATA-SAFETY-U14.md). A running module has its file open, so
 * choosing a copy only schedules the replacement; it happens at the next start, before any module opens its file.
 * Keyboard: focus starts on Close, Tab stays inside the dialog, Escape closes, and focus returns to the button that opened it.
 */
export function RestoreDialog({ modules, onClose }: { modules: { name: string; title: string }[]; onClose: () => void }) {
  const [module, setModule] = useState(modules[0].name);
  const [listing, setListing] = useState<Listing>({ backups: [], pending: null });
  const [choice, setChoice] = useState('');
  const [message, setMessage] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const title = modules.find(m => m.name === module)?.title ?? module;
  const refresh = () => invoke<Listing>('host_list_backups', { module }).then(next => { setListing(next); setChoice(''); }).catch(error => setMessage(String(error)));
  useEffect(() => { void refresh(); }, [module]);
  useEffect(() => { const opener = document.activeElement as HTMLElement | null; return () => opener?.focus?.(); }, []);
  async function schedule() {
    setMessage('');
    try { await invoke('host_schedule_restore', { module, file: choice }); await refresh(); setMessage(`Scheduled. Quit and reopen Unhollowed to finish: ${title}'s current data is kept in a safety copy first.`); }
    catch (error) { setMessage(String(error)); }
  }
  async function cancel() { await invoke('host_cancel_restore', { module }).catch(() => undefined); setMessage('The restore was cancelled.'); await refresh(); }
  function keep(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { onClose(); return; }
    if (event.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), select, input')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div ref={box} role="dialog" aria-modal="true" aria-labelledby="restore-title" aria-describedby="restore-body" className="upgrade" onKeyDown={keep}>
    <h2 id="restore-title">Restore {title}'s data</h2>
    <p id="restore-body">Choose a verified copy. Nothing is replaced until Unhollowed is restarted, and what is replaced is first kept in a safety copy.</p>
    <label>Module <select value={module} onChange={event => setModule(event.target.value)}>{modules.map(m => <option key={m.name} value={m.name}>{m.title}</option>)}</select></label>
    {listing.backups.length === 0 ? <p>There are no copies of {title}'s data yet.</p> : <fieldset><legend>Copies of {title}'s data, newest first</legend>
      {listing.backups.map(backup => <label key={backup.file}><input type="radio" name="backup" value={backup.file} checked={choice === backup.file} onChange={() => setChoice(backup.file)} /> {new Date(backup.modifiedMs).toLocaleString()} — {backup.kind === 'upgrade' ? 'taken before an upgrade' : 'taken before a restore'} (schema {backup.userVersion}, {Math.max(1, Math.round(backup.bytes / 1024))} KB)</label>)}
    </fieldset>}
    {listing.pending && <p role="status">A restore from {listing.pending} will happen the next time Unhollowed starts. <button type="button" className="power" onClick={() => void cancel()}>Cancel the restore</button></p>}
    {message && <p role="status">{message}</p>}
    <button type="button" className="power" autoFocus onClick={onClose}>Close</button>
    <button type="button" className="power" disabled={!choice} onClick={() => void schedule()}>Restore at next start</button>
  </div>;
}
