import { describe, expect, it } from 'vitest';
import { buildStageState } from '../src/engine/stageState';
import { gameConfig } from '../src/config';
import { PHASES } from '../src/contracts/types';
import type { GameState, Phase, PlayerId, PriceResult } from '../src/contracts/types';
import { fixturePlayers, lockedGuess, ROUND_EXAMPLE_1 } from '../fixtures/players';
import { stageFixture } from '../fixtures/stage-states';

const config = gameConfig({ lineDisplayNumber: '(214) 555-0100' });
const NOW = 100_000;
const SECRET_NAME = 'Owala FreeSip water bottle 24 oz';
const SECRET_RAW = 'zorblax gizmo raw text';

const price: PriceResult = {
  itemId: 'r1', displayName: SECRET_NAME, priceCents: 3499, source: 'list', isEstimate: false, confidence: 0.9,
  evidence: [], latencyMs: 10,
};

function state(phase: Phase, count: 2 | 3 | 4 = 4, patch: Partial<GameState> = {}): GameState {
  return {
    phase, gameId: 'g1', callId: 'c1', callStartAt: NOW - 60_000, now: NOW, phaseEnteredAt: NOW, demo: false,
    lightning: false, textMode: false, players: fixturePlayers(count),
    turnOrder: fixturePlayers(count).map((p) => p.id), roundIndex: 0, totalRounds: count,
    currentItem: { itemId: 'r1', ownerId: 'p1', request: { itemId: 'r1', ownerId: 'p1', origin: 'text', rawText: SECRET_RAW }, price },
    guessOrder: ['p2', 'p3', 'p4'].slice(0, count - 1) as PlayerId[], guessIndex: 0, guesses: [], pendingGuess: null,
    liveTranscript: null, timer: null, caption: null, revealStage: 'none', history: [], pendingItemTexts: {},
    itemPromptSentTo: [], silentWindows: 0, roundStartedAt: null, roundDurationsMs: [], capHit: false,
    rematchRequested: false, ...patch,
  };
}

const timer = { timerId: 't1', startedAt: NOW - 7_000, ms: 10_000 };

describe('secrecy', () => {
  const before: Phase[] = PHASES.filter((p) => !['reveal', 'round_score', 'finale', 'rematch_offer', 'ending'].includes(p));
  for (const phase of before) {
    it(`hides the item in ${phase}`, () => {
      const s = state(phase, 4, {
        timer, liveTranscript: 'forty', pendingGuess: { cents: 2500, spokenForm: 'x', rawTranscript: 'x', corrections: 0 },
        pendingItemTexts: { p1: SECRET_RAW }, guesses: [lockedGuess('p2', 2000)],
      });
      const json = JSON.stringify(buildStageState(s, NOW, config));
      for (const secret of [SECRET_NAME, SECRET_RAW, '$34.99', '3499', 'Owala']) expect(json).not.toContain(secret);
    });
  }
  it('hides name and price in the drumroll stage', () => {
    const json = JSON.stringify(buildStageState(state('reveal', 4, { revealStage: 'drumroll' }), NOW, config));
    expect(json).not.toContain('Owala');
    expect(json).not.toContain('34.99');
  });
});

