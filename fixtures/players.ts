// Fixture players. Phones are fake (555-01xx range). Never put a real phone number in this repo.
import type { Guess, Player, PlayerId, RoundResult } from '../src/contracts/types';

const NAMES = ['Ethan', 'Diego', 'Akshi', 'Aditri'];
const IDS: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

export const FIXTURE_PHONES = ['+12145550101', '+12145550102', '+12145550103', '+12145550104'];

export function fixturePlayers(count: 2 | 3 | 4 = 4): Player[] {
  return IDS.slice(0, count).map((id, seat) => ({
    id, seat, name: NAMES[seat], phone: FIXTURE_PHONES[seat], isMain: seat === 0, score: 0, roundWins: 0,
    joinedAt: 1_000 + seat * 1_000,
  }));
}

export function lockedGuess(playerId: PlayerId, cents: number): Guess {
  return { playerId, status: 'locked', cents, rawTranscript: String(cents / 100), channel: 'voice', corrected: false };
}

/** SPEC 6.5 example 1: price $34.99, owner Ethan (p1). Diego 111, Akshi 0, Aditri 71, Ethan 38 stump. */
export const ROUND_EXAMPLE_1: RoundResult = {
  roundIndex: 0,
  ownerId: 'p1',
  item: { displayName: 'Owala FreeSip water bottle', priceCents: 3499, isEstimate: false, source: 'list' },
  guesses: [lockedGuess('p2', 3000), lockedGuess('p3', 4000), lockedGuess('p4', 2500)],
  guessPoints: { p1: 0, p2: 86, p3: 0, p4: 71 },
  winnerIds: ['p2'],
  winnerReason: 'closest_under',
  bonus: 25,
  stumpPoints: 38,
  totals: { p1: 38, p2: 111, p3: 0, p4: 71 },
};

/** A second round (owner Diego, price $12.00, everyone over; SPEC 6.5 example 2 shape) on top of example 1. */
export const ROUND_EXAMPLE_2: RoundResult = {
  roundIndex: 1,
  ownerId: 'p2',
  item: { displayName: 'Hot Wheels 5-car pack', priceCents: 1200, isEstimate: true, source: 'estimate' },
  guesses: [lockedGuess('p3', 2000), lockedGuess('p4', 1300), lockedGuess('p1', 1500)],
  guessPoints: { p1: 0, p2: 0, p3: 0, p4: 0 },
  winnerIds: ['p4'],
  winnerReason: 'lowest_over',
  bonus: 25,
  stumpPoints: 67,
  totals: { p1: 38, p2: 178, p3: 0, p4: 96 },
};
