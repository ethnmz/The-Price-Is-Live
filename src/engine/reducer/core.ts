// Shared plumbing for the reducer: private state, the effect list, the host speech queue,
// timers and text sends. No game rules live here.
//
// Why a speech queue: several host lines often belong together (winner, then stump points).
// If we emitted them all at once, each SPEAK would overwrite state.caption and the stage would
// show the LAST line while the FIRST one is still being spoken. So we emit one SPEAK at a time
// and send the next one when SPEAK_DONE comes back. The caption always matches the line playing.
import type { Effect, EngineDeps } from '../../contracts/events';
import type { HostLineKey } from '../../contracts/hostLines';
import { emotionFor } from '../../contracts/hostLines';
import { last4 } from '../../contracts/money';
import type { GameConfig, GameState, Player, PlayerId, PriceResult } from '../../contracts/types';

export type TimerKind =
  | 'dial' | 'lobbysettle' | 'lobbymax' | 'price' | 'itemwait' | 'show' | 'guess' | 'confirm'
  | 'drumroll' | 'revealhold' | 'scorehold' | 'rematch';

/** What to do when the host has finished the lines that are queued right now. */
export type Next =
  | 'lobby' | 'start_round' | 'item_resolve' | 'guess_listen' | 'relisten' | 'confirm_listen' | 'after_guess'
  | 'score_done' | 'to_rematch' | 'rematch_listen' | 'end_call';

/** Fields only the engine reads. Other lanes only see GameState. */
export interface EnginePrivate {
  bootAt: number;
  speakQueue: { key: HostLineKey; vars?: Record<string, string | number> }[];
  speakingId: string | null;
  afterSpeech: Next | null;
  speakSeq: number;
  timerSeq: number;
  textSeq: number;
  timers: Record<string, TimerKind>; // live timers only: a late TIMER for any other id is ignored
  listenOpen: boolean; // speech is only accepted while the engine has the mic open
  dialAttempts: number;
  nudged: boolean; // "pass" nudge already used for this guesser
  guessCorrected: boolean; // guesser said "no" or changed the amount
  listenLeftMs: number; // guess-window time left when the confirm-back began
  earlyPrices: Record<string, PriceResult>;
  earlyFailed: Record<string, true>;
  finishedRoster: boolean; // a game was played with this roster, so "rematch" works
}

export type EngineState = GameState & EnginePrivate;

export function freshPrivate(): EnginePrivate {
  return {
    bootAt: 0, speakQueue: [], speakingId: null, afterSpeech: null, speakSeq: 0, timerSeq: 0, textSeq: 0,
    timers: {}, listenOpen: false, dialAttempts: 0, nudged: false, guessCorrected: false, listenLeftMs: 0,
    earlyPrices: {}, earlyFailed: {}, finishedRoster: false,
  };
}

export function freshState(config: GameConfig): EngineState {
  return {
    phase: 'boot', gameId: null, callId: null, callStartAt: null, now: 0, phaseEnteredAt: 0,
    demo: config.demo, lightning: false, textMode: false, players: [], turnOrder: [], roundIndex: -1,
    totalRounds: 0, currentItem: null, guessOrder: [], guessIndex: 0, guesses: [], pendingGuess: null,
    liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [],
    pendingItemTexts: {}, itemPromptSentTo: [], silentWindows: 0, roundStartedAt: null, roundDurationsMs: [],
    capHit: false, rematchRequested: false,
    ...freshPrivate(),
  };
}

/** Accept a plain GameState too (fill any private field that is missing). */
export function withPrivate(state: GameState): EngineState {
  return { ...freshPrivate(), ...state };
}

export interface Ctx {
  s: EngineState;
  fx: Effect[];
  deps: EngineDeps;
  at: number;
  cfg: GameConfig;
  /** Set when the event does not fit: reduce() then returns the old state plus a LOG. */
  ignored: string | null;
}

/** Config with the demo overrides applied when a `demo` text turned demo on after boot. */
export function effectiveConfig(s: GameState, base: GameConfig): GameConfig {
  if (!s.demo || base.demo) return base;
  return { ...base, demo: true, lobbySettleMs: Math.min(base.lobbySettleMs, 1000), showItemMs: Math.min(base.showItemMs, 3000) };
}

