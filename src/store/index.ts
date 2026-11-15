/**
 * Best effort persistence. No database operation runs on the game's call stack.
 * TO VERIFY ON THE REAL LINE: Atlas permissions, indexes and outage recovery with venue networking.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pino from 'pino';
import { z } from 'zod';
import type { Env } from '../config';
import type { StorePort } from '../contracts/ports';
import type { PersistKind } from '../contracts/events';
import type { PriceResult, ReferenceItem } from '../contracts/types';
import { bounded, Deadline, indexes, mongoClient, targets } from './mongo';
import { priceSchema, referenceSchema, schemas, scrub } from './schemas';

function epoch(value: string | number | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

type Write = { kind: PersistKind; doc: Record<string, unknown>; attempts: number };
export function createStore(env: Env, opts: { client?: unknown; dataDir?: string } = {}): StorePort & {
  ready(): Promise<boolean>; flush(timeoutMs?: number): Promise<void>; close(): Promise<void>;
} {
  const log = pino();
  const warn = (message: string) => { try { log.warn(message); } catch { /* logging cannot stop play */ } };
  let client: ReturnType<typeof mongoClient> = null;
  try { client = mongoClient(env, opts.client); } catch { warn('Store configuration unavailable'); }
  if (!client) warn('Store local-only mode: database queue discarded');
  let closed = false;
  let connected = false;
  let connection: Promise<boolean> | undefined;
  let indexed = false;
  let active = false;
  let overflow = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const queue: Write[] = [];
  const cache = new Map<string, { result: PriceResult; at: number }>();
  const ready = (): Promise<boolean> => {
    if (closed || !client) return Promise.resolve(false);
    if (connected) return Promise.resolve(true);
    if (connection) return connection;
    connection = bounded(() => client!.connect(), 1000).then(() => {
      if (closed) return false;
      connected = true;
      if (!indexed) {
        indexed = true;
        void bounded(() => indexes(client!, env.mongodbDb), 1000).catch(() => warn('Store index creation unavailable'));
      }
      return true;
    }, () => false).finally(() => { connection = undefined; });
    return connection;
  };
  const pump = async (): Promise<void> => {
    if (active || closed || !client || !queue.length || retry) return;
    active = true;
    const entry = queue[0];
    try {
      if (!await ready()) throw new Error('offline');
      const [name, keys] = targets[entry.kind];
      const doc = entry.doc;
      const filter = Object.fromEntries(keys.map(key => [key, doc[key]]));
      const update = entry.kind === 'player' ? {
        $set: { name: doc.name, phoneLast4: doc.phoneLast4, lastSeenAt: new Date() },
        $setOnInsert: { phoneHash: doc.phoneHash, firstSeenAt: new Date() },
        $inc: { gamesPlayed: 1, totalPoints: doc.points },
      } : { $set: doc };
      await bounded(() => client!.db(env.mongodbDb).collection(name).updateOne(filter, update, { upsert: true }), 1000);
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
    } catch (error) {
      if (error instanceof Deadline && entry.kind === 'player') {
        // Counter increments may have reached Atlas even if the response never
        // arrived. All other writes use idempotent $set upserts and can retry.
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
        warn('Store player write timed out; discarded ambiguous counter increment');
      } else if (!closed) {
        connected = false;
        retry = setTimeout(() => { retry = undefined; void pump(); }, Math.min(5000, 100 * 2 ** Math.min(entry.attempts++, 6)));
        retry.unref();
      }
    } finally {
      active = false;
      if (!closed && queue.length && !retry) queueMicrotask(() => { void pump(); });
    }
  };
  const flush = async (timeoutMs = 2000): Promise<void> => {
    const end = Date.now() + Math.max(0, Number.isFinite(timeoutMs) ? timeoutMs : 2000);
    while (!closed && (queue.length || active) && Date.now() < end) {
      void pump();
      await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(0, end - Date.now()))));
    }
  };
  return {
    ready, flush,
    persist(kind, input) {
      try {
        if (closed) return;
        const schema = schemas[kind];
        if (!schema) return;
        // Validate the phone before replacing it, then scrub every other field.
        const parsed = schema.safeParse(input);
        if (!parsed.success) { warn('Store invalid document dropped'); return; }
        let doc: Record<string, unknown> = parsed.data;
        if (kind === 'player') {
          if (!env.phoneHashSalt) { warn('Store player dropped: phone hash salt missing'); return; }
          const phone = String(doc.phone);
          delete doc.phone;
          // Derived identifiers are trusted: a hash can contain digit runs that
          // resemble a phone number, so attach it only after scrubbing input.
          doc = { ...scrub(doc) as Record<string, unknown>,
            phoneHash: createHash('sha256').update(env.phoneHashSalt).update(phone).digest('hex'), phoneLast4: phone.slice(-4) };
        } else doc = scrub(doc) as Record<string, unknown>;
        if (kind === 'player' && (typeof doc.name !== 'string' || typeof doc.phoneHash !== 'string')) return;
        if (kind !== 'player' && !schema.safeParse(doc).success) {
          warn('Store document dropped after privacy filtering'); return;
        }
        if (kind === 'priceCache') {
          const valid = schemas.priceCache.safeParse(doc);
          if (!valid.success) return;
          const at = epoch(valid.data.createdAt);
          if (!Number.isFinite(at)) return;
          doc.createdAt = new Date(at);
          cache.delete(valid.data.cleanText);
          cache.set(valid.data.cleanText, { result: valid.data.result, at });
          if (cache.size > 1000) cache.delete(cache.keys().next().value!);
        }
        if (!client) return;
        if (queue.length >= 1000) {
          queue.shift();
          if (!overflow) { overflow = true; warn('Store queue full: dropping oldest documents'); }
        }
        queue.push({ kind, doc, attempts: 0 });
        queueMicrotask(() => { void pump(); });
      } catch { warn('Store document dropped'); }
    },
    async loadReferenceItems() {
      try {
        const rows = await bounded(async () => {
          if (!await ready()) return [];
          return client!.db(env.mongodbDb).collection('reference_items').find({}, { maxTimeMS: 1800 }).toArray();
        }, 2000);
        const parsed = z.array(referenceSchema).safeParse(scrub(rows));
        if (parsed.success && parsed.data.length) return parsed.data;
      } catch { /* read local list */ }
      const samplePath = resolve('fixtures/reference-items.sample.json');
      for (const path of [resolve(opts.dataDir ?? 'data', 'reference-items.json'), samplePath]) {
        try {
          let rows: unknown = JSON.parse(await readFile(path, 'utf8'));
          // The frozen sample predates the four-digit ID contract. Adapt only
          // that fixture; Atlas and production files remain strictly validated.
          if (path === samplePath && Array.isArray(rows)) rows = rows.map(row =>
            row && typeof row === 'object' && typeof row.id === 'string'
              ? { ...row, id: row.id.replace(/^ref_s(\d{3})$/, 'ref_0$1') } : row);
          const parsed = z.array(referenceSchema).safeParse(scrub(rows));
          if (parsed.success && parsed.data.length) return parsed.data as ReferenceItem[];
        } catch { /* try next file */ }
      }
      return [];
    },
    async getCachedPrice(cleanText) {
      const local = cache.get(cleanText);
      if (local && Date.now() - local.at < 2592000000) return structuredClone(local.result);
      cache.delete(cleanText);
      try {
        return await bounded(async () => {
          if (!await ready()) return null;
          const row = await client!.db(env.mongodbDb).collection('price_cache').findOne({ cleanText }, { maxTimeMS: 250 });
          const parsed = schemas.priceCache.safeParse(scrub(row));
          if (!parsed.success) return null;
          const at = epoch(parsed.data.createdAt);
          if (!Number.isFinite(at) || Date.now() - at >= 2592000000) return null;
          const result = priceSchema.safeParse(parsed.data.result);
          return result.success ? result.data : null;
        }, 300);
      } catch { return null; }
    },
    async vectorSearch() { return []; },
    async close() {
      if (closed) return;
      await flush();
      closed = true;
      clearTimeout(retry);
      queue.length = 0;
      try { if (client) await bounded(() => client!.close(), 300); } catch { /* best effort */ }
    },
  };
}
