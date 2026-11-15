// iMessage templates, exactly as docs/SPEC.md section 11.
// Working first version written by the planner. Task T02 hardens it; keep the exported signatures.
import { formatCents } from '../contracts/money';
import type { Player, RoundResult } from '../contracts/types';
import { champions, rankPlayers } from './scoring';

export const REMATCH_LINE = '🔁 Want a rematch? Reply REMATCH and I\'ll FaceTime everyone back.';

export const MSG = {
  unknown: () => 'Hey! I\'m the host of THE PRICE IS LIVE 🎤 Text me "I\'m in, I\'m {yourName}" to join a game.',
  joinReply: (name: string, n: number, names: string[]) =>
    `🎉 You're in, ${name}! You're player ${n}. Players so far: ${names.join(', ')}. When it's your turn, I'll text you to send your item (like "Owala bottle"). The first player can text "start" to begin.`,
  gameFull: () => 'Sorry, this game is full (4 players). Catch the next one! 🎤',
  needTwo: () => 'We need at least 2 players. Have a friend text me "I\'m in" and their name, then text "start".',
  calling: () => '📞 Calling you now! Pick up the FaceTime to play THE PRICE IS LIVE.',
  cantConnect: () => 'Hmm, I couldn\'t connect the call. Try FaceTiming this number, or text "start" again.',
  itemPrompt: (name: string, when: 'first' | 'next') =>
    `${name}, you're up ${when}! Text me the item you're holding up, like "Owala bottle". Brand and size help! 🛍️`,
  itemReceived: (item: string) => `Got it: ${item}. 👍 Hold it up when the host calls you!`,
  itemReceivedUnsure: (item: string) =>
    `Got it: ${item}. I'm not 100% sure on this one, so I'll call the price an estimate. Hold it up when the host calls you!`,
  itemTooLate: () => 'Thanks! That came in a little late, so the host used the camera. Next time send it before your turn.',
  guessReceived: (amount: string) => `Got your guess: ${amount}. 🔒`,
  badGuess: () => 'I need a number, like "25" or "$12.99".',
  rematch: () => REMATCH_LINE,
  rematchAck: () => 'You got it! Calling everyone back in a few seconds. 📞',
  callDropped: (cardBody: string) => `😬 The call dropped. Here are the scores so far:\n${cardBody}`,
};

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

export interface ResultsCardOpts {
  /** Set when the hard clock cut the game short: k rounds finished out of n. */
  cap?: { roundsDone: number; totalRounds: number };
}

/** The results card text (SPEC 11). Blocks are separated by one blank line. */
export function buildResultsCard(history: RoundResult[], players: Player[], opts: ResultsCardOpts = {}): string {
  const ranked = rankPlayers(players, history);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  const board = ['🏆 THE PRICE IS LIVE: FINAL SCOREBOARD'];
  for (const r of ranked) board.push(`${MEDALS[r.place - 1]} ${r.name}: ${r.total} pts`);

  const items = ['🛍️ THE ITEMS AND REAL PRICES'];
  for (const round of history) {
    const tag = round.item.isEstimate ? ' (estimate)' : '';
    items.push(`• ${nameOf(round.ownerId)}'s ${round.item.displayName}: ${formatCents(round.item.priceCents)}${tag}`);
  }

  const champs = champions(ranked);
  const last: string[] = [];
  if (champs.length === 1) last.push(`👑 ${champs[0]} wins!`);
  else last.push(`👑 ${champs.slice(0, -1).join(', ')} and ${champs[champs.length - 1]} tie for the win!`);
  if (opts.cap) last.push(`⏱️ Time ran out after ${opts.cap.roundsDone} of ${opts.cap.totalRounds} rounds.`);
  last.push(REMATCH_LINE);

  return [board.join('\n'), items.join('\n'), last.join('\n')].join('\n\n');
}
