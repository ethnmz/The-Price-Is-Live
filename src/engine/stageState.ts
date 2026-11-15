// buildStageState: GameState -> StageState. Pure function; the runner calls it after every dispatch and tick.
// It reads only the documented GameState fields. Secrecy rule: the item name, raw text and price never
// appear before reveal.stage === 'price'.
//
// TO VERIFY ON THE REAL LINE: nothing (pure logic, no network).
import type { GameConfig, GameState, Guess, Phase, PlayerId, RoundResult, StageState } from '../contracts/types';
import { formatCents } from '../contracts/money';
import { champions, rankPlayers } from './scoring';

type Podium = StageState['podiums'][number];

const ROUND_PHASES: Phase[] = [
  'round_start', 'item_resolve', 'show_item', 'guess_prompt', 'guess_listen', 'guess_confirm', 'guess_silent',
  'reveal', 'round_score',
];
const GUESS_PHASES: Phase[] = ['guess_prompt', 'guess_listen', 'guess_confirm', 'guess_silent'];
const MYSTERY_PHASES: Phase[] = ['round_start', 'item_resolve', 'show_item', ...GUESS_PHASES];
const GUESS_TEXT_PHASES: Phase[] = [...GUESS_PHASES, 'reveal', 'round_score'];
const TIMER_PHASES: Phase[] = ['guess_prompt', 'guess_listen', 'guess_confirm'];
const FINALE_PHASES: Phase[] = ['finale', 'rematch_offer', 'ending'];
const JOIN_PHASES: Phase[] = ['wait_call', 'dialing', 'connected', 'lobby'];
const CAP_WARNING_MS = 45_000;

function lastResult(state: GameState): RoundResult | null {
  return state.history.length > 0 ? state.history[state.history.length - 1] : null;
}

