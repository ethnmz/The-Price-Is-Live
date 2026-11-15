import { afterEach, describe, expect, it, vi } from 'vitest';
import sample from '../fixtures/reference-items.sample.json';
import type { ItemRequest, PriceResult, SearchProvider, StorePort } from '../src/contracts';
import type { GeminiClient } from '../src/ai/gemini';
import { createPricing } from '../src/ai/pricing';

const req = (rawText: string, itemId = 'r1'): ItemRequest => ({ rawText, itemId, ownerId: 'p1', origin: 'text' });
const model = { displayName: 'Novel Widget', priceCents: 2300, confidence: 0.7, notAProduct: false };
function gemini(value: typeof model | null = model): GeminiClient {
  return { available: true, json: vi.fn(async () => value) as GeminiClient['json'], grounded: vi.fn(async () => null), text: vi.fn(async () => null) };
}
const webResult = { priceCents: 4200, sources: [{ title: 'Fixture store', url: 'https://example.com/widget' }], text: '$42.00' };
const search = (): SearchProvider => ({ search: vi.fn(async () => webResult) });
const hang = () => new Promise<never>(() => {});
function store(): StorePort {
  return { getCachedPrice: vi.fn(async () => null), persist: vi.fn(), loadReferenceItems: vi.fn(async () => []), vectorSearch: vi.fn(async () => []) };
}
afterEach(() => vi.useRealTimers());

