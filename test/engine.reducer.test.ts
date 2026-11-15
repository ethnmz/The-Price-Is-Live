// Drives the reducer like the runner would: SPEAK is answered with SPEAK_DONE, timers fire on demand.
import { describe, expect, it } from 'vitest';
import type { Effect, GameEvent } from '../src/contracts/events';
import type { GameConfig, GameState, PlayerId } from '../src/contracts/types';
import { initialState, reduce } from '../src/engine/reducer';
import type { EngineState } from '../src/engine/reducer/core';
import { fakePriceResult, FAKE_PROP_ITEM, makeFakeDeps } from '../src/testing/fakes';

const A = '+12145550101';
const B = '+12145550102';
const C = '+12145550103';
const D = '+12145550104';
const NAMES: Record<string, string> = { [A]: 'Ann', [B]: 'Ben', [C]: 'Cy', [D]: 'Di' };

type Ev = GameEvent extends infer E ? (E extends { at: number } ? Omit<E, 'at'> : never) : never;

class Sim {
  s: GameState;
  get priv(): EngineState {
    return this.s as EngineState;
  }
  deps;
  t = 1000;
  all: Effect[] = [];
  playing: string | null = null;
  timers = new Map<string, number>();
  dead = new Set<string>();

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
      if (e.type === 'SPEAK') {
        expect(this.playing, 'the engine must emit one SPEAK at a time').toBeNull();
        this.playing = e.speakId;
      } else if (e.type === 'START_TIMER') {
        expect(this.timers.has(e.timerId) || this.dead.has(e.timerId), 'timer ids are unique').toBe(false);
        this.timers.set(e.timerId, e.ms);
      } else if (e.type === 'CANCEL_TIMER') {
        this.timers.delete(e.timerId);
        this.dead.add(e.timerId);
      }
    }
    this.all.push(...r.effects);
    return r.effects;
  }

  /** Answer every SPEAK until the host is quiet. */
  settle(): void {
    for (let i = 0; i < 50 && this.playing; i += 1) {
      const id = this.playing;
      this.playing = null;
      this.send({ type: 'SPEAK_DONE', speakId: id });
    }
    expect(this.playing).toBeNull();
  }

  go(ev: Ev): void {
    this.send(ev);
    this.settle();
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
    expect(id, `timer ${kind} should be running (phase ${this.s.phase})`).toBeDefined();
    this.timers.delete(id as string);
    this.dead.add(id as string);
    this.go({ type: 'TIMER', timerId: id as string });
  }

  price(itemId: string, cents: number, name = `Item ${itemId}`): void {
    this.go({ type: 'PRICE_READY', itemId, result: fakePriceResult(itemId, name, cents) });
  }

  mark(): number {
    return this.all.length;
  }
  since(mark: number): Effect[] {
    return this.all.slice(mark);
  }
  speaks(mark = 0): string[] {
    return this.since(mark).filter((e): e is Extract<Effect, { type: 'SPEAK' }> => e.type === 'SPEAK').map((e) => e.text);
  }
  keys(mark = 0): string[] {
    return this.since(mark).filter((e): e is Extract<Effect, { type: 'SPEAK' }> => e.type === 'SPEAK').map((e) => e.key);
  }
  sent(phone?: string, mark = 0): string[] {
    return this.since(mark)
      .filter((e): e is Extract<Effect, { type: 'SEND_TEXT' }> => e.type === 'SEND_TEXT' && (!phone || e.phone === phone))
      .map((e) => e.text);
  }
  persisted(kind: string): Record<string, unknown>[] {
    return this.all.filter((e): e is Extract<Effect, { type: 'PERSIST' }> => e.type === 'PERSIST' && e.kind === kind).map((e) => e.doc);
  }
  total(id: PlayerId): number {
    return this.s.players.find((p) => p.id === id)?.score ?? -1;
  }

  /** Events that never fit: nothing may throw and the phase must not move. */
  strays(): void {
    const before = this.s.phase;
    const list: Ev[] = [
      { type: 'TIMER', timerId: 'nope:1' },
      ...[...this.dead].map((timerId) => ({ type: 'TIMER', timerId }) as Ev),
      { type: 'SPEAK_DONE', speakId: 'zzz' },
      { type: 'PRICE_READY', itemId: 'r9', result: fakePriceResult('r9', 'X', 500) },
      { type: 'PRICE_FAILED', itemId: 'weird' },
      { type: 'FRAME_ID_READY', itemId: 'r1', label: null, confidence: 0 },
      { type: 'CALL_FAILED', reason: 'stray' },
      { type: 'TICK' },
      { type: 'SPEECH_PARTIAL', text: 'um' },
      { type: 'BOOT' },
    ];
    for (const ev of list) {
      expect(() => this.send(ev)).not.toThrow();
    }
    expect(this.s.phase).toBe(before);
  }
}

/** Join players (names from NAMES) and return the sim sitting in `wait_call`. */
function withPlayers(phones: string[], cfg: Partial<GameConfig> = {}): Sim {
  const sim = new Sim(cfg);
  for (const p of phones) sim.text(p, `I'm in, I'm ${NAMES[p]}`);
  return sim;
}

/** Start the call and run until the game is in `rules`/`round_start` and beyond (hello + lobby + rules spoken). */
function dialCall(sim: Sim): void {
  sim.text(A, 'start');
  expect(sim.s.phase).toBe('dialing');
  sim.go({ type: 'CALL_READY', callId: 'call_1' });
}

/** dialCall, then let the lobby settle so the game goes on to the rules. */
function connect(sim: Sim): void {
  dialCall(sim);
  if (sim.timerId('lobbysettle')) sim.fire('lobbysettle');
}

