import { describe, expect, it, vi } from 'vitest';
import type { Effect, GameEvent, GameState, StageState } from '../src/contracts';
import { createRunner, VirtualScheduler } from '../src/engine/runner';
import { makeFakeDeps, makeFakePorts } from '../src/testing/fakes';

function harness(script: (e: GameEvent) => Effect[] = () => []) {
  const ports = makeFakePorts();
  const deps = makeFakeDeps();
  const clock = new VirtualScheduler();
  const seen: GameEvent[] = [];
  const initial: GameState = {
    phase: 'boot', gameId: null, callId: null, callStartAt: null, now: 0, phaseEnteredAt: 0,
    demo: false, lightning: false, textMode: false, players: [], turnOrder: [], roundIndex: -1,
    totalRounds: 0, currentItem: null, guessOrder: [], guessIndex: 0, guesses: [], pendingGuess: null,
    liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [], pendingItemTexts: {},
    itemPromptSentTo: [], silentWindows: 0, roundStartedAt: null, roundDurationsMs: [], capHit: false,
    rematchRequested: false,
  };
  const buildStageState = vi.fn((s: GameState): StageState => ({
    phase: s.phase, title: String(s.now), roundLabel: null, turnOrder: [], podiums: [], caption: null,
    timer: null, reveal: null, mysteryOwner: null, liveTranscript: null, banner: null, joinHint: null,
    fallbackBadge: null, hostSpeaking: false, lightning: false, capRemainingMs: null, finale: null,
  }));
  const log = vi.fn();
  const runner = createRunner({ ports, deps, scheduler: clock, initial, buildStageState, log,
    reduce: (s, e) => {
      seen.push(e);
      return { state: { ...s, now: e.at }, effects: script(e) };
    },
  });
  return { runner, ports, deps, clock, seen, buildStageState, log };
}
const request = { itemId: 'r1', ownerId: 'p1' as const, origin: 'text' as const, rawText: 'mug' };
const speak = (id: string): Effect => ({ type: 'SPEAK', speakId: id, key: 'connect.hello', text: id, emotion: 'warm' });

