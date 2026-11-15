// Pure game flow. Hard-clock, lightning and camera/voice fallbacks can enter at
// round_start and item_resolve without changing the speech/timer protocol below.
import type { EngineDeps, Effect, GameEvent, Reduce } from '../contracts/events';
import type { GameConfig, GameState, Guess, Phase, PlayerId, PriceResult } from '../contracts/types';
import { emotionFor, type HostLineKey } from '../contracts/hostLines';
import { addPlayer, parseJoinText } from './registry';
import { scoreRound, rankPlayers, champions } from './scoring';
import { MSG, buildResultsCard } from './messages';

type Action = string;
interface PrivateState extends GameState {
  seq: number;
  speech: { id: string; action: Action }[];
  timers: Record<string, Action>;
  prices: Record<string, PriceResult>;
  failed: string[];
  attempts: number;
  nudged: boolean;
  remaining: number;
  seen: string[];
  finishedRoster: boolean;
}
export function initialState(config: GameConfig): GameState {
  return {
    phase: 'boot', gameId: null, callId: null, callStartAt: null, now: 0, phaseEnteredAt: 0,
    demo: config.demo, lightning: false, textMode: false, players: [], turnOrder: [], roundIndex: -1,
    totalRounds: 0, currentItem: null, guessOrder: [], guessIndex: 0, guesses: [], pendingGuess: null,
    liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [], pendingItemTexts: {},
    itemPromptSentTo: [], silentWindows: 0, roundStartedAt: null, roundDurationsMs: [], capHit: false,
    rematchRequested: false, seq: 0, speech: [], timers: {}, prices: {}, failed: [], attempts: 0,
    nudged: false, remaining: 0, seen: [], finishedRoster: false,
  } as PrivateState;
}