/** Everyone texts an item and the prices arrive: items[i] = cents for the round owned by seat i. */
function sendItems(sim: Sim, phones: string[], prices: number[]): void {
  phones.forEach((p, i) => {
    sim.text(p, `thing ${i + 1}`);
    sim.price(`r${i + 1}`, prices[i], `Thing ${i + 1}`);
  });
}

/** Play the guesses of one round. Entries line up with guessOrder: '25' = say 25, null = stay silent. */
function guessAll(sim: Sim, guesses: (string | null)[]): void {
  expect(sim.s.phase).toBe('show_item');
  sim.fire('show');
  for (const g of guesses) {
    expect(sim.s.phase).toBe('guess_listen');
    if (g === null) sim.fire('guess');
    else {
      sim.say(g);
      expect(sim.s.phase).toBe('guess_confirm');
      sim.say('yes');
    }
  }
  expect(sim.s.phase).toBe('reveal');
}

/** From the reveal to the next round (or finale). */
function finishRound(sim: Sim): void {
  sim.fire('drumroll');
  sim.fire('revealhold');
  expect(sim.s.phase).toBe('round_score');
  sim.fire('scorehold');
}

describe('joining and starting', () => {
  it('boots to wait_call and replies to joins, strangers and a full game', () => {
    const sim = new Sim();
    expect(sim.s.phase).toBe('wait_call');
    sim.text(A, "I'm in, I'm ann");
    expect(sim.sent(A)[0]).toContain("You're in, Ann");
    sim.text(B, 'im in its ben');
    sim.text(C, 'in cy');
    sim.text(D, 'count me in di');
    sim.text('+12145550105', "I'm in, I'm Eve");
    expect(sim.sent('+12145550105')[0]).toContain('full');
    sim.text('+12145550199', 'hello?');
    expect(sim.sent('+12145550199')[0]).toContain('host of THE PRICE IS LIVE');
    expect(sim.s.players.map((p) => p.name)).toEqual(['Ann', 'Ben', 'Cy', 'Di']);
    expect(sim.s.players[0].isMain).toBe(true);
  });

  it('needs two players and the main player to start', () => {
    const sim = withPlayers([A]);
    sim.text(A, 'start');
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.sent(A).at(-1)).toContain('at least 2 players');
    sim.text(B, "I'm in, I'm Ben");
    sim.text(B, 'start'); // not the main player
    expect(sim.s.phase).toBe('wait_call');
    sim.text(A, 'Start!');
    expect(sim.s.phase).toBe('dialing');
    const dial = sim.all.find((e) => e.type === 'DIAL');
    expect(dial).toEqual({ type: 'DIAL', phones: [A, B] });
    expect(sim.sent(B).at(-1)).toContain('Calling you now');
    expect(sim.timerId('dial')).toBeDefined();
  });

  it('gives up in the lobby with fewer than two players', () => {
    const sim = withPlayers([A]);
    sim.go({ type: 'CALL_READY', callId: 'c' }); // inbound call
    expect(sim.s.phase).toBe('lobby');
    expect(sim.keys()).toContain('connect.hello');
    sim.fire('lobbymax');
    expect(sim.s.phase).toBe('ending');
    expect(sim.keys().slice(-2)).toEqual(['lobby.giveup', 'end.bye']);
    expect(sim.all.at(-1)).toEqual({ type: 'END_CALL' });
    sim.go({ type: 'CALL_ENDED', reason: 'host hung up' });
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.s.players).toHaveLength(1);
  });

  it('moves from the lobby to the rules after the settle time, and restarts the wait on a new join', () => {
    const sim = withPlayers([A, B]);
    dialCall(sim);
    expect(sim.s.phase).toBe('lobby');
    const first = sim.timerId('lobbysettle');
    expect(first).toBeDefined();
    sim.text(C, "I'm in, I'm Cy");
    expect(sim.keys().at(-1)).toBe('lobby.joined');
    expect(sim.timerId('lobbysettle')).not.toBe(first);
    expect(sim.dead.has(first as string)).toBe(true);
    sim.go({ type: 'TIMER', timerId: first as string }); // the old one is late: ignored
    expect(sim.s.phase).toBe('lobby');
    sim.fire('lobbysettle');
    expect(sim.s.phase).toBe('item_resolve');
    expect(sim.keys()).toContain('rules.full');
  });

  it('starts at once with four players, or when someone says or texts start', () => {
    const four = withPlayers([A, B, C, D]);
    dialCall(four);
    expect(four.keys()).toContain('rules.full');
    expect(four.s.phase).not.toBe('lobby');

    const spoken = withPlayers([A, B]);
    dialCall(spoken);
    spoken.say("let's go");
    expect(spoken.keys()).toContain('rules.full');

    const texted = withPlayers([A, B]);
    dialCall(texted);
    texted.text(B, 'start');
    expect(texted.keys()).toContain('rules.full');
  });
});

