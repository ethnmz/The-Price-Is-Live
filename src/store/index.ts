/** Mongo persistence is best effort and never part of the game clock.
 * TO VERIFY ON THE REAL LINE: Atlas permissions, indexes and write latency with deployment credentials.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pino from 'pino';
import type { Env } from '../config';
import type { PersistKind, PriceResult, ReferenceItem, StorePort } from '../contracts';
import { bounded, collections, keys, mongoClient, type Client } from './mongo';
import { priceSchema, referenceSchema, sanitize, schemas } from './schemas';

type Job = { kind: PersistKind; doc: Record<string, unknown>; attempts: number };
export function createStore(env: Env, opts: { client?: unknown; dataDir?: string } = {}): StorePort & { ready(): Promise<boolean>; flush(timeoutMs?: number): Promise<void>; close(): Promise<void> } {
  let logger: ReturnType<typeof pino>;
  try { logger = pino({ level: env.logLevel || 'info' }); } catch { logger = pino({ level: 'warn' }); }
  const warn = (msg: string) => { try { logger.warn(msg); } catch { /* Logging cannot stop the game. */ } };
  let client: Client | undefined;
  try { if (env.mongodbUri) client = (opts.client as Client | undefined) ?? mongoClient(env.mongodbUri); } catch { warn('Store database configuration unavailable'); }
  if (!client) warn('Store local-only mode: database queue discarded');
  let closed = false;
  let connected = false;
  let connecting: Promise<boolean> | undefined;
  let indexed = false;
  let running: Promise<void> | undefined;
  let overflowWarned = false;
  const queue: Job[] = [];
  const cache = new Map<string, PriceResult>();
  const collection = (name: string) => client!.db(env.mongodbDb || 'priceislive').collection(name);
  const ready = (): Promise<boolean> => {
    if (!client || closed) return Promise.resolve(false);
    if (connected) return Promise.resolve(true);
    if (!connecting) connecting = bounded(() => client!.connect(), 1000).then(() => {
      if (closed) return false;
      connected = true;
      if (!indexed) {
        indexed = true;
        void Promise.allSettled([
          ...Object.entries(collections).map(([kind, name]) => bounded(() => collection(name).createIndex(Object.fromEntries(keys[kind as PersistKind].map(k => [k, 1])), { unique: true }), 1000)),
          bounded(() => collection('reference_items').createIndex({ id: 1 }, { unique: true }), 1000),
          bounded(() => collection('price_cache').createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 }), 1000),
          bounded(() => collection('eval_runs').createIndex({ ranAt: 1 }), 1000),
        ]).then(results => { if (results.some(r => r.status === 'rejected')) warn('Store index setup unavailable'); });
      }
      return true;
    }).catch(() => false).finally(() => { connecting = undefined; });
    return connecting;
  };
  async function drain(): Promise<void> {
    while (queue.length && !closed) {
      const job = queue.shift()!;
      try {
        if (!await ready()) throw new Error('unavailable');
        const filter = Object.fromEntries(keys[job.kind].map(k => [k, job.doc[k]]));
        let update: Record<string, unknown> = { $set: job.doc };
        if (job.kind === 'player') {
          const { points, ...player } = job.doc;
          update = { $set: { name: player.name, phoneLast4: player.phoneLast4, lastSeenAt: player.lastSeenAt }, $setOnInsert: { phoneHash: player.phoneHash, firstSeenAt: player.lastSeenAt }, $inc: { gamesPlayed: 1, totalPoints: points } };
        }
        await bounded(() => collection(collections[job.kind]).updateOne(filter, update, { upsert: true }), 1000);
      } catch (error) {
        // An unacknowledged increment may already have committed: do not repeat it.
        const ambiguous = job.kind === 'player' && error instanceof Error && error.message === 'Store timeout';
        if (ambiguous) warn('Store player write timed out; discarded ambiguous counter increment');
        else if (++job.attempts < 3 && !closed) {
          await new Promise<void>(r => { const t = setTimeout(r, 50 * 2 ** (job.attempts - 1)); t.unref?.(); });
          // Retry before newer documents so an old snapshot cannot overwrite them.
          if (!closed) enqueue(job, true);
        } else warn('Store write dropped after retry limit');
      }
    }
  }
  function kick(): void {
    if (!running && client && !closed) running = Promise.resolve().then(drain).catch(() => warn('Store background write failed')).finally(() => { running = undefined; if (queue.length && !closed) kick(); });
  }
  function enqueue(job: Job, retry = false): void {
    if (queue.length >= 500) { queue.shift(); if (!overflowWarned) { overflowWarned = true; warn('Store queue full: oldest document dropped'); } }
    if (retry) queue.unshift(job);
    else queue.push(job);
  }
  function persist(kind: PersistKind, input: Record<string, unknown>): void {
    try {
      if (closed || !Object.hasOwn(schemas, kind)) return;
      // Phone must be validated and hashed before generic privacy stripping.
      const parsed = schemas[kind].safeParse(kind === 'player' ? input : sanitize(input));
      if (!parsed.success) { warn('Store invalid document dropped'); return; }
      let doc = parsed.data as Record<string, unknown>;
      if (kind === 'player') {
        if (!env.phoneHashSalt) { warn('Store player dropped: phone hash salt missing'); return; }
        const phone = doc.phone as string;
        doc = { ...doc, phoneLast4: phone.slice(-4), phoneHash: createHash('sha256').update(env.phoneHashSalt).update(phone).digest('hex'), lastSeenAt: Date.now() };
        delete doc.phone;
        doc = sanitize(doc) as Record<string, unknown>;
        if (!doc.name) return;
      }
      if (kind === 'priceCache') {
        doc.createdAt = new Date(doc.createdAt as string | number | Date);
        cache.delete(doc.cleanText as string);
        cache.set(doc.cleanText as string, doc.result as PriceResult);
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
      }
      if (kind === 'evalRun') doc.ranAt = new Date(doc.ranAt as string | number | Date);
      if (!client) return;
      enqueue({ kind, doc, attempts: 0 });
      kick();
    } catch { warn('Store invalid document dropped'); }
  }
  async function loadReferenceItems(): Promise<ReferenceItem[]> {
    try {
      const docs = await bounded(async () => await ready() ? collection('reference_items').find({}, { maxTimeMS: 1900 }).toArray() : [], 2000);
      const items = docs.flatMap(d => { const p = referenceSchema.safeParse(sanitize(d)); return p.success ? [p.data] : []; });
      if (items.length) return items;
    } catch { /* Local list keeps the game available. */ }
    for (const path of [resolve(opts.dataDir ?? 'data', 'reference-items.json'), resolve('fixtures/reference-items.sample.json')]) {
      try {
        const parsed = referenceSchema.array().safeParse(sanitize(JSON.parse(await readFile(path, 'utf8'))));
        if (parsed.success && parsed.data.length) return parsed.data;
      } catch { /* Try the next bundled list. */ }
    }
    return [];
  }
  async function getCachedPrice(cleanText: string): Promise<PriceResult | null> {
    try {
      const local = cache.get(cleanText);
      if (local) return structuredClone(local);
      return await bounded(async () => {
        if (!await ready()) return null;
        const value = await collection('price_cache').findOne({ cleanText }, { maxTimeMS: 250 }) as { result?: unknown; createdAt?: unknown } | null;
        if (!value) return null;
        const createdAt = new Date(value.createdAt as string | number).getTime();
        if (!Number.isFinite(createdAt) || Date.now() - createdAt > 2592000000) return null;
        const parsed = priceSchema.safeParse(sanitize(value.result));
        return parsed.success ? parsed.data : null;
      }, 300);
    } catch { return null; }
  }
  async function flush(timeoutMs = 2000): Promise<void> {
    try { kick(); await bounded(async () => { while (running) await running; }, Math.max(0, timeoutMs)); } catch { /* Shutdown has a deadline. */ }
  }
  async function close(): Promise<void> {
    if (closed) return;
    await flush(); closed = true; queue.length = 0;
    try { if (client) await bounded(() => client!.close(), 300); } catch { /* Closing is best effort. */ }
  }
  return { persist, ready, flush, close, loadReferenceItems, getCachedPrice, vectorSearch: async () => [] };
}
