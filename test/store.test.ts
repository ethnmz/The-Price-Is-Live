import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { loadEnv } from '../src/config';
import { createStore } from '../src/store';
import { scrub } from '../src/store/schemas';
import type { PersistKind } from '../src/contracts/events';

const env = loadEnv({ MONGODB_URI: 'mongodb://localhost:27017', PHONE_HASH_SALT: 'test-only-salt' });
const price = { itemId: 'r1', displayName: 'Bottle', priceCents: 2000, source: 'list', isEstimate: false, confidence: 1, evidence: [], latencyMs: 1 };
const game = { gameId: 'g1', startedAt: 1, mode: 'normal', callPlan: 'B', playerIds: ['p1'], totalRounds: 1, lightning: false, textMode: false };
const never = () => new Promise<never>(() => {});
function fake() {
  const collection = { updateOne: vi.fn().mockResolvedValue({}), createIndex: vi.fn().mockResolvedValue('index'),
    findOne: vi.fn().mockResolvedValue(null), find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })) };
  const client = { connect: vi.fn().mockResolvedValue(undefined), db: vi.fn(() => ({ collection: vi.fn(() => collection) })), close: vi.fn().mockResolvedValue(undefined) };
  return { client, collection };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('best effort store', () => {
  it('returns immediately when connect hangs and bounds lifecycle operations', async () => {
    vi.useFakeTimers();
    const { client, collection } = fake(); client.connect.mockImplementation(never);
    const store = createStore(env, { client });
    expect(store.persist('game', game)).toBeUndefined();
    const flushing = store.flush(30);
    await vi.advanceTimersByTimeAsync(30); await flushing;
    expect(collection.updateOne).not.toHaveBeenCalled();
    const closing = store.close(); await vi.advanceTimersByTimeAsync(2400); await closing;
  });
  it('retries rejected writes with backoff', async () => {
    vi.useFakeTimers();
    const { client, collection } = fake(); collection.updateOne.mockRejectedValueOnce(new Error('offline'));
    const store = createStore(env, { client }); store.persist('game', game);
    await vi.advanceTimersByTimeAsync(150);
    expect(collection.updateOne).toHaveBeenCalledTimes(2);
    await store.close();
  });
  it('retries timed-out upserts with backoff and preserves queued writes', async () => {
    vi.useFakeTimers();
    const { client, collection } = fake();
    collection.updateOne.mockImplementationOnce(never);
    const store = createStore(env, { client });
    expect(store.persist('game', game)).toBeUndefined();
    store.persist('game', { ...game, gameId: 'g2' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await store.flush();
    expect(collection.updateOne.mock.calls.map(call => call[0])).toEqual([
      { gameId: 'g1' }, { gameId: 'g1' }, { gameId: 'g2' },
    ]);
    expect(collection.updateOne.mock.calls[1]).toEqual(collection.updateOne.mock.calls[0]);
    await store.close();
  });
  it('hashes phones, increments lifetime counters and strips private data', async () => {
    const { client, collection } = fake(); const store = createStore(env, { client });
    store.persist('player', { gameId: 'g1', phone: '+12145550101', name: 'Ada', points: 50, token: 'private', image: 'data:image/jpeg' });
    await store.flush();
    const [filter, update] = collection.updateOne.mock.calls[0];
    expect(filter).toEqual({ phoneHash: createHash('sha256').update('test-only-salt+12145550101').digest('hex') });
    expect(update.$inc).toEqual({ gamesPlayed: 1, totalPoints: 50 });
    expect(update.$set.phoneLast4).toBe('0101');
    expect(JSON.stringify(collection.updateOne.mock.calls)).not.toContain('+12145550101');
    expect(JSON.stringify(update)).not.toContain('private');
    await store.close();
  });
  it('uses the contract upsert keys for every kind', async () => {
    const { client, collection } = fake(); const store = createStore(env, { client });
    const rows: [PersistKind, Record<string, unknown>, object][] = [
      ['game', game, { gameId: 'g1' }],
      ['round', { gameId: 'g1', roundIndex: 0, ownerId: 'p1', item: { ...price, rawText: 'Bottle', origin: 'text' }, winnerIds: [], winnerReason: 'none', stumpPoints: 0, durationMs: 1 }, { gameId: 'g1', roundIndex: 0 }],
      ['guess', { gameId: 'g1', roundIndex: 0, playerId: 'p2', cents: null, status: 'silent', channel: null, transcript: null, corrected: false, points: 0 }, { gameId: 'g1', roundIndex: 0, playerId: 'p2' }],
      ['result', { gameId: 'g1', scoreboard: [], items: [], cardText: 'Thanks', sentAt: 1 }, { gameId: 'g1' }],
      ['priceCache', { cleanText: 'bottle', result: price, createdAt: Date.now() }, { cleanText: 'bottle' }],
      ['evalRun', { runId: 'e1', ranAt: 1, variant: 'A', models: ['fake'], n: 1, within15: 1, within25: 1, medianAbsPctError: 0, perItem: [] }, { runId: 'e1', variant: 'A' }],
    ];
    for (const [kind, doc] of rows) store.persist(kind, doc);
    await store.flush();
    expect(collection.updateOne.mock.calls.map(c => c[0])).toEqual(rows.map(r => r[2]));
    expect(collection.updateOne.mock.calls.every(c => c[2].upsert)).toBe(true);
    await store.close();
  });
  it('drops invalid documents and players without a salt', async () => {
    const { client, collection } = fake(); const store = createStore({ ...env, phoneHashSalt: '' }, { client });
    store.persist('game', { gameId: 'only' });
    store.persist('priceCache', { cleanText: 'bad', result: { ...price, priceCents: -1 }, createdAt: 1 });
    store.persist('player', { gameId: 'g1', phone: '+12145550101', name: 'Ada', points: 1 });
    await store.flush(); expect(collection.updateOne).not.toHaveBeenCalled(); await store.close();
  });
  it('falls back to validated fixture JSON when Atlas is empty', async () => {
    const { client } = fake(); const store = createStore(env, { client, dataDir: '/missing-store-test-data' });
    const items = await store.loadReferenceItems(); expect(items.length).toBeGreaterThan(0);
    expect(items.every(item => /^ref_\d{4}$/.test(item.id))).toBe(true);
    expect(new Set(items.map(item => item.id)).size).toBe(items.length);
    expect(items[0]).toMatchObject({ id: 'ref_0001', priceCents: 2799, verified: false });
    await store.close();
  });
  it('returns null within 300 ms for a hanging cache lookup', async () => {
    vi.useFakeTimers(); const { client, collection } = fake(); collection.findOne.mockImplementation(never);
    const store = createStore(env, { client }); const lookup = store.getCachedPrice('bottle');
    await vi.advanceTimersByTimeAsync(300); expect(await lookup).toBeNull(); await store.close();
  });
  it('keeps cached prices in local mode without touching the client', async () => {
    const { client } = fake(); const store = createStore({ ...env, mongodbUri: '' }, { client, dataDir: 'fixtures' });
    expect(await store.ready()).toBe(false);
    store.persist('priceCache', { cleanText: 'bottle', result: price, createdAt: Date.now() });
    expect(await store.getCachedPrice('bottle')).toEqual(price);
    expect(await store.getCachedPrice('missing')).toBeNull();
    expect(await store.vectorSearch([], 1)).toEqual([]);
    expect((await store.loadReferenceItems()).length).toBeGreaterThan(0);
    await store.close(); expect(client.connect).not.toHaveBeenCalled();
  });
  it('bounds hung writes and does not replay ambiguous counter increments', async () => {
    vi.useFakeTimers(); const { client, collection } = fake(); collection.updateOne.mockImplementation(never);
    const store = createStore(env, { client }); store.persist('player', { gameId: 'g1', phone: '+12145550101', name: 'Ada', points: 1 });
    const done = store.flush(); await vi.advanceTimersByTimeAsync(1100); await done;
    expect(collection.updateOne).toHaveBeenCalledTimes(1); await store.close();
  });
});

it('recursively strips phone, token and image fields from mixed documents', () => {
  expect(scrub({ safe: 'Bottle', nested: { text: 'call +12145550101', accessToken: 'private', imageJpegBase64: ['private'], ok: 42 } })).toEqual({ safe: 'Bottle', nested: { ok: 42 } });
});