describe('phases', () => {
  it('reveal shows the price at the price stage', () => {
    const s = buildStageState(state('reveal', 4, { revealStage: 'price' }), NOW, config);
    expect(s.reveal).toEqual({ stage: 'price', priceText: '$34.99', itemName: SECRET_NAME, isEstimate: false, sourceLabel: 'Price list' });
    expect(s.mysteryOwner).toBeNull();
    expect(s.timer).toBeNull();
  });
  it('labels web and estimate sources', () => {
    const web: PriceResult = { ...price, source: 'web', evidence: [{ kind: 'web', label: 't', url: 'https://www.target.com/p/1' }] };
    const a = buildStageState(state('reveal', 4, { revealStage: 'price', currentItem: { ...state('reveal').currentItem!, price: web } }), NOW, config);
    expect(a.reveal?.sourceLabel).toBe('Google Search: target.com');
    const est: PriceResult = { ...price, source: 'estimate', isEstimate: true };
    const b = buildStageState(state('reveal', 4, { revealStage: 'price', currentItem: { ...state('reveal').currentItem!, price: est } }), NOW, config);
    expect(b.reveal?.sourceLabel).toBe('Estimate');
    expect(b.reveal?.isEstimate).toBe(true);
  });
  it('round_score matches the fixture shape (4 players)', () => {
    const players = fixturePlayers(4).map((p, i) => ({ ...p, score: [38, 111, 0, 71][i] }));
    const s = buildStageState(
      state('round_score', 4, {
        players, revealStage: 'price', history: [ROUND_EXAMPLE_1],
        guesses: [lockedGuess('p2', 3000), lockedGuess('p3', 4000), lockedGuess('p4', 2500)],
      }),
      NOW, config,
    );
    const fx = stageFixture('round_score', 4);
    expect(s.podiums.map((p) => [p.role, p.guessText, p.guessState, p.delta])).toEqual(
      fx.podiums.map((p) => [p.role, p.guessText, p.guessState, p.delta]),
    );
    expect(s.roundLabel).toBe('ROUND 1 OF 4');
    expect(s.reveal?.stage).toBe('price');
  });
  it('guess_prompt shows a full, stopped timer', () => {
    const s = buildStageState(state('guess_prompt', 4, { timer }), NOW, config);
    expect(s.timer).toEqual({ secondsLeft: 10, total: 10, running: false });
    expect(s.podiums.map((p) => p.role)).toEqual(['owner', 'guesser', 'idle', 'idle']);
    expect(s.mysteryOwner).toBe('Ethan');
  });
  it('guess_listen: running timer, transcript, default caption', () => {
    const s = buildStageState(state('guess_listen', 4, { timer, liveTranscript: 'twenty five...' }), NOW, config);
    expect(s.timer).toEqual({ secondsLeft: 3, total: 10, running: true });
    expect(s.liveTranscript).toBe('twenty five...');
    expect(s.caption).toEqual({ text: 'Listening...', speaker: 'system' });
  });
  it('guess_confirm shows the pending guess', () => {
    const s = buildStageState(
      state('guess_confirm', 4, { timer, pendingGuess: { cents: 2500, spokenForm: 'x', rawTranscript: 'x', corrections: 0 } }),
      NOW, config,
    );
    expect(s.podiums[1]).toMatchObject({ guessText: '$25.00 ?', guessState: 'pending' });
    expect(s.timer).toEqual({ secondsLeft: 3, total: 10, running: false });
    expect(s.liveTranscript).toBeNull();
  });
  it('silent and pass guesses show a dash', () => {
    const silent = { ...lockedGuess('p2', 1), status: 'silent' as const, cents: null };
    const pass = { ...lockedGuess('p3', 1), status: 'pass' as const, cents: null };
    const s = buildStageState(state('guess_silent', 4, { guesses: [silent, pass], guessIndex: 1 }), NOW, config);
    expect(s.podiums[1]).toMatchObject({ guessText: '—', guessState: 'silent' });
    expect(s.podiums[2]).toMatchObject({ guessText: '—', guessState: 'silent' });
  });
  it('item_resolve caption and mystery owner', () => {
    const s = buildStageState(state('item_resolve'), NOW, config);
    expect(s.caption?.text).toBe('Checking the price tag...');
    expect(s.mysteryOwner).toBe('Ethan');
    expect(s.turnOrder[0]).toMatchObject({ done: false, current: true });
  });
  it('rules banner and rematch/ending banners', () => {
    expect(buildStageState(state('rules'), NOW, config).banner).toBe('CLOSEST WITHOUT GOING OVER WINS');
    expect(buildStageState(state('rematch_offer'), NOW, config).banner).toBe('TEXT REMATCH TO PLAY AGAIN');
    expect(buildStageState(state('ending'), NOW, config).banner).toBe('THANKS FOR PLAYING');
  });
  it('finale ranks, champion and recap', () => {
    const players = fixturePlayers(4).map((p, i) => ({ ...p, score: [38, 111, 0, 71][i] }));
    const hist = [ROUND_EXAMPLE_1, { ...ROUND_EXAMPLE_1, ownerId: 'p2' as PlayerId, item: { displayName: 'Hot Wheels', priceCents: 1200, isEstimate: true, source: 'estimate' as const } }];
    const s = buildStageState(state('finale', 4, { players, history: hist }), NOW, config);
    expect(s.finale?.champion).toEqual(['Diego']);
    expect(s.finale?.ranks[0]).toMatchObject({ id: 'p2', place: 1 });
    expect(s.finale?.items).toEqual(['Ethan: Owala FreeSip water bottle $34.99', 'Diego: Hot Wheels $12.00 (estimate)']);
    expect(s.podiums.map((p) => p.role)).toEqual(['idle', 'winner', 'idle', 'idle']);
    expect(s.roundLabel).toBeNull();
  });
  it('shows no finale or reveal elsewhere', () => {
    const s = buildStageState(state('show_item'), NOW, config);
    expect(s.finale).toBeNull();
    expect(s.reveal).toBeNull();
    expect(s.liveTranscript).toBeNull();
  });
});

