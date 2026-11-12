import { useEffect, useRef, useState } from 'react';
import type { HostSound } from './hostSound';
import { CUES, CUE_LABELS, type Cue, type SoundSettings } from './sound';

/**
 * The rack sound settings (U-26, docs/SOUND-U26.md): one switch for all rack sounds, a volume, and a switch and a preview
 * button for each cue. These control only the rack's own sounds; each app keeps its own sound settings.
 * Keyboard: focus starts on Close, Tab stays inside, Escape closes and focus returns to the button that opened it.
 */
export function SoundDialog({ sound, onClose }: { sound: HostSound; onClose: () => void }) {
  const [settings, setSettings] = useState<SoundSettings>(sound.settings);
  const [message, setMessage] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const change = (next: SoundSettings) => { setSettings(next); sound.setSettings(next); };
  // The opener is read while rendering, before `autoFocus` moves focus into the dialog (an effect would see the dialog's own button).
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useEffect(() => () => opener.current?.focus?.(), []);
  // Escape must work even when focus is not inside the dialog: Safari-family web views leave focus on the page after a click on a control.
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, []);
  function preview(cue: Cue) {
    setMessage('');
    sound.preview(cue);
    // The first sound after the page opens waits a moment for the audio to unlock, so judge after that moment.
    setTimeout(() => { const recent = sound.log.slice(-4).filter(entry => entry.cue === cue); if (!recent.some(entry => entry.played)) setMessage(`Nothing played (${recent.at(-1)?.reason ?? 'unknown'}).`); }, 500);
  }
  function keep(event: React.KeyboardEvent) {
    if (event.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return <div ref={box} role="dialog" aria-modal="true" aria-labelledby="sound-title" aria-describedby="sound-body" className="sheet sound-dialog" onKeyDown={keep}>
    <h2 id="sound-title">Rack sounds</h2>
    <p id="sound-body">Sounds for the rack's keys and projectors. Off until you turn them on. Terminal, Ember and Swish keep their own sound settings.</p>
    <label><input type="checkbox" checked={settings.enabled} onChange={e => change({ ...settings, enabled: e.target.checked })} /> Play rack sounds</label>
    <label>Volume <input type="range" min={0} max={100} value={settings.volume} aria-valuetext={`${settings.volume} percent`} onChange={e => change({ ...settings, volume: Number(e.target.value) })} /> <output>{settings.volume}%</output></label>
    <fieldset><legend>Individual sounds</legend>
      {CUES.map(cue => <div key={cue} className="sound-row">
        <label><input type="checkbox" checked={settings.cues[cue]} onChange={e => change({ ...settings, cues: { ...settings.cues, [cue]: e.target.checked } })} /> {CUE_LABELS[cue]}</label>
        <button type="button" className="power" aria-label={`Play ${CUE_LABELS[cue]}`} onClick={() => preview(cue)}>Play</button>
      </div>)}
    </fieldset>
    {message && <p role="status">{message}</p>}
    <button type="button" className="power" autoFocus onClick={onClose}>Close</button>
  </div>;
}
