// The pure game engine: reduce(state, event, deps) -> { state, effects }. Rules: docs/API.md section 4, SPEC 7.4.
// No I/O, no clock (time = event.at), no randomness (everything comes through deps). It never throws:
// an event that does not fit the phase gives back the SAME state plus a LOG effect.
//
// SEAMS for later tasks (search for "SEAM"):
//  - camera / voice item fallbacks: resolveItem() branch "no item text"
//
// TO VERIFY ON THE REAL LINE:
//  - SPEAK_DONE really arrives for every SPEAK (the runner also sends it when speaking fails).
//  - The real parseGuess returns 'yes' / 'no' / 'pass' for the short phrases the fake one understands.
import type { Effect, EngineDeps, GameEvent, Reduce } from '../contracts/events';
import { formatCents } from '../contracts/money';
import type {
  GameConfig, GameState, Guess, Player, PlayerId, PriceResult, RoundResult,
} from '../contracts/types';
import { parseJoinText, addPlayer } from './registry';
import { MSG, buildResultsCard } from './messages';
import { champions, normalizeGuessCents, rankPlayers, scoreRound } from './scoring';
import {
  type Ctx, type EngineState, type Next, type TimerKind,
  cancelTimers, dropQueuedSpeech, effectiveConfig, freshState, hasTimer, ignore, listen, log,
  nameOf, playerById, say, sendText, sendToAll, setPhase, speechFinished, startTimer, withPrivate,
} from './reducer/core';

export function initialState(config: GameConfig): GameState {
  return freshState(config);
}

export const reduce: Reduce = (state, event, deps) => {
  try {
    const s = structuredClone(withPrivate(state));
    const c: Ctx = { s, fx: [], deps, at: event.at, cfg: effectiveConfig(s, deps.config), ignored: null };
    s.now = event.at;
    const speechInWindow = (event.type === 'SPEECH_PARTIAL' || event.type === 'SPEECH_FINAL') && inGuessWindow(s) && s.listenOpen;
    if (speechInWindow) {
      s.windowSpeechSeen = true;
      s.silentWindows = 0;
    }
    dispatch(c, event);
    // Speech proves the audio path is alive even when it contains no guess.
    // Events outside an open guess window still preserve ignored-state identity.
    if (c.ignored) return { state: speechInWindow ? s : state, effects: [ignoredLog(state, event, c.ignored)] };
    return { state: s, effects: c.fx };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { state, effects: [{ type: 'LOG', level: 'error', msg: `reducer error on ${event.type}: ${msg}` }] };
  }
};

function ignoredLog(state: GameState, event: GameEvent, why: string): Effect {
  return { type: 'LOG', level: 'info', msg: `ignored ${event.type}: ${why}`, data: { phase: state.phase } };
}

function dispatch(c: Ctx, ev: GameEvent): void {
  const s = c.s;
  if (s.phase === 'boot' && ev.type !== 'BOOT') return ignore(c, 'not booted');
  switch (ev.type) {
    case 'BOOT':
      if (s.phase !== 'boot') return ignore(c, 'already booted');
      s.bootAt = ev.at;
      return setPhase(c, 'wait_call');
    case 'TEXT_RECEIVED': return onText(c, ev.phone, ev.text);
    case 'CALL_READY':
      if (s.phase !== 'dialing' && s.phase !== 'wait_call') return ignore(c, 'no call expected');
      return enterConnected(c, ev.callId);
    case 'CALL_FAILED':
      if (s.phase !== 'dialing') return ignore(c, 'not dialing');
      return dialFailed(c, ev.reason);
    case 'CALL_ENDED': return onCallEnded(c, ev.reason);
    case 'SPEECH_PARTIAL':
      if (!s.listenOpen || (s.phase !== 'guess_listen' && s.phase !== 'guess_confirm')) return ignore(c, 'not listening');
      s.liveTranscript = ev.text;
      return;
    case 'SPEECH_FINAL': return onSpeechFinal(c, ev.text, ev.confidence);
    case 'SPEAK_DONE': {
      if (ev.speakId !== s.speakingId) return ignore(c, 'not the line playing');
      const next = speechFinished(c);
      if (next) run(c, next);
      return;
    }
    case 'TIMER': {
      const kind = s.timers[ev.timerId];
      if (!kind) return ignore(c, 'late or unknown timer');
      delete s.timers[ev.timerId];
      if (s.timer && s.timer.timerId === ev.timerId) s.timer = null;
      return onTimer(c, kind);
    }
    case 'PRICE_READY': return onPrice(c, ev.itemId, ev.result);
    case 'PRICE_FAILED': return onPrice(c, ev.itemId, null);
    case 'FRAME_ID_READY': return ignore(c, 'camera ID is a later task'); // SEAM(camera)
    case 'TICK': return hardClock(c);
  }
}

