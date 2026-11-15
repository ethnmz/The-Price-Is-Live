// Host line keys (docs/SPEC.md section 12.2). FROZEN contract.
// The text for every key lives in src/ai/host/lines.ts (ai lane). The engine only uses keys.
import type { Emotion } from './types';

export const HOST_LINE_KEYS = [
  'connect.hello',
  'lobby.waiting', 'lobby.joined', 'lobby.nameask', 'lobby.giveup',
  'rules.full', 'rules.short',
  'round.start', 'round.nextprompt',
  'item.pricing', 'item.camera', 'item.ask', 'item.propcloset', 'item.holdup', 'item.quip',
  'guess.prompt', 'guess.quiet', 'guess.nudge', 'guess.huh', 'guess.confirm', 'guess.locked',
  'guess.silent', 'guess.textack', 'guess.textmode',
  'reveal.drumroll', 'reveal.price', 'reveal.estimate',
  'score.winner', 'score.tie', 'score.allover', 'score.nowinner', 'score.stump', 'score.stumplow',
  'finale.drumroll', 'finale.champion', 'finale.cochamps', 'finale.shortcap', 'finale.thanks',
  'rematch.offer',
  'end.bye',
] as const;

export type HostLineKey = (typeof HOST_LINE_KEYS)[number];

/**
 * Variables each key may use. Lines must fill every {var} they contain.
 * name = guesser/player, owner, next = next owner, amount/price = SPOKEN words ("twenty-five dollars"),
 * winner, winner2, n = a count (players, round number, or stump points).
 */
export const HOST_LINE_VARS: Record<HostLineKey, string[]> = {
  'connect.hello': [],
  'lobby.waiting': ['n'], 'lobby.joined': ['name'], 'lobby.nameask': [], 'lobby.giveup': [],
  'rules.full': [], 'rules.short': [],
  'round.start': ['n', 'owner'], 'round.nextprompt': ['next'],
  'item.pricing': [], 'item.camera': ['owner'], 'item.ask': [], 'item.propcloset': [], 'item.holdup': ['owner'],
  'item.quip': ['owner'],
  'guess.prompt': ['name'], 'guess.quiet': [], 'guess.nudge': ['name'], 'guess.huh': ['name'],
  'guess.confirm': ['amount'], 'guess.locked': [], 'guess.silent': ['name'], 'guess.textack': ['name', 'amount'],
  'guess.textmode': [],
  'reveal.drumroll': [], 'reveal.price': ['price'], 'reveal.estimate': [],
  'score.winner': ['winner'], 'score.tie': ['winner', 'winner2'], 'score.allover': ['winner'], 'score.nowinner': [],
  'score.stump': ['owner', 'n'], 'score.stumplow': ['owner', 'n'],
  'finale.drumroll': [], 'finale.champion': ['winner'], 'finale.cochamps': ['winner', 'winner2'],
  'finale.shortcap': [], 'finale.thanks': [],
  'rematch.offer': [],
  'end.bye': [],
};

/** ElevenLabs emotion preset per line (SPEC 21.2). */
export function emotionFor(key: HostLineKey): Emotion {
  if (key.startsWith('reveal.') || key === 'finale.drumroll') return 'drumroll';
  if (key.startsWith('guess.') || key.startsWith('item.') || key === 'finale.thanks' || key === 'end.bye') return 'warm';
  return 'hype';
}