describe('a full 4-player game', () => {
  // Prices: r1 $20, r2 $50, r3 $10, r4 $100. Hand-computed totals are in the comments.
  it('scores every round and sends the results', () => {
    const phones = [A, B, C, D];
    const sim = withPlayers(phones);
    sendItems(sim, phones, [2000, 5000, 1000, 10000]);
    connect(sim);
    expect(sim.s.gameId).toBe('game_1');
    expect(sim.s.callStartAt).not.toBeNull();
    expect(sim.s.turnOrder).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(sim.s.totalRounds).toBe(4);
    expect(sim.persisted('game')[0]).toMatchObject({ gameId: 'game_1', playerIds: ['p1', 'p2', 'p3', 'p4'], totalRounds: 4, mode: 'normal' });
    // Every owner already sent an item, so nobody is nagged.
    expect(sim.sent().filter((t) => t.includes("you're up"))).toEqual([]);

    // Round 1: owner Ann. Guessers Ben, Cy, Di.
    expect(sim.s.guessOrder).toEqual(['p2', 'p3', 'p4']);
    expect(sim.keys()).toContain('round.start');
    expect(sim.speaks()).toContain('round.start|n=1|owner=Ann');
    guessAll(sim, ['15', '25', '10']);
    // Ben 75 + 25 bonus = 100, Cy over = 0, Di 50. Ann stump: misses .25 .25 .5 -> 67.
    finishRound(sim);
    expect([sim.total('p1'), sim.total('p2'), sim.total('p3'), sim.total('p4')]).toEqual([67, 100, 0, 50]);

    // Round 2: owner Ben. Guessers Cy, Di, Ann.
    expect(sim.s.guessOrder).toEqual(['p3', 'p4', 'p1']);
    guessAll(sim, ['40', '50', '60']);
    // Cy 80, Di 100 + 25, Ann over. Ben stump: .2 0 .2 -> 27.
    finishRound(sim);
    expect([sim.total('p1'), sim.total('p2'), sim.total('p3'), sim.total('p4')]).toEqual([67, 127, 80, 175]);

    // Round 3: owner Cy. Guessers Di, Ann, Ben (silent).
    expect(sim.s.guessOrder).toEqual(['p4', 'p1', 'p2']);
    guessAll(sim, ['5', '8', null]);
    // Di 50, Ann 80 + 25, Ben silent 0. Cy stump: .5 .2 -> 70.
    finishRound(sim);
    expect([sim.total('p1'), sim.total('p2'), sim.total('p3'), sim.total('p4')]).toEqual([172, 127, 150, 225]);

    // Round 4: owner Di. Guessers Ann, Ben, Cy.
    expect(sim.s.guessOrder).toEqual(['p1', 'p2', 'p3']);
    const mark = sim.mark();
    guessAll(sim, ['90', '120', '100']);
    // Ann 90, Ben over, Cy 100 + 25. Di stump: .1 .2 0 -> 20.
    sim.fire('drumroll');
    sim.fire('revealhold');
    expect(sim.keys(mark)).toContain('score.stump'); // 20 points is not "low"
    sim.fire('scorehold');

    expect([sim.total('p1'), sim.total('p2'), sim.total('p3'), sim.total('p4')]).toEqual([262, 127, 275, 245]);
    expect(sim.s.history).toHaveLength(4);
    expect(sim.s.history.map((r) => r.winnerIds)).toEqual([['p2'], ['p4'], ['p1'], ['p3']]);
    expect(sim.s.players.map((p) => p.roundWins)).toEqual([1, 1, 1, 1]);

    // Finale: the card goes to everybody, persist is complete, the host crowns Cy.
    expect(sim.s.phase).toBe('rematch_offer');
    const card = sim.sent(A).find((t) => t.includes('FINAL SCOREBOARD')) as string;
    expect(card).toContain('Cy: 275 pts');
    expect(card).toContain("Ann's Thing 1: $20.00");
    for (const p of phones) expect(sim.sent(p).some((t) => t.includes('FINAL SCOREBOARD'))).toBe(true);
    expect(sim.persisted('round')).toHaveLength(4);
    expect(sim.persisted('guess')).toHaveLength(12);
    expect(sim.persisted('player')).toHaveLength(4);
    expect(sim.persisted('result')[0]).toMatchObject({ gameId: 'game_1' });
    const gameDocs = sim.persisted('game');
    expect(gameDocs.at(-1)).toMatchObject({ endReason: 'complete', championIds: ['p3'] });
    expect(gameDocs.at(-1)?.endedAt).toBeTypeOf('number');
    expect(sim.persisted('guess')[0]).toMatchObject({ roundIndex: 0, playerId: 'p2', cents: 1500, status: 'locked', channel: 'voice', points: 75 });
    expect(sim.persisted('round')[0]).toMatchObject({ roundIndex: 0, ownerId: 'p1', winnerIds: ['p2'], stumpPoints: 67 });
    expect(sim.all.filter((e) => e.type === 'SFX').map((e) => (e as { name: string }).name)).toContain('tada');
    expect(sim.speaks()).toContain('finale.champion|winner=Cy');

    // SEND_TEXT keys follow gameId:type:last4:n and never repeat.
    const keys = sim.all.filter((e): e is Extract<Effect, { type: 'SEND_TEXT' }> => e.type === 'SEND_TEXT').map((e) => e.idemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.find((k) => k.includes(':card:0101:'))).toMatch(/^game_1:card:0101:\d+$/);
  });

  it('ignores stray and late events in every phase without throwing', () => {
    const phones = [A, B, C];
    const sim = withPlayers(phones);
    sim.strays();
    sendItems(sim, phones, [2000, 5000, 1000]);
    connect(sim);
    sim.strays(); // show_item
    sim.fire('show');
    sim.strays(); // guess_listen
    sim.say('15');
    sim.strays(); // guess_confirm
    sim.say('yes');
    sim.strays();
    sim.say('20');
    sim.say('yes');
    sim.strays(); // reveal
    sim.fire('drumroll');
    sim.strays();
    sim.fire('revealhold');
    sim.strays(); // round_score
    sim.fire('scorehold');
    sim.strays(); // next round
    // A reduce that gets garbage must still not throw.
    expect(() => reduce(sim.s, { type: 'TIMER', timerId: undefined as unknown as string, at: 1 }, sim.deps)).not.toThrow();
    expect(() => reduce({ ...sim.s, players: undefined as never }, { type: 'TICK', at: 1 }, sim.deps)).not.toThrow();
  });
});

