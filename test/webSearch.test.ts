import { describe, it, expect } from 'vitest';
import { createGeminiSearch, pickPrice, agreeWithin } from '../src/ai/webSearch.js';
import type { GeminiClient } from '../src/ai/gemini.js';

const SRC = [{ title: 'Store', url: 'https://example.com/a' }];

function fake(g: { text: string; sources: typeof SRC } | null, j: unknown): GeminiClient {
  return {
    available: true,
    grounded: async () => g,
    json: (async (a: any) => {
      if (j === null) return null;
      const r = a.schema.safeParse(j);
      return r.success ? r.data : null;
    }) as GeminiClient['json'],
    text: async () => null,
  };
}
const prices = (...c: number[]) => ({ displayName: 'X', prices: c.map((cents) => ({ cents, store: 's' })) });

describe('pickPrice / agreeWithin', () => {
  it('median, dropping outliers above 3x median', () => {
    expect(pickPrice([1000, 1100, 1200])).toBe(1100);
    expect(pickPrice([1000, 1100, 1200, 90000])).toBe(1100);
    expect(pickPrice([1000, 2000])).toBe(1500);
    expect(pickPrice([])).toBeNull();
    expect(pickPrice([500])).toBe(500);
  });
  it('agreement within tolerance', () => {
    expect(agreeWithin([1000, 1150], 0.2)).toBe(true);
    expect(agreeWithin([1000, 1500], 0.2)).toBe(false);
    expect(agreeWithin([1000], 0.2)).toBe(false);
  });
});

describe('createGeminiSearch', () => {
  it('uses the median of grounded prices', async () => {
    const r = await createGeminiSearch(fake({ text: 't', sources: SRC }, prices(1000, 1100, 1200))).search('x');
    expect(r.priceCents).toBe(1100);
    expect(r.sources).toEqual(SRC);
    expect((r as any).prices).toEqual([1000, 1100, 1200]);
  });
  it('one price', async () => {
    const r = await createGeminiSearch(fake({ text: 't', sources: SRC }, prices(4999))).search('x');
    expect(r.priceCents).toBe(4999);
  });
  it('no prices', async () => {
    const r = await createGeminiSearch(fake({ text: 't', sources: SRC }, prices())).search('x');
    expect(r.priceCents).toBeNull();
  });
  it('no sources gives null price', async () => {
    const r = await createGeminiSearch(fake({ text: 't', sources: [] }, prices(1000))).search('x');
    expect(r.priceCents).toBeNull();
    expect(r.text).toBe('t');
  });
  it('grounded null gives empty result', async () => {
    const r = await createGeminiSearch(fake(null, prices(1000))).search('x');
    expect(r).toEqual({ priceCents: null, sources: [], text: '' });
  });
  it('bad JSON step keeps sources', async () => {
    const r = await createGeminiSearch(fake({ text: 't', sources: SRC }, null)).search('x');
    expect(r.priceCents).toBeNull();
    expect(r.sources).toEqual(SRC);
  });
  it('unavailable or throwing client never throws', async () => {
    const dead = { ...fake(null, null), available: false };
    expect((await createGeminiSearch(dead).search('x')).priceCents).toBeNull();
    const boom = { ...fake(null, null), grounded: async () => { throw new Error('x'); } };
    expect((await createGeminiSearch(boom).search('x')).sources).toEqual([]);
  });
});
