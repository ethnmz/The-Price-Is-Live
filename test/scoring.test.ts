// All worked examples from docs/SPEC.md 6.5. These numbers are the law.
import { describe, expect, it } from 'vitest';
import { lockedGuess } from '../fixtures/players';
import type { Guess, PlayerId, RoundItem } from '../src/contracts/types';
import { guessPoints, normalizeGuessCents, rankPlayers, scoreRound, stumpPoints } from '../src/engine/scoring';
import { fixturePlayers } from '../fixtures/players';

const ALL: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];
const item = (priceCents: number): RoundItem => ({ displayName: 'Thing', priceCents, isEstimate: false, source: 'list' });
const silent = (playerId: PlayerId): Guess => ({ playerId, status: 'silent', cents: null, rawTranscript: null, channel: null, corrected: false });

function run(price: number, guesses: Guess[]) {
  return scoreRound({ roundIndex: 0, ownerId: 'p1', item: item(price), guesses, playerIds: ALL, prevTotals: {} });
}

describe('scoring worked examples (SPEC 6.5)', () => {
  it('example 1: normal round', () => {
    const r = run(3499, [lockedGuess('p2', 3000), lockedGuess('p3', 4000), lockedGuess('p4', 2500)]);
    expect(r.guessPoints).toEqual({ p1: 0, p2: 86, p3: 0, p4: 71 });
    expect(r.winnerIds).toEqual(['p2']);
    expect(r.winnerReason).toBe('closest_under');
    expect(r.stumpPoints).toBe(38);
    expect(r.totals).toEqual({ p1: 38, p2: 111, p3: 0, p4: 71 });
  });

  it('example 2: everyone goes over', () => {
    const r = run(1200, [lockedGuess('p2', 1500), lockedGuess('p3', 2000), lockedGuess('p4', 1300)]);
    expect(r.winnerIds).toEqual(['p4']);
    expect(r.winnerReason).toBe('lowest_over');
    expect(r.stumpPoints).toBe(67);
    expect(r.totals).toEqual({ p1: 67, p2: 0, p3: 0, p4: 25 });
  });

  it('example 3: tie', () => {
    const r = run(5000, [lockedGuess('p2', 4500), lockedGuess('p3', 4500), lockedGuess('p4', 3000)]);
    expect(r.winnerIds).toEqual(['p2', 'p3']);
    expect(r.stumpPoints).toBe(40);
    expect(r.totals).toEqual({ p1: 40, p2: 115, p3: 115, p4: 60 });
  });

  it('example 4: zero guess and silence', () => {
    const r = run(800, [lockedGuess('p2', normalizeGuessCents(0)), silent('p3'), lockedGuess('p4', 600)]);
    expect(r.guessPoints.p2).toBe(13); // 12.5 rounds half up
    expect(r.winnerIds).toEqual(['p4']);
    expect(r.stumpPoints).toBe(100);
    expect(r.totals).toEqual({ p1: 100, p2: 13, p3: 0, p4: 100 });
  });

  it('example 5: exact hit', () => {
    const r = run(2000, [lockedGuess('p2', 2000), lockedGuess('p3', 1500), lockedGuess('p4', 2500)]);
    expect(r.totals).toEqual({ p1: 33, p2: 125, p3: 75, p4: 0 });
  });

  it('example 6: demo mode, two rounds add up', () => {
    const r1 = run(3499, [lockedGuess('p2', 3000), lockedGuess('p3', 4000), lockedGuess('p4', 2500)]);
    const r2 = scoreRound({
      roundIndex: 1, ownerId: 'p2', item: item(1200), playerIds: ALL, prevTotals: r1.totals,
      guesses: [lockedGuess('p3', 2000), lockedGuess('p4', 1300), lockedGuess('p1', 1500)],
    });
    expect(r2.totals).toEqual({ p1: 38, p2: 111 + 67, p3: 0, p4: 71 + 25 });
    const ranked = rankPlayers(fixturePlayers(4), [r1, r2]);
    expect(ranked.map((r) => r.id)).toEqual(['p2', 'p4', 'p1', 'p3']);
    expect(ranked.map((r) => r.place)).toEqual([1, 2, 3, 4]);
  });

  it('nobody guessed: no winner, no stump', () => {
    const r = run(1000, [silent('p2'), silent('p3'), silent('p4')]);
    expect(r.winnerIds).toEqual([]);
    expect(r.winnerReason).toBe('none');
    expect(r.stumpPoints).toBe(0);
  });

  it('stays in range', () => {
    for (const price of [100, 999, 3499, 100000]) {
      for (const g of [100, 150, 999, 3499, 5000, 9999900]) {
        const pts = guessPoints(g, price);
        expect(pts).toBeGreaterThanOrEqual(0);
        expect(pts).toBeLessThanOrEqual(100);
        const st = stumpPoints([g], price);
        expect(st).toBeGreaterThanOrEqual(0);
        expect(st).toBeLessThanOrEqual(100);
      }
    }
  });
});
