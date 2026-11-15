import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOST_LINE_KEYS, HOST_LINE_VARS } from '../src/contracts/hostLines';
import { createHost, LINE_BANK, staticLines } from '../src/ai/host/lines';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('pino', () => ({ default: () => ({ warn }) }));

const vars = {
  name: 'ABCDEFGHIJKL', owner: 'MNOPQRSTUVWX', next: 'YZABCDEFGHIJ',
  winner: 'KLMNOPQRSTUV', winner2: 'WXYZABCDEFGH', n: 100,
  amount: 'one thousand two hundred dollars and ninety-nine cents',
  price: 'one thousand two hundred dollars and ninety-nine cents',
};

afterEach(() => vi.clearAllMocks());

describe('host line bank', () => {
  it('covers exactly the frozen keys with only permitted variables', () => {
    expect(Object.keys(LINE_BANK).sort()).toEqual([...HOST_LINE_KEYS].sort());
    for (const key of HOST_LINE_KEYS) {
      expect(LINE_BANK[key].length).toBeGreaterThan(0);
      expect(new Set(LINE_BANK[key]).size).toBe(LINE_BANK[key].length);
      for (const template of LINE_BANK[key]) {
        expect(template.trim().length).toBeGreaterThan(0);
        for (const match of template.matchAll(/\{([^{}]+)\}/g)) {
          expect(HOST_LINE_VARS[key]).toContain(match[1]);
        }
      }
    }
  });

  it('fills every variant within caption limits without braces or emoji', () => {
    for (const key of HOST_LINE_KEYS) {
      for (let index = 0; index < LINE_BANK[key].length; index++) {
        const host = createHost({ rng: () => (index + 0.5) / LINE_BANK[key].length });
        const line = host.line(key, vars);
        expect(line).toBe(LINE_BANK[key][index].replace(/\{([^{}]+)\}/g, (_, name: keyof typeof vars) => String(vars[name])));
        expect(line).not.toMatch(/[{}]|\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u);
        if (key !== 'reveal.price') expect(line.length).toBeLessThanOrEqual(140);
      }
    }
  });

  it('never repeats immediately in 200 draws per key, even with constant RNG', () => {
    for (const rng of [() => 0, () => 0.5, () => 0.999999, Math.random]) {
      const host = createHost({ rng });
      for (const key of HOST_LINE_KEYS) {
        let previous: string | undefined;
        for (let draw = 0; draw < 200; draw++) {
          const line = host.line(key, vars);
          if (LINE_BANK[key].length > 1) expect(line).not.toBe(previous);
          previous = line;
        }
      }
    }
  });

  it('keeps repeat history per key and per host', () => {
    const host = createHost({ rng: () => 0 });
    expect(host.line('guess.locked')).toBe(LINE_BANK['guess.locked'][0]);
    host.line('connect.hello');
    expect(host.line('guess.locked')).toBe(LINE_BANK['guess.locked'][1]);
    expect(createHost({ rng: () => 0 }).line('guess.locked')).toBe(LINE_BANK['guess.locked'][0]);
  });

  it('keeps RNG endpoints and invalid samples within the bank', () => {
    for (const sample of [1, -1, NaN, Infinity]) {
      const host = createHost({ rng: () => sample });
      const first = host.line('guess.locked');
      const second = host.line('guess.locked');
      expect(LINE_BANK['guess.locked']).toContain(first);
      expect(LINE_BANK['guess.locked']).toContain(second);
      expect(second).not.toBe(first);
    }
  });

  it('removes missing variables, warns, and tidies spaces', () => {
    const line = createHost({ rng: () => 0 }).line('score.stump');
    expect(line).toBe('stumped the crowd for stump points!');
    expect(line).not.toMatch(/[{}]| {2}/);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('fills zero and strips braces from supplied text without recursive substitution', () => {
    expect(createHost({ rng: () => 0 }).line('score.stump', { owner: '{Guest}', n: 0 }))
      .toBe('Guest stumped the crowd for 0 stump points!');
  });

  it('returns all static variants and no templates for warmup', () => {
    expect(staticLines()).toEqual(Object.values(LINE_BANK).flat().filter(line => !/[{}]/.test(line)));
    expect(staticLines().length).toBeGreaterThanOrEqual(15);
    expect(staticLines().every(line => !/[{}]/.test(line))).toBe(true);
  });

  it('uses injected quips and otherwise resolves null', async () => {
    const quip = vi.fn(async () => 'What a mystery!');
    await expect(createHost().quip('Bottle', 'Guest')).resolves.toBeNull();
    await expect(createHost({ quip }).quip('Bottle', 'Guest')).resolves.toBe('What a mystery!');
    expect(quip).toHaveBeenCalledWith('Bottle', 'Guest');
  });
});