describe('shorter games', () => {
  it('plays a 2-player game: each round has one guesser', () => {
    const phones = [A, B];
    const sim = withPlayers(phones);
    sendItems(sim, phones, [2000, 4000]);
    connect(sim);
    expect(sim.s.totalRounds).toBe(2);
    expect(sim.s.guessOrder).toEqual(['p2']);
    guessAll(sim, ['10']); // Ben $10 of $20: 50 + 25; Ann stump |.5| -> 100
    finishRound(sim);
    expect([sim.total('p1'), sim.total('p2')]).toEqual([100, 75]);
    expect(sim.s.guessOrder).toEqual(['p1']);
    guessAll(sim, ['30']); // Ann $30 of $40: 75 + 25; Ben stump .25 -> 50
    finishRound(sim);
    expect(sim.keys().filter((k) => k === 'guess.quiet')).toHaveLength(2); // first (only) guesser of each round
    expect([sim.total('p1'), sim.total('p2')]).toEqual([200, 125]);
    expect(sim.s.phase).toBe('rematch_offer');
    expect(sim.speaks()).toContain('finale.champion|winner=Ann');
  });

  it('demo mode: 2 rounds with 4 players, short rules, quick lobby and hold-up', () => {
    const phones = [A, B, C, D];
    const sim = withPlayers(phones.slice(0, 2));
    sim.text(A, 'demo');
    expect(sim.s.demo).toBe(true);
    sim.text(C, "I'm in, I'm Cy");
    sim.text(D, "I'm in, I'm Di");
    sendItems(sim, phones.slice(0, 2), [2000, 5000]);
    connect(sim);
    expect(sim.s.totalRounds).toBe(2);
    expect(sim.keys()).toContain('rules.short');
    expect(sim.keys()).not.toContain('rules.full');
    expect(sim.persisted('game')[0]).toMatchObject({ mode: 'demo', totalRounds: 2 });
    guessAll(sim, ['10', '20', '5']);
    expect(sim.timers.size).toBeGreaterThan(0);
    finishRound(sim);
    guessAll(sim, ['30', '40', '45']);
    finishRound(sim);
    expect(sim.s.phase).toBe('rematch_offer');
    expect(sim.s.history).toHaveLength(2);
  });

  it('demo mode shortens the lobby settle and the hold-up', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'demo');
    sim.text(C, "I'm in, I'm Cy");
    sim.go({ type: 'CALL_READY', callId: 'c' });
    const settle = sim.all.find((e) => e.type === 'START_TIMER' && e.timerId.startsWith('lobbysettle'));
    expect(settle).toMatchObject({ ms: 1000 });
    sim.fire('lobbysettle');
    sendItems(sim, [A, B, C], [2000, 3000, 4000]);
    expect(sim.s.phase).toBe('show_item');
    expect(sim.all.find((e) => e.type === 'START_TIMER' && e.timerId.startsWith('show'))).toMatchObject({ ms: 3000 });
  });
});

describe('scoring cases', () => {
  it('everyone over: the lowest guess wins', () => {
    const sim = withPlayers([A, B, C]);
    sendItems(sim, [A, B, C], [1000, 1000, 1000]);
    connect(sim);
    guessAll(sim, ['30', '20']); // Ben $30, Cy $20 on a $10 item
    const mark = sim.mark();
    finishRound(sim);
    expect(sim.keys(mark)).toContain('score.allover');
    expect(sim.speaks(mark)).toContain('score.allover|winner=Cy');
    expect([sim.total('p1'), sim.total('p2'), sim.total('p3')]).toEqual([100, 0, 25]); // stump: misses capped at 1.0 -> 100
  });

  it('a tie shares the bonus and uses score.tie', () => {
    const sim = withPlayers([A, B, C, D]);
    sendItems(sim, [A, B, C, D], [5000, 1000, 1000, 1000]);
    connect(sim);
    guessAll(sim, ['45', '45', '30']);
    const mark = sim.mark();
    finishRound(sim);
    expect(sim.speaks(mark)).toContain('score.tie|winner=Ben|winner2=Cy');
    expect([sim.total('p1'), sim.total('p2'), sim.total('p3'), sim.total('p4')]).toEqual([40, 115, 115, 60]);
  });

  it('nobody guessing means no winner and low stump points', () => {
    const sim = withPlayers([A, B]);
    sendItems(sim, [A, B], [2000, 2000]);
    connect(sim);
    guessAll(sim, [null]);
    expect(sim.keys()).toContain('guess.silent');
    expect(sim.all.some((e) => e.type === 'SFX' && e.name === 'buzzer')).toBe(true);
    const mark = sim.mark();
    finishRound(sim);
    expect(sim.keys(mark)).toEqual(expect.arrayContaining(['score.nowinner', 'score.stumplow']));
    expect(sim.s.history[0].guesses[0]).toMatchObject({ status: 'silent', cents: null });
    expect([sim.total('p1'), sim.total('p2')]).toEqual([0, 0]);
  });
});

