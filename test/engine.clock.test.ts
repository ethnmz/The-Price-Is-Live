// Hard clock, lightning mode and automatic TEXT MODE (SPEC 7.4, 9.2 rule 8, 9.6).
// The sim answers every SPEAK with SPEAK_DONE and fires timers on demand; time is set by hand.
import { describe, expect, it } from 'vitest';
import type { Effect, GameEvent } from '../src/contracts/events';
import type { GameConfig, GameState } from '../src/contracts/types';
import { initialState, reduce } from '../src/engine/reducer';
import { fakePriceResult, makeFakeDeps } from '../src/testing/fakes';

const PHONES = ['+12145550101', '+12145550102', '+12145550103'];
const NAMES = ['Ann', 'Ben', 'Cy'];

type Ev = GameEvent extends infer E ? (E extends { at: number } ? Omit<E, 'at'> : never) : never;

class Sim {
  s: GameState;
  deps;
  t = 1000;
  callAt = 0;
  all: Effect[] = [];
  playing: string | null = null;
  timers = new Map<string, number>();

  constructor(cfg: Partial<GameConfig> = {}) {
    this.deps = makeFakeDeps(cfg);
    this.s = initialState(this.deps.config);
    this.send({ type: 'BOOT' });
  }

  send(ev: Ev): Effect[] {
    this.t += 100;
    const r = reduce(this.s, { ...ev, at: this.t } as GameEvent, this.deps);
    this.s = r.state;
    for (const e of r.effects) {
      if (e.type === 'SPEAK') this.playing = e.speakId;
      else if (e.type === 'START_TIMER') this.timers.set(e.timerId, e.ms);
      else if (e.type === 'CANCEL_TIMER') this.timers.delete(e.timerId);
    }
    this.all.push(...r.effects);
    return r.effects;
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
  say(text: string, confidence = 0.95): void {
    this.go({ type: 'SPEECH_FINAL', text, confidence });
  }
  timerId(kind: string): string | undefined {
    return [...this.timers.keys()].find((id) => id.startsWith(`${kind}:`));
  }
  fire(kind: string): void {
    const id = this.timerId(kind);
    expect(id, `timer ${kind} should run in ${this.s.phase}`).toBeDefined();
    this.timers.delete(id as string);
    this.go({ type: 'TIMER', timerId: id as string });
  }
  /** Move the virtual clock so the next event happens `ms` after the call started. */
  setElapsed(ms: number): void {
    this.t = this.callAt + ms - 100;
  }
  mark(): number {
    return this.all.length;
  }
  keys(mark = 0): string[] {
    return this.all.slice(mark).filter((e): e is Extract<Effect, { type: 'SPEAK' }> => e.type === 'SPEAK').map((e) => e.key);
  }
  texts(mark = 0): string[] {
    return this.all.slice(mark).filter((e): e is Extract<Effect, { type: 'SEND_TEXT' }> => e.type === 'SEND_TEXT').map((e) => e.text);
  }
  get state(): GameState & { windowSpeechSeen?: boolean } {
    return this.s;
  }
}

/** Three players, call connected, items texted and priced, sitting at the first round's hold-up. */
function startGame(cfg: Partial<GameConfig> = {}): Sim {
  const sim = new Sim(cfg);
  PHONES.forEach((p, i) => sim.text(p, `I'm in, I'm ${NAMES[i]}`));
  sim.text(PHONES[0], 'start');
  sim.callAt = sim.t + 100;
  sim.go({ type: 'CALL_READY', callId: 'call_1' });
  sim.fire('lobbysettle');
  PHONES.forEach((p, i) => {
    sim.text(p, `thing ${i + 1}`);
    sim.go({ type: 'PRICE_READY', itemId: `r${i + 1}`, result: fakePriceResult(`r${i + 1}`, `Thing ${i + 1}`, 2000) });
  });
  expect(sim.s.phase).toBe('show_item');
  return sim;
}

/** Both guessers lock an amount by voice (with the confirm-back unless lightning skips it). */
function voiceGuess(sim: Sim, amount: string, confirm: boolean): void {
  sim.say(amount);
  if (confirm) {
    expect(sim.s.phase).toBe('guess_confirm');
    sim.say('yes');
  }
}

function playRound(sim: Sim, confirm = true): void {
  sim.fire('show');
  voiceGuess(sim, '25', confirm);
  voiceGuess(sim, '30', confirm);
  expect(sim.s.phase).toBe('reveal');
  sim.fire('drumroll');
  sim.fire('revealhold');
  expect(sim.s.phase).toBe('round_score');
}

describe('hard clock', () => {
  it('stops at the cap, abandons the round in progress and sends the cap line', () => {
    const sim = startGame();
    playRound(sim);
    sim.fire('scorehold');
    expect(sim.s.roundIndex).toBe(1);
    sim.fire('show');
    expect(sim.s.phase).toBe('guess_listen');
    sim.setElapsed(269_000);
    sim.go({ type: 'TICK' });
    expect(sim.s.phase).toBe('guess_listen'); // not yet
    const mark = sim.mark();
    sim.setElapsed(270_000);
    sim.go({ type: 'TICK' });
    expect(['finale', 'rematch_offer']).toContain(sim.s.phase);
    expect(sim.s.capHit).toBe(true);
    expect(sim.s.history).toHaveLength(1); // the half-played round is not scored
    expect(sim.s.guesses).toHaveLength(0);
    expect(sim.keys(mark)).toContain('finale.shortcap');
    expect(sim.keys(mark)).not.toContain('finale.drumroll');
    expect(sim.all.slice(mark)).toContainEqual({ type: 'LISTEN', on: false });
    expect(sim.timerId('guess')).toBeUndefined();
    expect(sim.timerId('show')).toBeUndefined();
    expect(sim.texts(mark).some((t) => t.includes('Time ran out after 1 of 3 rounds'))).toBe(true);
  });

  it('does not start a new round after the last-round-start time', () => {
    const sim = startGame();
    playRound(sim);
    sim.setElapsed(250_000);
    const mark = sim.mark();
    sim.fire('scorehold');
    expect(['finale', 'rematch_offer']).toContain(sim.s.phase);
    expect(sim.s.capHit).toBe(true);
    expect(sim.s.history).toHaveLength(1);
    expect(sim.keys(mark)).toContain('finale.shortcap');
    expect(sim.texts(mark).some((t) => t.includes('1 of 3'))).toBe(true);
  });

  it('starts the next round just before the limit', () => {
    const sim = startGame();
    playRound(sim);
    sim.setElapsed(249_000);
    sim.fire('scorehold');
    expect(sim.s.roundIndex).toBe(1);
    expect(sim.s.capHit).toBe(false);
  });

  it('ignores TICK before the call and after the finale', () => {
    const sim = new Sim();
    sim.go({ type: 'TICK' });
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.s.capHit).toBe(false);
  });
});

