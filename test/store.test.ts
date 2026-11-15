import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/config';
import { createStore } from '../src/store';

const env = () => loadEnv({ MONGODB_URI: 'mongodb://fixture.invalid', PHONE_HASH_SALT: 'fixture-salt', LOG_LEVEL: 'silent' });
const price = { itemId: 'r1', displayName: 'Bottle', priceCents: 2500, source: 'list', isEstimate: false, confidence: 1, evidence: [], latencyMs: 0 };
const game = { gameId: 'g1', startedAt: 1, mode: 'normal', callPlan: 'B', playerIds: ['p1', 'p2'], totalRounds: 2, lightning: false, textMode: false };
function fake() {
  const writes: { collection: string; filter: Record<string, unknown>; update: Record<string, unknown> }[] = [];
  const update = vi.fn(async () => {});
  const findOne = vi.fn(async (): Promise<unknown> => null);
  const toArray = vi.fn(async (): Promise<unknown[]> => []);
  const index = vi.fn(async () => {});
  const client = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}), db: vi.fn(() => ({ collection: (name: string) => ({
    createIndex: index, findOne, find: () => ({ toArray }),
    updateOne: async (filter: Record<string, unknown>, value: Record<string, unknown>) => { writes.push({ collection: name, filter, update: value }); await update(); },
  }) })) };
  return { client, writes, update, findOne, toArray, index };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); });