describe('guess window', () => {
  function atFirstGuess(cfg: Partial<GameConfig> = {}): Sim {
    const sim = withPlayers([A, B, C], cfg);
    sendItems(sim, [A, B, C], [2000, 2000, 2000]);
    connect(sim);
    sim.fire('show');
    return sim;
  }

  it('prompts the guesser with LISTEN off and opens the window with a visible timer', () => {
    const sim = withPlayers([A, B, C]);
    sendItems(sim, [A, B, C], [2000, 2000, 2000]);
    connect(sim);
    const mark = sim.mark();
    sim.fire('show');
    expect(sim.keys(mark)).toEqual(['guess.quiet', 'guess.prompt']);
    expect(sim.speaks(mark)[1]).toBe('guess.prompt|name=Ben');
    const listens = sim.since(mark).filter((e) => e.type === 'LISTEN');
    expect(listens).toEqual([{ type: 'LISTEN', on: false }, { type: 'LISTEN', on: true }]);
    expect(sim.s.timer).toMatchObject({ ms: 10_000 });
    expect(sim.timers.get(sim.s.timer?.timerId as string)).toBe(10_000);
    sim.go({ type: 'SPEECH_PARTIAL', text: 'twenty fi' });
    expect(sim.s.liveTranscript).toBe('twenty fi');
  });

  it('asks the second guesser without the quiet line', () => {
    const sim = atFirstGuess();
    sim.say('10');
    sim.say('yes');
    expect(sim.speaks().filter((t) => t.startsWith('guess.prompt'))).toEqual(['guess.prompt|name=Ben', 'guess.prompt|name=Cy']);
    expect(sim.keys().filter((k) => k === 'guess.quiet')).toHaveLength(1);
  });

  it('confirm-back repeats the amount and a quiet moment locks it', () => {
    const sim = atFirstGuess();
    const mark = sim.mark();
    sim.say('twenty five 25');
    expect(sim.speaks(mark)).toEqual(['guess.confirm|amount=$25.00']);
    expect(sim.s.pendingGuess).toMatchObject({ cents: 2500, corrections: 0 });
    expect(sim.timerId('confirm')).toBeDefined();
    expect(sim.timers.get(sim.timerId('confirm') as string)).toBe(3000);
    expect(sim.timerId('guess')).toBeUndefined();
    sim.fire('confirm');
    expect(sim.keys(mark)).toEqual(['guess.confirm', 'guess.locked', 'guess.prompt']);
    expect(sim.s.guesses[0]).toMatchObject({ playerId: 'p2', status: 'locked', cents: 2500, channel: 'voice', corrected: false });
  });

  it('a correction is confirmed once more and the second correction is final', () => {
    const sim = atFirstGuess();
    sim.say('25');
    const mark = sim.mark();
    sim.say('30');
    expect(sim.speaks(mark)).toEqual(['guess.confirm|amount=$30.00']);
    expect(sim.s.phase).toBe('guess_confirm');
    sim.say('35'); // second correction: final, no more repeat
    expect(sim.speaks(mark)).toEqual(['guess.confirm|amount=$30.00', 'guess.locked', 'guess.prompt|name=Cy']);
    expect(sim.s.guesses[0]).toMatchObject({ cents: 3500, corrected: true });
  });

  it('a correction followed by yes locks the new amount', () => {
    const sim = atFirstGuess();
    sim.say('25');
    sim.say('30');
    sim.say('yeah');
    expect(sim.s.guesses[0]).toMatchObject({ cents: 3000, corrected: true });
  });

  it('"no" goes back to listening with the time that was left, at least minRelistenMs', () => {
    const sim = atFirstGuess({ guessSeconds: 3 });
    sim.say('25');
    sim.say('no');
    expect(sim.s.phase).toBe('guess_listen');
    expect(sim.s.pendingGuess).toBeNull();
    expect(sim.s.timer?.ms).toBe(4000); // 3 s window, so the 4 s floor applies
    sim.say('12');
    sim.say('yes');
    expect(sim.s.guesses[0]).toMatchObject({ cents: 1200, corrected: true });
  });

  it('"no" keeps a longer remaining time', () => {
    const sim = atFirstGuess({ guessSeconds: 60 });
    sim.say('25');
    sim.say('no');
    expect(sim.s.timer?.ms).toBeGreaterThan(50_000);
    expect(sim.s.timer?.ms).toBeLessThanOrEqual(60_000);
  });

  it('pass nudges once; a second pass is silent', () => {
    const sim = atFirstGuess();
    const mark = sim.mark();
    sim.say('pass');
    expect(sim.speaks(mark)).toEqual(['guess.nudge|name=Ben']);
    expect(sim.s.phase).toBe('guess_listen');
    expect(sim.priv.listenOpen).toBe(true);
    sim.say('pass');
    expect(sim.s.guesses[0]).toMatchObject({ status: 'silent' });
    expect(sim.keys(mark)).toEqual(['guess.nudge', 'guess.silent', 'guess.prompt']);
  });

  it('accepts unparsed audio activity, and ignores speech while the mic is closed', () => {
    const sim = atFirstGuess();
    const before = sim.s;
    const snapshot = structuredClone(before);
    sim.say('hmm let me think');
    expect(sim.s).not.toBe(before);
    expect(before).toEqual(snapshot);
    expect(sim.priv.windowSpeechSeen).toBe(true);
    expect(sim.s.guesses).toEqual(before.guesses);
    expect(sim.s.timer).toEqual(before.timer);
    // while the host is still speaking the prompt, the mic is closed and speech is dropped
    const sim2 = withPlayers([A, B, C]);
    sendItems(sim2, [A, B, C], [2000, 2000, 2000]);
    connect(sim2);
    sim2.send({ type: 'TIMER', timerId: sim2.timerId('show') as string }); // prompt playing, no SPEAK_DONE yet
    expect(sim2.s.phase).toBe('guess_prompt');
    const closed = sim2.s;
    const out = sim2.send({ type: 'SPEECH_FINAL', text: '10', confidence: 0.9 });
    expect(sim2.s).toBe(closed);
    expect(out.map((e) => e.type)).toEqual(['LOG']);
  });

  it('a text guess from the current guesser locks at once', () => {
    const sim = atFirstGuess();
    const mark = sim.mark();
    sim.text(B, '$30');
    expect(sim.s.guesses[0]).toMatchObject({ playerId: 'p2', cents: 3000, channel: 'text', status: 'locked' });
    expect(sim.sent(B, mark)).toEqual(['Got your guess: $30.00. 🔒']);
    expect(sim.keys(mark)).toEqual(['guess.textack', 'guess.prompt']);
    expect(sim.speaks(mark)[0]).toBe('guess.textack|name=Ben|amount=$30.00');
    expect(sim.timerId('guess')).toBeDefined(); // the next guesser's window
    expect(sim.s.guessIndex).toBe(1);
  });

  it('a text without a number gets a hint; texts from other phones do not count as guesses', () => {
    const sim = atFirstGuess();
    sim.text(B, 'hmm no idea');
    expect(sim.sent(B).at(-1)).toContain('I need a number');
    expect(sim.s.guesses).toHaveLength(0);
    sim.text(C, '99'); // Cy is not guessing yet: this is an item text (too late: Cy's round is later, so it is accepted as an item)
    expect(sim.s.guesses).toHaveLength(0);
    expect(sim.s.pendingItemTexts.p3).toBe('99');
  });

  it('a text guess while the prompt is still being spoken does not trigger a second listen', () => {
    const sim = withPlayers([A, B, C]);
    sendItems(sim, [A, B, C], [2000, 2000, 2000]);
    connect(sim);
    sim.send({ type: 'TIMER', timerId: sim.timerId('show') as string }); // prompt playing, no SPEAK_DONE yet
    expect(sim.s.phase).toBe('guess_prompt');
    sim.send({ type: 'TEXT_RECEIVED', phone: B, text: '15', msgId: 'x' });
    sim.settle();
    expect(sim.s.guesses[0]).toMatchObject({ channel: 'text', cents: 1500 });
    expect(sim.s.guessIndex).toBe(1);
    expect(sim.s.phase).toBe('guess_listen'); // Cy, not a stale window for Ben
    expect(sim.s.guessOrder[sim.s.guessIndex]).toBe('p3');
  });

  it('uses the longer text-mode window when textMode is on', () => {
    const sim = withPlayers([A, B, C]);
    sendItems(sim, [A, B, C], [2000, 2000, 2000]);
    connect(sim);
    sim.s = { ...sim.s, textMode: true };
    sim.fire('show');
    expect(sim.s.timer?.ms).toBe(20_000);
  });
});

