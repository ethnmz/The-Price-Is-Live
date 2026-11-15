import { describe, expect, it } from 'vitest';
import { buildStageState } from '../src/engine/stageState';
import { gameConfig } from '../src/config';
import { PHASES } from '../src/contracts/types';
import type { GameState, Phase } from '../src/contracts/types';
import { fixturePlayers, lockedGuess, ROUND_EXAMPLE_1, ROUND_EXAMPLE_2 } from '../fixtures/players';
import { stageFixture } from '../fixtures/stage-states';

const config = gameConfig();
function state(phase: Phase = 'round_start', count: 2 | 3 | 4 = 4): GameState {
  const players = fixturePlayers(count);
  return {
    phase, gameId: 'test', callId: 'call', callStartAt: 0, now: 1000, phaseEnteredAt: 1000,
    demo: false, lightning: false, textMode: false, players, turnOrder: players.map((p) => p.id),
    roundIndex: 0, totalRounds: count,
    currentItem: { itemId: 'r1', ownerId: 'p1', request: { itemId: 'r1', ownerId: 'p1',
      origin: 'text', rawText: 'secret raw item' }, price: { itemId: 'r1', displayName: 'Secret product',
      priceCents: 3499, source: 'list', isEstimate: false, confidence: 1, evidence: [], latencyMs: 1 } },
    guessOrder: players.slice(1).map((p) => p.id), guessIndex: 0, guesses: [], pendingGuess: null,
    liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [],
    pendingItemTexts: { p1: 'secret raw item' }, itemPromptSentTo: [], silentWindows: 0,
    roundStartedAt: 1000, roundDurationsMs: [], capHit: false, rematchRequested: false,
  };
}
const build = (s: GameState, now = 1000) => buildStageState(s, now, config);

