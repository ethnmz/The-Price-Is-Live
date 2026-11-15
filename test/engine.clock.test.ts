import { describe, expect, it } from 'vitest';
import type { Effect, GameEvent } from '../src/contracts/events';
import type { GameConfig } from '../src/contracts/types';
import { initialState, reduce } from '../src/engine/reducer';
import type { EngineState } from '../src/engine/reducer/core';
import { fakePriceResult, makeFakeDeps } from '../src/testing/fakes';

type Input = GameEvent extends infer E ? E extends GameEvent ? Omit<E, 'at'> : never : never;
const phones = ['+12145550101', '+12145550102', '+12145550103'];
function game(config: Partial<GameConfig> = {}) {
  const deps = makeFakeDeps(config);
  let s = initialState(deps.config) as EngineState;
  let at = 0;
  const effects: Effect[] = [];
  function send(event: Input) {
    const r = reduce(s, { ...event, at } as GameEvent, deps);
    s = r.state as EngineState;
    effects.push(...r.effects);
    expect(r.effects.some(e => e.type === 'LOG' && e.level === 'error')).toBe(false);
    return r.effects;
  }
  function settle() {
    for (let n = 0; s.speakingId && n < 60; n++) send({ type: 'SPEAK_DONE', speakId: s.speakingId });
    expect(s.speakingId).toBeNull();
  }
  function fire(kind: string) {
    const id = Object.keys(s.timers).find(id => id.startsWith(`${kind}:`));
    expect(id, `${kind} in ${s.phase}`).toBeDefined();
    send({ type: 'TIMER', timerId: id! });
    settle();
  }
  function text(phone: string, text: string) { send({ type: 'TEXT_RECEIVED', phone, text, msgId: 'test' }); settle(); }
  function guess(textValue = '10') { text(s.players.find(p => p.id === s.guessOrder[s.guessIndex])!.phone, textValue); }
  function round() {
    fire('show');
    while (s.phase === 'guess_listen') guess();
    fire('drumroll'); fire('revealhold'); fire('scorehold');
  }
  send({ type: 'BOOT' });
  phones.forEach((phone, i) => text(phone, `I'm in, I'm Player${i}`));
  phones.forEach((phone, i) => {
    text(phone, `item ${i}`);
    send({ type: 'PRICE_READY', itemId: `r${i + 1}`, result: fakePriceResult(`r${i + 1}`, `Item ${i}`, 2000) });
  });
  text(phones[0], 'start');
  send({ type: 'CALL_READY', callId: 'clock-test' }); settle();
  fire('lobbysettle');
  return { get s() { return s; }, deps, effects, send, settle, fire, guess, round,
    time(ms: number) { at = ms; },
    keys() { return effects.filter(e => e.type === 'SPEAK').map(e => e.key); } };
}

describe('hard clock', () => {
  it('abandons an unfinished round exactly at 4:30 and sends capped scores once', () => {
    const g = game();
    g.round();
    const scores = g.s.players.map(p => p.score);
    g.fire('show'); g.guess();
    const timerId = g.s.timer!.timerId;
    g.time(269999); g.send({ type: 'TICK' });
    expect(g.s.phase).toBe('guess_listen');
    g.time(270000);
    const fx = g.send({ type: 'TICK' });
    expect(g.s.phase).toBe('finale');
    expect(g.s.capHit).toBe(true);
    expect(g.s.history).toHaveLength(1);
    expect(g.s.players.map(p => p.score)).toEqual(scores);
    expect(g.s.timers).toEqual({});
    expect(g.s.listenOpen).toBe(false);
    expect(fx).toContainEqual({ type: 'CANCEL_TIMER', timerId });
    const cards = fx.filter(e => e.type === 'SEND_TEXT');
    expect(cards).toHaveLength(3);
    expect(cards.every(e => e.text.includes('Time ran out after 1 of 3 rounds.'))).toBe(true);
    g.send({ type: 'TIMER', timerId }); g.settle();
    expect(g.keys()).toContain('finale.shortcap');
    expect(g.keys()).not.toContain('finale.drumroll');
    expect(g.s.history).toHaveLength(1);
    expect(g.send({ type: 'TICK' }).some(e => e.type === 'SEND_TEXT')).toBe(false);
  });

  it('does not start another round at 4:10', () => {
    const g = game();
    g.fire('show'); g.guess(); g.guess();
    g.fire('drumroll'); g.fire('revealhold');
    g.time(250000); g.fire('scorehold');
    expect(g.s.phase).toBe('rematch_offer');
    expect(g.s.roundIndex).toBe(0);
    expect(g.s.capHit).toBe(true);
    expect(g.s.history).toHaveLength(1);
  });

  it('applies the cap during connection speech and does not restart on later ticks', () => {
    const g = game();
    // Restart a fresh connected state using the same registered roster.
    g.send({ type: 'CALL_ENDED', reason: 'fixture' });
    g.send({ type: 'CALL_READY', callId: 'second' });
    g.time(270000); g.send({ type: 'TICK' });
    expect(g.s.phase).toBe('finale');
    g.settle();
    expect(g.s.phase).toBe('rematch_offer');
    expect(g.keys().filter(k => k === 'finale.shortcap')).toHaveLength(1);
  });
});