describe('pricing pipeline', () => {
  it.each(sample.slice(0, 10))('prices $name from the list', async item => {
    const client = gemini();
    const result = await createPricing({ items: sample, gemini: client }).price(req(item.name));
    expect(result).toMatchObject({ displayName: item.name, priceCents: item.priceCents, source: 'list', isEstimate: false });
    expect(result.evidence[0]?.kind).toBe('list');
    expect(client.json).not.toHaveBeenCalled();
  });

  it('starts web and model in parallel and prefers grounded web', async () => {
    const client = gemini();
    client.json = vi.fn(hang);
    const result = await createPricing({ items: sample, gemini: client, search: search() }).price(req('novel widget'));
    expect(client.json).toHaveBeenCalled();
    expect(result).toMatchObject({ source: 'web', priceCents: 4200, confidence: 0.75, isEstimate: false });
    expect(result.evidence[0]).toMatchObject({ kind: 'web', label: 'Fixture store', url: webResult.sources[0]!.url });
  });

  it('uses an estimate after the web deadline', async () => {
    vi.useFakeTimers();
    const pending = createPricing({ items: sample, gemini: gemini(), search: { search: hang }, webTimeoutMs: 20, timeoutMs: 50 }).price(req('novel widget'));
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ source: 'estimate', priceCents: 2300, isEstimate: true, latencyMs: 20 });
  });

  it('bounds hanging Gemini and store lookups by the overall deadline', async () => {
    vi.useFakeTimers();
    const client = gemini(); client.json = vi.fn(hang);
    const db = store(); db.getCachedPrice = vi.fn(hang);
    const requests = [undefined, db].map(db => createPricing({ items: sample, gemini: client, store: db, timeoutMs: 30 }).price(req('novel widget')));
    await vi.advanceTimersByTimeAsync(30);
    for (const result of await Promise.all(requests)) expect(result).toMatchObject({ source: 'estimate', isEstimate: true, latencyMs: 30 });
  });

  it('works without a key, with nonsense, rejected text and an empty list', async () => {
    const client = gemini(); client.available = false;
    const pricing = createPricing({ items: sample, gemini: client });
    expect((await pricing.price(req('owala'))).source).toBe('list');
    for (const text of ['asdfgh', 'nothing', '']) {
      expect(await pricing.price(req(text))).toMatchObject({ source: 'estimate', isEstimate: true, propClosetSuggested: true });
    }
    expect((await createPricing({ items: [], gemini: client }).price(req('widget'))).priceCents).toBe(100);
    expect(client.json).not.toHaveBeenCalled();
  });

  it('routes size conflicts through web search', async () => {
    const provider = search();
    const result = await createPricing({ items: sample, gemini: gemini(), search: provider }).price(req('owala bottle 32 oz'));
    expect(provider.search).toHaveBeenCalledWith('owala bottle 32 oz');
    expect(result.source).toBe('web');
  });

  it('caches by cleaned text, replaces itemId, and isolates returned evidence', async () => {
    const provider = search(); const db = store();
    const pricing = createPricing({ items: sample, gemini: gemini(), search: provider, store: db });
    const first = await pricing.price(req('my novel widget'));
    first.evidence[0]!.label = 'changed';
    const second = await pricing.price(req('novel widget', 'r2'));
    expect(second.itemId).toBe('r2');
    expect(second.evidence[0]!.label).toBe('Fixture store');
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(db.persist).toHaveBeenCalledWith('priceCache', expect.objectContaining({ cleanText: 'novel widget', createdAt: expect.any(Number) }));
  });

  it('uses a persistent cache result with a fresh item id', async () => {
    const db = store();
    const cached = await createPricing({ items: sample, gemini: gemini() }).price(req('owala'));
    db.getCachedPrice = vi.fn(async () => cached);
    expect(await createPricing({ items: sample, gemini: gemini(), store: db }).price(req('owala', 'r4'))).toMatchObject({ itemId: 'r4', source: 'list' });
  });

  it.each([1, 999999])('clamps web prices %s', async priceCents => {
    const result = await createPricing({ items: sample, gemini: gemini(), search: { search: async () => ({ ...webResult, priceCents }) } }).price(req('novel widget'));
    expect(result.priceCents).toBe(priceCents === 1 ? 100 : 100000);
    expect(result.isEstimate).toBe(false);
  });

  it('requires price corroboration for high web confidence and grounded sources for web labels', async () => {
    const price = async (sources: typeof webResult.sources, text: string) => createPricing({ items: sample, gemini: gemini(), search: { search: async () => ({ ...webResult, sources, text }) } }).price(req('novel widget'));
    const sources = [...webResult.sources, { title: 'Second store', url: 'https://example.org/widget' }];
    expect((await price(sources, '$42.00 and $43.00')).confidence).toBe(0.9);
    expect((await price(sources, '$42.00 and $99.00')).confidence).toBe(0.75);
    expect((await price(sources, '$34.00 and $50.00')).confidence).toBe(0.75);
    expect((await price([], '$42.00')).source).toBe('estimate');
  });

  it('flags model nonproducts and labels low confidence model prices', async () => {
    expect(await createPricing({ items: sample, gemini: gemini({ ...model, notAProduct: true }) }).price(req('asdfgh'))).toMatchObject({ propClosetSuggested: true, isEstimate: true });
    expect(await createPricing({ items: sample, gemini: gemini({ ...model, confidence: 0.1, priceCents: 1 }) }).price(req('widget'))).toMatchObject({ source: 'estimate', priceCents: 100, isEstimate: true });
  });

  it('contains synchronous provider and persistence failures', async () => {
    const db = store(); db.persist = () => { throw Error('offline'); };
    const provider: SearchProvider = { search() { throw Error('offline'); } };
    expect((await createPricing({ items: sample, gemini: gemini(), store: db }).price(req('owala'))).source).toBe('list');
    expect((await createPricing({ items: sample, gemini: gemini(), search: provider }).price(req('widget'))).source).toBe('estimate');
  });

  it('delegates optional frame identification and contains failures', async () => {
    const identify = vi.fn(async () => ({ label: 'Bottle', confidence: 0.8 }));
    const frames = [Buffer.from('fixture')];
    expect(await createPricing({ items: sample, gemini: gemini(), identify }).identifyFromFrames(frames)).toEqual({ label: 'Bottle', confidence: 0.8 });
    expect(identify).toHaveBeenCalledWith(frames);
    expect(await createPricing({ items: sample, gemini: gemini() }).identifyFromFrames(frames)).toBeNull();
    expect(await createPricing({ items: sample, gemini: gemini(), identify: async () => { throw Error('offline'); } }).identifyFromFrames(frames)).toBeNull();
  });
});