function currentGuesserId(state: GameState): PlayerId | null {
  if (!GUESS_PHASES.includes(state.phase)) return null;
  return state.guessOrder[state.guessIndex] ?? null;
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function sourceLabel(state: GameState): string | null {
  const price = state.currentItem?.price;
  const source = price?.source ?? lastResult(state)?.item.source;
  if (!source) return null;
  if (source === 'list') return 'Price list';
  if (source === 'estimate') return 'Estimate';
  const host = hostOf(price?.evidence.find((e) => e.kind === 'web' && e.url)?.url);
  return host ? `Google Search: ${host}` : 'Google Search';
}

function buildReveal(state: GameState): StageState['reveal'] {
  if (state.phase !== 'reveal' && state.phase !== 'round_score') return null;
  const stage = state.revealStage;
  if (stage !== 'price') {
    return { stage, priceText: '', itemName: '', isEstimate: false, sourceLabel: null };
  }
  const price = state.currentItem?.price;
  const done = lastResult(state)?.item;
  const cents = price?.priceCents ?? done?.priceCents;
  return {
    stage,
    priceText: cents === undefined ? '' : formatCents(cents),
    itemName: price?.displayName ?? done?.displayName ?? '',
    isEstimate: price?.isEstimate ?? done?.isEstimate ?? false,
    sourceLabel: sourceLabel(state),
  };
}

function buildTimer(state: GameState, now: number): StageState['timer'] {
  if (!state.timer || !TIMER_PHASES.includes(state.phase)) return null;
  const total = state.timer.ms / 1000;
  const left = (state.timer.startedAt + state.timer.ms - now) / 1000;
  const full = state.phase === 'guess_prompt';
  return {
    secondsLeft: full ? total : Math.min(total, Math.max(0, left)),
    total,
    running: state.phase === 'guess_listen',
  };
}

/** Text and state shown under one guesser's podium. */
function guessView(state: GameState, id: PlayerId, price: number | null): Pick<Podium, 'guessText' | 'guessState'> {
  const none = { guessText: null, guessState: 'none' as const };
  if (!GUESS_TEXT_PHASES.includes(state.phase)) return none;
  if (state.pendingGuess && currentGuesserId(state) === id) {
    return { guessText: `${formatCents(state.pendingGuess.cents)} ?`, guessState: 'pending' };
  }
  const guess: Guess | undefined = state.guesses.find((g) => g.playerId === id);
  if (!guess) return none;
  if (guess.status !== 'locked' || guess.cents === null) return { guessText: '—', guessState: 'silent' };
  if (state.phase === 'round_score' && price !== null && guess.cents > price) {
    return { guessText: formatCents(guess.cents), guessState: 'over' };
  }
  return { guessText: `${formatCents(guess.cents)} ✓`, guessState: 'locked' };
}

function buildPodiums(state: GameState): Podium[] {
  const phase = state.phase;
  const result = phase === 'round_score' ? lastResult(state) : null;
  const price = result ? result.item.priceCents : null;
  const ownerId = state.currentItem?.ownerId ?? null;
  const guesserId = currentGuesserId(state);
  const finalWinners = FINALE_PHASES.includes(phase)
    ? champions(rankPlayers(state.players, state.history))
    : [];

  return state.players.map((p) => {
    let role: Podium['role'] = 'idle';
    if (result?.winnerIds.includes(p.id)) role = 'winner';
    else if (finalWinners.includes(p.name)) role = 'winner';
    else if (ROUND_PHASES.includes(phase) && ownerId === p.id) role = 'owner';
    else if (guesserId === p.id) role = 'guesser';

    // The owner keeps the owner role in round_score even when not a winner.
    const delta = result
      ? {
          guess: result.guessPoints[p.id] ?? 0,
          bonus: result.winnerIds.includes(p.id) ? result.bonus : 0,
          stump: result.ownerId === p.id ? result.stumpPoints : 0,
        }
      : null;
    return { id: p.id, name: p.name, score: p.score, seat: p.seat, role, ...guessView(state, p.id, price), delta };
  });
}

function buildTurnOrder(state: GameState): StageState['turnOrder'] {
  const ids = state.turnOrder.length > 0 ? state.turnOrder : state.players.map((p) => p.id);
  const inRound = ROUND_PHASES.includes(state.phase);
  const allDone = FINALE_PHASES.includes(state.phase);
  return ids.flatMap((id, i) => {
    const player = state.players.find((p) => p.id === id);
    if (!player) return [];
    const done = allDone || (inRound && (i < state.roundIndex || (state.phase === 'round_score' && i === state.roundIndex)));
    return [{ id, name: player.name, done, current: inRound && i === state.roundIndex }];
  });
}

function buildCaption(state: GameState): StageState['caption'] {
  if (state.caption) return state.caption;
  if (state.phase === 'guess_listen') return { text: 'Listening...', speaker: 'system' };
  if (state.phase === 'item_resolve') return { text: 'Checking the price tag...', speaker: 'system' };
  return null;
}

function buildJoinHint(state: GameState, config: GameConfig): string | null {
  if (!JOIN_PHASES.includes(state.phase) || state.players.length >= 2) return null;
  // Shown on screen to people, so no template placeholders: "[your name]" reads as an instruction.
  const msg = `"I'm in, I'm [your name]"`;
  return config.lineDisplayNumber ? `Text ${msg} to ${config.lineDisplayNumber}` : `Text ${msg}`;
}

function buildBanner(phase: Phase): string | null {
  if (phase === 'rematch_offer') return 'TEXT REMATCH TO PLAY AGAIN';
  if (phase === 'ending') return 'THANKS FOR PLAYING';
  if (phase === 'rules') return 'CLOSEST WITHOUT GOING OVER WINS';
  return null;
}

function buildFinale(state: GameState): StageState['finale'] {
  if (!FINALE_PHASES.includes(state.phase)) return null;
  const ranked = rankPlayers(state.players, state.history);
  const items = state.history.map((r) => {
    const owner = state.players.find((p) => p.id === r.ownerId)?.name ?? r.ownerId;
    const est = r.item.isEstimate ? ' (estimate)' : '';
    return `${owner}: ${r.item.displayName} ${formatCents(r.item.priceCents)}${est}`;
  });
  return {
    ranks: ranked.map((r) => ({ id: r.id, name: r.name, total: r.total, place: r.place })),
    champion: champions(ranked),
    items,
  };
}

function buildCapRemaining(state: GameState, now: number, config: GameConfig): number | null {
  if (state.callStartAt === null) return null;
  const remaining = config.hardCapMs - (now - state.callStartAt);
  return remaining <= CAP_WARNING_MS ? Math.max(0, remaining) : null;
}

export function buildStageState(state: GameState, now: number, config: GameConfig): StageState {
  const phase = state.phase;
  const owner = state.currentItem ? state.players.find((p) => p.id === state.currentItem?.ownerId) : undefined;
  return {
    phase,
    title: 'THE PRICE IS LIVE',
    roundLabel: ROUND_PHASES.includes(phase) ? `ROUND ${state.roundIndex + 1} OF ${state.totalRounds}` : null,
    turnOrder: buildTurnOrder(state),
    podiums: buildPodiums(state),
    caption: buildCaption(state),
    timer: buildTimer(state, now),
    reveal: buildReveal(state),
    mysteryOwner: MYSTERY_PHASES.includes(phase) && owner ? owner.name : null,
    liveTranscript: phase === 'guess_listen' ? state.liveTranscript : null,
    banner: buildBanner(phase),
    joinHint: buildJoinHint(state, config),
    fallbackBadge: state.textMode ? 'TEXT MODE' : null,
    hostSpeaking: false,
    lightning: state.lightning,
    capRemainingMs: buildCapRemaining(state, now, config),
    finale: buildFinale(state),
  };
}