describe('runner', () => {
  it('executes every basic effect and feeds pricing and camera answers back', async () => {
    const effects: Effect[] = [
      { type: 'SFX', name: 'ding' }, { type: 'LISTEN', on: true },
      { type: 'SEND_TEXT', phone: '+12145550101', text: 'hello', idemKey: 'test:hello' },
      { type: 'PRICE_ITEM', request }, { type: 'IDENTIFY_FROM_CAMERA', itemId: 'r2', ownerId: 'p2' },
      { type: 'DIAL', phones: ['+12145550101'] }, { type: 'END_CALL' },
      { type: 'PERSIST', kind: 'game', doc: { gameId: 'test' } },
      { type: 'LOG', level: 'info', msg: 'hello', data: { test: true } },
    ];
    const h = harness((e) => e.type === 'BOOT' ? effects : []);
    const frames = [Buffer.from('fixture')];
    h.ports.call.frames = frames;
    const latest = vi.spyOn(h.ports.call, 'latestCallerFrames');
    const identify = vi.spyOn(h.ports.pricing, 'identifyFromFrames').mockResolvedValue({ label: 'mug', confidence: 0.9 });
    h.runner.start();
    await h.clock.advance(0);
    expect(h.ports.voice.sfxPlayed).toEqual(['ding']);
    expect(h.ports.voice.listening).toBe(true);
    expect(h.ports.message.sent).toEqual([{ phone: '+12145550101', text: 'hello', idemKey: 'test:hello' }]);
    expect(h.ports.pricing.requests).toEqual([request]);
    expect(latest).toHaveBeenCalledWith(3);
    expect(identify).toHaveBeenCalledWith(frames);
    expect(h.seen).toContainEqual(expect.objectContaining({ type: 'PRICE_READY', itemId: 'r1' }));
    expect(h.seen).toContainEqual({ type: 'FRAME_ID_READY', itemId: 'r2', label: 'mug', confidence: 0.9, at: 0 });
    expect(h.ports.call.dialed).toEqual([['+12145550101']]);
    expect(h.seen.some((e) => e.type === 'CALL_READY')).toBe(false);
    expect(h.ports.call.ended).toBe(1);
    expect(h.ports.stage.states).toHaveLength(h.seen.length);
    expect(h.buildStageState).toHaveBeenCalledTimes(h.seen.length);
    expect(h.ports.store.persisted).toEqual([{ kind: 'game', doc: { gameId: 'test' } }]);
    expect(h.log).toHaveBeenCalledWith('info', 'hello', { test: true });
    h.runner.stop();
  });

  it('serializes speech, including rejection and synchronous throws, with a completion for each', async () => {
    const h = harness((e) => e.type === 'BOOT' ? [speak('one'), speak('two'), speak('three')] : []);
    let finish!: () => void;
    const voice = vi.spyOn(h.ports.voice, 'speak')
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('bad audio'))
      .mockImplementationOnce(() => { throw new Error('sync audio failure'); });
    h.runner.start();
    await h.clock.advance(0);
    expect(voice.mock.calls.map((c) => c[0])).toEqual(['one']);
    finish();
    await h.clock.advance(0);
    expect(voice.mock.calls.map((c) => c[0])).toEqual(['one', 'two', 'three']);
    expect(voice.mock.calls[0]).toEqual(['one', 'one', { emotion: 'warm' }]);
    expect(h.seen.filter((e) => e.type === 'SPEAK_DONE').map((e) => e.speakId)).toEqual(['one', 'two', 'three']);
    h.runner.stop();
  });

  it('replaces and cancels timers, ticks, and clears everything on stop', async () => {
    const h = harness((e) => e.type === 'BOOT' ? [
      { type: 'START_TIMER', timerId: 'replace', ms: 5 },
      { type: 'START_TIMER', timerId: 'replace', ms: 15 },
      { type: 'START_TIMER', timerId: 'cancel', ms: 10 },
      { type: 'CANCEL_TIMER', timerId: 'cancel' },
      { type: 'START_TIMER', timerId: 'later', ms: 3000 },
    ] : []);
    h.runner.start();
    h.runner.start();
    await h.clock.advance(1000);
    expect(h.seen.filter((e) => e.type === 'TIMER')).toEqual([{ type: 'TIMER', timerId: 'replace', at: 15 }]);
    expect(h.seen.filter((e) => e.type === 'TICK')).toEqual([{ type: 'TICK', at: 1000 }]);
    expect(h.seen.filter((e) => e.type === 'BOOT')).toHaveLength(1);
    h.runner.stop();
    h.runner.stop();
    const count = h.seen.length;
    await h.clock.advance(10000);
    expect(h.seen).toHaveLength(count);
    expect(h.ports.message.started).toBe(false);
    // No hidden tick remains scheduled even though dispatch ignores stopped events.
    expect((h.clock as unknown as { timers: Map<unknown, unknown> }).timers.size).toBe(0);
  });

  it('forwards subscriptions, timestamps, mouth levels and speaking changes', () => {
    const h = harness();
    let speaking!: (on: boolean) => void;
    let mouth!: (level: number) => void;
    vi.spyOn(h.ports.voice, 'onSpeakingChange').mockImplementation((cb) => { speaking = cb; });
    vi.spyOn(h.ports.voice, 'onMouthLevel').mockImplementation((cb) => { mouth = cb; });
    const setMouth = vi.spyOn(h.ports.stage, 'setMouthLevel');
    h.runner.start();
    speaking(true);
    mouth(0.4);
    h.ports.voice.say('twenty', 12, false);
    h.ports.voice.say('twenty dollars', 13, true, 0.8);
    h.ports.message.receive('+12145550101', 'hello', 14);
    h.ports.call.emitReady('test-call', 15);
    h.ports.call.emitEnded('finished');
    expect(h.seen.slice(1)).toEqual([
      { type: 'SPEECH_PARTIAL', text: 'twenty', at: 12 },
      { type: 'SPEECH_FINAL', text: 'twenty dollars', confidence: 0.8, at: 13 },
      { type: 'TEXT_RECEIVED', phone: '+12145550101', text: 'hello', msgId: 'msg_1', at: 14 },
      { type: 'CALL_READY', callId: 'test-call', at: 15 },
      { type: 'CALL_ENDED', reason: 'finished', at: 0 },
    ]);
    expect(setMouth).toHaveBeenCalledWith(0.4);
    expect(h.ports.stage.last?.hostSpeaking).toBe(true);
    speaking(false);
    expect(h.ports.stage.last?.hostSpeaking).toBe(false);
    h.runner.stop();
    const count = h.ports.stage.states.length;
    h.ports.voice.say('late', 20);
    speaking(true);
    mouth(1);
    expect(h.ports.stage.states).toHaveLength(count);
    expect(setMouth).toHaveBeenCalledTimes(1);
  });

  it('queues reentrant events until all effects and stage rendering finish', () => {
    const h = harness((e) => e.type === 'BOOT'
      ? [{ type: 'LISTEN', on: true }, { type: 'LISTEN', on: false }] : []);
    const order: string[] = [];
    vi.spyOn(h.ports.voice, 'listen').mockImplementation((on) => {
      order.push(String(on));
      if (on) h.runner.dispatch({ type: 'TICK', at: 42 });
    });
    vi.spyOn(h.ports.stage, 'setState').mockImplementation((s) => { order.push(s.title!); });
    h.runner.start();
    expect(order).toEqual(['true', 'false', '0', '42']);
    expect(h.buildStageState).toHaveBeenCalledTimes(2);
    expect(h.buildStageState).toHaveBeenLastCalledWith(h.runner.getState(), 0, h.deps.config);
    h.runner.stop();
  });

  it('handles rejecting ports and keeps subsequent effects and events alive', async () => {
    const h = harness((e) => e.type === 'BOOT' ? [
      { type: 'PRICE_ITEM', request }, { type: 'DIAL', phones: [] },
      { type: 'SEND_TEXT', phone: '+12145550101', text: 'hello', idemKey: 'fail' },
      { type: 'SFX', name: 'ding' }, { type: 'END_CALL' },
      { type: 'PERSIST', kind: 'game', doc: {} }, { type: 'LISTEN', on: true },
      { type: 'IDENTIFY_FROM_CAMERA', itemId: 'r2', ownerId: 'p2' },
    ] : []);
    vi.spyOn(h.ports.pricing, 'price').mockRejectedValue(new Error('pricing'));
    vi.spyOn(h.ports.call, 'dial').mockRejectedValue(new Error('dial failed'));
    vi.spyOn(h.ports.message, 'send').mockRejectedValue(new Error('message'));
    vi.spyOn(h.ports.voice, 'sfx').mockRejectedValue(new Error('sfx'));
    vi.spyOn(h.ports.call, 'end').mockRejectedValue(new Error('end'));
    vi.spyOn(h.ports.store, 'persist').mockImplementation(() => { throw new Error('store'); });
    vi.spyOn(h.ports.call, 'latestCallerFrames').mockRejectedValue(new Error('frames'));
    vi.spyOn(h.ports.stage, 'setState').mockImplementationOnce(() => { throw new Error('stage'); });
    h.runner.start();
    await h.clock.advance(1000);
    expect(h.seen).toContainEqual({ type: 'PRICE_FAILED', itemId: 'r1', at: 0 });
    expect(h.seen).toContainEqual({ type: 'CALL_FAILED', reason: 'dial failed', at: 0 });
    expect(h.seen).toContainEqual({ type: 'FRAME_ID_READY', itemId: 'r2', label: null, confidence: 0, at: 0 });
    expect(h.seen).toContainEqual({ type: 'TICK', at: 1000 });
    expect(h.ports.voice.listening).toBe(true);
    expect(h.log).toHaveBeenCalled();
    h.runner.stop();
  });

  it.each(['missing', 'empty', 'null result', 'rejected result'])('returns a camera fallback for %s', async (mode) => {
    const h = harness((e) => e.type === 'BOOT' ? [{ type: 'IDENTIFY_FROM_CAMERA', itemId: 'r1', ownerId: 'p1' }] : []);
    h.ports.call.frames = mode === 'missing' ? null : mode === 'empty' ? [] : [Buffer.from('fixture')];
    const identify = vi.spyOn(h.ports.pricing, 'identifyFromFrames');
    if (mode === 'rejected result') identify.mockRejectedValue(new Error('identify'));
    h.runner.start();
    await h.clock.advance(0);
    expect(h.seen).toContainEqual({ type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0, at: 0 });
    if (mode === 'missing' || mode === 'empty') expect(identify).not.toHaveBeenCalled();
    h.runner.stop();
  });

  it('does not wait for hanging pricing and ignores results arriving after stop', async () => {
    const h = harness((e) => e.type === 'BOOT' ? [{ type: 'PRICE_ITEM', request }, speak('hello')] : []);
    h.ports.pricing.hang = true;
    h.runner.start();
    await h.clock.advance(240000);
    expect(h.seen.filter((e) => e.type === 'TICK')).toHaveLength(240);
    expect(h.seen).toContainEqual({ type: 'SPEAK_DONE', speakId: 'hello', at: 0 });
    h.runner.stop();

    const late = harness((e) => e.type === 'BOOT' ? [speak('late')] : []);
    let finish!: () => void;
    vi.spyOn(late.ports.voice, 'speak').mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    late.runner.start();
    await late.clock.advance(0);
    late.runner.stop();
    finish();
    await late.clock.advance(0);
    expect(late.seen).toHaveLength(1);
  });
});

describe('VirtualScheduler', () => {
  it('orders equal deadlines, supports cancellation, and settles chained promises between timers', async () => {
    const clock = new VirtualScheduler();
    const seen: string[] = [];
    const canceled = clock.setTimeout(() => seen.push('canceled'), 5);
    clock.clearTimeout(canceled);
    clock.setTimeout(() => {
      seen.push(`a:${clock.now()}`);
      void Promise.resolve().then(() => Promise.resolve()).then(() => {
        clock.setTimeout(() => seen.push(`async:${clock.now()}`), 1);
      });
    }, 10);
    clock.setTimeout(() => seen.push(`b:${clock.now()}`), 10);
    clock.setTimeout(() => seen.push(`c:${clock.now()}`), 20);
    await clock.advance(30);
    expect(seen).toEqual(['a:10', 'b:10', 'async:11', 'c:20']);
    expect(clock.now()).toBe(30);
    await expect(clock.advance(-1)).rejects.toThrow(RangeError);
  });
});
