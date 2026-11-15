import { MongoClient } from 'mongodb';
import type { Env } from '../config';

export interface Collection {
  updateOne(filter: object, update: object, options: object): Promise<unknown>;
  createIndex(keys: Record<string, number>, options?: object): Promise<unknown>;
  findOne(filter: object, options?: object): Promise<unknown>;
  find(filter: object, options?: object): { toArray(): Promise<unknown[]> };
}
export interface Client {
  connect(): Promise<unknown>;
  db(name: string): { collection(name: string): Collection };
  close(): Promise<unknown>;
}
export class Deadline extends Error {}
export async function bounded<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Deadline()), ms);
    })]);
  } finally { clearTimeout(timer); }
}
export function mongoClient(env: Env, injected?: unknown): Client | null {
  if (!env.mongodbUri) return null;
  return (injected ?? new MongoClient(env.mongodbUri, { serverSelectionTimeoutMS: 1000,
    connectTimeoutMS: 1000, socketTimeoutMS: 1000, timeoutMS: 1000, retryWrites: false })) as Client;
}
export const targets = {
  player: ['players', ['phoneHash']], game: ['games', ['gameId']], round: ['rounds', ['gameId', 'roundIndex']],
  guess: ['guesses', ['gameId', 'roundIndex', 'playerId']], result: ['results', ['gameId']],
  priceCache: ['price_cache', ['cleanText']], evalRun: ['eval_runs', ['runId', 'variant']],
} as const;
export async function indexes(client: Client, db: string): Promise<void> {
  await Promise.all(Object.values(targets).map(([name, keys]) =>
    client.db(db).collection(name).createIndex(Object.fromEntries(keys.map(k => [k, 1])), { unique: true })));
  await client.db(db).collection('reference_items').createIndex({ id: 1 }, { unique: true });
  await client.db(db).collection('price_cache').createIndex({ createdAt: 1 }, { expireAfterSeconds: 2592000 });
  await client.db(db).collection('eval_runs').createIndex({ ranAt: 1 });
}