describe('buildStageState', () => {
  for (const count of [2, 3, 4] as const) {
    for (const phase of PHASES) {
      it(`${phase} with ${count} players has the fixture shape and phase visibility`, () => {
        const s = state(phase, count);
        const actual = build(s);
        const fixture = stageFixture(phase, count);
        expect(Object.keys(actual).sort()).toEqual(Object.keys(fixture).sort());
        expect(actual.title).toBe(fixture.title);
        expect(actual.phase).toBe(phase);
        expect(actual.podiums).toHaveLength(count);
        expect(actual.podiums[0]).toMatchObject({ name: 'Ethan', score: 0, seat: 0 });
        const round = PHASES.indexOf(phase) >= PHASES.indexOf('round_start')
          && PHASES.indexOf(phase) <= PHASES.indexOf('round_score');
        expect(actual.roundLabel).toBe(round ? `ROUND 1 OF ${count}` : null);
        expect(actual.mysteryOwner).toBe(round && !['reveal', 'round_score'].includes(phase) ? 'Ethan' : null);
        expect(actual.banner).toBe(fixture.banner);
        expect(actual.hostSpeaking).toBe(false);
        expect(actual.finale !== null).toBe(['finale', 'rematch_offer', 'ending'].includes(phase));
        expect(actual.reveal !== null).toBe(['reveal', 'round_score'].includes(phase));
      });
    }
  }

  it('never projects item details before the price reveal, including stale history', () => {
    for (const phase of PHASES.slice(0, PHASES.indexOf('reveal') + 1)) {
      for (const revealStage of ['none', 'drumroll'] as const) {
        const s = state(phase);
        s.revealStage = revealStage;
        s.history = [{ ...ROUND_EXAMPLE_1, item: { ...ROUND_EXAMPLE_1.item,
          displayName: 'Secret product' } }];
        const json = JSON.stringify(build(s));
        for (const secret of ['Secret product', 'secret raw item', '$34.99']) expect(json).not.toContain(secret);
      }
    }
  });

  it('reveals name, formatted price, estimate status and source only on the price stage', () => {
    const s = state('reveal');
    s.revealStage = 'drumroll';
    expect(build(s).reveal).toMatchObject({ stage: 'drumroll', priceText: '', itemName: '' });
    s.revealStage = 'price';
    expect(build(s).reveal).toEqual({ stage: 'price', priceText: '$34.99', itemName: 'Secret product',
      isEstimate: false, sourceLabel: 'Price list' });
    const price = s.currentItem!.price!;
    price.source = 'web';
    price.evidence = [{ kind: 'list', label: 'irrelevant', url: 'https://example.com' },
      { kind: 'web', label: 'retailer', url: 'https://target.com/item?q=secret' }];
    expect(build(s).reveal?.sourceLabel).toBe('Google Search: target.com');
    price.evidence[1].url = 'broken';
    expect(build(s).reveal?.sourceLabel).toBe('Google Search');
    price.evidence = [];
    expect(build(s).reveal?.sourceLabel).toBe('Google Search');
    price.source = 'estimate'; price.isEstimate = true;
    expect(build(s).reveal).toMatchObject({ sourceLabel: 'Estimate', isEstimate: true });
  });

  it('projects pending, locked, silent and pass guesses and scored deltas', () => {
    const s = state('guess_confirm');
    s.pendingGuess = { cents: 2500, spokenForm: 'twenty five', rawTranscript: '25', corrections: 0 };
    expect(build(s).podiums[1]).toMatchObject({ role: 'guesser', guessText: '$25.00 ?', guessState: 'pending' });
    s.guesses = [lockedGuess('p2', 3000), lockedGuess('p3', 4000),
      { ...lockedGuess('p4', 100), status: 'pass', cents: null }];
    expect(build(s).podiums[1]).toMatchObject({ guessText: '$30.00 ✓', guessState: 'locked' });
    expect(build(s).podiums[3]).toMatchObject({ guessText: '—', guessState: 'silent' });
    s.guesses[2].status = 'silent';
    expect(build(s).podiums[3].guessState).toBe('silent');
    s.phase = 'round_score'; s.history = [ROUND_EXAMPLE_2, ROUND_EXAMPLE_1];
    const podiums = build(s).podiums;
    expect(podiums[0]).toMatchObject({ role: 'owner', delta: { guess: 0, bonus: 0, stump: 38 } });
    expect(podiums[1]).toMatchObject({ role: 'winner', delta: { guess: 86, bonus: 25, stump: 0 } });
    expect(podiums[2]).toMatchObject({ guessText: '$40.00', guessState: 'over', delta: { guess: 0, bonus: 0, stump: 0 } });
  });

  it('shows a full prompt timer and exact countdown only in timer phases', () => {
    const s = state('guess_prompt');
    s.timer = { timerId: 'guess', startedAt: 1000, ms: 10000 };
    expect(build(s, 3500).timer).toEqual({ secondsLeft: 10, total: 10, running: false });
    s.phase = 'guess_listen';
    expect(build(s, 3500).timer).toEqual({ secondsLeft: 7.5, total: 10, running: true });
    expect(build(s, 12000).timer?.secondsLeft).toBe(0);
    s.phase = 'guess_confirm';
    expect(build(s, 3500).timer).toEqual({ secondsLeft: 7.5, total: 10, running: false });
    s.phase = 'guess_silent'; expect(build(s).timer).toBeNull();
    s.phase = 'guess_listen'; s.timer = null; expect(build(s).timer).toBeNull();
  });

  it('uses captions, listening transcript and mode flags without mutating inputs', () => {
    const s = state('guess_listen'); s.liveTranscript = 'twenty five'; s.textMode = true; s.lightning = true;
    const before = structuredClone(s);
    expect(build(s)).toMatchObject({ caption: { text: 'Listening...', speaker: 'system' },
      liveTranscript: 'twenty five', fallbackBadge: 'TEXT MODE', lightning: true });
    expect(s).toEqual(before);
    s.caption = { text: 'Host line', speaker: 'host' };
    expect(build(s).caption).toEqual(s.caption);
    s.phase = 'item_resolve'; s.caption = null;
    expect(build(s)).toMatchObject({ caption: { text: 'Checking the price tag...', speaker: 'system' }, liveTranscript: null });
  });

  it('shows join instructions only in join phases below two players', () => {
    for (const phase of PHASES) {
      const s = state(phase); s.players = s.players.slice(0, 1);
      const expected = ['wait_call', 'dialing', 'connected', 'lobby'].includes(phase);
      expect(build(s).joinHint).toBe(expected ? "Text: I'm in, I'm {name}" : null);
      if (expected) expect(buildStageState(s, 0, { ...config, lineDisplayNumber: '+12145550100' }).joinHint)
        .toBe("Text +12145550100: I'm in, I'm {name}");
      s.players = fixturePlayers(2); expect(build(s).joinHint).toBeNull();
    }
  });

  it('shows the cap clock at the inclusive 45 second boundary only with an active call', () => {
    const s = state();
    expect(build(s, 224999).capRemainingMs).toBeNull();
    expect(build(s, 225000).capRemainingMs).toBe(45000);
    expect(build(s, 270000).capRemainingMs).toBe(0);
    expect(build(s, 270001).capRemainingMs).toBe(-1);
    s.callId = null; expect(build(s, 250000).capRemainingMs).toBeNull();
    s.callId = 'call'; s.callStartAt = null; expect(build(s, 250000).capRemainingMs).toBeNull();
  });

  it('builds ranked finale recaps in every final phase and marks co-champions by id', () => {
    const s = state('finale'); s.history = [ROUND_EXAMPLE_1, ROUND_EXAMPLE_2];
    for (const phase of ['finale', 'rematch_offer', 'ending'] as const) {
      s.phase = phase;
      expect(build(s).finale).toEqual({
        ranks: [{ id: 'p2', name: 'Diego', total: 178, place: 1 }, { id: 'p4', name: 'Aditri', total: 96, place: 2 },
          { id: 'p1', name: 'Ethan', total: 38, place: 3 }, { id: 'p3', name: 'Akshi', total: 0, place: 4 }],
        champion: ['Diego'], items: ['Ethan: Owala FreeSip water bottle $34.99', 'Diego: Hot Wheels 5-car pack $12.00 (estimate)'],
      });
    }
    s.phase = 'finale'; s.history = []; s.players[0].score = 100; s.players[1].score = 100;
    expect(build(s).finale?.champion).toEqual(['Ethan', 'Diego']);
    expect(build(s).podiums.map((p) => p.role)).toEqual(['winner', 'winner', 'idle', 'idle']);
  });

  it('derives turn completion from history and handles missing current items', () => {
    const s = state(); s.roundIndex = 1; s.currentItem = null; s.history = [ROUND_EXAMPLE_1];
    expect(build(s).turnOrder.slice(0, 2)).toEqual([
      { id: 'p1', name: 'Ethan', done: true, current: false },
      { id: 'p2', name: 'Diego', done: false, current: true },
    ]);
    expect(build(s).mysteryOwner).toBe('Diego');
    s.phase = 'reveal'; s.revealStage = 'price';
    expect(build(s).reveal).toMatchObject({ priceText: '', itemName: '', sourceLabel: null });
  });
});
