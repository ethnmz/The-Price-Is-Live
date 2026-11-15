import { describe, expect, it } from 'vitest';
import { fixturePlayers, ROUND_EXAMPLE_1, ROUND_EXAMPLE_2 } from '../fixtures/players';
import { buildResultsCard, MSG, REMATCH_LINE } from '../src/engine/messages';
import type { RoundResult } from '../src/contracts/types';

describe('MSG templates (SPEC 11)', () => {
  it('match the spec text exactly', () => {
    expect(MSG.unknown()).toBe('Hey! I\'m the host of THE PRICE IS LIVE 🎤 Text me "I\'m in, I\'m {yourName}" to join a game.');
    expect(MSG.joinReply('Diego', 2, ['Ethan', 'Diego'])).toBe(
      '🎉 You\'re in, Diego! You\'re player 2. Players so far: Ethan, Diego. When it\'s your turn, I\'ll text you to send your item (like "Owala bottle"). The first player can text "start" to begin.',
    );
    expect(MSG.calling()).toBe('📞 Calling you now! Pick up the FaceTime to play THE PRICE IS LIVE.');
    expect(MSG.cantConnect()).toBe('Hmm, I couldn\'t connect the call. Try FaceTiming this number, or text "start" again.');
    expect(MSG.itemPrompt('Akshi', 'first')).toBe(
      'Akshi, you\'re up first! Text me the item you\'re holding up, like "Owala bottle". Brand and size help! 🛍️',
    );
    expect(MSG.itemPrompt('Akshi', 'next')).toContain("you're up next!");
    expect(MSG.itemReceived('Owala bottle')).toBe('Got it: Owala bottle. 👍 Hold it up when the host calls you!');
    expect(MSG.itemReceivedUnsure('Owala bottle')).toBe(
      'Got it: Owala bottle. I\'m not 100% sure on this one, so I\'ll call the price an estimate. Hold it up when the host calls you!',
    );
    expect(MSG.itemTooLate()).toBe(
      'Thanks! That came in a little late, so the host used the camera. Next time send it before your turn.',
    );
    expect(MSG.guessReceived('$25.00')).toBe('Got your guess: $25.00. 🔒');
    expect(MSG.badGuess()).toBe('I need a number, like "25" or "$12.99".');
    expect(MSG.rematch()).toBe("🔁 Want a rematch? Reply REMATCH and I'll FaceTime everyone back.");
    expect(MSG.rematch()).toBe(REMATCH_LINE);
    expect(MSG.rematchAck()).toBe('You got it! Calling everyone back in a few seconds. 📞');
  });
  it('callDropped prefixes the card body', () => {
    expect(MSG.callDropped('BODY')).toBe('😬 The call dropped. Here are the scores so far:\nBODY');
  });
  it('gameFull and needTwo are non-empty and short', () => {
    expect(MSG.gameFull()).toContain('full');
    expect(MSG.needTwo()).toContain('at least 2 players');
  });
});

describe('buildResultsCard', () => {
  it('4 players, with an estimate tag', () => {
    const card = buildResultsCard([ROUND_EXAMPLE_1, ROUND_EXAMPLE_2], fixturePlayers(4));
    const lines = card.split('\n');
    expect(lines[0]).toBe('🏆 THE PRICE IS LIVE: FINAL SCOREBOARD');
    expect(lines.filter((l) => /^(🥇|🥈|🥉|4️⃣) /.test(l))).toHaveLength(4);
    expect(card).toContain("• Ethan's Owala FreeSip water bottle: $34.99\n");
    expect(card).toContain("• Diego's Hot Wheels 5-car pack: $12.00 (estimate)");
    expect(card.endsWith(REMATCH_LINE)).toBe(true);
    expect(card.length).toBeLessThan(4000);
  });

  it('blocks are separated by exactly one blank line', () => {
    const card = buildResultsCard([ROUND_EXAMPLE_1], fixturePlayers(4));
    expect(card.split('\n\n')).toHaveLength(3);
    expect(card).not.toContain('\n\n\n');
  });

  it('3 and 2 players skip missing lines', () => {
    const one: RoundResult = { ...ROUND_EXAMPLE_1, guesses: [], totals: { p1: 38, p2: 111, p3: 5, p4: 0 } };
    const three = buildResultsCard([one], fixturePlayers(3));
    expect(three).toContain('🥉');
    expect(three).not.toContain('4️⃣');
    const two = buildResultsCard([one], fixturePlayers(2));
    expect(two).toContain('🥈');
    expect(two).not.toContain('🥉');
    expect(two).not.toContain('Akshi');
  });

  it('single winner line', () => {
    const card = buildResultsCard([ROUND_EXAMPLE_1], fixturePlayers(4));
    expect(card).toContain('👑 Diego wins!');
    expect(card).toContain('🥇 Diego: 111 pts');
  });

  it('a tie for first gives both the gold medal', () => {
    const tied: RoundResult = { ...ROUND_EXAMPLE_1, totals: { p1: 50, p2: 100, p3: 100, p4: 10 } };
    const card = buildResultsCard([tied], fixturePlayers(4));
    expect(card).toContain('🥇 Diego: 100 pts');
    expect(card).toContain('🥇 Akshi: 100 pts');
    expect(card).toContain('🥉 Ethan: 50 pts');
    expect(card).toContain('👑 Diego and Akshi tie for the win!');
  });

  it('adds the hard-cap line only when capped', () => {
    const capped = buildResultsCard([ROUND_EXAMPLE_1], fixturePlayers(4), { cap: { roundsDone: 2, totalRounds: 4 } });
    expect(capped).toContain('⏱️ Time ran out after 2 of 4 rounds.\n' + REMATCH_LINE);
    expect(buildResultsCard([ROUND_EXAMPLE_1], fixturePlayers(4))).not.toContain('⏱️');
  });
});
