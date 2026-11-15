// Scoring, exactly as docs/SPEC.md section 6. Pure functions, integer cents, round half up.
import type { Cents, Guess, Player, PlayerId, RoundItem, RoundResult } from '../contracts/types';

export const ROUND_BONUS = 25 as const;

/** A guess under $1 (including "zero") counts as $1. */
export function normalizeGuessCents(cents: Cents): Cents {
  return Math.max(100, Math.round(cents));
}

/** At or under the price: up to 100 points by closeness. Over: 0. */
export function guessPoints(guessCents: Cents, priceCents: Cents): number {
  if (guessCents > priceCents) return 0;
  return Math.round((100 * guessCents) / priceCents);
}

/** Owner points: an average miss of 50% or more earns the full 100. Each miss is capped at 100%. */
export function stumpPoints(validGuessCents: Cents[], priceCents: Cents): number {
  if (validGuessCents.length === 0) return 0;
  const misses = validGuessCents.map((g) => Math.min(1, Math.abs(g - priceCents) / priceCents));
  const meanMiss = misses.reduce((a, b) => a + b, 0) / misses.length;
  return Math.round(100 * Math.min(1, meanMiss / 0.5));
}

export interface ScoreRoundInput {
  roundIndex: number;
  ownerId: PlayerId;
  item: RoundItem;
  guesses: Guess[]; // one per guesser; only status 'locked' with cents counts as valid
  playerIds: PlayerId[]; // everyone in the game
  prevTotals: Partial<Record<PlayerId, number>>;
}

function zeroRecord(): Record<PlayerId, number> {
  return { p1: 0, p2: 0, p3: 0, p4: 0 };
}

export function scoreRound(input: ScoreRoundInput): RoundResult {
  const price = input.item.priceCents;
  const valid = input.guesses.filter((g) => g.status === 'locked' && g.cents !== null && g.playerId !== input.ownerId);
  const points = zeroRecord();
  for (const g of valid) points[g.playerId] = guessPoints(g.cents as Cents, price);

  let winnerIds: PlayerId[] = [];
  let winnerReason: RoundResult['winnerReason'] = 'none';
  const under = valid.filter((g) => (g.cents as Cents) <= price);
  if (under.length > 0) {
    const best = Math.max(...under.map((g) => g.cents as Cents));
    winnerIds = under.filter((g) => g.cents === best).map((g) => g.playerId);
    winnerReason = 'closest_under';
  } else if (valid.length > 0) {
    const lowest = Math.min(...valid.map((g) => g.cents as Cents));
    winnerIds = valid.filter((g) => g.cents === lowest).map((g) => g.playerId);
    winnerReason = 'lowest_over';
  }

  const stump = stumpPoints(valid.map((g) => g.cents as Cents), price);
  const totals = zeroRecord();
  for (const id of input.playerIds) {
    const bonus = winnerIds.includes(id) ? ROUND_BONUS : 0;
    const owner = id === input.ownerId ? stump : 0;
    totals[id] = (input.prevTotals[id] ?? 0) + points[id] + bonus + owner;
  }

  return {
    roundIndex: input.roundIndex,
    ownerId: input.ownerId,
    item: input.item,
    guesses: input.guesses,
    guessPoints: points,
    winnerIds,
    winnerReason,
    bonus: ROUND_BONUS,
    stumpPoints: stump,
    totals,
  };
}

export interface RankedPlayer {
  id: PlayerId;
  name: string;
  total: number;
  roundWins: number;
  seat: number;
  place: number; // 1-based; equal totals share a place
}

/** Sort by total, then round wins, then seat (SPEC 6.4). Equal totals share a place. */
export function rankPlayers(players: Player[], history: RoundResult[]): RankedPlayer[] {
  const last = history[history.length - 1];
  const rows = players.map((p) => ({
    id: p.id,
    name: p.name,
    seat: p.seat,
    total: last ? last.totals[p.id] ?? 0 : p.score,
    roundWins: history.filter((r) => r.winnerIds.includes(p.id)).length,
    place: 0,
  }));
  rows.sort((a, b) => b.total - a.total || b.roundWins - a.roundWins || a.seat - b.seat);
  for (const row of rows) row.place = 1 + rows.filter((o) => o.total > row.total).length;
  return rows;
}

/** Names of everyone tied for first place. */
export function champions(ranked: RankedPlayer[]): string[] {
  return ranked.filter((r) => r.place === 1).map((r) => r.name);
}
