/**
 * Sound effects synthesised with WebAudio: zero asset bytes, offline, and no
 * licensing. Deliberately soft; the "not quite" sound is a gentle low note,
 * never a buzzer.
 */
type Sfx = 'hop' | 'land' | 'yes' | 'soft' | 'gift' | 'tap' | 'unlock';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; to?: number; delay?: number; gain?: number } = {}): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + (opts.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.12, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function play(s: Sfx): void {
  switch (s) {
    case 'hop':
      tone(320, 0.12, { to: 640, gain: 0.07 });
      break;
    case 'land':
      tone(240, 0.08, { type: 'triangle', gain: 0.08 });
      break;
    case 'yes':
      tone(660, 0.12, { type: 'triangle' });
      tone(880, 0.18, { type: 'triangle', delay: 0.1 });
      break;
    case 'soft':
      tone(262, 0.25, { type: 'sine', to: 220, gain: 0.07 });
      break;
    case 'gift':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, { type: 'triangle', delay: i * 0.08, gain: 0.08 }));
      break;
    case 'unlock':
      tone(440, 0.1, { type: 'triangle', gain: 0.08 });
      tone(660, 0.2, { type: 'triangle', delay: 0.08, gain: 0.08 });
      break;
    case 'tap':
      tone(900, 0.03, { type: 'square', gain: 0.02 });
      break;
  }
}

/** Must be called from a user gesture once (autoplay policies). */
export function unlockAudio(): void {
  ac();
}