describe('items and pricing', () => {
  it('prices an item text at once with itemId r{seat+1}', () => {
    const sim = withPlayers([A, B]);
    const mark = sim.mark();
    sim.text(B, 'Owala bottle');
    const priceEffect = sim.since(mark).find((e) => e.type === 'PRICE_ITEM');
    expect(priceEffect).toEqual({ type: 'PRICE_ITEM', request: { itemId: 'r2', ownerId: 'p2', origin: 'text', rawText: 'Owala bottle' } });
    expect(sim.s.pendingItemTexts.p2).toBe('Owala bottle');
    expect(sim.sent(B).at(-1)).toContain('Got it: Owala bottle');
  });

  it('prompts owner 1 at the rules and the next owner at each round start', () => {
    const sim = withPlayers([A, B, C]);
    connect(sim);
    expect(sim.sent(A).filter((t) => t.includes("you're up first"))).toHaveLength(1);
    expect(sim.sent(B).filter((t) => t.includes("you're up next"))).toHaveLength(1);
    expect(sim.sent(C).filter((t) => t.includes("you're up"))).toHaveLength(0);
    expect(sim.s.itemPromptSentTo).toEqual(['p1', 'p2']);
    expect(sim.persisted('game')).toHaveLength(1);
  });

  it('says item.pricing and waits for a slow price, then moves on when it arrives', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'Slow thing');
    connect(sim);
    expect(sim.s.phase).toBe('item_resolve');
    expect(sim.keys()).toContain('item.pricing');
    expect(sim.timers.get(sim.timerId('price') as string)).toBe(8000);
    sim.price('r1', 2500, 'Slow thing');
    expect(sim.s.phase).toBe('show_item');
    expect(sim.s.currentItem?.price?.priceCents).toBe(2500);
    expect(sim.timerId('price')).toBeUndefined();
    expect(sim.speaks().at(-1)).toBe('item.holdup|owner=Ann');
  });

  it('pricing timeout -> prop closet', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'Slow thing');
    connect(sim);
    sim.fire('price');
    expect(sim.keys()).toContain('item.propcloset');
    expect(sim.s.phase).toBe('show_item');
    expect(sim.s.currentItem?.request.origin).toBe('prop_closet');
    expect(sim.s.currentItem?.price).toMatchObject({ displayName: FAKE_PROP_ITEM.name, priceCents: 1099 });
    // the real price turning up late changes nothing
    sim.price('r1', 9900);
    expect(sim.s.currentItem?.price?.priceCents).toBe(1099);
    guessAll(sim, ['10']);
    sim.fire('drumroll');
    expect(sim.speaks()).not.toContain('reveal.estimate');
    sim.fire('revealhold');
    expect(sim.speaks()).toContain('reveal.price|price=$10.99');
    expect(sim.persisted('round')[0]).toMatchObject({ item: { origin: 'prop_closet', displayName: FAKE_PROP_ITEM.name } });
  });

  it('PRICE_FAILED and propClosetSuggested also use the prop closet', () => {
    const failed = withPlayers([A, B]);
    failed.text(A, 'thing');
    connect(failed);
    failed.go({ type: 'PRICE_FAILED', itemId: 'r1' });
    expect(failed.keys()).toContain('item.propcloset');
    expect(failed.s.phase).toBe('show_item');

    const suggested = withPlayers([A, B]);
    suggested.text(A, 'asdfgh');
    connect(suggested);
    suggested.go({ type: 'PRICE_READY', itemId: 'r1', result: fakePriceResult('r1', 'asdfgh', 100, { propClosetSuggested: true }) });
    expect(suggested.keys()).toContain('item.propcloset');
    expect(suggested.s.phase).toBe('show_item');
  });

  it('a failure that arrives before the round starts is remembered', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'thing');
    sim.go({ type: 'PRICE_FAILED', itemId: 'r1' });
    connect(sim);
    expect(sim.keys()).toContain('item.propcloset');
    expect(sim.s.phase).toBe('show_item');
  });

  it('no item text at all: camera first, voice after itemWaitMs, prop closet only at the 12 s deadline', () => {
    const sim = withPlayers([A, B]);
    connect(sim);
    expect(sim.s.phase).toBe('item_resolve');
    expect(sim.keys()).toContain('item.camera');
    expect(sim.timers.get(sim.timerId('itemwait') as string)).toBe(6000);
    sim.fire('itemwait');
    expect(sim.keys()).toContain('item.ask');
    expect(sim.keys()).not.toContain('item.propcloset');
    expect(sim.s.phase).toBe('item_resolve');
    sim.fire('itemmax');
    expect(sim.keys()).toContain('item.propcloset');
    expect(sim.s.phase).toBe('show_item');
  });

  it('an item text that arrives while waiting starts pricing', () => {
    const sim = withPlayers([A, B]);
    connect(sim);
    sim.text(A, 'Late bottle');
    expect(sim.timerId('itemwait')).toBeUndefined();
    expect(sim.timerId('price')).toBeDefined();
    expect(sim.keys()).toContain('item.pricing');
    sim.price('r1', 1500);
    expect(sim.s.phase).toBe('show_item');
  });

  it('an estimate is announced as an estimate; an item text after the round is too late', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'thing');
    sim.go({ type: 'PRICE_READY', itemId: 'r1', result: fakePriceResult('r1', 'Thing', 3000, { source: 'estimate', isEstimate: true, confidence: 0.3 }) });
    connect(sim);
    guessAll(sim, ['20']);
    sim.fire('drumroll');
    const mark = sim.mark();
    sim.fire('revealhold');
    sim.text(A, 'another thing');
    expect(sim.sent(A).at(-1)).toContain('a little late');
    expect(sim.speaks()).toEqual(expect.arrayContaining(['reveal.price|price=$30.00', 'reveal.estimate']));
    expect(mark).toBeGreaterThan(0);
    expect(sim.s.history[0].item.isEstimate).toBe(true);
  });
});

