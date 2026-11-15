import { MongoClient } from 'mongodb';

export interface Collection {
  createIndex(keys: Record<string, number>, options?: Record<string, unknown>): Promise<unknown>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options: { upsert: boolean }): Promise<unknown>;
  findOne(filter: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<unknown[]> };
}
export interface Client {
  connect(): Promise<unknown>;
  db(name: string): { collection(name: string): Collection };
  close(): Promise<unknown>;
}
export function mongoClient(uri: string): Client {
  return new MongoClient(uri, { serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000, socketTimeoutMS: 1000, retryWrites: false }) as unknown as Client;
}
export const collections = { game: 'games', player: 'players', round: 'rounds', guess: 'guesses', result: 'results', priceCache: 'price_cache', evalRun: 'eval_runs' } as const;
export const keys = { game: ['gameId'], player: ['phoneHash'], round: ['gameId', 'roundIndex'], guess: ['gameId', 'roundIndex', 'playerId'], result: ['gameId'], priceCache: ['cleanText'], evalRun: ['runId', 'variant'] } as const;

export async function bounded<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Store timeout')), ms); })]);
  } finally { clearTimeout(timer); }
}