/** What happens when the host has finished the lines queued right now. Each one checks the phase first. */
function run(c: Ctx, next: Next): void {
  const s = c.s;
  switch (next) {
    case 'lobby': if (s.phase === 'connected') enterLobby(c); return;
    case 'start_round': if (s.phase === 'rules') startRound(c); return;
    case 'item_resolve':
      if (s.phase !== 'round_start') return;
      setPhase(c, 'item_resolve');
      return resolveItem(c);
    case 'guess_listen': if (s.phase === 'guess_prompt') enterListen(c, guessMs(c)); return;
    case 'relisten': if (s.phase === 'guess_listen') listen(c, true); return;
    case 'confirm_listen':
      if (s.phase !== 'guess_confirm' || !s.pendingGuess) return;
      listen(c, true);
      startTimer(c, 'confirm', c.cfg.confirmSilenceMs);
      return;
    case 'after_guess':
      if (s.phase === 'guess_confirm' || s.phase === 'guess_silent') nextGuesser(c);
      return;
    case 'score_done': if (s.phase === 'round_score') startTimer(c, 'scorehold', c.cfg.scoreHoldMs); return;
    case 'to_rematch':
      if (s.phase !== 'finale') return;
      return s.rematchRequested ? enterEnding(c) : enterRematchOffer(c);
    case 'rematch_listen':
      if (s.phase !== 'rematch_offer') return;
      listen(c, true);
      startTimer(c, 'rematch', c.cfg.rematchListenMs);
      return;
    case 'end_call': if (s.phase === 'ending') c.fx.push({ type: 'END_CALL' }); return;
  }
}

function onTimer(c: Ctx, kind: TimerKind): void {
  const s = c.s;
  switch (kind) {
    case 'dial': return s.phase === 'dialing' ? dialFailed(c, 'dial timeout') : undefined;
    case 'lobbysettle':
      if (s.phase === 'lobby' && s.players.length >= c.cfg.minPlayers) enterRules(c);
      return;
    case 'lobbymax':
      if (s.phase !== 'lobby' || s.players.length >= c.cfg.minPlayers) return;
      cancelTimers(c);
      say(c, 'lobby.giveup');
      return enterEnding(c);
    case 'price': case 'itemwait':
      if (s.phase === 'item_resolve' && s.currentItem && !s.currentItem.price) propCloset(c);
      return;
    case 'show': if (s.phase === 'show_item') startGuess(c, 0); return;
    case 'guess': if (s.phase === 'guess_listen') recordSilent(c); return;
    case 'confirm': if (s.phase === 'guess_confirm' && s.pendingGuess) lockVoice(c); return;
    case 'drumroll': if (s.phase === 'reveal') revealPrice(c); return;
    case 'revealhold': if (s.phase === 'reveal') scoreCurrentRound(c); return;
    case 'scorehold': if (s.phase === 'round_score') return afterScore(c); return;
    case 'rematch': if (s.phase === 'rematch_offer') enterEnding(c); return;
  }
}

// ======================================================================
// Texts
// ======================================================================

