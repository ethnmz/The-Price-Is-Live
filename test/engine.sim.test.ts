import { describe, expect, it } from 'vitest';
import { fixturePlayers } from '../fixtures/players';
import { playScriptedGame, type ScriptedGameOptions } from '../src/engine/simGame';
import { createHost } from '../src/ai/host/lines';
import { parseGuess } from '../src/speech/parseGuess';
import { spokenAmount } from '../src/speech/spokenAmount';
import { FakeStage, FakeVoice } from '../src/testing/fakes';

function script(count: 2 | 3 | 4 = 4): ScriptedGameOptions {
  return {
    players: fixturePlayers(count),
    items: fixturePlayers(count).map((p) => ({ text: `${p.name} test item`, priceCents: 2000 })),
    guesses: Array.from({ length: count }, () => ({ p1: 20, p2: 20, p3: 20, p4: 20 })),
  };
}
function checkFinished(result: Awaited<ReturnType<typeof playScriptedGame>>, totals: number[], rounds: number) {
  expect(result.finalState.history).toHaveLength(rounds);
  expect(result.finalState.capHit).toBe(false);
  expect(result.finalState.players.map((p) => p.score)).toEqual(totals);
  expect(result.phasesSeen.at(-1)).toBe('wait_call');
  expect(result.phasesSeen).toContain('ending');
  expect(result.resultsCards.map((c) => c.phone).sort()).toEqual(result.finalState.players.map((p) => p.phone).sort());
  expect(new Set(result.resultsCards.map((c) => c.text)).size).toBe(1);
  for (const stage of result.stageStates) {
    if (stage.reveal && stage.reveal.stage !== 'price') {
      expect(stage.reveal.priceText).toBe('');
      expect(stage.reveal.itemName).toBe('');
    }
  }
}

describe('scripted whole games', () => {
  it('plays four rounds with the worked normal and all-over examples', async () => {
    const opts = script();
    opts.items[0].priceCents = 3499;
    opts.items[1].priceCents = 1200;
    opts.guesses[0] = { p2: 30, p3: 40, p4: 25 };
    opts.guesses[1] = { p1: 15, p3: 20, p4: 13 };
    const result = await playScriptedGame(opts);
    // First two totals: [38,178,0,96]; the remaining exact hits add
    // [250,250,125,125], with zero owner stump points.
    checkFinished(result, [288, 428, 125, 221], 4);
    expect(result.finalState.history[0].totals).toEqual({ p1: 38, p2: 111, p3: 0, p4: 71 });
    expect(result.virtualMs).toBeLessThan(270_000);
  });

  it('plays a two-player game', async () => {
    checkFinished(await playScriptedGame(script(2)), [125, 125], 2);
  });

  it('uses only two items in demo mode', async () => {
    const result = await playScriptedGame({ ...script(), demo: true });
    checkFinished(result, [125, 125, 250, 250], 2);
    expect(result.virtualMs).toBeLessThan(120_000);
  });

  it('lets a silent guesser time out and awards no guess points', async () => {
    const opts = script();
    opts.guesses = opts.guesses.map((g) => ({ ...g, p2: 'silent' }));
    const result = await playScriptedGame(opts);
    checkFinished(result, [375, 0, 375, 375], 4);
    expect(result.finalState.history[0].guesses.find((g) => g.playerId === 'p2')?.status).toBe('silent');
  });

  it('gives everyone the lowest-over bonus when all guesses tie over', async () => {
    const opts = script();
    opts.guesses = opts.guesses.map(() => ({ p1: 25, p2: 25, p3: 25, p4: 25 }));
    // Each owner gets 50 stump points; each guesser gets three 25 point bonuses.
    const result = await playScriptedGame(opts);
    checkFinished(result, [125, 125, 125, 125], 4);
    expect(result.finalState.history.every((r) => r.winnerReason === 'lowest_over')).toBe(true);
  });

  it('shares tied round wins and the championship', async () => {
    const opts = script();
    opts.items.forEach((item) => { item.priceCents = 5000; });
    opts.guesses = opts.guesses.map(() => ({ p1: 45, p2: 45, p3: 45, p4: 45 }));
    // Three rounds at 90 + 25, plus 20 stump points as owner.
    const result = await playScriptedGame(opts);
    checkFinished(result, [365, 365, 365, 365], 4);
    expect(result.finalState.history.every((r) => r.winnerIds.length === 3)).toBe(true);
    expect(result.resultsCards[0].text).toContain('tie for the win');
  });

  it('accepts text guesses and real host/parser/stage overrides', async () => {
    const opts = script(2);
    const voice = new FakeVoice();
    const stage = new FakeStage();
    const host = createHost({ rng: () => 0 });
    opts.guesses = [{ p2: { text: '20' } }, { p1: 'twenty dollars' }];
    const result = await playScriptedGame({ ...opts, ports: { host, voice, stage }, deps: { parseGuess, spokenAmount } });
    checkFinished(result, [125, 125], 2);
    expect(result.finalState.history[0].guesses[0].channel).toBe('text');
    expect(stage.states.length).toBeGreaterThan(0);
    expect(voice.spoken.some((line) => line.text.includes('connect.hello'))).toBe(false);
  });

  it('stops at the safety limit when speech never completes', async () => {
    const voice = new FakeVoice();
    voice.speak = () => new Promise<void>(() => {});
    await expect(playScriptedGame({ ...script(2), ports: { voice }, safetyLimitMs: 1000 })).rejects.toThrow('safety limit');
  });
});
