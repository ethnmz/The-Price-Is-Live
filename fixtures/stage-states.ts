// One StageState per phase, for 2, 3 or 4 players. Used by the stage lane (previews, tests)
// before the engine exists, and by anyone who needs a realistic StageState.
import type { Phase, PlayerId, StageState } from '../src/contracts/types';
import { PHASES } from '../src/contracts/types';
import { fixturePlayers } from './players';

type Podium = StageState['podiums'][number];

const LONG_CAPTION = "Here's how it works. Everyone brings one item from home. Guess the price, closest without going over wins! Go over, and you get zero!";

function base(phase: Phase, count: 2 | 3 | 4): StageState {
  const players = fixturePlayers(count);
  return {
    phase,
    title: 'THE PRICE IS LIVE',
    roundLabel: null,
    turnOrder: players.map((p) => ({ id: p.id, name: p.name, done: false, current: false })),
    podiums: players.map((p) => ({
      id: p.id, name: p.name, score: 0, seat: p.seat, role: 'idle', guessText: null, guessState: 'none', delta: null,
    })),
    caption: null,
    timer: null,
    reveal: null,
    mysteryOwner: null,
    liveTranscript: null,
    banner: null,
    joinHint: null,
    fallbackBadge: null,
    hostSpeaking: false,
    lightning: false,
    capRemainingMs: null,
    finale: null,
  };
}