describe('captions follow the line being spoken', () => {
  it('round_score: winner caption first, stump caption only after the winner line is done', () => {
    const sim2 = withPlayers([A, B, C]);
    sendItems(sim2, [A, B, C], [2000, 2000, 2000]);
    connect(sim2);
    sim2.fire('show');
    sim2.say('15');
    sim2.say('yes');
    sim2.say('10');
    sim2.say('yes');
    sim2.fire('drumroll');
    const id = sim2.timerId('revealhold') as string;
    sim2.timers.delete(id);
    const out = sim2.send({ type: 'TIMER', timerId: id });
    const speaks = out.filter((e) => e.type === 'SPEAK');
    expect(speaks).toHaveLength(1); // only the winner line starts now
    expect(sim2.s.caption?.text).toBe('score.winner|winner=Ben');
    expect(sim2.timerId('scorehold')).toBeUndefined();
    const winnerState = sim2.s;
    expect(sim2.send({ type: 'SPEAK_DONE', speakId: 'unrelated' })).toMatchObject([{ type: 'LOG' }]);
    expect(sim2.s).toBe(winnerState);
    sim2.playing = null;
    const next = sim2.send({ type: 'SPEAK_DONE', speakId: (speaks[0] as { speakId: string }).speakId });
    expect(next.filter((e) => e.type === 'SPEAK')).toHaveLength(1);
    expect(sim2.s.caption?.text).toMatch(/^score\.stump\|owner=Ann\|n=/);
    const stumpState = sim2.s;
    expect(sim2.send({ type: 'SPEAK_DONE', speakId: (speaks[0] as { speakId: string }).speakId })).toMatchObject([{ type: 'LOG' }]);
    expect(sim2.s).toBe(stumpState); // a duplicate completion must not skip the stump line
    expect(sim2.timerId('scorehold')).toBeUndefined();
    sim2.settle();
    expect(sim2.timerId('scorehold')).toBeDefined();
  });

  it('finale: drumroll, champion, thanks appear one after another', () => {
    const sim = withPlayers([A, B]);
    sendItems(sim, [A, B], [2000, 2000]);
    connect(sim);
    guessAll(sim, ['10']);
    finishRound(sim);
    guessAll(sim, ['10']);
    sim.fire('drumroll');
    const id = sim.timerId('revealhold') as string;
    sim.timers.delete(id);
    sim.send({ type: 'TIMER', timerId: id });
    sim.settle();
    const id2 = sim.timerId('scorehold') as string;
    sim.timers.delete(id2);
    const captions: (string | undefined)[] = [];
    let out = sim.send({ type: 'TIMER', timerId: id2 });
    expect(sim.s.phase).toBe('finale');
    for (let i = 0; i < 6; i += 1) {
      const speak = out.find((e) => e.type === 'SPEAK') as { speakId: string } | undefined;
      if (!speak) break;
      captions.push(sim.s.caption?.text);
      sim.playing = null;
      out = sim.send({ type: 'SPEAK_DONE', speakId: speak.speakId });
    }
    expect(captions.slice(0, 3)).toEqual(['finale.drumroll', expect.stringMatching(/^finale\.(champion|cochamps)\|/), 'finale.thanks']);
    expect(sim.s.phase).toBe('rematch_offer');
    expect(sim.s.caption?.text).toBe('rematch.offer');
  });
});