describe('lightning', () => {
  it('uses the initial projection and skips sure, unambiguous confirm-back', () => {
    const g = game({ avgRoundMsInitial: 100000 });
    expect(g.s.lightning).toBe(true);
    g.fire('show');
    const before = g.keys().length;
    g.send({ type: 'SPEECH_FINAL', text: '10', confidence: 0.8 }); g.settle();
    expect(g.s.guesses[0]).toMatchObject({ status: 'locked', channel: 'voice' });
    expect(g.keys().slice(before)).toContain('guess.locked');
    expect(g.keys().slice(before)).not.toContain('guess.confirm');
    g.guess();
    expect(g.effects.at(-1)).toMatchObject({ type: 'START_TIMER', ms: 2000 });
    g.fire('drumroll');
    expect(g.effects.some(e => e.type === 'START_TIMER' && e.timerId.startsWith('revealhold:') && e.ms === 2000)).toBe(true);
    g.fire('revealhold'); g.fire('scorehold'); g.fire('show');
    expect(g.keys().filter(k => k === 'guess.quiet')).toHaveLength(1);
    expect(g.s.lightning).toBe(true);
  });

  it('keeps confirm-back for ambiguous and low-confidence guesses', () => {
    for (const ambiguous of [false, true]) {
      const g = game({ avgRoundMsInitial: 100000 });
      const parse = g.deps.parseGuess;
      g.deps.parseGuess = (text, confidence) => ({ ...parse(text, confidence), ambiguous });
      g.fire('show');
      g.send({ type: 'SPEECH_FINAL', text: '10', confidence: ambiguous ? 1 : 0.79 }); g.settle();
      expect(g.s.phase).toBe('guess_confirm');
      expect(g.s.guesses).toEqual([]);
    }
  });

  it('uses measured average durations at subsequent round starts', () => {
    const g = game();
    expect(g.s.lightning).toBe(false);
    g.time(90000); g.round();
    expect(g.s.roundDurationsMs).toEqual([90000]);
    expect(g.s.lightning).toBe(true);
  });

  it('does not turn on at equality or in a normal fast game', () => {
    const g = game({ avgRoundMsInitial: (270000 - 25000) / 3 });
    expect(g.s.lightning).toBe(false);
    g.round(); g.round(); g.round();
    expect(g.s.history).toHaveLength(3);
    expect(g.s.lightning).toBe(false);
    expect(g.s.capHit).toBe(false);
  });

  it('uses lightning timings from the start in demo mode', () => {
    const g = game({ demo: true });
    g.fire('show'); g.guess(); g.guess();
    expect(g.effects.at(-1)).toMatchObject({ type: 'START_TIMER', ms: 2000 });
    g.fire('drumroll');
    expect(g.effects.some(e => e.type === 'START_TIMER' && e.timerId.startsWith('revealhold:') && e.ms === 2000)).toBe(true);
  });
});

describe('automatic TEXT MODE', () => {
  it('announces once after two speechless windows, extends later windows, and accepts text', () => {
    const g = game();
    g.fire('show'); g.fire('guess');
    expect(g.s.silentWindows).toBe(1);
    expect(g.s.textMode).toBe(false);
    g.fire('guess');
    expect(g.s.textMode).toBe(true);
    expect(g.keys().filter(k => k === 'guess.textmode')).toHaveLength(1);
    g.fire('drumroll'); g.fire('revealhold'); g.fire('scorehold'); g.fire('show');
    expect(g.s.timer?.ms).toBe(20000);
    g.guess('25');
    expect(g.s.guesses[0]).toMatchObject({ cents: 2500, status: 'locked', channel: 'text' });
    expect(g.keys().filter(k => k === 'guess.textmode')).toHaveLength(1);
  });

  it.each(['SPEECH_PARTIAL', 'SPEECH_FINAL'] as const)('resets the streak on %s even without a parsed amount', type => {
    const g = game();
    g.fire('show'); g.fire('guess');
    g.send(type === 'SPEECH_PARTIAL' ? { type, text: 'hmm' } : { type, text: 'hmm', confidence: 1 });
    expect(g.s.silentWindows).toBe(0);
    g.fire('guess');
    expect(g.s.silentWindows).toBe(0);
    expect(g.s.textMode).toBe(false);
  });
});
