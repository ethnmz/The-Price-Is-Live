// `npm run seed`: loads data/reference-items.json into Atlas and creates every index from docs/DATA_MODEL.md section 5.
// No embeddings and no vector index are built (not implemented); the output says so.
//
// TO VERIFY ON THE REAL LINE: run against a real Atlas cluster with MONGODB_URI set.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { loadEnv } from '../config';

export const TTL_SECONDS = 30 * 24 * 60 * 60;

/** Index plan for every collection (docs/DATA_MODEL.md section 5). */
export const INDEXES: { collection: string; keys: Record<string, 1 | -1>; options: Record<string, unknown> }[] = [
  { collection: 'reference_items', keys: { id: 1 }, options: { unique: true } },
  { collection: 'players', keys: { phoneHash: 1 }, options: { unique: true } },
  { collection: 'games', keys: { gameId: 1 }, options: { unique: true } },
  { collection: 'rounds', keys: { gameId: 1, roundIndex: 1 }, options: { unique: true } },
  { collection: 'guesses', keys: { gameId: 1, roundIndex: 1 }, options: {} },
  { collection: 'results', keys: { gameId: 1 }, options: { unique: true } },
  { collection: 'price_cache', keys: { cleanText: 1 }, options: { unique: true } },
  { collection: 'price_cache', keys: { createdAt: 1 }, options: { expireAfterSeconds: TTL_SECONDS } },
  { collection: 'eval_runs', keys: { ranAt: 1 }, options: {} },
];

/** Turn one raw JSON row into a clean reference_items document. Returns null if it is unusable. */
export function toReferenceDoc(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  const cents = Number(r.priceCents);
  if (!Number.isFinite(cents)) return null;
  const doc: Record<string, unknown> = {
    id: r.id,
    name: r.name,
    aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === 'string') : [],
    category: typeof r.category === 'string' ? r.category : '',
    priceCents: Math.round(cents), // always whole cents
    source: typeof r.source === 'string' ? r.source : '',
    checkedAt: typeof r.checkedAt === 'string' ? r.checkedAt : '',
  };
  if (typeof r.sizeNote === 'string') doc.sizeNote = r.sizeNote;
  if (typeof r.verified === 'boolean') doc.verified = r.verified;
  return doc; // unknown fields (and embedding) are dropped on purpose
}

export async function seed(uri: string, dbName: string, file = resolve('data/reference-items.json')): Promise<void> {
  const rows: unknown[] = JSON.parse(readFileSync(file, 'utf8'));
  const docs = rows.map(toReferenceDoc).filter((d): d is Record<string, unknown> => d !== null);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(dbName);
    if (docs.length > 0) {
      await db.collection('reference_items').bulkWrite(docs.map((d) => ({ updateOne: { filter: { id: d.id }, update: { $set: d }, upsert: true } })));
    }
    for (const ix of INDEXES) await db.collection(ix.collection).createIndex(ix.keys, ix.options);
    console.log(`Upserted ${docs.length} of ${rows.length} reference items.`);
    console.log(`Created ${INDEXES.length} indexes (price_cache TTL ${TTL_SECONDS}s).`);
    for (const name of new Set(INDEXES.map((i) => i.collection))) {
      console.log(`  ${name}: ${await db.collection(name).countDocuments()} documents`);
    }
    console.log('No embeddings and no vector index were built (not implemented).');
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const env = loadEnv(process.env, { readDotenv: true });
  if (!env.mongodbUri) {
    console.error('MONGODB_URI is missing. Set it in .env, then run `npm run seed` again.');
    process.exit(1);
  }
  await seed(env.mongodbUri, env.mongodbDb);
}

if (process.argv[1] && /seed\.[tj]s$/.test(process.argv[1])) {
  main().catch((e) => { console.error(`Seed failed: ${(e as Error).message}`); process.exit(1); });
}
