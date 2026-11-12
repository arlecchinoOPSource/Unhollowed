import { HostSound } from './hostSound';
import { mayPlay, parseSoundSettings, SOUND_KEY, volumeToGain, CUE_MAX_S, type SoundSettings } from './sound';
import { renderCue } from './synth';

/** The host's sound player bound to the real Web Audio and localStorage. Settings are written only when the person changes them. */
export function createHostSound(): HostSound {
  let stored: unknown = null;
  try { stored = localStorage.getItem(SOUND_KEY); } catch { /* storage unavailable: defaults */ }
  return new HostSound({
    initial: parseSoundSettings(stored),
    settings: { mayPlay, gain: volumeToGain },
    render: (cue, sampleRate) => renderCue(cue, CUE_MAX_S[cue], sampleRate),
    save: (s: SoundSettings) => { try { localStorage.setItem(SOUND_KEY, JSON.stringify(s)); } catch { /* ignore */ } },
    createContext: () => {
      const Ctor = (window as unknown as { AudioContext?: new () => unknown; webkitAudioContext?: new () => unknown }).AudioContext ?? (window as unknown as { webkitAudioContext?: new () => unknown }).webkitAudioContext;
      return Ctor ? (new Ctor() as never) : null;
    },
  });
}
