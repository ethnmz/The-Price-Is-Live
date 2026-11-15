import { describe, expect, it } from 'vitest';
import type { Effect, GameEvent } from '../src/contracts/events';
import { withPrivate } from '../src/engine/reducer/core';
import { initialState, reduce } from '../src/engine/reducer';
import { fakePriceResult, makeFakeDeps } from '../src/testing/fakes';
import { MSG } from '../src/engine/messages';

type Input = GameEvent extends infer E ? E extends { at: number } ? Omit<E, 'at'> : never : never;
function game() {
  const deps = makeFakeDeps();
  let state = initialState(deps.config);
  let now = 0;
  const effects: Effect[] = [];
  const timers = new Map<string, { ms: number; at: number }>();
  function send(event: Input, at = now) {
    now = at;
    const result = reduce(state, { ...event, at } as GameEvent, deps);
    state = result.state;
    effects.push(...result.effects);
    for (const effect of result.effects) {
      if (effect.type === 'START_TIMER') timers.set(effect.timerId, { ms: effect.ms, at });
      if (effect.type === 'CANCEL_TIMER') timers.delete(effect.timerId);
    }
    return result.effects;
  }
  function settle() {
    for (let n = 0; n < 30; n++) {
      const id = (state as typeof state & { speakingId: string | null }).speakingId;
      if (!id) return;
      send({ type: 'SPEAK_DONE', speakId: id });
    }
    throw new Error('speech did not settle');
  }
  function fire(kind: string) {
    const entry = [...timers].find(([id]) => id.startsWith(`${kind}:`));
    expect(entry).toBeDefined();
    const [timerId, timer] = entry!;
    timers.delete(timerId);
    send({ type: 'TIMER', timerId }, timer.at + timer.ms);
    settle();
  }
  const text = (value: string) => send({ type: 'TEXT_RECEIVED', phone: '+12145550101', text: value, msgId: `m${effects.length}` });
  send({ type: 'BOOT' });
  text("I'm in, I'm Ann");
  send({ type: 'TEXT_RECEIVED', phone: '+12145550102', text: "I'm in, I'm Ben", msgId: 'join2' });
  text('start');
  send({ type: 'CALL_READY', callId: 'fake-call' });
  settle();
  fire('lobbysettle');
  expect(state.phase).toBe('item_resolve');
  return { get state() { return state; }, effects, timers, send, settle, fire, text };
}