describe('nonblocking store', () => {
  it('returns immediately with a hanging client and bounds ready, flush and close', async () => {
    vi.useFakeTimers();
    const f = fake(); f.client.connect.mockImplementation(() => new Promise(() => {}));
    const store = createStore(env(), { client: f.client });
    expect(store.persist('game', game)).toBeUndefined();
    const ready = store.ready();
    await vi.advanceTimersByTimeAsync(1000); expect(await ready).toBe(false);
    const flush = store.flush(20); await vi.advanceTimersByTimeAsync(20); await flush;
    const close = store.close(); await vi.advanceTimersByTimeAsync(2300); await close;
    expect(f.writes).toHaveLength(0);
  });

  it('retries a failed write with backoff', async () => {
    vi.useFakeTimers();
    const f = fake(); f.update.mockRejectedValueOnce(new Error('offline'));
    const store = createStore(env(), { client: f.client });
    store.persist('game', game); await settle();
    expect(f.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(50); await store.flush();
    expect(f.update).toHaveBeenCalledTimes(2); await store.close();
  });

  it('keeps newer game values after retrying a failed game-start write', async () => {
    vi.useFakeTimers();
    const f = fake();
    const stored: Record<string, unknown> = {};
    f.update.mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => {
      Object.assign(stored, f.writes[f.writes.length - 1].update.$set);
    });
    const store = createStore(env(), { client: f.client });
    store.persist('game', game); await settle();
    expect(f.update).toHaveBeenCalledTimes(1);
    const finished = { ...game, endedAt: 100, totalRounds: 4, lightning: true, textMode: true };
    store.persist('game', finished);
    await vi.advanceTimersByTimeAsync(50); await store.flush();
    expect(f.update).toHaveBeenCalledTimes(3);
    expect(stored).toMatchObject(finished);
    await store.close();
  });

  it('hashes phones and increments lifetime counters without storing private content', async () => {
    const f = fake(); const store = createStore(env(), { client: f.client });
    store.persist('player', { gameId: 'g1', phone: '+12145550101', name: 'Player', points: 125, token: 'private' });
    await store.flush();
    expect(f.writes[0].filter).toEqual({ phoneHash: createHash('sha256').update('fixture-salt+12145550101').digest('hex') });
    expect(f.writes[0].update.$inc).toEqual({ gamesPlayed: 1, totalPoints: 125 });
    expect(f.writes[0].update.$set).toMatchObject({ name: 'Player', phoneLast4: '0101' });
    expect(JSON.stringify(f.writes)).not.toContain('+12145550101');
    expect(JSON.stringify(f.writes)).not.toContain('private'); await store.close();
  });

  it('uses the collection and identity for every kind', async () => {
    const f = fake(); const store = createStore(env(), { client: f.client });
    store.persist('game', game);
    store.persist('round', { gameId: 'g1', roundIndex: 0, ownerId: 'p1', item: { ...price, origin: 'text', rawText: null }, winnerIds: [], winnerReason: 'none', stumpPoints: 0, durationMs: 5 });
    store.persist('guess', { gameId: 'g1', roundIndex: 0, playerId: 'p2', cents: null, status: 'silent', channel: null, transcript: null, corrected: false, points: 0 });
    store.persist('result', { gameId: 'g1', scoreboard: [], items: [], cardText: 'Done', sentAt: 2 });
    store.persist('priceCache', { cleanText: 'bottle', result: price, createdAt: Date.now() });
    store.persist('evalRun', { runId: 'e1', ranAt: Date.now(), variant: 'A', models: ['fixture'], n: 1, within15: 1, within25: 1, medianAbsPctError: 0, perItem: [] });
    await store.flush();
    expect(f.writes.map(w => [w.collection, w.filter])).toEqual([
      ['games', { gameId: 'g1' }], ['rounds', { gameId: 'g1', roundIndex: 0 }], ['guesses', { gameId: 'g1', roundIndex: 0, playerId: 'p2' }], ['results', { gameId: 'g1' }], ['price_cache', { cleanText: 'bottle' }], ['eval_runs', { runId: 'e1', variant: 'A' }],
    ]);
    expect((f.writes[4].update.$set as Record<string, unknown>).createdAt).toBeInstanceOf(Date);
    await store.ready(); expect(f.index).toHaveBeenCalledTimes(10); await store.close();
  });

  it('drops invalid input and players without a hash salt', async () => {
    const f = fake(); const store = createStore({ ...env(), phoneHashSalt: '' }, { client: f.client });
    store.persist('game', { gameId: 'g' });
    store.persist('priceCache', { cleanText: 'bad', result: { ...price, priceCents: -1 }, createdAt: 1 });
    store.persist('player', { gameId: 'g', phone: '+12145550101', name: 'Player', points: 1 });
    await store.flush(); expect(f.writes).toHaveLength(0); await store.close();
  });

  it('strips phones embedded in text and private nested fields', async () => {
    const f = fake(); const store = createStore(env(), { client: f.client });
    store.persist('result', { gameId: 'g1', scoreboard: [], items: [], cardText: 'Text +1 (214) 555-0101', sentAt: 2, token: 'hidden', imageJpegBase64: ['frame'] });
    await store.flush(); expect(f.writes[0].update.$set).toEqual({ gameId: 'g1', scoreboard: [], items: [], sentAt: 2 }); await store.close();
  });

  it('reads Atlas first and falls back to bundled sample JSON offline', async () => {
    const f = fake(); const store = createStore(env(), { client: f.client, dataDir: '/missing-store-test-directory' });
    const sample = await store.loadReferenceItems(); expect(sample.length).toBe(20);
    f.toArray.mockResolvedValueOnce([sample[0]]);
    expect(await store.loadReferenceItems()).toEqual([sample[0]]);
    f.toArray.mockRejectedValueOnce(new Error('offline'));
    expect(await store.loadReferenceItems()).toEqual(sample); await store.close();
  });

  it('uses the configured data directory before the sample list', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'store-test-'));
    const store = createStore({ ...env(), mongodbUri: '' }, { dataDir: directory });
    try {
      const sample = JSON.parse(await readFile('fixtures/reference-items.sample.json', 'utf8'));
      await writeFile(join(directory, 'reference-items.json'), JSON.stringify([sample[0]]));
      expect(await store.loadReferenceItems()).toEqual([sample[0]]);
    } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it('validates database cache entries and ignores expired or invalid dates', async () => {
    const f = fake(); const store = createStore(env(), { client: f.client });
    f.findOne.mockResolvedValueOnce({ result: price, createdAt: new Date() });
    expect(await store.getCachedPrice('fresh')).toEqual(price);
    f.findOne.mockResolvedValueOnce({ result: price, createdAt: new Date(Date.now() - 2592000001) });
    expect(await store.getCachedPrice('expired')).toBeNull();
    f.findOne.mockResolvedValueOnce({ result: price, createdAt: 'invalid' });
    expect(await store.getCachedPrice('invalid date')).toBeNull();
    f.findOne.mockResolvedValueOnce({ result: { ...price, confidence: 2 }, createdAt: new Date() });
    expect(await store.getCachedPrice('invalid price')).toBeNull();
    await store.close();
  });

  it('bounds reference reads at 2 seconds', async () => {
    vi.useFakeTimers(); const f = fake(); f.toArray.mockImplementation(() => new Promise(() => {}));
    const store = createStore(env(), { client: f.client, dataDir: '/missing-store-test-directory' });
    const result = store.loadReferenceItems(); await vi.advanceTimersByTimeAsync(2000);
    expect((await result).length).toBe(20); await store.close();
  });

  it('returns null at the 300ms cache deadline and finds prices persisted locally', async () => {
    vi.useFakeTimers(); const f = fake(); f.findOne.mockImplementation(() => new Promise(() => {}));
    const store = createStore(env(), { client: f.client });
    const result = store.getCachedPrice('absent'); await vi.advanceTimersByTimeAsync(300); expect(await result).toBeNull();
    store.persist('priceCache', { cleanText: 'bottle', result: price, createdAt: Date.now() });
    expect(await store.getCachedPrice('bottle')).toEqual(price); await store.close();
  });

  it('works without a URI and never uses the injected database', async () => {
    const f = fake(); const store = createStore({ ...env(), mongodbUri: '' }, { client: f.client, dataDir: '/missing-store-test-directory' });
    expect(await store.ready()).toBe(false); store.persist('game', game);
    store.persist('priceCache', { cleanText: 'bottle', result: price, createdAt: 1 });
    expect(await store.getCachedPrice('bottle')).toEqual(price); expect(await store.getCachedPrice('missing')).toBeNull();
    expect(await store.vectorSearch([], 1)).toEqual([]); expect((await store.loadReferenceItems()).length).toBe(20);
    await store.flush(); await store.close(); expect(f.client.connect).not.toHaveBeenCalled();
  });

  it('caps queued writes and drops the oldest', async () => {
    vi.useFakeTimers(); const f = fake(); const store = createStore(env(), { client: f.client });
    for (let i = 0; i < 505; i++) store.persist('game', { ...game, gameId: `g${i}` });
    await store.flush(); expect(f.writes).toHaveLength(500); expect(f.writes[0].filter).toEqual({ gameId: 'g5' }); await store.close();
  });

  it('does not repeat an ambiguous player increment after a write timeout', async () => {
    vi.useFakeTimers(); const f = fake(); f.update.mockImplementation(() => new Promise(() => {}));
    const store = createStore(env(), { client: f.client });
    store.persist('player', { gameId: 'g1', phone: '+12145550101', name: 'Player', points: 1 });
    await vi.advanceTimersByTimeAsync(1000); await store.flush(); expect(f.update).toHaveBeenCalledTimes(1); await store.close();
  });
});
