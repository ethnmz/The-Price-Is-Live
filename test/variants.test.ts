import { describe, expect, it, vi } from 'vitest';
import items from '../fixtures/reference-items.sample.json';
import type { SearchProvider } from '../src/contracts';
import type { GeminiClient } from '../src/ai/gemini';
import { makeVariants } from '../src/ai/variants';
import { createAi } from '../src/ai/index';
import { loadEnv } from '../src/config';

const product = { displayName: 'Novel Gadget', priceCents: 3200, confidence: 0.7, notAProduct: false };
function gemini(value: unknown = product, available = true): GeminiClient & { json: ReturnType<typeof vi.fn> } {
  return { available, json: vi.fn(async () => value), text: async () => null, grounded: async () => null } as never;
}
const search = (): SearchProvider & { search: ReturnType<typeof vi.fn> } => ({ search: vi.fn(async () => ({
  priceCents: 4200, text: '$42.00 and $43.00',
  sources: [{ title: 'A', url: 'https://example.com/a' }, { title: 'B', url: 'https://example.org/b' }],
})) }) as never;
const known = items[0]!;

describe('variants', () => {
  it('A uses only the model, never the list or search', async () => {
    const g = gemini(); const s = search();
    const r = await makeVariants({ items, gemini: g, search: s }).A(known.name);
    expect(r).toMatchObject({ priceCents: 3200, source: 'estimate' });
    expect(s.search).not.toHaveBeenCalled();
    expect(g.json.mock.calls[0]![0].prompt).not.toContain('Calibration examples');
  });

  it('B uses the list for a known item and examples for a miss', async () => {
    const g = gemini(); const s = search();
    const v = makeVariants({ items, gemini: g, search: s });
    expect(await v.B(known.name)).toMatchObject({ source: 'list', priceCents: known.priceCents });
    expect(g.json).not.toHaveBeenCalled();
    expect(await v.B('novel gadget')).toMatchObject({ source: 'estimate', priceCents: 3200 });
    expect(g.json).toHaveBeenCalledTimes(1);
    expect(s.search).not.toHaveBeenCalled();
  });

  it('C returns a web price when search has one', async () => {
    const r = await makeVariants({ items, gemini: gemini(), search: search() }).C('novel gadget');
    expect(r).toMatchObject({ source: 'web', priceCents: 4200 });
  });

  it('all survive a failing Gemini', async () => {
    const bad = { available: true, json: async () => { throw new Error('boom'); }, text: async () => null, grounded: async () => null } as unknown as GeminiClient;
    for (const g of [bad, gemini(null, false)]) {
      const v = makeVariants({ items, gemini: g, search: null });
      for (const f of [v.A, v.B, v.C]) {
        const r = await f('novel gadget');
        expect(r.priceCents).toBeNull();
        expect(r.source).toBe('none');
      }
    }
  });
});

describe('createAi', () => {
  it('works with an empty env', async () => {
    const ai = createAi(loadEnv({}, { readDotenv: false }), { items });
    expect(ai.gemini.available).toBe(false);
    const r = await ai.pricing.price({ rawText: 'owala bottle', itemId: 'x', ownerId: 'p1', origin: 'text' });
    expect(r.priceCents).toBeGreaterThan(0);
    expect(r.source).toBe('list');
    expect(typeof ai.host.line).toBe('function');
  });
});