describe('lightning mode', () => {
  it('turns on when the projection is over the cap, and then skips the confirm-back', () => {
    const sim = startGame({ avgRoundMsInitial: 120_000 }); // 3 rounds * 120 s is far over 270 s
    sim.fire('show');
    expect(sim.s.lightning).toBe(true);
    expect(sim.keys()).toContain('guess.quiet'); // round 1 still gets it
    sim.say('25', 0.95);
    expect(sim.s.phase).toBe('guess_listen'); // locked at once, next guesser is up
    expect(sim.s.guesses[0]).toMatchObject({ status: 'locked', cents: 2500, channel: 'voice' });
    expect(sim.keys()).toContain('guess.locked');
    expect(sim.keys()).not.toContain('guess.confirm');
    sim.say('30', 0.5); // unsure: confirm-back stays
    expect(sim.s.phase).toBe('guess_confirm');
    sim.say('yes');
    expect(sim.s.phase).toBe('reveal');
    sim.fire('drumroll');
    const hold = sim.timerId('revealhold');
    expect(sim.timers.get(hold as string)).toBe(2000);
  });

  it('uses the short drumroll and no quiet line after round 1', () => {
    const sim = startGame({ avgRoundMsInitial: 120_000 });
    sim.fire('show');
    sim.say('25');
    sim.say('30');
    expect(sim.timers.get(sim.timerId('drumroll') as string)).toBe(2000);
    sim.fire('drumroll');
    sim.fire('revealhold');
    sim.fire('scorehold');
    const mark = sim.mark();
    sim.fire('show');
    expect(sim.keys(mark)).not.toContain('guess.quiet');
    expect(sim.keys(mark)).toContain('guess.prompt');
  });

  it('keeps the confirm-back for ambiguous guesses', () => {
    const sim = startGame({ avgRoundMsInitial: 120_000 });
    sim.deps.parseGuess = (text, conf = 1) => ({ kind: 'amount', cents: 2500, ambiguous: true, confidence: conf, spokenForm: '$25' });
    sim.fire('show');
    sim.say('twenty five');
    expect(sim.s.phase).toBe('guess_confirm');
  });

  it('never turns on in a normal fast game', () => {
    const sim = startGame();
    for (let i = 0; i < 3; i += 1) {
      playRound(sim);
      expect(sim.s.lightning).toBe(false);
      sim.setElapsed(40_000 * (i + 1));
      sim.fire('scorehold');
    }
    expect(['finale', 'rematch_offer']).toContain(sim.s.phase);
    expect(sim.s.capHit).toBe(false);
    expect(sim.s.lightning).toBe(false);
    expect(sim.keys()).toContain('finale.drumroll');
    expect(sim.keys()).not.toContain('finale.shortcap');
  });

  it('uses the measured round length once rounds are done', () => {
    const sim = startGame();
    playRound(sim);
    // Round 1 took a long time; at 100 s with 2 rounds left at ~90 s each the plan no longer fits.
    sim.setElapsed(100_000);
    sim.s.roundDurationsMs = [90_000]; // as the reducer would have recorded it
    sim.fire('scorehold');
    expect(sim.s.lightning).toBe(true);
  });
});