export function ignore(c: Ctx, why: string): void {
  c.ignored = why;
}

export function log(c: Ctx, level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void {
  c.fx.push({ type: 'LOG', level, msg, data });
}

export function setPhase(c: Ctx, phase: GameState['phase']): void {
  if (c.s.phase === phase) return;
  c.s.phase = phase;
  c.s.phaseEnteredAt = c.at;
}

export function playerById(s: GameState, id: PlayerId): Player | undefined {
  return s.players.find((p) => p.id === id);
}

export function nameOf(s: GameState, id: PlayerId): string {
  return playerById(s, id)?.name ?? id;
}

// ---------- microphone ----------

export function listen(c: Ctx, on: boolean): void {
  c.s.listenOpen = on;
  c.fx.push({ type: 'LISTEN', on });
}

// ---------- host speech queue ----------

/** Emit the next queued line if nothing is being spoken. The caption follows the line that starts. */
function pump(c: Ctx): void {
  const s = c.s;
  if (s.speakingId || s.speakQueue.length === 0) return;
  const line = s.speakQueue.shift() as EnginePrivate['speakQueue'][number];
  s.speakSeq += 1;
  const speakId = `s${s.speakSeq}`;
  const text = c.deps.line(line.key, line.vars);
  s.speakingId = speakId;
  s.caption = { text, speaker: 'host' };
  c.fx.push({ type: 'SPEAK', speakId, key: line.key, text, emotion: emotionFor(line.key) });
}

/** Queue a host line. Lines play one at a time, in order. */
export function say(c: Ctx, key: HostLineKey, vars?: Record<string, string | number>): void {
  c.s.speakQueue.push({ key, vars });
  pump(c);
}

/** Called on SPEAK_DONE for the line that was playing. Returns the continuation to run, if the queue is now empty. */
export function speechFinished(c: Ctx): Next | null {
  const s = c.s;
  s.speakingId = null;
  pump(c);
  if (s.speakingId || s.speakQueue.length > 0 || !s.afterSpeech) return null;
  const next = s.afterSpeech;
  s.afterSpeech = null;
  return next;
}

/** True when the host is silent and nothing is waiting to be said. */
export function hostIdle(s: EngineState): boolean {
  return !s.speakingId && s.speakQueue.length === 0;
}

/** Forget lines that have not started yet and any pending continuation (a line already playing finishes). */
export function dropQueuedSpeech(s: EngineState): void {
  s.speakQueue = [];
  s.afterSpeech = null;
}

// ---------- timers ----------

/** Start a timer with a unique id so a late TIMER for an old use is ignored. */
export function startTimer(c: Ctx, kind: TimerKind, ms: number): string {
  const s = c.s;
  s.timerSeq += 1;
  const tag = s.currentItem ? s.currentItem.itemId : 'pre';
  const timerId = `${kind}:${tag}:${s.timerSeq}`;
  s.timers[timerId] = kind;
  c.fx.push({ type: 'START_TIMER', timerId, ms });
  return timerId;
}

export function cancelTimers(c: Ctx, kind?: TimerKind): void {
  const s = c.s;
  for (const [id, k] of Object.entries(s.timers)) {
    if (kind && k !== kind) continue;
    delete s.timers[id];
    c.fx.push({ type: 'CANCEL_TIMER', timerId: id });
    if (s.timer && s.timer.timerId === id) s.timer = null;
  }
}

export function hasTimer(s: EngineState, kind: TimerKind): boolean {
  return Object.values(s.timers).includes(kind);
}

// ---------- texts ----------

/** Send an iMessage. idemKey = `${gameId}:${type}:${last4}:${n}`; n never repeats, so keys never clash. */
export function sendText(c: Ctx, phone: string, type: string, text: string): void {
  const s = c.s;
  s.textSeq += 1;
  const game = s.gameId ?? `pre-${s.bootAt}`;
  c.fx.push({ type: 'SEND_TEXT', phone, text, idemKey: `${game}:${type}:${last4(phone)}:${s.textSeq}` });
}

export function sendToAll(c: Ctx, type: string, text: string): void {
  for (const p of c.s.players) sendText(c, p.phone, type, text);
}