describe('player counts', () => {
  for (const n of [2, 3, 4] as const) {
    it(`${n} players`, () => {
      const s = buildStageState(state('round_start', n), NOW, config);
      expect(s.podiums).toHaveLength(n);
      expect(s.turnOrder).toHaveLength(n);
      expect(s.roundLabel).toBe(`ROUND 1 OF ${n}`);
    });
  }
});

describe('timer math', () => {
  it('clamps at zero', () => {
    const s = buildStageState(state('guess_listen', 4, { timer: { ...timer, startedAt: NOW - 20_000 } }), NOW, config);
    expect(s.timer?.secondsLeft).toBe(0);
  });
  it('is null outside the guess phases', () => {
    expect(buildStageState(state('reveal', 4, { timer }), NOW, config).timer).toBeNull();
  });
});

describe('join hint, badge and cap clock', () => {
  it('join hint with and without a number', () => {
    const lobby = state('lobby', 4, { players: fixturePlayers(2).slice(0, 1) });
    expect(buildStageState(lobby, NOW, config).joinHint).toBe(`Text "I'm in, I'm [your name]" to (214) 555-0100`);
    expect(buildStageState(lobby, NOW, gameConfig()).joinHint).toBe(`Text "I'm in, I'm [your name]"`);
    expect(buildStageState(state('lobby', 2), NOW, config).joinHint).toBeNull();
    expect(buildStageState(state('rules', 4, { players: fixturePlayers(2).slice(0, 1) }), NOW, config).joinHint).toBeNull();
  });
  it('text mode and lightning', () => {
    const s = buildStageState(state('rules', 4, { textMode: true, lightning: true }), NOW, config);
    expect(s.fallbackBadge).toBe('TEXT MODE');
    expect(s.lightning).toBe(true);
    expect(s.hostSpeaking).toBe(false);
  });
  it('cap clock only in the last 45 seconds', () => {
    const at = (elapsed: number) => buildStageState(state('rules', 4, { callStartAt: NOW - elapsed }), NOW, config).capRemainingMs;
    expect(at(60_000)).toBeNull();
    expect(at(225_000)).toBe(45_000);
    expect(at(224_999)).toBeNull();
    expect(at(250_000)).toBe(20_000);
    expect(at(300_000)).toBe(0);
    expect(buildStageState(state('wait_call', 4, { callStartAt: null }), NOW, config).capRemainingMs).toBeNull();
  });
});


describe('contract regression coverage', () => {
  for (const phase of PHASES) {
    it(`keeps the documented stage shape in ${phase}`, () => {
      const input = state(phase);
      const before = JSON.stringify(input);
      const output = buildStageState(input, NOW, config);
      expect(Object.keys(output).sort()).toEqual(Object.keys(stageFixture(phase)).sort());
      expect(output.phase).toBe(phase);
      expect(output.title).toBe('THE PRICE IS LIVE');
      expect(output.podiums.map(({ id, name, seat, score }) => ({ id, name, seat, score })))
        .toEqual(input.players.map(({ id, name, seat, score }) => ({ id, name, seat, score })));
      expect(JSON.stringify(input)).toBe(before);
    });
  }

  it('uses the first web evidence URL rather than a list or model URL', () => {
    const web: PriceResult = {
      ...price, source: 'web', evidence: [
        { kind: 'list', label: 'reference', url: 'https://reference.example/item' },
        { kind: 'model', label: 'model', url: 'https://model.example/item' },
        { kind: 'web', label: 'missing URL' },
        { kind: 'web', label: 'retailer', url: 'https://www.target.com/p/item' },
        { kind: 'web', label: 'later', url: 'https://later.example/item' },
      ],
    };
    const input = state('reveal', 4, {
      revealStage: 'price', currentItem: { ...state('reveal').currentItem!, price: web },
    });
    expect(buildStageState(input, NOW, config).reveal?.sourceLabel).toBe('Google Search: target.com');
  });

  for (const phase of ['reveal', 'round_score'] as const) {
    for (const revealStage of ['none', 'drumroll'] as const) {
      it(`keeps ${phase}/${revealStage} secret even with scored history`, () => {
        const input = state(phase, 4, {
          revealStage,
          history: [{ ...ROUND_EXAMPLE_1, item: { ...ROUND_EXAMPLE_1.item, displayName: SECRET_NAME } }],
        });
        const output = buildStageState(input, NOW, config);
        expect(output.reveal).toEqual({ stage: revealStage, priceText: '', itemName: '', isEstimate: false, sourceLabel: null });
        for (const secret of [SECRET_NAME, SECRET_RAW, '$34.99']) {
          expect(JSON.stringify(output)).not.toContain(secret);
        }
      });
    }
  }
});
