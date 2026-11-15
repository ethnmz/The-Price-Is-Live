// Item fallbacks (SPEC 7.4 state 7 c/d): camera, then voice, then prop closet; late texts.
import { describe, expect, it } from 'vitest';
import type { Effect, GameEvent } from '../src/contracts/events';
import { MSG } from '../src/engine/messages';
import { initialState, reduce } from '../src/engine/reducer';
import type { GameState } from '../src/contracts/types';
import { makeFakeDeps } from '../src/testing/fakes';

const A = '+12145550101';
const B = '+12145550102';
type Ev = GameEvent extends infer E ? (E extends { at: number } ? Omit<E, 'at'> : never) : never;

class Sim {
  s: GameState;
  deps = makeFakeDeps();
  t = 1000;
  all: Effect[] = [];
  playing: string | null = null;
  timers = new Map<string, number>();
  constructor() {
    this.s = initialState(this.deps.config);
    this.send({ type: 'BOOT' });
  }
  send(ev: Ev): void {
    this.t += 100;
    const r = reduce(this.s, { ...ev, at: this.t } as GameEvent, this.deps);
    this.s = r.state;
    for (const e of r.effects) {
      if (e.type === 'SPEAK') this.playing = e.speakId;
      else if (e.type === 'START_TIMER') this.timers.set(e.timerId, e.ms);
      else if (e.type === 'CANCEL_TIMER') this.timers.delete(e.timerId);
    }
    this.all.push(...r.effects);
  }
  go(ev: Ev): void {
    this.send(ev);
    for (let i = 0; i < 50 && this.playing; i += 1) {
      const id = this.playing;
      this.playing = null;
      this.send({ type: 'SPEAK_DONE', speakId: id });
    }
  }
  text(phone: string, text: string): void {
    this.go({ type: 'TEXT_RECEIVED', phone, text, msgId: `m${this.all.length}` });
  }
  timerId(kind: string): string | undefined {
    return [...this.timers.keys()].find((id) => id.startsWith(`${kind}:`));
  }
  fire(kind: string): void {
    const id = this.timerId(kind) as string;
    expect(id, `timer ${kind}`).toBeDefined();
    this.timers.delete(id);
    this.go({ type: 'TIMER', timerId: id });
  }
  keys(): string[] {
    return this.all.filter((e): e is Extract<Effect, { type: 'SPEAK' }> => e.type === 'SPEAK').map((e) => e.key);
  }
  priced(): Extract<Effect, { type: 'PRICE_ITEM' }>[] {
    return this.all.filter((e): e is Extract<Effect, { type: 'PRICE_ITEM' }> => e.type === 'PRICE_ITEM');
  }
  sent(): string[] {
    return this.all.filter((e): e is Extract<Effect, { type: 'SEND_TEXT' }> => e.type === 'SEND_TEXT').map((e) => e.text);
  }
}

/** Two players, call connected, rules spoken, sitting in item_resolve with no item text. */
function inItemResolve(): Sim {
  const sim = new Sim();
  sim.text(A, "I'm in, I'm Ann");
  sim.text(B, "I'm in, I'm Ben");
  sim.text(A, 'start');
  sim.go({ type: 'CALL_READY', callId: 'call_1' });
  if (sim.timerId('lobbysettle')) sim.fire('lobbysettle');
  expect(sim.s.phase).toBe('item_resolve');
  return sim;
}

describe('item fallbacks', () => {
  it('asks the camera first', () => {
    const sim = inItemResolve();
    expect(sim.keys()).toContain('item.camera');
    expect(sim.all.some((e) => e.type === 'IDENTIFY_FROM_CAMERA' && e.itemId === 'r1')).toBe(true);
  });

  it('camera label with confidence >= 0.5 is priced with origin camera', () => {
    const sim = inItemResolve();
    sim.go({ type: 'FRAME_ID_READY', itemId: 'r1', label: 'red stapler', confidence: 0.8 });
    expect(sim.priced().at(-1)?.request).toMatchObject({ origin: 'camera', rawText: 'red stapler' });
    expect(sim.keys()).not.toContain('item.ask');
  });

  it('camera null: asks out loud and prices the spoken answer with origin voice', () => {
    const sim = inItemResolve();
    sim.go({ type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0 });
    expect(sim.keys()).toContain('item.ask');
    expect(sim.all.at(-1)).toBeDefined();
    sim.go({ type: 'SPEECH_FINAL', text: 'a garden gnome', confidence: 0.9 });
    expect(sim.priced().at(-1)?.request).toMatchObject({ origin: 'voice', rawText: 'a garden gnome' });
  });

  it('camera silence then voice answer is priced', () => {
    const sim = inItemResolve();
    sim.fire('itemwait');
    expect(sim.keys()).toContain('item.ask');
    expect(sim.keys()).not.toContain('item.propcloset');
    sim.go({ type: 'SPEECH_FINAL', text: 'a lava lamp', confidence: 0.9 });
    expect(sim.priced().at(-1)?.request).toMatchObject({ origin: 'voice', rawText: 'a lava lamp' });
    expect(sim.s.phase).toBe('item_resolve');
  });

  it('owner text after six seconds is still used at once', () => {
    const sim = inItemResolve();
    sim.fire('itemwait');
    sim.text(A, 'a lava lamp');
    expect(sim.priced().at(-1)?.request).toMatchObject({ origin: 'text', rawText: 'a lava lamp' });
    expect(sim.timerId('itemmax')).toBeUndefined();
  });

  it('nothing at all: prop closet only at the original deadline', () => {
    const sim = inItemResolve();
    expect(sim.timers.get(sim.timerId('itemmax') as string)).toBe(12_000);
    sim.fire('itemwait');
    expect(sim.s.phase).toBe('item_resolve');
    expect(sim.keys()).not.toContain('item.propcloset');
    sim.fire('itemmax');
    expect(sim.keys()).toContain('item.propcloset');
    expect(sim.s.phase).toBe('show_item');
  });

  it('a text after the owner round moved on gets the too-late message', () => {
    const sim = inItemResolve();
    sim.fire('itemmax');
    expect(sim.s.phase).toBe('show_item');
    sim.text(A, 'a lava lamp');
    expect(sim.sent()).toContain(MSG.itemTooLate());
  });
});
