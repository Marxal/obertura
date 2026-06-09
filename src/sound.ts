// Optional training feedback sound — a short bright tone on a correct move and a
// lower buzz on a wrong one. Uses the Web Audio API so there's no audio file to
// ship and nothing to preload. Device-local pref in localStorage; off by default
// (a phone trainer shouldn't make noise until you ask it to).

const SOUND_KEY = 'obertura.feedbackSound';

export function getFeedbackSound(): boolean {
  return localStorage.getItem(SOUND_KEY) === 'on';
}

export function setFeedbackSound(on: boolean): void {
  localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
}

// One lazily-created AudioContext, reused for every beep. Created on first use so
// it's tied to a user gesture (toggling the setting or making a move).
let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

// A single short tone with a quick attack and exponential decay, so it reads as a
// soft "blip" rather than a hard click.
function beep(freq: number, durationMs: number, type: OscillatorType): void {
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();

  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const now = ac.currentTime;
  const end = now + durationMs / 1000;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain).connect(ac.destination);
  osc.start(now);
  osc.stop(end + 0.02);
}

// Play the feedback tone for a move, if the pref is on. A no-op otherwise.
export function playFeedback(kind: 'correct' | 'wrong'): void {
  if (!getFeedbackSound()) return;
  if (kind === 'correct') beep(660, 110, 'sine');
  else beep(170, 200, 'square');
}

// Play a sample tone regardless of the pref — used by the Settings toggle so a
// flip to "on" is audibly confirmed.
export function previewFeedback(): void {
  beep(660, 110, 'sine');
}