function step(input: GameState, event: GameEvent, deps: EngineDeps) {
  const s = structuredClone(input) as PrivateState;
  s.seq ??= 0; s.speech ??= []; s.timers ??= {}; s.prices ??= {}; s.failed ??= []; s.seen ??= [];
  s.now = event.at;
  const effects: Effect[] = [];
  const c = deps.config;
  const id = (prefix: string) => `${prefix}:${++s.seq}`;
  const log = () => ({ state: input, effects: [{ type: 'LOG', level: 'info', msg: `Ignored ${event.type} in ${input.phase}` } as Effect] });
  const player = (pid: PlayerId) => s.players.find(p => p.id === pid)!;
  const name = (pid: PlayerId) => player(pid)?.name ?? pid;
  const current = () => s.guessOrder[s.guessIndex];
  function text(phone: string, type: string, body: string) {
    effects.push({ type: 'SEND_TEXT', phone, text: body, idemKey: `${s.gameId ?? 'lobby'}:${type}:${phone.slice(-4)}:${++s.seq}` });
  }
  const allText = (type: string, body: string) => s.players.forEach(p => text(p.phone, type, body));
  function speak(key: HostLineKey, vars: Record<string, string | number> = {}, action = '') {
    const speakId = id('speak');
    const line = deps.line(key, vars);
    s.speech.push({ id: speakId, action });
    s.caption = { text: line, speaker: 'host' };
    effects.push({ type: 'SPEAK', speakId, key, text: line, emotion: emotionFor(key) });
  }
  function timer(action: string, ms: number, visible = false) {
    const timerId = id(action); s.timers[timerId] = action;
    effects.push({ type: 'START_TIMER', timerId, ms });
    if (visible) s.timer = { timerId, startedAt: event.at, ms };
  }
  function cancel() {
    for (const timerId of Object.keys(s.timers)) effects.push({ type: 'CANCEL_TIMER', timerId });
    s.timers = {}; s.timer = null;
  }
  function phase(p: Phase) { cancel(); s.speech = []; s.phase = p; s.phaseEnteredAt = event.at; }
  function prompt(pid: PlayerId, when: 'first' | 'next') {
    if (!s.itemPromptSentTo.includes(pid) && !s.pendingItemTexts[pid]) {
      text(player(pid).phone, 'itemPrompt', MSG.itemPrompt(name(pid), when)); s.itemPromptSentTo.push(pid);
    }
  }
  function gameDoc(ended = false): Record<string, unknown> {
    const board = rankPlayers(s.players, s.history);
    return { gameId: s.gameId, startedAt: s.callStartAt, ...(ended ? { endedAt: event.at } : {}),
      mode: s.demo ? 'demo' : 'normal', callPlan: 'B', playerIds: s.turnOrder,
      totalRounds: s.totalRounds, lightning: s.lightning, textMode: s.textMode,
      endReason: ended ? 'completed' : null, finalScoreboard: board,
      championIds: board.filter(p => p.place === 1).map(p => p.id) };
  }
  function persist(kind: 'game' | 'round' | 'guess' | 'result' | 'player', doc: Record<string, unknown>) { effects.push({ type: 'PERSIST', kind, doc }); }
  function dial(retry = false) {
    phase('dialing'); s.attempts = retry ? s.attempts + 1 : 1;
    effects.push({ type: 'DIAL', phones: s.players.map(p => p.phone) });
    if (!retry) allText('calling', MSG.calling());
    timer('dial', c.dialTimeoutMs);
  }
  function lobby() {
    phase('lobby'); effects.push({ type: 'LISTEN', on: true });
    if (s.players.length >= c.maxPlayers) return rules();
    timer('lobbyMax', c.lobbyMaxWaitMs);
    if (s.players.length >= c.minPlayers) timer('settle', s.demo ? 1000 : c.lobbySettleMs);
  }
  function rules() {
    if (s.players.length < c.minPlayers) return;
    phase('rules'); effects.push({ type: 'LISTEN', on: false });
    s.turnOrder = [...s.players].sort((a,b) => a.seat-b.seat).map(p => p.id);
    s.totalRounds = s.demo ? Math.min(c.demoItems, s.players.length) : s.players.length;
    prompt(s.turnOrder[0], 'first'); persist('game', gameDoc());
    speak(s.demo ? 'rules.short' : 'rules.full', {}, 'round');
  }
  function round() {
    phase('round_start'); s.roundIndex++; s.roundStartedAt = event.at;
    const ownerId = s.turnOrder[s.roundIndex], itemId = `r${s.roundIndex+1}`;
    s.currentItem = { itemId, ownerId, request: { itemId, ownerId, origin: 'text', rawText: s.pendingItemTexts[ownerId] }, price: s.prices[itemId] ?? null };
    s.guessOrder = [...s.turnOrder.slice(s.roundIndex+1), ...s.turnOrder.slice(0,s.roundIndex)];
    s.guessIndex = 0; s.guesses = []; s.pendingGuess = null; s.revealStage = 'none'; s.liveTranscript = null;
    const next = s.turnOrder[s.roundIndex+1];
    if (next && s.roundIndex+1 < s.totalRounds) prompt(next, 'next');
    speak('round.start', { n: s.roundIndex+1, owner: name(ownerId) }, 'resolve');
  }
  function resolve() {
    phase('item_resolve');
    if (s.currentItem!.price) return show();
    if (s.failed.includes(s.currentItem!.itemId)) return prop();
    if (s.pendingItemTexts[s.currentItem!.ownerId]) {
      speak('item.pricing'); timer('prop', Math.min(c.priceTimeoutMs, c.itemResolveMaxMs));
    } else timer('prop', Math.min(c.itemWaitMs, c.itemResolveMaxMs));
  }
  function prop() {
    const p = deps.propItem();
    s.currentItem!.request = { itemId: s.currentItem!.itemId, ownerId: s.currentItem!.ownerId, origin: 'prop_closet', rawText: p.name };
    s.currentItem!.price = { itemId: s.currentItem!.itemId, displayName: p.name, priceCents: p.priceCents, source: 'list', isEstimate: false, confidence: 1, evidence: [], latencyMs: 0 };
    cancel(); s.speech = []; speak('item.propcloset', {}, 'show');
  }
  function show() { phase('show_item'); speak('item.holdup', { owner: name(s.currentItem!.ownerId) }, 'hold'); }
  function guessPrompt() {
    phase('guess_prompt'); s.pendingGuess = null; s.liveTranscript = null; s.nudged = false;
    effects.push({ type: 'LISTEN', on: false });
    if (s.guessIndex === 0) speak('guess.quiet');
    speak('guess.prompt', { name: name(current()) }, 'listen');
    timer('listen', c.guessPromptMaxMs);
  }
  function listen(ms = (s.textMode ? c.textModeGuessSeconds : c.guessSeconds)*1000) {
    phase('guess_listen'); effects.push({ type: 'LISTEN', on: true }); timer('silent', ms, true);
  }
  function confirm(cents: number, raw: string, spoken?: string) {
    const old = s.pendingGuess;
    if (old?.cents === cents) return;
    if (s.timer) s.remaining = Math.max(c.minRelistenMs, s.timer.ms - (event.at-s.timer.startedAt));
    phase('guess_confirm'); s.pendingGuess = { cents, rawTranscript: raw, spokenForm: spoken ?? deps.spokenAmount(cents), corrections: old ? old.corrections+1 : 0 };
    if (s.pendingGuess.corrections >= 2) return lock('voice');
    effects.push({ type: 'LISTEN', on: false }); speak('guess.confirm', { amount: s.pendingGuess.spokenForm }, 'confirmListen');
  }
  function lock(channel: 'voice' | 'text') {
    const g = s.pendingGuess!; cancel(); s.speech = [];
    s.guesses.push({ playerId: current(), status: 'locked', cents: g.cents, rawTranscript: g.rawTranscript, channel, corrected: g.corrections > 0 });
    s.pendingGuess = null; effects.push({ type: 'LISTEN', on: false });
    if (channel === 'text') speak('guess.textack', { name: name(current()), amount: deps.spokenAmount(g.cents) }, 'nextGuess');
    else speak('guess.locked', {}, 'nextGuess');
  }
  function silent() {
    phase('guess_silent'); s.pendingGuess = null;
    s.guesses.push({ playerId: current(), status: 'silent', cents: null, rawTranscript: null, channel: null, corrected: false });
    effects.push({ type: 'LISTEN', on: false }, { type: 'SFX', name: 'buzzer' });
    speak('guess.silent', { name: name(current()) }, 'nextGuess');
  }
  function nextGuess() {
    s.guessIndex++;
    if (s.guessIndex < s.guessOrder.length) return guessPrompt();
    phase('reveal'); s.revealStage = 'drumroll';
    effects.push({ type: 'LISTEN', on: false }, { type: 'SFX', name: 'drumroll' });
    speak('reveal.drumroll', {}, 'drumroll');
  }
  function revealPrice() {
    s.revealStage = 'price'; effects.push({ type: 'SFX', name: 'ding' });
    speak('reveal.price', { price: deps.spokenAmount(s.currentItem!.price!.priceCents) }, s.currentItem!.price!.isEstimate ? '' : 'revealHold');
    if (s.currentItem!.price!.isEstimate) speak('reveal.estimate', {}, 'revealHold');
  }
  function score() {
    phase('round_score'); const item = s.currentItem!;
    const result = scoreRound({ roundIndex: s.roundIndex, ownerId: item.ownerId, item: item.price!, guesses: s.guesses,
      playerIds: s.turnOrder, prevTotals: Object.fromEntries(s.players.map(p => [p.id,p.score])) });
    s.history.push(result); s.players = s.players.map(p => ({ ...p, score: result.totals[p.id], roundWins: p.roundWins + Number(result.winnerIds.includes(p.id)) }));
    const durationMs = event.at - s.roundStartedAt!; s.roundDurationsMs.push(durationMs);
    persist('round', { gameId: s.gameId, roundIndex: s.roundIndex, ownerId: item.ownerId, item: { ...item.price, rawText: item.request.rawText, origin: item.request.origin }, winnerIds: result.winnerIds, winnerReason: result.winnerReason, stumpPoints: result.stumpPoints, durationMs });
    for (const g of s.guesses) persist('guess', { gameId: s.gameId, roundIndex: s.roundIndex, ...g, transcript: g.rawTranscript, points: result.guessPoints[g.playerId] });
    const winners = result.winnerIds.map(name);
    speak(!winners.length ? 'score.nowinner' : winners.length > 1 ? 'score.tie' : result.winnerReason === 'lowest_over' ? 'score.allover' : 'score.winner', { winner: winners[0] ?? '', winner2: winners.slice(1).join(', ') });
    speak(result.stumpPoints < 20 ? 'score.stumplow' : 'score.stump', { owner: name(item.ownerId), n: result.stumpPoints }, 'scoreHold');
  }
  function finale() {
    phase('finale'); s.finishedRoster = true; const card = buildResultsCard(s.history, s.players), board = rankPlayers(s.players,s.history);
    allText('results', card);
    persist('result', { gameId: s.gameId, scoreboard: board, items: s.history.map(r => ({ owner: name(r.ownerId), name: r.item.displayName, priceCents: r.item.priceCents, isEstimate: r.item.isEstimate })), cardText: card, sentAt: event.at });
    persist('game', gameDoc(true)); for (const p of s.players) persist('player', { gameId: s.gameId, phone: p.phone, name: p.name, points: p.score });
    effects.push({ type: 'SFX', name: 'tada' }); const champs = champions(board);
    speak('finale.drumroll'); speak(champs.length > 1 ? 'finale.cochamps' : 'finale.champion', { winner: champs[0], winner2: champs.slice(1).join(', ') }); speak('finale.thanks', {}, 'rematch');
  }
  function ending() { phase('ending'); effects.push({ type: 'LISTEN', on: false }); speak('end.bye', {}, 'end'); }
  function rematch(phone?: string) { s.rematchRequested = true; if (phone) text(phone, 'rematchAck', MSG.rematchAck()); else allText('rematchAck', MSG.rematchAck()); ending(); }
  function action(a: string) {
    switch (a) {
      case 'dial': if (s.attempts < 2) dial(true); else { allText('cantConnect', MSG.cantConnect()); phase('wait_call'); } break;
      case 'lobby': lobby(); break;
      case 'settle': rules(); break;
      case 'lobbyMax': if (s.players.length < c.minPlayers) { cancel(); speak('lobby.giveup', {}, 'ending'); } else rules(); break;
      case 'round': round(); break;
      case 'resolve': resolve(); break;
      case 'prop': prop(); break;
      case 'show': show(); break;
      case 'hold': timer('guessPrompt', s.demo ? 3000 : c.showItemMs); break;
      case 'guessPrompt': guessPrompt(); break;
      case 'listen': listen(); break;
      case 'confirmListen': effects.push({ type: 'LISTEN', on: true }); timer('lock', c.confirmSilenceMs); break;
      case 'lock': lock('voice'); break;
      case 'silent': silent(); break;
      case 'nextGuess': nextGuess(); break;
      case 'drumroll': timer('price', c.drumrollMs); break;
      case 'price': revealPrice(); break;
      case 'revealHold': timer('score', c.revealHoldMs); break;
      case 'score': score(); break;
      case 'scoreHold': timer('nextRound', c.scoreHoldMs); break;
      case 'nextRound': if (s.roundIndex+1 < s.totalRounds) round(); else finale(); break;
      case 'rematch': phase('rematch_offer'); speak('rematch.offer', {}, 'rematchListen'); break;
      case 'rematchListen': effects.push({ type: 'LISTEN', on: true }); timer('ending', c.rematchListenMs); break;
      case 'ending': ending(); break;
      case 'end': effects.push({ type: 'END_CALL' }); break;
    }
  }
  if (event.type === 'CALL_ENDED' && !['boot','wait_call'].includes(s.phase)) {
    const again = s.phase === 'ending' && s.rematchRequested;
    const finishedRoster = s.finishedRoster;
    if (s.phase !== 'ending' && s.history.length) allText('dropped', MSG.callDropped(buildResultsCard(s.history,s.players)));
    cancel(); effects.push({ type: 'LISTEN', on: false });
    const fresh = initialState({ ...c, demo: s.demo }) as PrivateState;
    Object.assign(s, fresh, { players: s.players.map(p => ({ ...p, score: 0, roundWins: 0 })), phase: 'wait_call', now: event.at, phaseEnteredAt: event.at, seq: s.seq, seen: s.seen, finishedRoster });
    if (again) dial();
  } else if (event.type === 'BOOT' && s.phase === 'boot') phase('wait_call');
  else if (event.type === 'CALL_READY' && ['wait_call','dialing'].includes(s.phase)) {
    phase('connected'); s.callId = event.callId; s.callStartAt = event.at; s.gameId = deps.newGameId(); speak('connect.hello', {}, 'lobby');
  } else if (event.type === 'CALL_FAILED' && s.phase === 'dialing') action('dial');
  else if (event.type === 'SPEAK_DONE') {
    const speech = s.speech[0]; if (!speech || speech.id !== event.speakId) return log();
    s.speech.shift(); action(speech.action);
  } else if (event.type === 'TIMER') {
    const a = s.timers[event.timerId]; if (!a) return log(); delete s.timers[event.timerId]; action(a);
  } else if (event.type === 'PRICE_READY' || event.type === 'PRICE_FAILED') {
    const owner = s.players.find(p => `r${p.seat+1}` === event.itemId);
    if (!owner || !s.pendingItemTexts[owner.id] || (s.currentItem?.itemId === event.itemId && s.currentItem.request.origin === 'prop_closet') || (s.currentItem?.itemId === event.itemId && s.phase !== 'round_start' && s.phase !== 'item_resolve')) return log();
    if (event.type === 'PRICE_READY' && !event.result.propClosetSuggested) s.prices[event.itemId] = event.result;
    else s.failed.push(event.itemId);
    if (s.currentItem?.itemId === event.itemId) {
      s.currentItem.price = s.prices[event.itemId] ?? null;
      if (s.phase === 'item_resolve') { if (s.currentItem.price) show(); else prop(); }
    }
  } else if (event.type === 'TEXT_RECEIVED') {
    if (s.seen.includes(event.msgId)) return log(); s.seen.push(event.msgId);
    const p = s.players.find(p => p.phone === event.phone), cmd = event.text.trim().toLowerCase();
    const join = parseJoinText(event.text);
    if (join.isJoin && ['wait_call','lobby'].includes(s.phase)) {
      const result = addPlayer(s.players,event.phone,join.name,event.at,c.maxPlayers); s.players = result.players;
      text(event.phone, 'join', result.player ? MSG.joinReply(result.player.name,result.player.seat+1,s.players.map(p => p.name)) : MSG.gameFull());
      if (s.phase === 'lobby' && result.outcome === 'joined') {
        if (s.players.length >= c.maxPlayers) { cancel(); s.speech = []; speak('lobby.joined', { name: result.player!.name }, 'settle'); }
        else { for (const [tid,a] of Object.entries(s.timers)) if (a === 'settle') { effects.push({ type: 'CANCEL_TIMER', timerId: tid }); delete s.timers[tid]; }
          speak('lobby.joined', { name: result.player!.name }); if (s.players.length >= c.minPlayers) timer('settle',s.demo ? 1000 : c.lobbySettleMs); }
      }
    } else if (!p) text(event.phone,'unknown',MSG.unknown());
    else if (cmd === 'rematch' && s.phase === 'wait_call' && s.finishedRoster && s.players.length >= c.minPlayers) { text(p.phone,'rematchAck',MSG.rematchAck()); dial(); }
    else if (cmd === 'rematch' && ['finale','rematch_offer','ending'].includes(s.phase)) { if (s.phase === 'ending') { s.rematchRequested = true; text(p.phone,'rematchAck',MSG.rematchAck()); } else rematch(p.phone); }
    else if (cmd === 'demo' && s.phase === 'wait_call' && p.isMain) s.demo = true;
    else if (cmd === 'start' && s.phase === 'wait_call' && p.isMain) { if (s.players.length >= c.minPlayers) dial(); else text(p.phone,'needTwo',MSG.needTwo()); }
    else if (['start',"let's go",'lets go'].includes(cmd) && s.phase === 'lobby') rules();
    else if (['guess_listen','guess_confirm'].includes(s.phase) && p.id === current() && !s.guesses.some(g => g.playerId === p.id)) {
      const parsed = deps.parseGuess(event.text);
      if (parsed.kind === 'amount' && parsed.cents !== undefined) { s.pendingGuess = { cents: parsed.cents, spokenForm: parsed.spokenForm ?? deps.spokenAmount(parsed.cents), rawTranscript: event.text, corrections: 0 }; text(p.phone,'guessReceived',MSG.guessReceived(deps.spokenAmount(parsed.cents))); lock('text'); }
      else text(p.phone,'badGuess',MSG.badGuess());
    } else if (!['start','demo','rematch'].includes(cmd)) {
      const itemId = `r${p.seat+1}`;
      if (p.seat < s.roundIndex || (p.seat === s.roundIndex && !['round_start','item_resolve'].includes(s.phase))) text(p.phone,'itemTooLate',MSG.itemTooLate());
      else if (!s.pendingItemTexts[p.id]) {
        s.pendingItemTexts[p.id] = event.text; effects.push({ type: 'PRICE_ITEM', request: { itemId, ownerId: p.id, origin: 'text', rawText: event.text } }); text(p.phone,'itemReceived',MSG.itemReceived(event.text));
        if (s.currentItem?.itemId === itemId) { s.currentItem.request.rawText = event.text; if (s.phase === 'item_resolve') { cancel(); speak('item.pricing'); timer('prop',Math.min(c.priceTimeoutMs, Math.max(0,c.itemResolveMaxMs-(event.at-s.phaseEnteredAt)))); } }
      }
    } else return log();
  } else if (event.type === 'SPEECH_PARTIAL' && s.phase === 'guess_listen') s.liveTranscript = event.text;
  else if (event.type === 'SPEECH_FINAL') {
    const cmd = event.text.trim().toLowerCase();
    if (s.phase === 'lobby' && ['start',"let's go",'lets go'].includes(cmd)) rules();
    else if (s.phase === 'rematch_offer' && /^(rematch|again|yes)\b/.test(cmd)) rematch();
    else if (['guess_listen','guess_confirm'].includes(s.phase) && !s.guesses.some(g => g.playerId === current())) {
      const g = deps.parseGuess(event.text,event.confidence);
      if (g.kind === 'amount' && g.cents !== undefined) confirm(g.cents,event.text,g.spokenForm);
      else if (s.phase === 'guess_confirm' && s.pendingGuess && g.kind === 'yes') lock('voice');
      else if (s.phase === 'guess_confirm' && g.kind === 'no') { s.pendingGuess = null; listen(Math.max(c.minRelistenMs,s.remaining)); }
      else if (s.phase === 'guess_listen' && g.kind === 'pass') { if (s.nudged) silent(); else { s.nudged = true; speak('guess.nudge',{ name: name(current()) }); } }
      else return log();
    } else return log();
  } else return log();
  return { state: s, effects };
}
export const reduce: Reduce = (state, event, deps) => {
  try { return step(state,event,deps); }
  catch { return { state, effects: [{ type: 'LOG', level: 'error', msg: `Could not handle ${event.type} in ${state.phase}` }] }; }
};
