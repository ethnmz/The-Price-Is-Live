import { afterEach, describe, expect, it, vi } from 'vitest';
import items from '../fixtures/reference-items.sample.json';
import type { ItemRequest, SearchProvider, StorePort } from '../src/contracts';
import type { GeminiClient } from '../src/ai/gemini';
import { createPricing } from '../src/ai/pricing';

const req = (rawText = 'novel gadget', itemId = 'r1'): ItemRequest => ({ rawText, itemId, ownerId: 'p1', origin: 'text' });
const product = { displayName: 'Novel Gadget', priceCents: 3200, confidence: 0.7, notAProduct: false };
function gemini(value: unknown = product, available = true): GeminiClient {
  return { available, json: vi.fn(async () => value) as GeminiClient['json'],
    text: async () => null, grounded: async () => null };
}
const never = () => new Promise<never>(() => {});
const search = (priceCents = 4200): SearchProvider => ({ search: vi.fn(async () => ({
  priceCents, sources: [{ title: 'Fixture retailer', url: 'https://example.com/item' },
    { title: 'Other fixture retailer', url: 'https://example.org/item' }], text: '$42.00 and $43.00',
})) });
afterEach(() => vi.useRealTimers());

describe('pricing pipeline', () => {
  it.each(items.slice(0, 10))('prices $name from the reference list', async item => {
    const result = await createPricing({ items, gemini: gemini() }).price(req(item.name));
    expect(result).toMatchObject({ source: 'list', priceCents: item.priceCents, displayName: item.name, isEstimate: false });
    expect(result.evidence[0]?.kind).toBe('list');
  });

  it('uses and caches web prices with the new item id', async () => {
    const web = search();
    const persist = vi.fn();
    const store = { getCachedPrice: async () => null, persist } as unknown as StorePort;
    const pricing = createPricing({ items, gemini: gemini(), search: web, store });
    expect(await pricing.price(req())).toMatchObject({ source: 'web', priceCents: 4200, confidence: 0.9, isEstimate: false });
    expect(await pricing.price(req('novel gadget', 'r2'))).toMatchObject({ itemId: 'r2', source: 'web' });
    expect(web.search).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('priceCache', expect.objectContaining({ cleanText: 'novel gadget' }));
  });

  it('honors immediate nonproduct even with successful web, and never caches it', async () => {
    const web = search();
    const persist = vi.fn();
    const pricing = createPricing({ items, gemini: gemini({ ...product, notAProduct: true }), search: web,
      store: { getCachedPrice: async () => null, persist } as unknown as StorePort });
    for (const itemId of ['r1', 'r2']) {
      expect(await pricing.price(req('imaginary happiness', itemId))).toMatchObject({
        itemId, source: 'estimate', isEstimate: true, propClosetSuggested: true,
      });
    }
    expect(persist).not.toHaveBeenCalled();
    expect(web.search).toHaveBeenCalledTimes(2);
  });

  it('returns a nonproduct result before a pending web search completes', async () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    const pending = createPricing({ items, gemini: gemini({ ...product, notAProduct: true }),
      search: { search: never }, timeoutMs: 80, webTimeoutMs: 60,
      store: { getCachedPrice: async () => null, persist } as unknown as StorePort }).price(req());
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toMatchObject({ source: 'estimate', isEstimate: true,
      propClosetSuggested: true, latencyMs: 0 });
    expect(persist).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors a nonproduct resolved before delayed web success', async () => {
    vi.useFakeTimers();
    let complete!: (value: Awaited<ReturnType<SearchProvider['search']>>) => void;
    const persist = vi.fn();
    const pending = createPricing({ items, gemini: gemini({ ...product, notAProduct: true }),
      search: { search: () => new Promise(resolve => { complete = resolve; }) },
      store: { getCachedPrice: async () => null, persist } as unknown as StorePort }).price(req());
    await vi.advanceTimersByTimeAsync(0);
    complete({ priceCents: 4200, sources: [{ title: 'Fixture retailer', url: 'https://example.com/item' }], text: '$42' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toMatchObject({ source: 'estimate', propClosetSuggested: true });
    expect(persist).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wait for a hanging model before accepting web', async () => {
    vi.useFakeTimers();
    const model = gemini(); model.json = never;
    const pending = createPricing({ items, gemini: model, search: search(), timeoutMs: 80 }).price(req());
    await vi.advanceTimersByTimeAsync(0);
    expect(await pending).toMatchObject({ source: 'web', isEstimate: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the estimate when web is too slow', async () => {
    vi.useFakeTimers();
    const pending = createPricing({ items, gemini: gemini(), search: { search: never }, webTimeoutMs: 10, timeoutMs: 30 }).price(req());
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ source: 'estimate', priceCents: 3200, isEstimate: true });
  });

  it('returns fallback at the hard deadline and ignores late web completion', async () => {
    vi.useFakeTimers();
    const model = gemini(); model.json = never;
    let complete!: (value: Awaited<ReturnType<SearchProvider['search']>>) => void;
    const persist = vi.fn();
    const pricing = createPricing({ items, gemini: model, search: { search: () => new Promise(resolve => { complete = resolve; }) },
      store: { getCachedPrice: async () => null, persist } as unknown as StorePort, timeoutMs: 20, webTimeoutMs: 50 });
    const pending = pricing.price(req());
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ source: 'estimate', propClosetSuggested: true, latencyMs: 20 });
    complete({ priceCents: 5000, sources: [], text: '' });
    await vi.advanceTimersByTimeAsync(0);
    expect(persist).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('survives missing key, nonsense, and rejected text', async () => {
    const pricing = createPricing({ items, gemini: gemini(null, false) });
    expect(await pricing.price(req('owala'))).toMatchObject({ source: 'list' });
    for (const text of ['asdfgh', '']) {
      expect(await pricing.price(req(text))).toMatchObject({ source: 'estimate', isEstimate: true, propClosetSuggested: true });
    }
    expect(await pricing.identifyFromFrames([])).toBeNull();
  });

  it('routes conflicting sizes to web', async () => {
    expect(await createPricing({ items, gemini: gemini(), search: search() }).price(req('owala bottle 64 oz')))
      .toMatchObject({ source: 'web' });
  });

  it('requires grounded sources for web pricing', async () => {
    expect(await createPricing({ items, gemini: gemini(), search: { search: async () => ({ priceCents: 4200, sources: [], text: '$42' }) } })
      .price(req())).toMatchObject({ source: 'estimate', priceCents: 3200, isEstimate: true });
  });

  it('uses a low confidence nearby list price without a key', async () => {
    const web = search();
    expect(await createPricing({ items, gemini: gemini(null, false), search: web }).price(req('owala bottle 64 oz')))
      .toMatchObject({ source: 'estimate', priceCents: items[0]!.priceCents, confidence: 0.4, isEstimate: true });
    expect(web.search).not.toHaveBeenCalled();
  });

  it.each([0, 999999])('clamps web price %s and labels it consistently', async price => {
    const result = await createPricing({ items, gemini: gemini(), search: search(price) }).price(req());
    expect(result.priceCents).toBe(Math.max(100, Math.min(100000, price)));
    expect(result.isEstimate).toBe(result.source === 'estimate' || result.confidence < 0.5);
  });

  it('gives web prices with one source or disagreeing prices 0.75 confidence', async () => {
    const one: SearchProvider = { search: async () => ({ priceCents: 4200,
      sources: [{ title: 'Only retailer', url: 'https://example.com/item' }], text: '$42.00' }) };
    expect(await createPricing({ items, gemini: gemini(), search: one }).price(req()))
      .toMatchObject({ source: 'web', confidence: 0.75, isEstimate: false });
  });

  it('uses a persistent cache and tolerates throwing providers', async () => {
    const cached = await createPricing({ items, gemini: gemini() }).price(req('owala'));
    expect(await createPricing({ items, gemini: gemini(), store: { getCachedPrice: async () => cached } as unknown as StorePort })
      .price(req('anything', 'r5'))).toMatchObject({ source: 'list', itemId: 'r5' });
    const model = gemini(); model.json = async () => { throw Error('offline'); };
    expect(await createPricing({ items, gemini: model, search: { search: async () => { throw Error('offline'); } } }).price(req()))
      .toMatchObject({ source: 'estimate', propClosetSuggested: true });
  });

  it('delegates optional identification', async () => {
    const identify = vi.fn(async () => ({ label: 'Bottle', confidence: 0.8 }));
    expect(await createPricing({ items, gemini: gemini(), identify }).identifyFromFrames([])).toEqual({ label: 'Bottle', confidence: 0.8 });
  });
});
