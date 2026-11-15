import { describe, expect, it, vi } from 'vitest';
import type { Effect, GameEvent, GameState, StageState } from '../src/contracts';
import { createRunner, VirtualScheduler } from '../src/engine/runner';
import { makeFakeDeps, makeFakePorts } from '../src/testing/fakes';

const initial: GameState = {
  phase: 'boot', gameId: null, callId: null, callStartAt: null, now: 0, phaseEnteredAt: 0,
  demo: false, lightning: false, textMode: false, players: [], turnOrder: [], roundIndex: -1,
  totalRounds: 0, currentItem: null, guessOrder: [], guessIndex: 0, guesses: [], pendingGuess: null,
  liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [], pendingItemTexts: {},
  itemPromptSentTo: [], silentWindows: 0, roundStartedAt: null, roundDurationsMs: [], capHit: false, rematchRequested: false,
};
const stage: StageState = {
  phase: 'boot', title: null, roundLabel: null, turnOrder: [], podiums: [], caption: null,
  timer: null, reveal: null, mysteryOwner: null, liveTranscript: null, banner: null, joinHint: null,
  fallbackBadge: null, hostSpeaking: false, lightning: false, capRemainingMs: null, finale: null,
};
const request = { itemId: 'r1', ownerId: 'p1' as const, origin: 'text' as const, rawText: 'mug' };
const speak = (speakId: string): Effect => ({ type: 'SPEAK', speakId, key: 'reveal.estimate', text: speakId, emotion: 'warm' });
function setup(effects: Effect[] = []) {
  const ports = makeFakePorts();
  const scheduler = new VirtualScheduler();
  const events: GameEvent[] = [];
  const log = vi.fn();
  const buildStageState = vi.fn(() => ({ ...stage }));
  const runner = createRunner({ ports, scheduler, deps: makeFakeDeps(), initial, log, buildStageState,
    reduce: (state, event) => {
      events.push(event);
      return { state: { ...state, now: event.at }, effects: event.type === 'BOOT' ? effects : [] };
    },
  });
  return { ports, scheduler, events, runner, log, buildStageState };
}