const requests = (effects: Effect[]) => effects.filter(e => e.type === 'PRICE_ITEM');
describe('item camera and voice fallbacks', () => {
  it('prices a camera label at the confidence boundary', () => {
    const g = game();
    expect(g.effects).toContainEqual({ type: 'IDENTIFY_FROM_CAMERA', itemId: 'r1', ownerId: g.state.currentItem?.ownerId });
    expect(g.effects).toContainEqual(expect.objectContaining({ type: 'SPEAK', key: 'item.camera' }));
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: 'Water bottle', confidence: 0.5 });
    expect(requests(g.effects)).toEqual([{ type: 'PRICE_ITEM', request: expect.objectContaining({ origin: 'camera', rawText: 'Water bottle' }) }]);
    g.send({ type: 'PRICE_READY', itemId: 'r1', result: fakePriceResult('r1', 'Water bottle', 2000) });
    expect(g.state.phase).toBe('show_item');
    expect([...g.timers.keys()].some(id => /^(item|price)/.test(id))).toBe(false);
  });

  it.each([null, 'Uncertain object'])('asks for voice after camera result %s', label => {
    const g = game();
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label, confidence: 0.49 });
    g.settle();
    expect(g.effects).toContainEqual(expect.objectContaining({ type: 'SPEAK', key: 'item.ask' }));
    expect(g.effects.at(-1)).toEqual({ type: 'LISTEN', on: true });
    g.send({ type: 'SPEECH_FINAL', text: 'Coffee mug', confidence: 0.9 });
    g.send({ type: 'SPEECH_FINAL', text: 'Other thing', confidence: 0.9 });
    expect(requests(g.effects)).toEqual([{ type: 'PRICE_ITEM', request: expect.objectContaining({ origin: 'voice', rawText: 'Coffee mug' }) }]);
    g.send({ type: 'PRICE_READY', itemId: 'r1', result: fakePriceResult('r1', 'Coffee mug', 1500) });
    expect(g.state.phase).toBe('show_item');
  });

  it('offers voice after camera silence and keeps the original 12-second deadline', () => {
    const g = game();
    const entered = g.state.phaseEnteredAt;
    g.fire('itemwait');
    expect(g.state.now - entered).toBe(6000);
    expect(g.state.phase).toBe('item_resolve');
    expect(g.effects).toContainEqual(expect.objectContaining({ type: 'SPEAK', key: 'item.ask' }));
    expect(g.effects.at(-1)).toEqual({ type: 'LISTEN', on: true });
    const before = g.state;
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: 'Late bottle', confidence: 1 });
    expect(g.state).toBe(before);
    expect(requests(g.effects)).toEqual([]);
    g.fire('itemmax');
    expect(g.state.now - entered).toBe(12000);
    expect(g.state.phase).toBe('show_item');
    expect(g.state.currentItem?.request.origin).toBe('prop_closet');
    expect([...g.timers.keys()].some(id => /^(item|price)/.test(id))).toBe(false);
  });

  it('uses the prop closet by 12 seconds when voice never responds', () => {
    const g = game();
    const entered = g.state.phaseEnteredAt;
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0 });
    g.settle();
    expect(g.state.phase).toBe('item_resolve');
    g.fire('itemmax');
    expect(g.state.now - entered).toBe(12000);
    expect(g.state.phase).toBe('show_item');
    expect(g.state.currentItem?.request.origin).toBe('prop_closet');
  });

  it.each([12000, 12001])('handles CALL_ENDED at item deadline +%s ms', elapsed => {
    const g = game();
    g.send({ type: 'CALL_ENDED', reason: 'disconnected' }, g.state.phaseEnteredAt + elapsed);
    expect(g.state.phase).toBe('wait_call');
    expect(g.state.callId).toBeNull();
    expect(g.state.currentItem).toBeNull();
    expect(withPrivate(g.state).speakingId).toBeNull();
    expect(g.timers.size).toBe(0);
  });

  it.each([12000, 12001])('finishes active speech at item deadline +%s ms and drains fallback lines', elapsed => {
    const g = game();
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0 });
    const speakId = withPrivate(g.state).speakingId;
    expect(speakId).not.toBeNull();
    const effects = g.send({ type: 'SPEAK_DONE', speakId: speakId! }, g.state.phaseEnteredAt + elapsed);
    expect(g.state.phase).toBe('show_item');
    expect(g.state.currentItem?.request.origin).toBe('prop_closet');
    expect(effects).toContainEqual(expect.objectContaining({ type: 'SPEAK', key: 'item.propcloset' }));
    expect(withPrivate(g.state).speakingId).not.toBe(speakId);
    g.settle();
    expect(withPrivate(g.state).speakingId).toBeNull();
    expect(withPrivate(g.state).speakQueue).toEqual([]);
    expect(g.effects).toContainEqual(expect.objectContaining({ type: 'SPEAK', key: 'item.holdup' }));
  });

  it('keeps the original deadline when a camera label is still pricing', () => {
    const g = game();
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: 'Bottle', confidence: 1 }, g.state.phaseEnteredAt + 5900);
    g.fire('itemmax');
    expect(g.state.currentItem?.request.origin).toBe('prop_closet');
  });

  it('uses late owner text during voice listening and rejects stale camera results', () => {
    const g = game();
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0 });
    g.settle();
    g.text('Texted bottle');
    expect(requests(g.effects).at(-1)).toMatchObject({ request: { origin: 'text', rawText: 'Texted bottle' } });
    const before = g.state;
    g.send({ type: 'FRAME_ID_READY', itemId: 'r1', label: 'Wrong item', confidence: 1 });
    expect(g.state).toBe(before);
    g.send({ type: 'PRICE_READY', itemId: 'r1', result: fakePriceResult('r1', 'Texted bottle', 2000) });
    const reply = g.text('Too late bottle');
    expect(reply).toContainEqual(expect.objectContaining({ type: 'SEND_TEXT', text: MSG.itemTooLate() }));
  });
});
