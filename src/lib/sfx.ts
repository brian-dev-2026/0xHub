import { settingsStore } from "./store";

// Synthesized sound effects — no audio assets to download.

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = "square", gain = 0.15, slideTo?: number, delay = 0) {
  const vol = settingsStore.get().volume;
  if (vol <= 0) return;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain * vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  move: () => tone(420, 0.03, "square", 0.04),
  rotate: () => tone(620, 0.04, "triangle", 0.07),
  tspinRotate: () => tone(880, 0.08, "triangle", 0.1, 1320),
  hold: () => tone(300, 0.08, "sine", 0.1, 500),
  lock: () => tone(140, 0.07, "triangle", 0.12),
  hardDrop: () => tone(180, 0.09, "square", 0.1, 60),
  clear: (lines: number) => {
    const base = [0, 523, 587, 659, 784][Math.min(lines, 4)];
    tone(base, 0.12, "square", 0.1);
    tone(base * 1.5, 0.16, "triangle", 0.08, undefined, 0.05);
  },
  tetris: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.14, "square", 0.09, undefined, i * 0.05)),
  tspin: () => [659, 880, 1174].forEach((f, i) => tone(f, 0.16, "sawtooth", 0.07, undefined, i * 0.05)),
  combo: (n: number) => tone(440 * Math.pow(1.06, Math.min(n, 15) * 2), 0.1, "triangle", 0.09),
  garbage: () => tone(110, 0.2, "sawtooth", 0.1, 70),
  ko: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.18, "square", 0.1, undefined, i * 0.09)),
  levelUp: () => [523, 784, 1046].forEach((f, i) => tone(f, 0.12, "triangle", 0.1, undefined, i * 0.07)),
  countdown: (final: boolean) => tone(final ? 880 : 440, final ? 0.3 : 0.12, "square", 0.1),
  gameOver: () => [392, 349, 311, 262].forEach((f, i) => tone(f, 0.25, "triangle", 0.12, undefined, i * 0.14)),
  win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.16, "square", 0.08, undefined, i * 0.09)),
};