function setPodium(s: StageState, id: PlayerId, patch: Partial<Podium>): void {
  s.podiums = s.podiums.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

/** Round 1 in progress: p1 owns, p2 is the current guesser. */
function inRound(s: StageState, count: number): void {
  s.roundLabel = `ROUND 1 OF ${count}`;
  s.turnOrder = s.turnOrder.map((t, i) => ({ ...t, current: i === 0 }));
  s.mysteryOwner = s.podiums[0].name;
  setPodium(s, 'p1', { role: 'owner' });
}

export function stageFixture(phase: Phase, count: 2 | 3 | 4 = 4): StageState {
  const s = base(phase, count);
  const host = (text: string) => ({ text, speaker: 'host' as const });
  switch (phase) {
    case 'boot':
    case 'wait_call':
    case 'dialing':
      s.podiums = [];
      s.turnOrder = [];
      s.joinHint = `Text "I'm in, I'm [your name]" to (214) 555-0100`;
      break;
    case 'connected':
      s.caption = host("Hello, hello, HELLO! Welcome to THE PRICE IS LIVE! I'm your host, Chip Dollar!");
      s.hostSpeaking = true;
      break;
    case 'lobby':
      s.podiums = s.podiums.slice(0, 1);
      s.turnOrder = s.turnOrder.slice(0, 1);
      s.joinHint = `Text "I'm in, I'm [your name]" to (214) 555-0100`;
      s.caption = host("I only see 1 of you so far. Text me 'I'm in' and your name!");
      break;
    case 'rules':
      s.caption = host(LONG_CAPTION);
      s.hostSpeaking = true;
      s.banner = 'CLOSEST WITHOUT GOING OVER WINS';
      break;
    case 'round_start':
      inRound(s, count);
      s.caption = host("Round 1! Ethan, you're up with a mystery item!");
      s.hostSpeaking = true;
      break;
    case 'item_resolve':
      inRound(s, count);
      s.caption = { text: 'Checking the price tag...', speaker: 'system' };
      break;
    case 'show_item':
      inRound(s, count);
      s.caption = host('Ethan, hold that item up high so everyone can see it!');
      s.hostSpeaking = true;
      break;
    case 'guess_prompt':
      inRound(s, count);
      setPodium(s, 'p2', { role: 'guesser' });
      s.timer = { secondsLeft: 10, total: 10, running: false };
      s.caption = host("Diego, what's your guess?");
      s.hostSpeaking = true;
      break;
    case 'guess_listen':
      inRound(s, count);
      setPodium(s, 'p2', { role: 'guesser' });
      s.timer = { secondsLeft: 3, total: 10, running: true };
      s.liveTranscript = 'twenty five...';
      s.caption = { text: 'Listening...', speaker: 'system' };
      break;
    case 'guess_confirm':
      inRound(s, count);
      setPodium(s, 'p2', { role: 'guesser', guessText: '$25.00 ?', guessState: 'pending' });
      s.timer = { secondsLeft: 6, total: 10, running: false };
      s.caption = host('Twenty-five dollars. Right?');
      s.hostSpeaking = true;
      break;
    case 'guess_silent':
      inRound(s, count);
      setPodium(s, 'p2', { role: 'guesser', guessText: '—', guessState: 'silent' });
      s.caption = host("Time's up! Zero for Diego. Ouch!");
      s.fallbackBadge = 'TEXT MODE';
      break;
    case 'reveal':
      inRound(s, count);
      s.mysteryOwner = null;
      setPodium(s, 'p2', { guessText: '$30.00 ✓', guessState: 'locked' });
      if (count >= 3) setPodium(s, 'p3', { guessText: '$1,200.00 ✓', guessState: 'locked' });
      if (count >= 4) setPodium(s, 'p4', { guessText: '—', guessState: 'silent' });
      s.reveal = {
        stage: 'price', priceText: '$1,000.00', itemName: 'Owala FreeSip water bottle 24 oz', isEstimate: true,
        sourceLabel: 'Google Search: target.com',
      };
      s.caption = host("One thousand dollars! That's my best estimate!");
      break;
    case 'round_score':
      inRound(s, count);
      s.mysteryOwner = null;
      setPodium(s, 'p1', { score: 38, delta: { guess: 0, bonus: 0, stump: 38 } });
      setPodium(s, 'p2', { role: 'winner', score: 111, guessText: '$30.00 ✓', guessState: 'locked', delta: { guess: 86, bonus: 25, stump: 0 } });
      if (count >= 3) setPodium(s, 'p3', { guessText: '$40.00', guessState: 'over', delta: { guess: 0, bonus: 0, stump: 0 } });
      if (count >= 4) setPodium(s, 'p4', { score: 71, guessText: '$25.00 ✓', guessState: 'locked', delta: { guess: 71, bonus: 0, stump: 0 } });
      s.caption = host('Diego wins the round! Plus twenty-five bonus points!');
      break;
    case 'finale': {
      const totals = [38, 178, 0, 96].slice(0, count);
      s.podiums = s.podiums.map((p, i) => ({ ...p, score: totals[i], role: totals[i] === Math.max(...totals) ? 'winner' : 'idle' }));
      const sorted = s.podiums.slice().sort((a, b) => b.score - a.score);
      s.finale = {
        ranks: sorted.map((p, i) => ({ id: p.id, name: p.name, total: p.score, place: i + 1 })),
        champion: [sorted[0].name],
        items: ['Ethan: Owala FreeSip water bottle $34.99', 'Diego: Hot Wheels 5-car pack $12.00 (estimate)'],
      };
      s.roundLabel = null;
      s.caption = host('Your champion is... Diego! What a show!');
      s.capRemainingMs = 32_000;
      break;
    }
    case 'rematch_offer':
      s.banner = 'TEXT REMATCH TO PLAY AGAIN';
      s.caption = host('Want a rematch? Say rematch, or text me REMATCH!');
      break;
    case 'ending':
      s.banner = 'THANKS FOR PLAYING';
      s.caption = host('Thanks for playing THE PRICE IS LIVE! See you next time!');
      break;
  }
  return s;
}

/** Every phase x every player count. */
export function allStageFixtures(): { name: string; state: StageState }[] {
  const out: { name: string; state: StageState }[] = [];
  for (const count of [2, 3, 4] as const) {
    for (const phase of PHASES) out.push({ name: `${phase}-${count}p`, state: stageFixture(phase, count) });
  }
  return out;
}

/** Worst cases for layout checks: 12-character names, big scores, the longest caption. */
export function stressStageFixture(): StageState {
  const s = stageFixture('round_score', 4);
  const names = ['Maximilliano', 'Bartholomew1', 'Wwwwwwwwwwww', 'Christophers'];
  s.podiums = s.podiums.map((p, i) => ({ ...p, name: names[i], score: 1225 }));
  s.turnOrder = s.turnOrder.map((t, i) => ({ ...t, name: names[i] }));
  s.caption = { text: LONG_CAPTION, speaker: 'host' };
  return s;
}
