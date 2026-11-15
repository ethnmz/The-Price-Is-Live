// Sanity checks on the frozen contracts, fixtures and fakes. Planner-owned: do not edit in a task.
import { describe, expect, it } from 'vitest';
import sampleItems from '../fixtures/reference-items.sample.json';
import { fixturePlayers, ROUND_EXAMPLE_1, ROUND_EXAMPLE_2 } from '../fixtures/players';
import { allStageFixtures, stressStageFixture } from '../fixtures/stage-states';
import { gameConfig, loadEnv } from '../src/config';
import { emotionFor, formatCents, HOST_LINE_KEYS, HOST_LINE_VARS, last4, PHASES, toE164 } from '../src/contracts';
import type { ReferenceItem } from '../src/contracts';
import { buildResultsCard, MSG } from '../src/engine/messages';
import { addPlayer, parseJoinText } from '../src/engine/registry';
import { fakeParseGuess, makeFakeDeps, makeFakePorts } from '../src/testing/fakes';

describe('contracts', () => {
  it('money helpers', () => {
    expect(formatCents(3499)).toBe('$34.99');
    expect(formatCents(100000)).toBe('$1,000.00');
    expect(formatCents(99)).toBe('$0.99');
    expect(last4('+12145550101')).toBe('0101');
    expect(toE164('(214) 555-0102')).toBe('+12145550102');
    expect(toE164('hello')).toBeNull();
  });

  it('every host line key has vars and an emotion', () => {
    for (const key of HOST_LINE_KEYS) {
      expect(HOST_LINE_VARS[key]).toBeDefined();
      expect(['hype', 'drumroll', 'warm']).toContain(emotionFor(key));
    }
  });

  it('config loads with no env at all', () => {
    const env = loadEnv({});
    expect(env.stageW).toBe(960);
    expect(env.geminiApiKey).toBe('');
    expect(gameConfig({ demo: true }).lobbySettleMs).toBe(1000);
    expect(gameConfig().hardCapMs).toBe(270000);
  });

  it('stage fixtures cover every phase for 2, 3 and 4 players', () => {
    const all = allStageFixtures();
    expect(all.length).toBe(PHASES.length * 3);
    expect(stressStageFixture().podiums.every((p) => p.name.length === 12)).toBe(true);
  });

  it('sample reference items are well formed', () => {
    const items = sampleItems as ReferenceItem[];
    expect(items.length).toBe(20);
    for (const it of items) {
      expect(it.priceCents).toBeGreaterThanOrEqual(100);
      expect(it.aliases.length).toBeGreaterThan(0);
    }
  });
});

describe('planner stubs', () => {
  it('join texts', () => {
    expect(parseJoinText("I'm in, I'm Diego")).toEqual({ isJoin: true, name: 'Diego' });
    expect(parseJoinText('im in its akshi')).toEqual({ isJoin: true, name: 'Akshi' });
    expect(parseJoinText('im in')).toEqual({ isJoin: true, name: null });
    expect(parseJoinText('in - Aditri')).toEqual({ isJoin: true, name: 'Aditri' });
    expect(parseJoinText('Owala bottle').isJoin).toBe(false);
  });

  it('roster: max 4, first is main, duplicates ignored', () => {
    let players = fixturePlayers(2).slice(0, 0);
    for (const [i, name] of ['A', 'B', 'C', 'D'].entries()) {
      const r = addPlayer(players, `+1214555010${i}`, name, i);
      expect(r.outcome).toBe('joined');
      players = r.players;
    }
    expect(players[0].isMain).toBe(true);
    expect(addPlayer(players, '+12145550109', 'E', 9).outcome).toBe('full');
    expect(addPlayer(players, '+12145550100', null, 9).outcome).toBe('duplicate');
  });

  it('results card matches the template', () => {
    const card = buildResultsCard([ROUND_EXAMPLE_1, ROUND_EXAMPLE_2], fixturePlayers(4));
    expect(card).toBe(
      [
        '🏆 THE PRICE IS LIVE: FINAL SCOREBOARD',
        '🥇 Diego: 178 pts',
        '🥈 Aditri: 96 pts',
        '🥉 Ethan: 38 pts',
        '4️⃣ Akshi: 0 pts',
        '',
        '🛍️ THE ITEMS AND REAL PRICES',
        "• Ethan's Owala FreeSip water bottle: $34.99",
        "• Diego's Hot Wheels 5-car pack: $12.00 (estimate)",
        '',
        '👑 Diego wins!',
        "🔁 Want a rematch? Reply REMATCH and I'll FaceTime everyone back.",
      ].join('\n'),
    );
    expect(MSG.guessReceived('$25.00')).toBe('Got your guess: $25.00. 🔒');
  });

  it('fakes work', async () => {
    const ports = makeFakePorts({ 'owala bottle': { name: 'Owala FreeSip water bottle', cents: 2799 } });
    const price = await ports.pricing.price({ itemId: 'r1', ownerId: 'p1', origin: 'text', rawText: 'Owala bottle' });
    expect(price.priceCents).toBe(2799);
    expect(fakeParseGuess('$25.50').cents).toBe(2550);
    expect(fakeParseGuess('yes').kind).toBe('yes');
    expect(makeFakeDeps().line('guess.prompt', { name: 'Diego' })).toBe('guess.prompt|name=Diego');
  });
});