describe('call trouble', () => {
  it('a failed dial is tried once more, then the players are told', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'start');
    sim.go({ type: 'CALL_FAILED', reason: 'busy' });
    expect(sim.s.phase).toBe('dialing');
    expect(sim.all.filter((e) => e.type === 'DIAL')).toHaveLength(2);
    sim.go({ type: 'CALL_FAILED', reason: 'busy again' });
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.all.filter((e) => e.type === 'DIAL')).toHaveLength(2);
    expect(sim.sent(A).at(-1)).toContain("couldn't connect");
    expect(sim.sent(B).at(-1)).toContain("couldn't connect");
    // the players are still registered: start works again
    sim.text(A, 'start');
    expect(sim.s.phase).toBe('dialing');
  });

  it('the dial timer counts as a failure, and a retry that connects works', () => {
    const sim = withPlayers([A, B]);
    sim.text(A, 'start');
    sim.fire('dial');
    expect(sim.all.filter((e) => e.type === 'DIAL')).toHaveLength(2);
    expect(sim.timers.get(sim.timerId('dial') as string)).toBe(120_000);
    sim.go({ type: 'CALL_READY', callId: 'c2' });
    expect(sim.s.phase).toBe('lobby');
    expect(sim.s.callId).toBe('c2');
    expect(sim.timerId('dial')).toBeUndefined();
  });

  it('CALL_ENDED mid-game texts the scores, cancels timers and goes back to wait_call', () => {
    const sim = withPlayers([A, B, C]);
    sendItems(sim, [A, B, C], [2000, 2000, 2000]);
    connect(sim);
    guessAll(sim, ['15', '10']);
    finishRound(sim);
    expect(sim.s.history).toHaveLength(1);
    const mark = sim.mark();
    sim.go({ type: 'CALL_ENDED', reason: 'dropped' });
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.timers.size).toBe(0); // every running timer was cancelled
    for (const p of [A, B, C]) {
      const t = sim.sent(p, mark);
      expect(t).toHaveLength(1);
      expect(t[0]).toContain('The call dropped');
      expect(t[0]).toContain('FINAL SCOREBOARD');
    }
    expect(sim.s.players).toHaveLength(3);
    expect(sim.s.players.every((p) => p.score === 0)).toBe(true);
    expect(sim.s.history).toEqual([]);
    sim.strays();
  });

  it('CALL_ENDED before any round was scored sends nothing', () => {
    const sim = withPlayers([A, B]);
    connect(sim);
    const mark = sim.mark();
    sim.go({ type: 'CALL_ENDED', reason: 'hung up' });
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.sent(undefined, mark)).toEqual([]);
    expect(sim.timers.size).toBe(0);
  });
});

describe('rematch', () => {
  function finishedTwoPlayerGame(): Sim {
    const sim = withPlayers([A, B]);
    sendItems(sim, [A, B], [2000, 4000]);
    connect(sim);
    guessAll(sim, ['10']);
    finishRound(sim);
    guessAll(sim, ['30']);
    finishRound(sim);
    expect(sim.s.phase).toBe('rematch_offer');
    return sim;
  }

  it('a REMATCH text during the offer says bye, ends the call and dials everyone again at once', () => {
    const sim = finishedTwoPlayerGame();
    expect(sim.priv.listenOpen).toBe(true);
    expect(sim.timerId('rematch')).toBeDefined();
    const mark = sim.mark();
    sim.text(B, 'REMATCH');
    expect(sim.s.rematchRequested).toBe(true);
    expect(sim.sent(B, mark)).toEqual(['You got it! Calling everyone back in a few seconds. 📞']);
    expect(sim.s.phase).toBe('ending');
    expect(sim.keys(mark)).toEqual(['end.bye']);
    expect(sim.all.at(-1)).toEqual({ type: 'END_CALL' });
    const mark2 = sim.mark();
    sim.go({ type: 'CALL_ENDED', reason: 'host ended' });
    expect(sim.since(mark2).find((e) => e.type === 'DIAL')).toEqual({ type: 'DIAL', phones: [A, B] });
    expect(sim.s.phase).toBe('dialing');
    expect(sim.s.players.map((p) => p.score)).toEqual([0, 0]);
    expect(sim.sent(A, mark2)).toEqual(['📞 Calling you now! Pick up the FaceTime to play THE PRICE IS LIVE.']);
    // and the next game works
    sim.go({ type: 'CALL_READY', callId: 'call_2' });
    expect(sim.s.gameId).toBe('game_2');
    expect(sim.s.phase).toBe('lobby');
  });

  it('"rematch" spoken during the offer counts too', () => {
    const sim = finishedTwoPlayerGame();
    sim.say('yes rematch please');
    expect(sim.s.rematchRequested).toBe(true);
    expect(sim.s.phase).toBe('ending');
  });

  it('a REMATCH text sent during the finale skips the offer', () => {
    const sim = withPlayers([A, B]);
    sendItems(sim, [A, B], [2000, 4000]);
    connect(sim);
    guessAll(sim, ['10']);
    finishRound(sim);
    guessAll(sim, ['30']);
    sim.fire('drumroll');
    sim.fire('revealhold');
    sim.settle();
    // the finale speech has not been answered yet: text arrives while the host talks
    const id = sim.timerId('scorehold') as string;
    sim.timers.delete(id);
    sim.send({ type: 'TIMER', timerId: id });
    expect(sim.s.phase).toBe('finale');
    sim.send({ type: 'TEXT_RECEIVED', phone: A, text: 'rematch', msgId: 'r' });
    sim.settle();
    expect(sim.s.phase).toBe('ending');
    expect(sim.keys()).not.toContain('rematch.offer');
  });

  it('with no rematch signal the roster is kept, and a later rematch text dials again', () => {
    const sim = finishedTwoPlayerGame();
    sim.fire('rematch'); // 8 s with nobody answering
    expect(sim.s.phase).toBe('ending');
    expect(sim.keys().slice(-1)).toEqual(['end.bye']);
    sim.go({ type: 'CALL_ENDED', reason: 'bye' });
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.s.players).toHaveLength(2);
    expect(sim.all.filter((e) => e.type === 'DIAL')).toHaveLength(1); // the first game's dial only
    const mark = sim.mark();
    sim.text(B, 'Rematch');
    expect(sim.s.phase).toBe('dialing');
    expect(sim.since(mark).find((e) => e.type === 'DIAL')).toEqual({ type: 'DIAL', phones: [A, B] });
    sim.strays();
  });

  it('"rematch" before any game is just an item word, not a dial', () => {
    const sim = withPlayers([A, B]);
    sim.text(B, 'rematch');
    expect(sim.s.phase).toBe('wait_call');
    expect(sim.all.some((e) => e.type === 'DIAL')).toBe(false);
  });
});
