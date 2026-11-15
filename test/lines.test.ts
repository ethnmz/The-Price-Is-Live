import { describe, expect, it, vi } from 'vitest';
import { HOST_LINE_KEYS, HOST_LINE_VARS } from '../src/contracts';
import { createHost, LINE_BANK, staticLines } from '../src/ai/host/lines';

vi.mock('pino', () => ({ default: () => ({ warn: warning }) }));
const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));

const vars = {
  name: 'Abcdefghijkl', owner: 'Mnopqrstuvwx', next: 'Yzabcdefghij',
  winner: 'Klmnopqrstuv', winner2: 'Wxyzabcdefgh', n: 100,
  price: 'one thousand two hundred dollars and ninety-nine cents',
  amount: 'one thousand two hundred dollars and ninety-nine cents',
};

describe('host script bank', () => {
  it('covers exactly the frozen keys and only their allowed variables', () => {
    expect(Object.keys(LINE_BANK).sort()).toEqual([...HOST_LINE_KEYS].sort());
    for (const key of HOST_LINE_KEYS) {
      expect(LINE_BANK[key].length).toBeGreaterThan(0);
      expect(new Set(LINE_BANK[key]).size).toBe(LINE_BANK[key].length);
      for (const line of LINE_BANK[key]) {
        for (const match of line.matchAll(/\{([^{}]+)\}/g)) {
          expect(HOST_LINE_VARS[key]).toContain(match[1]);
        }
      }
    }
  });

  it('fills every variant with long names and spoken amounts within caption limits', () => {
    for (const key of HOST_LINE_KEYS) {
      LINE_BANK[key].forEach((_, index, variants) => {
        const host = createHost({ rng: () => (index + 0.5) / variants.length });
        const line = host.line(key, vars);
        expect(line).not.toMatch(/[{}]|\p{Extended_Pictographic}|\p{Regional_Indicator}/u);
        if (key !== 'reveal.price') expect(line.length).toBeLessThanOrEqual(140);
      });
    }
  });

  it('never immediately repeats over 200 draws, including constant RNGs', () => {
    for (const rng of [() => 0, () => 0.5, () => 0.999999, Math.random]) {
      const host = createHost({ rng });
      for (const key of HOST_LINE_KEYS) {
        let last = host.line(key, vars);
        for (let draw = 0; draw < 200; draw++) {
          const next = host.line(key, vars);
          if (LINE_BANK[key].length > 1) expect(next).not.toBe(last);
          last = next;
        }
      }
    }
  });

  it('selects uniformly from the available indexes and tracks each key independently', () => {
    const host = createHost({ rng: () => 0.5 });
    expect(host.line('guess.prompt', vars)).toBe('Abcdefghijkl, how much? Go!');
    host.line('guess.locked');
    expect(host.line('guess.prompt', vars)).toBe('Abcdefghijkl, your price, please!');
    expect(createHost({ rng: () => 0.5 }).line('guess.prompt', vars)).toBe('Abcdefghijkl, how much? Go!');
  });

  it('removes missing variables, tidies spaces, and warns without logging supplied values', () => {
    warning.mockClear();
    const line = createHost({ rng: () => 0 }).line('score.stump', { n: 0 });
    expect(line).toBe('stumped the crowd for 0 stump points!');
    expect(line).not.toMatch(/[{}]|  /);
    expect(warning).toHaveBeenCalledWith({ key: 'score.stump', variable: 'owner' }, expect.any(String));
    expect(createHost({ rng: () => 0 }).line('guess.prompt')).not.toMatch(/[{}]/);
  });

  it('does not substitute inherited properties or leave braces from variable values', () => {
    expect(createHost({ rng: () => 0 }).line('guess.prompt', Object.create({ name: 'Inherited' }))).toBe(", what's your guess?");
    expect(createHost({ rng: () => 0 }).line('guess.prompt', { name: '{Pat}' })).toBe("Pat, what's your guess?");
  });

  it('preserves the separate reveal and stump lines', () => {
    expect(LINE_BANK['reveal.price']).toEqual(['{price}!']);
    expect(LINE_BANK['reveal.estimate']).toContain("That's my best estimate!");
    expect(LINE_BANK['score.stump']).toHaveLength(2);
    expect(LINE_BANK['score.stumplow']).toContain('{owner} got {n} stump points. Tough crowd!');
    expect(LINE_BANK['item.quip']).toEqual([
      "Oh, that's a fancy one!", 'I have a feeling about this one.', 'Interesting choice, {owner}!',
    ]);
  });

  it('returns all and only static variants as an independent array', () => {
    const lines = staticLines();
    expect(lines.length).toBeGreaterThanOrEqual(15);
    expect(lines).toEqual(Object.values(LINE_BANK).flat().filter(line => !/[{}]/.test(line)));
    expect(lines.every(line => !/[{}]/.test(line))).toBe(true);
    lines.length = 0;
    expect(staticLines().length).toBeGreaterThanOrEqual(15);
  });

  it('delegates quips when provided and otherwise resolves null', async () => {
    await expect(createHost().quip('fixture item', 'Pat')).resolves.toBeNull();
    const quip = vi.fn(async () => 'What a show!');
    await expect(createHost({ quip }).quip('fixture item', 'Pat')).resolves.toBe('What a show!');
    expect(quip).toHaveBeenCalledWith('fixture item', 'Pat');
  });
});