const START_RE = /^\s*(start|let['’]?s go|lets go)\s*[.!]*\s*$/i;
const START_SPOKEN_RE = /\b(start|let['’]?s go|lets go)\b/i;
const REMATCH_RE = /^\s*(rematch|play again)\s*[.!]*\s*$/i;
const REMATCH_SPOKEN_RE = /\b(rematch|again|yes|yeah|yep|yup|sure)\b/i;
const DEMO_RE = /^\s*demo\s*[.!]*\s*$/i;
const FORMING = ['wait_call', 'dialing', 'connected', 'lobby'];

function onText(c: Ctx, phone: string, rawText: string): void {
  const s = c.s;
  const text = rawText.trim();
  const player = s.players.find((p) => p.phone === phone) ?? null;

  if (player && inGuessWindow(s) && currentGuesserId(s) === player.id) return textGuess(c, player, text);
  if (REMATCH_RE.test(text) && player && ['finale', 'rematch_offer', 'ending'].includes(s.phase)) {
    return rematchSignal(c, player);
  }
  if (!text) return ignore(c, 'empty text');

  const join = parseJoinText(text);
  if (join.isJoin && (!player || FORMING.includes(s.phase))) return onJoin(c, phone, join.name);
  if (!player) return sendText(c, phone, 'unknown', MSG.unknown());
  if (join.isJoin) return ignore(c, 'already registered');
  if (START_RE.test(text)) return onStartText(c, player);
  if (DEMO_RE.test(text)) return onDemoText(c, player);
  if (REMATCH_RE.test(text)) return onRematchText(c, player);
  return onItemText(c, player, text);
}

function onJoin(c: Ctx, phone: string, name: string | null): void {
  const s = c.s;
  if (!FORMING.includes(s.phase)) return sendText(c, phone, 'full', MSG.gameFull()); // game already running
  const res = addPlayer(s.players, phone, name, c.at, c.cfg.maxPlayers);
  if (res.outcome === 'full' || !res.player) return sendText(c, phone, 'full', MSG.gameFull());
  s.players = res.players;
  const names = s.players.map((p) => p.name);
  sendText(c, phone, 'join', MSG.joinReply(res.player.name, res.player.seat + 1, names));
  if (res.outcome !== 'joined') return;
  if (s.phase === 'lobby' || s.phase === 'connected') say(c, 'lobby.joined', { name: res.player.name });
  if (s.phase !== 'lobby') return;
  if (s.players.length >= c.cfg.maxPlayers) return enterRules(c);
  if (s.players.length >= c.cfg.minPlayers) {
    cancelTimers(c, 'lobbysettle'); // a new join restarts the settle wait
    startTimer(c, 'lobbysettle', c.cfg.lobbySettleMs);
  }
}

function onStartText(c: Ctx, player: Player): void {
  const s = c.s;
  if (s.phase === 'wait_call') {
    if (!player.isMain) return ignore(c, 'only the main player can start');
    if (s.players.length < c.cfg.minPlayers) return sendText(c, player.phone, 'needtwo', MSG.needTwo());
    return beginDial(c);
  }
  if (s.phase === 'lobby') {
    if (s.players.length < c.cfg.minPlayers) return sendText(c, player.phone, 'needtwo', MSG.needTwo());
    return enterRules(c);
  }
  return ignore(c, 'start does not fit this phase');
}

function onDemoText(c: Ctx, player: Player): void {
  if (c.s.phase !== 'wait_call' || !player.isMain) return ignore(c, 'demo only from the main player before a game');
  c.s.demo = true;
  log(c, 'info', 'demo mode on for the next game');
}

function onRematchText(c: Ctx, player: Player): void {
  const s = c.s;
  if (s.phase === 'wait_call' && s.finishedRoster) {
    if (s.players.length < c.cfg.minPlayers) return sendText(c, player.phone, 'needtwo', MSG.needTwo());
    return beginDial(c);
  }
  return onItemText(c, player, 'rematch'); // no finished roster: it is just a word
}

function itemIdFor(player: Player): string {
  return `r${player.seat + 1}`;
}

/** Has this player's round already passed (or reached the point where an item no longer helps)? */
function itemTooLate(s: EngineState, player: Player): boolean {
  if (['finale', 'rematch_offer', 'ending'].includes(s.phase)) return true;
  if (s.roundIndex > player.seat) return true;
  return s.roundIndex === player.seat && s.phase !== 'round_start' && s.phase !== 'item_resolve';
}

function onItemText(c: Ctx, player: Player, text: string): void {
  const s = c.s;
  if (itemTooLate(s, player)) return sendText(c, player.phone, 'toolate', MSG.itemTooLate());
  const itemId = itemIdFor(player);
  const rawText = text.slice(0, 120);
  s.pendingItemTexts[player.id] = rawText;
  delete s.earlyPrices[itemId];
  delete s.earlyFailed[itemId];
  c.fx.push({ type: 'PRICE_ITEM', request: { itemId, ownerId: player.id, origin: 'text', rawText } });
  sendText(c, player.phone, 'item', MSG.itemReceived(rawText));
  const cur = s.currentItem;
  if (!cur || cur.itemId !== itemId) return;
  cur.request = { ...cur.request, rawText };
  if (s.phase === 'item_resolve') {
    cancelTimers(c, 'itemwait');
    resolveItem(c);
  }
}

// ======================================================================
// Dialing and connecting
// ======================================================================

function beginDial(c: Ctx): void {
  const s = c.s;
  s.dialAttempts = 1;
  setPhase(c, 'dialing');
  c.fx.push({ type: 'DIAL', phones: s.players.map((p) => p.phone) });
  sendToAll(c, 'calling', MSG.calling());
  startTimer(c, 'dial', c.cfg.dialTimeoutMs);
}

function dialFailed(c: Ctx, reason: string): void {
  const s = c.s;
  cancelTimers(c, 'dial');
  if (s.dialAttempts < 2) {
    s.dialAttempts += 1;
    log(c, 'warn', 'dial failed, trying once more', { reason });
    c.fx.push({ type: 'DIAL', phones: s.players.map((p) => p.phone) });
    startTimer(c, 'dial', c.cfg.dialTimeoutMs);
    return;
  }
  log(c, 'warn', 'dial failed twice, giving up', { reason });
  sendToAll(c, 'cantconnect', MSG.cantConnect());
  setPhase(c, 'wait_call');
}

function enterConnected(c: Ctx, callId: string): void {
  const s = c.s;
  cancelTimers(c, 'dial');
  s.callId = callId;
  s.callStartAt = c.at;
  s.gameId = c.deps.newGameId();
  setPhase(c, 'connected');
  say(c, 'connect.hello');
  s.afterSpeech = 'lobby';
}

function enterLobby(c: Ctx): void {
  const s = c.s;
  setPhase(c, 'lobby');
  listen(c, true); // so "start" can be heard
  if (s.players.length >= c.cfg.maxPlayers) return enterRules(c);
  startTimer(c, 'lobbymax', c.cfg.lobbyMaxWaitMs);
  if (s.players.length >= c.cfg.minPlayers) startTimer(c, 'lobbysettle', c.cfg.lobbySettleMs);
}

// ======================================================================
// Rules and rounds
// ======================================================================

function enterRules(c: Ctx): void {
  const s = c.s;
  cancelTimers(c, 'lobbysettle');
  cancelTimers(c, 'lobbymax');
  listen(c, false);
  s.turnOrder = [...s.players].sort((a, b) => a.seat - b.seat).map((p) => p.id);
  s.roundIndex = -1;
  s.totalRounds = s.demo ? Math.min(c.cfg.demoItems, s.players.length) : s.players.length;
  setPhase(c, 'rules');
  say(c, s.demo || s.lightning ? 'rules.short' : 'rules.full');
  promptOwner(c, s.turnOrder[0], 'first');
  persistGame(c, false);
  s.afterSpeech = 'start_round';
}

/** Text the item prompt once, unless that player already sent their item. */
function promptOwner(c: Ctx, id: PlayerId | undefined, when: 'first' | 'next'): void {
  const s = c.s;
  const p = id ? playerById(s, id) : undefined;
  if (!p || s.itemPromptSentTo.includes(p.id)) return;
  s.itemPromptSentTo.push(p.id);
  if (s.pendingItemTexts[p.id]) return;
  sendText(c, p.phone, 'itemprompt', MSG.itemPrompt(p.name, when));
}

/** The finale must only be entered once; later ticks leave its speech and rematch timer alone. */
function hardClock(c: Ctx): void {
  const s = c.s;
  if (s.callStartAt === null || ['finale', 'rematch_offer', 'ending', 'wait_call', 'dialing'].includes(s.phase)) return;
  if (c.at - s.callStartAt < c.cfg.hardCapMs) return;
  s.capHit = true;
  if (s.totalRounds === 0) s.totalRounds = s.demo ? Math.min(c.cfg.demoItems, s.players.length) : s.players.length;
  s.pendingGuess = null;
  s.liveTranscript = null;
  s.currentItem = null;
  s.guesses = [];
  enterFinale(c);
}

/** Check every round entry, including the first after a slow lobby or rules. */
function beforeNextRound(c: Ctx): boolean {
  const s = c.s;
  if (s.roundIndex + 1 >= s.totalRounds) return false;
  if (s.callStartAt !== null && c.at - s.callStartAt >= c.cfg.lastRoundStartMs) {
    s.capHit = s.history.length < s.totalRounds;
    return false;
  }
  return true;
}

function startRound(c: Ctx): void {
  const s = c.s;
  if (!beforeNextRound(c)) return enterFinale(c);
  const elapsed = s.callStartAt === null ? 0 : c.at - s.callStartAt;
  const avg = s.roundDurationsMs.length
    ? s.roundDurationsMs.reduce((sum, ms) => sum + ms, 0) / s.roundDurationsMs.length
    : c.cfg.avgRoundMsInitial;
  const roundsLeft = s.totalRounds - s.roundIndex - 1;
  if (elapsed + roundsLeft * avg + c.cfg.finaleBufferMs > c.cfg.hardCapMs) s.lightning = true;
  s.roundIndex += 1;
  const ownerId = s.turnOrder[s.roundIndex];
  const owner = playerById(s, ownerId) as Player;
  const at = s.turnOrder.indexOf(ownerId);
  s.guessOrder = [];
  for (let k = 1; k < s.turnOrder.length; k += 1) s.guessOrder.push(s.turnOrder[(at + k) % s.turnOrder.length]);
  s.guessIndex = 0;
  s.guesses = [];
  s.pendingGuess = null;
  s.liveTranscript = null;
  s.timer = null;
  s.revealStage = 'none';
  s.nudged = false;
  s.guessCorrected = false;
  s.roundStartedAt = c.at;
  s.currentItem = {
    itemId: itemIdFor(owner), ownerId,
    request: { itemId: itemIdFor(owner), ownerId, origin: 'text', rawText: s.pendingItemTexts[ownerId] },
    price: null,
  };
  promptOwner(c, s.turnOrder[s.roundIndex + 1], 'next');
  setPhase(c, 'round_start');
  say(c, 'round.start', { n: s.roundIndex + 1, owner: owner.name });
  s.afterSpeech = 'item_resolve';
}

// ======================================================================
// Item and price
// ======================================================================

function onPrice(c: Ctx, itemId: string, result: PriceResult | null): void {
  const s = c.s;
  const idx = Number(itemId.slice(1)) - 1;
  if (!/^r\d+$/.test(itemId) || idx < s.roundIndex || (s.currentItem?.itemId === itemId && s.currentItem.price)) {
    return ignore(c, 'price for a round that is already settled');
  }
  if (result) s.earlyPrices[itemId] = result;
  else s.earlyFailed[itemId] = true;
  if (s.phase === 'item_resolve' && s.currentItem?.itemId === itemId) resolveItem(c);
}

/** Look at what we have for the current item and move on. Never blocks: every wait has a timer. */
function resolveItem(c: Ctx): void {
  const s = c.s;
  const cur = s.currentItem;
  if (!cur || cur.price) return;
  const early = s.earlyPrices[cur.itemId];
  if (early && !early.propClosetSuggested) {
    cancelTimers(c, 'price');
    cancelTimers(c, 'itemwait');
    cur.price = early;
    return showItem(c);
  }
  if (early?.propClosetSuggested || s.earlyFailed[cur.itemId]) return propCloset(c);
  if (s.pendingItemTexts[cur.ownerId]) {
    if (hasTimer(s, 'price')) return;
    cancelTimers(c, 'itemwait');
    say(c, 'item.pricing');
    startTimer(c, 'price', c.cfg.priceTimeoutMs);
    return;
  }
  // SEAM(camera): IDENTIFY_FROM_CAMERA, then ask out loud, go here. For now: wait, then prop closet.
  if (!hasTimer(s, 'itemwait')) startTimer(c, 'itemwait', c.cfg.itemWaitMs);
}

function propCloset(c: Ctx): void {
  const s = c.s;
  const cur = s.currentItem;
  if (!cur) return;
  cancelTimers(c, 'price');
  cancelTimers(c, 'itemwait');
  const prop = c.deps.propItem();
  say(c, 'item.propcloset');
  cur.request = { itemId: cur.itemId, ownerId: cur.ownerId, origin: 'prop_closet', rawText: prop.name };
  cur.price = {
    itemId: cur.itemId, displayName: prop.name, priceCents: prop.priceCents, source: 'list', isEstimate: false,
    confidence: 1, evidence: [{ kind: 'list', label: prop.name, priceCents: prop.priceCents, matchScore: 1 }], latencyMs: 0,
  };
  showItem(c);
}

function showItem(c: Ctx): void {
  const s = c.s;
  setPhase(c, 'show_item');
  say(c, 'item.holdup', { owner: nameOf(s, (s.currentItem as NonNullable<GameState['currentItem']>).ownerId) });
  startTimer(c, 'show', c.cfg.showItemMs);
}

// ======================================================================
// Guessing
// ======================================================================

function guessMs(c: Ctx): number {
  return (c.s.textMode ? c.cfg.textModeGuessSeconds : c.cfg.guessSeconds) * 1000;
}

function currentGuesserId(s: GameState): PlayerId | undefined {
  return s.guessOrder[s.guessIndex];
}

/** A guess window is open for the current guesser and has no result yet. */
function inGuessWindow(s: GameState): boolean {
  const open = s.phase === 'guess_prompt' || s.phase === 'guess_listen' || s.phase === 'guess_confirm';
  return open && s.guesses.length === s.guessIndex && currentGuesserId(s) !== undefined;
}

function startGuess(c: Ctx, index: number): void {
  const s = c.s;
  s.guessIndex = index;
  s.windowSpeechSeen = false;
  s.pendingGuess = null;
  s.liveTranscript = null;
  s.timer = null;
  s.nudged = false;
  s.guessCorrected = false;
  setPhase(c, 'guess_prompt');
  listen(c, false); // the host voice must not be mistaken for a guess
  if (index === 0 && (!s.lightning || s.roundIndex === 0)) say(c, 'guess.quiet');
  say(c, 'guess.prompt', { name: nameOf(s, s.guessOrder[index]) });
  s.afterSpeech = 'guess_listen';
}

function enterListen(c: Ctx, ms: number): void {
  const s = c.s;
  setPhase(c, 'guess_listen');
  s.liveTranscript = null;
  listen(c, true);
  const timerId = startTimer(c, 'guess', ms);
  s.timer = { timerId, startedAt: c.at, ms };
}

function onSpeechFinal(c: Ctx, text: string, confidence: number): void {
  const s = c.s;
  if (!s.listenOpen) return ignore(c, 'not listening');
  switch (s.phase) {
    case 'lobby':
      if (START_SPOKEN_RE.test(text) && s.players.length >= c.cfg.minPlayers) return enterRules(c);
      return ignore(c, 'nothing to act on');
    case 'guess_listen': return listenSpeech(c, text, confidence);
    case 'guess_confirm': return confirmSpeech(c, text, confidence);
    case 'rematch_offer':
      if (REMATCH_SPOKEN_RE.test(text) || c.deps.parseGuess(text, confidence).kind === 'yes') return rematchSignal(c, null);
      return ignore(c, 'not a rematch');
    default: return ignore(c, 'speech does not fit this phase');
  }
}

function listenSpeech(c: Ctx, text: string, confidence: number): void {
  const s = c.s;
  const parsed = c.deps.parseGuess(text, confidence);
  if (parsed.kind === 'amount' && parsed.cents !== undefined) {
    s.pendingGuess = {
      cents: parsed.cents, spokenForm: parsed.spokenForm ?? c.deps.spokenAmount(parsed.cents), rawTranscript: text, corrections: 0,
    };
    if (s.lightning && parsed.confidence >= c.cfg.lightningConfidence && !parsed.ambiguous) return lockVoice(c);
    return enterConfirm(c);
  }
  if (parsed.kind !== 'pass') return ignore(c, 'not a guess');
  if (s.nudged) return recordSilent(c); // second pass counts as silent
  s.nudged = true;
  listen(c, false);
  say(c, 'guess.nudge', { name: nameOf(s, s.guessOrder[s.guessIndex]) });
  s.afterSpeech = 'relisten';
}

function enterConfirm(c: Ctx): void {
  const s = c.s;
  const left = s.timer ? s.timer.ms - (c.at - s.timer.startedAt) : 0;
  s.listenLeftMs = Math.max(0, left);
  cancelTimers(c, 'guess');
  s.timer = null;
  setPhase(c, 'guess_confirm');
  sayConfirm(c);
}

/** Host repeats the amount, then listens for yes / a correction / silence. */
function sayConfirm(c: Ctx): void {
  const s = c.s;
  cancelTimers(c, 'confirm');
  listen(c, false);
  say(c, 'guess.confirm', { amount: (s.pendingGuess as NonNullable<GameState['pendingGuess']>).spokenForm });
  s.afterSpeech = 'confirm_listen';
}

function confirmSpeech(c: Ctx, text: string, confidence: number): void {
  const s = c.s;
  const pending = s.pendingGuess;
  if (!pending) return ignore(c, 'nothing to confirm');
  const parsed = c.deps.parseGuess(text, confidence);
  if (parsed.kind === 'yes') return lockVoice(c);
  if (parsed.kind === 'no') {
    // Back to listening with the time that was left, but never less than minRelistenMs.
    s.pendingGuess = null;
    s.guessCorrected = true;
    cancelTimers(c, 'confirm');
    return enterListen(c, Math.max(c.cfg.minRelistenMs, s.listenLeftMs));
  }
  if (parsed.kind !== 'amount' || parsed.cents === undefined) return ignore(c, 'not an answer');
  if (parsed.cents === pending.cents) return lockVoice(c); // said the same amount again
  s.pendingGuess = {
    cents: parsed.cents, spokenForm: parsed.spokenForm ?? c.deps.spokenAmount(parsed.cents), rawTranscript: text,
    corrections: pending.corrections + 1,
  };
  if (s.pendingGuess.corrections >= 2) return lockVoice(c); // the second correction is final
  sayConfirm(c);
}

/** Store the locked guess and silence the mic. Callers then say their line and set 'after_guess'. */
function storeGuess(c: Ctx, guess: Guess): void {
  const s = c.s;
  s.guesses.push(guess);
  s.pendingGuess = null;
  s.liveTranscript = null;
  cancelTimers(c, 'guess');
  cancelTimers(c, 'confirm');
  s.timer = null;
  listen(c, false);
  if (!s.windowSpeechSeen) s.silentWindows += 1;
  if (!s.textMode && s.silentWindows >= 2) {
    s.textMode = true;
    say(c, 'guess.textmode');
  }
}

function lockVoice(c: Ctx): void {
  const s = c.s;
  setPhase(c, 'guess_confirm');
  const pending = s.pendingGuess as NonNullable<GameState['pendingGuess']>;
  storeGuess(c, {
    playerId: s.guessOrder[s.guessIndex], status: 'locked', cents: normalizeGuessCents(pending.cents),
    rawTranscript: pending.rawTranscript, channel: 'voice', corrected: pending.corrections > 0 || s.guessCorrected,
  });
  say(c, 'guess.locked');
  s.afterSpeech = 'after_guess';
}

/** A text with a number from the current guesser's phone locks at once. Without a number: ask again. */
function textGuess(c: Ctx, player: Player, text: string): void {
  const s = c.s;
  const parsed = c.deps.parseGuess(text);
  if (parsed.kind !== 'amount' || parsed.cents === undefined) {
    return sendText(c, player.phone, 'badguess', MSG.badGuess());
  }
  const cents = normalizeGuessCents(parsed.cents);
  const corrected = s.pendingGuess !== null || s.guessCorrected;
  dropQueuedSpeech(c.s); // a prompt that has not started yet is no longer needed
  storeGuess(c, { playerId: player.id, status: 'locked', cents, rawTranscript: text, channel: 'text', corrected });
  setPhase(c, 'guess_confirm');
  sendText(c, player.phone, 'guess', MSG.guessReceived(formatCents(cents)));
  say(c, 'guess.textack', { name: player.name, amount: c.deps.spokenAmount(cents) });
  s.afterSpeech = 'after_guess';
}

/** Timer ran out, or a second "pass": 0 points. */
function recordSilent(c: Ctx): void {
  const s = c.s;
  storeGuess(c, { playerId: s.guessOrder[s.guessIndex], status: 'silent', cents: null, rawTranscript: null, channel: null, corrected: false });
  setPhase(c, 'guess_silent');
  c.fx.push({ type: 'SFX', name: 'buzzer' });
  say(c, 'guess.silent', { name: nameOf(s, s.guessOrder[s.guessIndex]) });
  s.afterSpeech = 'after_guess';
}

function nextGuesser(c: Ctx): void {
  const s = c.s;
  if (s.guessIndex + 1 < s.guessOrder.length) return startGuess(c, s.guessIndex + 1);
  startReveal(c);
}

// ======================================================================
// Reveal and scoring
// ======================================================================

function startReveal(c: Ctx): void {
  const s = c.s;
  setPhase(c, 'reveal');
  listen(c, false);
  s.revealStage = 'drumroll';
  c.fx.push({ type: 'SFX', name: 'drumroll' });
  say(c, 'reveal.drumroll');
  startTimer(c, 'drumroll', s.lightning || s.demo ? c.cfg.lightningDrumrollMs : c.cfg.drumrollMs);
}

function revealPrice(c: Ctx): void {
  const s = c.s;
  const price = (s.currentItem as NonNullable<GameState['currentItem']>).price as PriceResult;
  c.fx.push({ type: 'SFX', name: 'ding' });
  s.revealStage = 'price';
  say(c, 'reveal.price', { price: c.deps.spokenAmount(price.priceCents) });
  if (price.isEstimate) say(c, 'reveal.estimate');
  startTimer(c, 'revealhold', s.lightning || s.demo ? 2000 : c.cfg.revealHoldMs);
}

function joinNames(names: string[], word: string): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${word} ${names[names.length - 1]}`;
}

function scoreCurrentRound(c: Ctx): void {
  const s = c.s;
  const cur = s.currentItem as NonNullable<GameState['currentItem']>;
  const price = cur.price as PriceResult;
  const prevTotals: Partial<Record<PlayerId, number>> = {};
  for (const p of s.players) prevTotals[p.id] = p.score;
  const result = scoreRound({
    roundIndex: s.roundIndex, ownerId: cur.ownerId,
    item: { displayName: price.displayName, priceCents: price.priceCents, isEstimate: price.isEstimate, source: price.source },
    guesses: s.guesses, playerIds: s.players.map((p) => p.id), prevTotals,
  });
  s.players = s.players.map((p) => ({
    ...p, score: result.totals[p.id], roundWins: p.roundWins + (result.winnerIds.includes(p.id) ? 1 : 0),
  }));
  s.history.push(result);
  const durationMs = c.at - (s.roundStartedAt ?? c.at);
  s.roundDurationsMs.push(durationMs);
  persistRound(c, result, cur.request, price, durationMs);
  setPhase(c, 'round_score');
  saySummary(c, result);
  s.afterSpeech = 'score_done';
}

/** Winner line(s), then the owner's stump points. */
function saySummary(c: Ctx, r: RoundResult): void {
  const s = c.s;
  const names = r.winnerIds.map((id) => nameOf(s, id));
  if (r.winnerReason === 'none') say(c, 'score.nowinner');
  else if (r.winnerReason === 'lowest_over') say(c, 'score.allover', { winner: joinNames(names, 'and') });
  else if (names.length === 1) say(c, 'score.winner', { winner: names[0] });
  else say(c, 'score.tie', { winner: names.slice(0, -1).join(', '), winner2: names[names.length - 1] });
  const stump = { owner: nameOf(s, r.ownerId), n: r.stumpPoints };
  say(c, r.stumpPoints < 20 ? 'score.stumplow' : 'score.stump', stump);
}

function afterScore(c: Ctx): void {
  if (beforeNextRound(c)) return startRound(c);
  enterFinale(c);
}

// ======================================================================
// Finale, rematch, ending
// ======================================================================

function enterFinale(c: Ctx): void {
  const s = c.s;
  cancelTimers(c);
  listen(c, false);
  dropQueuedSpeech(s);
  setPhase(c, 'finale');
  s.finishedRoster = true;
  s.revealStage = 'none';
  const card = buildResultsCard(s.history, s.players, s.capHit ? { cap: { roundsDone: s.history.length, totalRounds: s.totalRounds } } : {});
  sendToAll(c, 'card', card); // right away, so it arrives while they watch
  persistFinale(c, card);
  c.fx.push({ type: 'SFX', name: 'tada' });
  const ranked = rankPlayers(s.players, s.history);
  const champs = champions(ranked);
  say(c, s.capHit ? 'finale.shortcap' : 'finale.drumroll');
  if (champs.length === 1) say(c, 'finale.champion', { winner: champs[0] });
  else say(c, 'finale.cochamps', { winner: champs.slice(0, -1).join(', '), winner2: champs[champs.length - 1] });
  say(c, 'finale.thanks');
  s.afterSpeech = 'to_rematch';
}

function enterRematchOffer(c: Ctx): void {
  setPhase(c, 'rematch_offer');
  say(c, 'rematch.offer');
  c.s.afterSpeech = 'rematch_listen';
}

/** Any "rematch" signal (spoken or texted). `player` is null for speech. */
function rematchSignal(c: Ctx, player: Player | null): void {
  const s = c.s;
  const first = !s.rematchRequested;
  s.rematchRequested = true;
  if (player && first) sendText(c, player.phone, 'rematch', MSG.rematchAck());
  if (s.phase === 'rematch_offer') {
    cancelTimers(c, 'rematch');
    enterEnding(c);
  }
}

function enterEnding(c: Ctx): void {
  const s = c.s;
  cancelTimers(c);
  listen(c, false);
  setPhase(c, 'ending');
  say(c, 'end.bye');
  s.afterSpeech = 'end_call'; // hang up only after the goodbye has been spoken
}

function onCallEnded(c: Ctx, reason: string): void {
  const s = c.s;
  if (s.phase === 'boot' || s.phase === 'wait_call' || s.phase === 'dialing') return ignore(c, 'no call to end');
  const wasEnding = s.phase === 'ending';
  const cardAlreadySent = s.phase === 'finale' || s.phase === 'rematch_offer';
  if (!wasEnding && !cardAlreadySent && s.history.length > 0) {
    sendToAll(c, 'dropped', MSG.callDropped(buildResultsCard(s.history, s.players)));
  }
  log(c, 'info', 'call ended', { reason, phase: s.phase });
  const rematch = wasEnding && s.rematchRequested;
  if (s.history.length > 0) s.finishedRoster = true;
  cancelTimers(c);
  listen(c, false);
  resetForNextGame(c);
  setPhase(c, 'wait_call');
  if (rematch) beginDial(c);
}

/** Keep the roster (names, phones, main player) but wipe scores and everything about the finished game. */
function resetForNextGame(c: Ctx): void {
  const s = c.s;
  s.players = s.players.map((p) => ({ ...p, score: 0, roundWins: 0 }));
  Object.assign(s, {
    gameId: null, callId: null, callStartAt: null, demo: c.deps.config.demo, lightning: false, textMode: false,
    turnOrder: [], roundIndex: -1, totalRounds: 0, currentItem: null, guessOrder: [], guessIndex: 0, guesses: [],
    pendingGuess: null, liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [],
    pendingItemTexts: {}, itemPromptSentTo: [], silentWindows: 0, roundStartedAt: null, roundDurationsMs: [],
    capHit: false, rematchRequested: false, speakQueue: [], speakingId: null, afterSpeech: null, timers: {},
    windowSpeechSeen: false, listenOpen: false, dialAttempts: 0, nudged: false, guessCorrected: false, listenLeftMs: 0, earlyPrices: {}, earlyFailed: {},
  });
  c.cfg = effectiveConfig(s, c.deps.config);
}

// ======================================================================
// Persist documents (shapes: docs/DATA_MODEL.md section 5)
// ======================================================================

function persistGame(c: Ctx, ended: boolean, extra: Record<string, unknown> = {}): void {
  const s = c.s;
  const doc: Record<string, unknown> = {
    gameId: s.gameId, startedAt: s.callStartAt, mode: s.demo ? 'demo' : 'normal', callPlan: 'B',
    playerIds: s.players.map((p) => p.id), totalRounds: s.totalRounds, lightning: s.lightning, textMode: s.textMode,
    ...extra,
  };
  if (ended) doc.endedAt = c.at;
  c.fx.push({ type: 'PERSIST', kind: 'game', doc });
}

function persistRound(c: Ctx, r: RoundResult, req: { origin: string; rawText?: string }, price: PriceResult, durationMs: number): void {
  const s = c.s;
  c.fx.push({
    type: 'PERSIST', kind: 'round',
    doc: {
      gameId: s.gameId, roundIndex: r.roundIndex, ownerId: r.ownerId,
      item: {
        rawText: req.rawText ?? null, origin: req.origin, displayName: price.displayName, priceCents: price.priceCents,
        source: price.source, isEstimate: price.isEstimate, confidence: price.confidence, evidence: price.evidence,
      },
      winnerIds: r.winnerIds, winnerReason: r.winnerReason, stumpPoints: r.stumpPoints, durationMs,
    },
  });
  for (const g of r.guesses) {
    c.fx.push({
      type: 'PERSIST', kind: 'guess',
      doc: {
        gameId: s.gameId, roundIndex: r.roundIndex, playerId: g.playerId, cents: g.cents, status: g.status,
        channel: g.channel, transcript: g.rawTranscript, corrected: g.corrected, points: r.guessPoints[g.playerId] ?? 0,
      },
    });
  }
}

function persistFinale(c: Ctx, cardText: string): void {
  const s = c.s;
  const ranked = rankPlayers(s.players, s.history);
  const scoreboard = ranked.map((r) => ({ id: r.id, name: r.name, total: r.total, place: r.place }));
  const items = s.history.map((r) => ({
    owner: nameOf(s, r.ownerId), name: r.item.displayName, priceCents: r.item.priceCents, isEstimate: r.item.isEstimate,
  }));
  c.fx.push({ type: 'PERSIST', kind: 'result', doc: { gameId: s.gameId, scoreboard, items, cardText, sentAt: c.at } });
  persistGame(c, true, {
    endReason: s.capHit ? 'cap' : 'complete', finalScoreboard: scoreboard,
    championIds: ranked.filter((r) => r.place === 1).map((r) => r.id),
  });
  for (const p of s.players) {
    c.fx.push({ type: 'PERSIST', kind: 'player', doc: { gameId: s.gameId, phone: p.phone, name: p.name, points: p.score } });
  }
}
