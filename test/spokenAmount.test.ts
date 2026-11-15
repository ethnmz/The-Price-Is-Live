import { describe, expect, it } from 'vitest';
import { spokenAmount } from '../src/speech/spokenAmount';
import { parseGuess } from '../src/speech/parseGuess';

describe('spokenAmount', () => {
  it('matches the examples', () => {
    expect(spokenAmount(2500)).toBe('twenty-five dollars');
    expect(spokenAmount(1299)).toBe('twelve dollars and ninety-nine cents');
    expect(spokenAmount(100)).toBe('one dollar');
    expect(spokenAmount(100000)).toBe('one thousand dollars');
    expect(spokenAmount(15050)).toBe('one hundred fifty dollars and fifty cents');
  });
  it('handles small and odd amounts', () => {
    expect(spokenAmount(0)).toBe('zero dollars');
    expect(spokenAmount(1)).toBe('one cent');
    expect(spokenAmount(101)).toBe('one dollar and one cent');
    expect(spokenAmount(9999900)).toBe('ninety-nine thousand nine hundred ninety-nine dollars');
  });
  it('round-trips through parseGuess for 50 amounts', () => {
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) samples.push(100 + ((i * 7919 * 37 + i * i * 1013) % 9999800));
    samples.push(100, 101, 199, 1000, 1299, 2500, 10000, 12000, 15050, 100000, 100100, 9999900);
    for (const c of samples) {
      const r = parseGuess(spokenAmount(c));
      expect(r.kind, spokenAmount(c)).toBe('amount');
      expect(r.cents, spokenAmount(c)).toBe(c);
      expect(r.ambiguous).toBe(false);
    }
  });
});