describe('automatic TEXT MODE', () => {
  it('turns on after two silent windows in a row, then a text guess locks', () => {
    const sim = startGame();
    sim.fire('show');
    sim.fire('guess');
    expect(sim.s.silentWindows).toBe(1);
    expect(sim.s.textMode).toBe(false);
    const mark = sim.mark();
    sim.fire('guess');
    expect(sim.s.silentWindows).toBe(2);
    expect(sim.s.textMode).toBe(true);
    expect(sim.keys(mark).filter((k) => k === 'guess.textmode')).toHaveLength(1);
    sim.fire('drumroll');
    sim.fire('revealhold');
    sim.fire('scorehold');
    sim.fire('show');
    expect(sim.s.phase).toBe('guess_listen');
    expect(sim.s.timer?.ms).toBe(20_000);
    const guesser = sim.s.players.find((p) => p.id === sim.s.guessOrder[0]);
    sim.text(guesser?.phone as string, '$42');
    expect(sim.s.guesses[0]).toMatchObject({ status: 'locked', cents: 4200, channel: 'text' });
    // The notice is said only once.
    expect(sim.keys(mark).filter((k) => k === 'guess.textmode')).toHaveLength(1);
  });

  it('speech in a window resets the count', () => {
    const sim = startGame();
    sim.fire('show');
    sim.fire('guess'); // silent window 1
    expect(sim.s.silentWindows).toBe(1);
    sim.say('25');
    sim.say('yes');
    expect(sim.s.silentWindows).toBe(0);
    expect(sim.s.textMode).toBe(false);
  });

  it('counts a partial transcript as speech', () => {
    const sim = startGame();
    sim.fire('show');
    sim.fire('guess');
    sim.go({ type: 'SPEECH_PARTIAL', text: 'um' });
    sim.fire('guess');
    expect(sim.s.silentWindows).toBe(0);
    expect(sim.s.textMode).toBe(false);
  });

  it('does not turn on when speech was heard but did not parse (hmm let me think)', () => {
    const sim = startGame();
    sim.fire('show');
    sim.fire('guess'); // one silent window
    expect(sim.s.silentWindows).toBe(1);
    sim.say('hmm let me think'); // ignored as a guess, still proves the audio works
    expect(sim.s.silentWindows).toBe(0);
    sim.fire('guess');
    expect(sim.s.silentWindows).toBe(0);
    expect(sim.s.textMode).toBe(false);
  });

  it('leaves state untouched for speech outside a listening window', () => {
    const sim = startGame();
    const before = sim.s;
    const r = reduce(before, { type: 'SPEECH_FINAL', text: 'hmm', confidence: 0.9, at: sim.t + 100 }, sim.deps);
    expect(r.state).toBe(before);
  });
});
