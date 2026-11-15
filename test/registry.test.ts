import { describe, expect, it } from 'vitest';
import { addPlayer, cleanName, parseJoinText } from '../src/engine/registry';
import { FIXTURE_PHONES } from '../fixtures/players';

describe('parseJoinText', () => {
  const joins: Array<[string, string | null]> = [
    ["I'm in, I'm Diego", 'Diego'],
    ['im in', null],
    ["Im in it's akshi", 'Akshi'],
    ['in - Aditri', 'Aditri'],
    ["I'm in! this is ETHAN", 'Ethan'],
    ['I’m in, I’m Diego', 'Diego'],
    ['I’m in, it’s Akshi', 'Akshi'],
    ['  I   am   in   my name is   sam  ', 'Sam'],
    ['in', null],
    ['IN 🎉', null],
    ['I\'m in 🎉🎉 I\'m Priya 😎', 'Priya'],
    ["We're in, we're Jo", 'Jo'],
    ['count me in, Marcus', 'Marcus'],
    ["i'm in, I'm Mary-Jane", 'Mary-Jane'],
    ["in, I'm O'Brien", "O'Brien"],
    ["I'm in, I'm Bartholomew Fitzgerald", 'Bartholomew'],
    ["I'm in, I'm Wolfeschlegelstein", 'Wolfeschlege'],
    ['In. Zoe', 'Zoe'],
  ];
  it.each(joins)('parses %j', (text, name) => {
    expect(parseJoinText(text)).toEqual({ isJoin: true, name });
  });

  it.each(['Owala bottle', 'start', '25', 'interesting', 'in-ear headphones', 'REMATCH', '', 'hello in there', 'insulated cup'])(
    'does not parse %j as a join',
    (text) => {
      expect(parseJoinText(text)).toEqual({ isJoin: false, name: null });
    },
  );
});

describe('cleanName', () => {
  it('title-cases and trims', () => {
    expect(cleanName('  eTHAN ')).toBe('Ethan');
  });
  it('cuts at a word when it fits', () => {
    expect(cleanName('anna maria louise')).toBe('Anna Maria');
  });
  it('cuts at 12 characters for one long word', () => {
    expect(cleanName('abcdefghijklmnop')).toBe('Abcdefghijkl');
  });
  it('never returns more than 12 characters', () => {
    expect(cleanName('a very long name indeed').length).toBeLessThanOrEqual(12);
  });
  it('handles empty input', () => {
    expect(cleanName('')).toBe('');
  });
});

describe('addPlayer', () => {
  const [a, b, c, d] = FIXTURE_PHONES;
  it('first player is main, seats and ids follow join order', () => {
    const r1 = addPlayer([], a, 'Ethan', 1);
    expect(r1.outcome).toBe('joined');
    expect(r1.player).toMatchObject({ id: 'p1', seat: 0, isMain: true, name: 'Ethan', score: 0, joinedAt: 1 });
    const r2 = addPlayer(r1.players, b, 'Diego', 2);
    expect(r2.player).toMatchObject({ id: 'p2', seat: 1, isMain: false });
  });
  it('same phone twice is a duplicate', () => {
    const r1 = addPlayer([], a, 'Ethan', 1);
    const r2 = addPlayer(r1.players, a, 'Ethan', 2);
    expect(r2.outcome).toBe('duplicate');
    expect(r2.players).toHaveLength(1);
    expect(addPlayer(r1.players, a, null, 3).outcome).toBe('duplicate');
  });
  it('same phone with a new name renames', () => {
    const r1 = addPlayer([], a, 'Ethan', 1);
    const r2 = addPlayer(r1.players, a, 'Eth', 2);
    expect(r2.outcome).toBe('renamed');
    expect(r2.players[0].name).toBe('Eth');
    expect(r2.players[0].isMain).toBe(true);
  });
  it('a 5th phone is full', () => {
    let ps = addPlayer([], a, 'A', 1).players;
    ps = addPlayer(ps, b, 'B', 2).players;
    ps = addPlayer(ps, c, 'C', 3).players;
    ps = addPlayer(ps, d, 'D', 4).players;
    const r = addPlayer(ps, '+12145550105', 'E', 5);
    expect(r.outcome).toBe('full');
    expect(r.player).toBeNull();
    expect(r.players).toHaveLength(4);
  });
  it('gives a default name when none was given', () => {
    expect(addPlayer([], a, null, 1).player?.name).toBe('Player 1');
  });
  it('does not mutate the input array', () => {
    const ps = addPlayer([], a, 'A', 1).players;
    addPlayer(ps, b, 'B', 2);
    expect(ps).toHaveLength(1);
  });
});
