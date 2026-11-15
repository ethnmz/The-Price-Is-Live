import { describe, expect, it } from 'vitest';
import { createMixer } from '../src/comms/mixer';
import { synthSfx } from '../src/comms/sfx';
import type { SfxName } from '../src/contracts/types';

const SR = 24000;
const peak = (a: Int16Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sine = (n: number, amp = 20000) => Int16Array.from({ length: n }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / SR)));

describe('synthSfx', () => {
  const expected: Record<SfxName, number> = { drumroll: 3, ding: 0.8, buzzer: 0.5, tada: 1.2, tick: 0.02 };
  for (const [name, secs] of Object.entries(expected) as [SfxName, number][]) {
    it(`${name} has the right length, is audible and does not clip`, () => {
      const pcm = synthSfx(name, SR);
      expect(pcm.length).toBe(Math.round(secs * SR));
      expect(peak(pcm)).toBeGreaterThan(1000);
      expect(peak(pcm)).toBeLessThan(0.8 * 32767);
    });
  }
  it('is deterministic and cached', () => {
    expect(synthSfx('drumroll', SR)).toBe(synthSfx('drumroll', SR));
    expect(synthSfx('drumroll', 8000).length).toBe(24000);
  });
});

describe('mixer', () => {
  it('mixes drumroll over voice, both audible, inside int16', () => {
    const m = createMixer();
    m.addVoice(sine(SR));
    m.addSfx(synthSfx('drumroll', SR));
    const { pcm, level } = m.nextFrame(SR);
    expect(level).toBeGreaterThan(0.1);
    expect(peak(pcm)).toBeLessThanOrEqual(32767);
    const sfxOnly = createMixer();
    sfxOnly.addSfx(synthSfx('drumroll', SR));
    const plain = sfxOnly.nextFrame(SR).pcm;
    expect(pcm.some((v, i) => v !== plain[i])).toBe(true);
    expect(peak(plain)).toBeGreaterThan(1000);
  });

  it('hard clips instead of wrapping', () => {
    const m = createMixer();
    m.addVoice(new Int16Array(10).fill(32767));
    m.addVoice(new Int16Array(10).fill(32767));
    expect(Array.from(m.nextFrame(10).pcm)).toEqual(new Array(10).fill(32767));
  });

  it('returns exact frame sizes and pads with zeros', () => {
    const m = createMixer();
    m.addVoice(new Int16Array(5).fill(1000));
    const { pcm } = m.nextFrame(8);
    expect(pcm.length).toBe(8);
    expect(Array.from(pcm.slice(5))).toEqual([0, 0, 0]);
    expect(pcm[4]).toBe(1000);
    expect(m.hasAudio()).toBe(false);
    expect(m.nextFrame(4).pcm.length).toBe(4);
  });

  it('level is 0 for silence and > 0.1 for a loud sine', () => {
    const m = createMixer();
    expect(m.nextFrame(480).level).toBe(0);
    m.addVoice(sine(480, 30000));
    expect(m.nextFrame(480).level).toBeGreaterThan(0.1);
  });

  it('clearVoice stops voice but not sfx', () => {
    const m = createMixer();
    m.addVoice(sine(SR));
    m.addSfx(synthSfx('ding', SR));
    m.nextFrame(480);
    expect(m.voiceActive()).toBe(true);
    m.clearVoice();
    expect(m.voiceActive()).toBe(false);
    expect(m.hasAudio()).toBe(true);
    const { pcm, level } = m.nextFrame(480);
    expect(level).toBe(0);
    expect(peak(pcm)).toBeGreaterThan(100);
  });
});