describe('runner', () => {
  it('routes effects to the ports and feeds results back', async () => {
    const x = setup([
      speak('a'), { type: 'SFX', name: 'drumroll' },
      { type: 'SEND_TEXT', phone: '+12145550101', text: 'hello', idemKey: 'game:test:0101' },
      { type: 'PRICE_ITEM', request }, { type: 'IDENTIFY_FROM_CAMERA', itemId: 'r1', ownerId: 'p1' },
      { type: 'LISTEN', on: true }, { type: 'DIAL', phones: ['+12145550101'] },
      { type: 'END_CALL' }, { type: 'PERSIST', kind: 'game', doc: { gameId: 'test' } },
      { type: 'LOG', level: 'info', msg: 'test' },
    ]);
    x.ports.call.frames = [Buffer.from('fixture')];
    const identify = vi.spyOn(x.ports.pricing, 'identifyFromFrames').mockResolvedValue({ label: 'mug', confidence: 0.8 });
    x.runner.start();
    await x.scheduler.advance(0);
    expect(x.ports.voice.spoken).toEqual([{ id: 'a', text: 'a', emotion: 'warm' }]);
    expect(x.ports.voice.sfxPlayed).toEqual(['drumroll']);
    expect(x.ports.message.sent[0]).toMatchObject({ text: 'hello', idemKey: 'game:test:0101' });
    expect(x.ports.pricing.requests).toEqual([request]);
    expect(identify).toHaveBeenCalledWith(x.ports.call.frames);
    expect(x.ports.voice.listening).toBe(true);
    expect(x.ports.call.dialed).toEqual([['+12145550101']]);
    expect(x.ports.call.ended).toBe(1);
    expect(x.ports.store.persisted).toHaveLength(1);
    expect(x.log).toHaveBeenCalledWith('info', 'test', undefined);
    expect(x.events).toContainEqual(expect.objectContaining({ type: 'PRICE_READY', itemId: 'r1' }));
    expect(x.events).toContainEqual({ type: 'FRAME_ID_READY', itemId: 'r1', label: 'mug', confidence: 0.8, at: 0 });
    expect(x.events).toContainEqual({ type: 'SPEAK_DONE', speakId: 'a', at: 0 });
    expect(x.events.some(e => e.type === 'CALL_READY')).toBe(false);
    x.runner.stop();
  });

  it('serializes speech and completes rejected speech', async () => {
    const x = setup([speak('a'), speak('b'), speak('c')]);
    let finish!: () => void;
    const spoken: string[] = [];
    x.ports.voice.speak = async (id) => {
      spoken.push(id);
      if (id === 'a') await new Promise<void>(resolve => { finish = resolve; });
      if (id === 'b') throw new Error('offline');
    };
    x.runner.start();
    await x.scheduler.advance(0);
    expect(spoken).toEqual(['a']);
    finish();
    await x.scheduler.advance(0);
    expect(spoken).toEqual(['a', 'b', 'c']);
    expect(x.events.filter(e => e.type === 'SPEAK_DONE').map(e => e.speakId)).toEqual(['a', 'b', 'c']);
    x.runner.stop();
  });

  it('replaces and cancels timers, ticks, and clears all timers on stop', async () => {
    const x = setup([
      { type: 'START_TIMER', timerId: 'replace', ms: 10 },
      { type: 'START_TIMER', timerId: 'replace', ms: 30 },
      { type: 'START_TIMER', timerId: 'cancel', ms: 20 },
      { type: 'CANCEL_TIMER', timerId: 'cancel' },
      { type: 'START_TIMER', timerId: 'later', ms: 10000 },
    ]);
    x.runner.start();
    await x.scheduler.advance(1000);
    expect(x.events.filter(e => e.type === 'TIMER')).toEqual([{ type: 'TIMER', timerId: 'replace', at: 30 }]);
    expect(x.events.at(-1)).toEqual({ type: 'TICK', at: 1000 });
    const clear = vi.spyOn(x.scheduler, 'clearTimeout');
    x.runner.stop();
    expect(clear).toHaveBeenCalledTimes(2);
    const count = x.events.length;
    await x.scheduler.advance(240000);
    x.ports.message.receive('+12145550101', 'late', 241000);
    expect(x.events).toHaveLength(count);
    expect(x.ports.message.started).toBe(false);
  });

  it('keeps processing with hung pricing and throwing ports', async () => {
    const x = setup([{ type: 'PRICE_ITEM', request }, { type: 'LISTEN', on: true },
      { type: 'SEND_TEXT', phone: '+12145550101', text: 'x', idemKey: 'game:test:0101' },
      { type: 'PERSIST', kind: 'game', doc: {} }]);
    x.ports.pricing.hang = true;
    x.ports.voice.listen = () => { throw new Error('broken'); };
    x.ports.message.send = async () => { throw new Error('offline'); };
    x.runner.start();
    await x.scheduler.advance(1000);
    expect(x.events.map(e => e.type)).toEqual(['BOOT', 'TICK']);
    expect(x.ports.store.persisted).toHaveLength(1);
    expect(x.log).toHaveBeenCalled();
    x.runner.stop();
  });

  it('returns failure events and unavailable camera results', async () => {
    const x = setup([{ type: 'PRICE_ITEM', request }, { type: 'DIAL', phones: [] },
      { type: 'IDENTIFY_FROM_CAMERA', itemId: 'r1', ownerId: 'p1' }]);
    x.ports.pricing.price = async () => { throw new Error('offline'); };
    x.ports.call.failNextDial = 'dial failed';
    x.runner.start();
    await x.scheduler.advance(0);
    expect(x.events).toContainEqual({ type: 'PRICE_FAILED', itemId: 'r1', at: 0 });
    expect(x.events).toContainEqual({ type: 'CALL_FAILED', reason: 'dial failed', at: 0 });
    expect(x.events).toContainEqual({ type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0, at: 0 });
    x.runner.stop();
  });

  it('queues reentrant callbacks and renders every event', async () => {
    const x = setup([{ type: 'LISTEN', on: true }]);
    x.ports.voice.listen = () => x.ports.voice.say('nested', 2);
    x.runner.start();
    x.runner.start();
    x.ports.voice.say('partial', 3, false);
    x.ports.message.receive('+12145550101', 'hi', 4);
    x.ports.call.emitReady('call', 5);
    x.ports.call.emitEnded('done');
    expect(x.events.map(e => e.type)).toEqual(['BOOT', 'SPEECH_FINAL', 'SPEECH_PARTIAL', 'TEXT_RECEIVED', 'CALL_READY', 'CALL_ENDED']);
    expect(x.ports.stage.states).toHaveLength(x.events.length);
    expect(x.buildStageState).toHaveBeenCalledTimes(x.events.length);
    expect(x.runner.getState().now).toBe(0);
    x.runner.stop();
    await x.scheduler.advance(1000);
  });

  it('forwards mouth and speaking state', async () => {
    const x = setup([speak('a')]);
    x.runner.start();
    await x.scheduler.advance(0);
    expect(x.ports.stage.mouthLevels).toBe(1);
    expect(x.ports.stage.states.some(s => s.hostSpeaking)).toBe(true);
    expect(x.ports.stage.last?.hostSpeaking).toBe(false);
    x.runner.stop();
  });
});

it('virtual time settles async chains before the next deadline and preserves insertion order', async () => {
  const clock = new VirtualScheduler();
  const seen: number[] = [];
  clock.setTimeout(() => {
    seen.push(clock.now());
    void Promise.resolve().then(() => Promise.resolve()).then(() => {
      clock.setTimeout(() => seen.push(clock.now()), 5);
    });
  }, 10);
  clock.setTimeout(() => seen.push(clock.now()), 10);
  await clock.advance(20);
  expect(seen).toEqual([10, 10, 15]);
  expect(clock.now()).toBe(20);
});
