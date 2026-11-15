// `npm run atlas:stats`: show-off aggregations over the game data in Atlas, printed as small tables.
// `--dry` prints the pipelines as JSON without connecting.
//
// TO VERIFY ON THE REAL LINE: run against an Atlas cluster that holds real games.
import { MongoClient } from 'mongodb';
import { loadEnv } from '../src/config';

export type Stage = Record<string, unknown>;
export interface Pipeline { name: string; collection: string; title: string; build: () => Stage[] }

/** Average points handed out per round (sum over all guessers, then averaged across rounds). */
export const pointsPipeline = (): Stage[] => [
  { $group: { _id: { gameId: '$gameId', roundIndex: '$roundIndex' }, roundPoints: { $sum: '$points' } } },
  { $group: { _id: null, avgPerRound: { $avg: '$roundPoints' }, rounds: { $sum: 1 } } },
  { $project: { _id: 0, avgPerRound: { $round: ['$avgPerRound', 1] }, rounds: 1 } },
];

/** Average points for each player id. */
export const pointsPerPlayerPipeline = (): Stage[] => [
  { $group: { _id: '$playerId', avgPoints: { $avg: '$points' }, total: { $sum: '$points' }, guesses: { $sum: 1 } } },
  { $project: { _id: 0, player: '$_id', avgPoints: { $round: ['$avgPoints', 1] }, total: 1, guesses: 1 } },
  { $sort: { total: -1 } },
  { $limit: 10 },
];

/** Where prices came from: list, web or estimate. */
export const sourceSharePipeline = (): Stage[] => [
  { $group: { _id: '$item.source', rounds: { $sum: 1 } } },
  { $project: { _id: 0, source: '$_id', rounds: 1 } },
  { $sort: { rounds: -1 } },
];

/** Items that stumped the players most. */
export const trickiestPipeline = (): Stage[] => [
  { $match: { stumpPoints: { $gt: 0 } } },
  { $group: { _id: '$item.displayName', stumpPoints: { $max: '$stumpPoints' }, priceCents: { $first: '$item.priceCents' } } },
  { $sort: { stumpPoints: -1 } },
  { $limit: 5 },
  { $project: { _id: 0, item: '$_id', stumpPoints: 1, priceCents: 1 } },
];

/** Lifetime leaderboard. */
export const leaderboardPipeline = (): Stage[] => [
  { $sort: { totalPoints: -1 } },
  { $limit: 10 },
  { $project: { _id: 0, name: 1, phoneLast4: 1, gamesPlayed: 1, totalPoints: 1 } },
];

/** Pricing error by eval variant. */
export const evalErrorPipeline = (): Stage[] => [
  { $group: { _id: '$variant', runs: { $sum: 1 }, avgWithin15: { $avg: '$within15' }, avgWithin25: { $avg: '$within25' }, medianAbsPctError: { $avg: '$medianAbsPctError' } } },
  { $project: { _id: 0, variant: '$_id', runs: 1, avgWithin15: { $round: ['$avgWithin15', 3] }, avgWithin25: { $round: ['$avgWithin25', 3] }, medianAbsPctError: { $round: ['$medianAbsPctError', 3] } } },
  { $sort: { medianAbsPctError: 1 } },
];

export const PIPELINES: Pipeline[] = [
  { name: 'points', collection: 'guesses', title: 'Average points per round and per player', build: pointsPipeline },
  { name: 'pointsPerPlayer', collection: 'guesses', title: 'Average points by player', build: pointsPerPlayerPipeline },
  { name: 'sourceShare', collection: 'rounds', title: 'Price source share (list / web / estimate)', build: sourceSharePipeline },
  { name: 'trickiest', collection: 'rounds', title: 'Trickiest items', build: trickiestPipeline },
  { name: 'leaderboard', collection: 'players', title: 'Lifetime leaderboard', build: leaderboardPipeline },
  { name: 'evalError', collection: 'eval_runs', title: 'Pricing error by variant', build: evalErrorPipeline },
];

/** Render rows as a small text table. */
export function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '  (no data)';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => '  ' + vals.map((v, i) => v.padEnd(widths[i])).join('  ');
  return [line(cols), line(widths.map((w) => '-'.repeat(w))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join('\n');
}

async function main(): Promise<void> {
  if (process.argv.includes('--dry')) {
    const out = Object.fromEntries(PIPELINES.map((p) => [p.name, { collection: p.collection, pipeline: p.build() }]));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const env = loadEnv(process.env, { readDotenv: true });
  if (!env.mongodbUri) {
    console.error('MONGODB_URI is missing. Set it in .env, or use --dry to just print the pipelines.');
    process.exit(1);
  }
  const client = new MongoClient(env.mongodbUri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const db = client.db(env.mongodbDb);
    for (const p of PIPELINES) {
      const rows = (await db.collection(p.collection).aggregate(p.build()).toArray()) as Record<string, unknown>[];
      console.log(`\n${p.title}`);
      console.log(formatTable(rows));
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && /atlas-stats\.[tj]s$/.test(process.argv[1])) {
  main().catch((e) => { console.error(`atlas:stats failed: ${(e as Error).message}`); process.exit(1); });
}
