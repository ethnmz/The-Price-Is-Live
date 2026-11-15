import { describe, expect, it } from 'vitest';
import { resampleInt16, stereoToMono } from '../src/comms/resample.js';

function sine(freq: number, rate: number, n: number): Int16Array {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(10000 * Math.sin((2 * Math.PI * freq * i) / rate));
  return out;
}
function crossings(pcm: Int16Array): number {
  let c = 0;
  for (let i = 1; i < pcm.length; i++) if (pcm[i - 1] < 0 && pcm[i] >= 0) c++;
  return c;
}

describe('resampleInt16', () => {
  it('passes the same rate through', () => {
    const a = sine(440, 16000, 100);
    expect(resampleInt16(a, 16000, 16000)).toBe(a);
  });
  it('gives the right length', () => {
    expect(resampleInt16(new Int16Array(2400), 24000, 16000).length).toBe(1600);
    expect(resampleInt16(new Int16Array(1600), 16000, 24000).length).toBe(2400);
  });
  it('keeps a sine at its frequency', () => {
    const out = resampleInt16(sine(500, 24000, 24000), 24000, 16000); // 1 second
    expect(out.length).toBe(16000);
    expect(Math.abs(crossings(out) - 500)).toBeLessThanOrEqual(2);
  });
  it('handles empty input', () => {
    expect(resampleInt16(new Int16Array(0), 24000, 16000).length).toBe(0);
  });
});

describe('stereoToMono', () => {
  it('averages pairs', () => {
    expect(Array.from(stereoToMono(Int16Array.from([100, 200, -100, 100])))).toEqual([150, 0]);
  });
  it('passes mono through', () => {
    const a = Int16Array.from([1, 2, 3]);
    expect(stereoToMono(a, 1)).toBe(a);
  });
});
