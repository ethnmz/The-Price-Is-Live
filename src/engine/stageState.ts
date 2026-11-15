// Pure stage projection. Item details stay behind the price reveal boundary.
import type { GameConfig, GameState, StageState, PriceResult } from '../contracts/types';
import { formatCents } from '../contracts/money';
import { champions, rankPlayers } from './scoring';

function sourceLabel(price: PriceResult | null): string | null {
  if (!price) return null;
  if (price.source === 'list') return 'Price list';
  if (price.source === 'estimate') return 'Estimate';
  const url = price.evidence.find((e) => e.kind === 'web' && e.url)?.url;
  try {
    return url ? `Google Search: ${new URL(url).host}` : 'Google Search';
  } catch {
    return 'Google Search';
  }
}

export function buildStageState(state: GameState, now: number, config: GameConfig): StageState {
  const { phase } = state;
  const inRound = ['round_start', 'item_resolve', 'show_item', 'guess_prompt', 'guess_listen',
    'guess_confirm', 'guess_silent', 'reveal', 'round_score'].includes(phase);
  const guessing = phase.startsWith('guess_');
  const final = ['finale', 'rematch_offer', 'ending'].includes(phase);
  const ownerId = state.currentItem?.ownerId ?? state.turnOrder[state.roundIndex];
  const owner = state.players.find((p) => p.id === ownerId);
  const guesserId = state.guessOrder[state.guessIndex];
  const last = state.history.at(-1);
  const result = phase === 'round_score' ? last : undefined;
  const price = state.currentItem?.price ?? null;
  const ranked = final ? rankPlayers(state.players, state.history) : [];
  const timerVisible = ['guess_prompt', 'guess_listen', 'guess_confirm'].includes(phase);
  const remaining = state.callId !== null && state.callStartAt !== null
    ? config.hardCapMs - (now - state.callStartAt) : null;

  return {
    phase,
    title: 'THE PRICE IS LIVE',
    roundLabel: inRound ? `ROUND ${state.roundIndex + 1} OF ${state.totalRounds}` : null,
    turnOrder: state.turnOrder.flatMap((id) => {
      const player = state.players.find((p) => p.id === id);
      return player ? [{ id, name: player.name, done: state.history.some((r) => r.ownerId === id),
        current: inRound && id === ownerId }] : [];
    }),
    podiums: state.players.map((p) => {
      const guess = inRound ? state.guesses.find((g) => g.playerId === p.id) : undefined;
      let guessText: string | null = null;
      let guessState: StageState['podiums'][number]['guessState'] = 'none';
      if (guess) {
        if (guess.status === 'locked' && guess.cents !== null) {
          const over = result !== undefined && guess.cents > result.item.priceCents;
          guessState = over ? 'over' : 'locked';
          guessText = `${formatCents(guess.cents)}${over ? '' : ' ✓'}`;
        } else {
          guessState = 'silent';
          guessText = '—';
        }
      } else if (guessing && p.id === guesserId && state.pendingGuess) {
        guessState = 'pending';
        guessText = `${formatCents(state.pendingGuess.cents)} ?`;
      }
      const winner = result?.winnerIds.includes(p.id)
        || (phase === 'finale' && ranked.some((r) => r.id === p.id && r.place === 1));
      return {
        id: p.id, name: p.name, score: p.score, seat: p.seat,
        role: winner ? 'winner' : inRound && p.id === ownerId ? 'owner'
          : guessing && p.id === guesserId ? 'guesser' : 'idle',
        guessText, guessState,
        delta: result ? { guess: result.guessPoints[p.id], bonus: result.winnerIds.includes(p.id) ? 25 : 0,
          stump: p.id === result.ownerId ? result.stumpPoints : 0 } : null,
      };
    }),
    caption: state.caption ? { ...state.caption } : phase === 'guess_listen'
      ? { text: 'Listening...', speaker: 'system' } : phase === 'item_resolve'
        ? { text: 'Checking the price tag...', speaker: 'system' } : null,
    timer: timerVisible && state.timer ? {
      secondsLeft: phase === 'guess_prompt' ? state.timer.ms / 1000
        : Math.max(0, (state.timer.startedAt + state.timer.ms - now) / 1000),
      total: state.timer.ms / 1000, running: phase === 'guess_listen',
    } : null,
    reveal: phase === 'reveal' || phase === 'round_score' ? {
      stage: state.revealStage,
      priceText: state.revealStage === 'price' && price ? formatCents(price.priceCents) : '',
      itemName: state.revealStage === 'price' && price ? price.displayName : '',
      isEstimate: price?.isEstimate ?? false,
      sourceLabel: sourceLabel(price),
    } : null,
    mysteryOwner: inRound && phase !== 'reveal' && phase !== 'round_score' ? owner?.name ?? null : null,
    liveTranscript: phase === 'guess_listen' ? state.liveTranscript : null,
    banner: phase === 'rules' ? 'CLOSEST WITHOUT GOING OVER WINS'
      : phase === 'rematch_offer' ? 'TEXT REMATCH TO PLAY AGAIN'
        : phase === 'ending' ? 'THANKS FOR PLAYING' : null,
    joinHint: ['wait_call', 'dialing', 'connected', 'lobby'].includes(phase) && state.players.length < 2
      ? `Text${config.lineDisplayNumber ? ` ${config.lineDisplayNumber}` : ''}: I'm in, I'm {name}` : null,
    fallbackBadge: state.textMode ? 'TEXT MODE' : null,
    hostSpeaking: false,
    lightning: state.lightning,
    capRemainingMs: remaining !== null && remaining <= 45_000 ? remaining : null,
    finale: final ? {
      ranks: ranked.map(({ id, name, total, place }) => ({ id, name, total, place })),
      champion: champions(ranked),
      items: state.history.map((r) => {
        const name = state.players.find((p) => p.id === r.ownerId)?.name ?? '';
        return `${name}: ${r.item.displayName} ${formatCents(r.item.priceCents)}${r.item.isEstimate ? ' (estimate)' : ''}`;
      }),
    } : null,
  };
}
