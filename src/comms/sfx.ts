// Synthesized sound effects (spec 8.2, D3). Pure Int16Array math, mono, no files.
// Everything is generated in code so there are no audio licensing questions.
// Deterministic: noise comes from a seeded generator. Results are cached per name and rate.
//
// TO VERIFY ON THE REAL LINE: listen to each effect over a real FaceTime call
// and adjust loudness/pitch by ear (phone speakers and call codecs squash highs).
import type { SfxName } from '../contracts/types';

const PEAK = 0.7; // stays below 80% of full scale

const cache = new Map<string, Int16Array>();

/** Small seeded random generator (mulberry32), returns -1..1. */
function makeNoise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Scale float samples so the loudest one hits PEAK, then convert to int16. */
function toInt16(x: Float64Array): Int16Array {
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  const gain = max > 0 ? (PEAK * 32767) / max : 0;
  const out = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.round(x[i] * gain);
  return out;
}

function drumroll(sr: number): Float64Array {
  const n = Math.round(sr * 3);
  const x = new Float64Array(n);
  const noise = makeNoise(1234);
  let t = 0; // start time of the next hit, in seconds
  let lp = 0;
  while (t < 3) {
    const progress = t / 3;
    const gap = 0.12 - 0.09 * progress; // hits speed up
    const amp = 0.25 + 0.75 * progress; // and swell
    const start = Math.round(t * sr);
    const len = Math.round(sr * 0.06);
    for (let i = 0; i < len && start + i < n; i++) {
      const env = Math.exp((-i / sr) * 60);
      const white = noise();
      lp += 0.5 * (white - lp); // light low-pass for a snare-ish body
      x[start + i] += amp * env * (0.6 * lp + 0.4 * white);
    }
    t += gap;
  }
  return x;
}

function ding(sr: number): Float64Array {
  const n = Math.round(sr * 0.8);
  const x = new Float64Array(n);
  const partials = [
    [1, 1, 5],
    [2.76, 0.5, 7],
    [5.4, 0.25, 10],
  ];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (const [mult, amp, decay] of partials) v += amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * 1318.5 * mult * t);
    x[i] = v * Math.min(1, t / 0.002); // tiny fade-in avoids a click
  }
  return x;
}

function buzzer(sr: number): Float64Array {
  const n = Math.round(sr * 0.5);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const sq = Math.sin(2 * Math.PI * 110 * t) >= 0 ? 1 : -1;
    const saw = 2 * ((t * 113) % 1) - 1;
    const env = Math.min(1, t / 0.01) * Math.min(1, (0.5 - t) / 0.03);
    x[i] = (0.6 * sq + 0.4 * saw) * env;
  }
  return x;
}

function tada(sr: number): Float64Array {
  const n = Math.round(sr * 1.2);
  const x = new Float64Array(n);
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C major arpeggio, rising
  const step = 0.12;
  for (let k = 0; k < notes.length; k++) {
    const start = Math.round(k * step * sr);
    const last = k === notes.length - 1;
    for (let i = start; i < n; i++) {
      const t = (i - start) / sr;
      const env = Math.min(1, t / 0.005) * Math.exp(-t * (last ? 2.5 : 8));
      const f = notes[k];
      x[i] += env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t));
    }
  }
  return x;
}

function tick(sr: number): Float64Array {
  const n = Math.round(sr * 0.02);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = Math.exp(-t * 300) * Math.sin(2 * Math.PI * 1800 * t);
  }
  return x;
}

const MAKERS: Record<SfxName, (sr: number) => Float64Array> = { drumroll, ding, buzzer, tada, tick };

export function synthSfx(name: SfxName, sampleRate: number): Int16Array {
  const key = `${name}@${sampleRate}`;
  let pcm = cache.get(key);
  if (!pcm) {
    pcm = toInt16(MAKERS[name](sampleRate));
    cache.set(key, pcm);
  }
  return pcm;
}
