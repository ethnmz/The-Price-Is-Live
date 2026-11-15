import { describe, expect, it } from 'vitest';
import items from '../fixtures/reference-items.sample.json';
import { cleanItemText } from '../src/ai/cleanText';
import { LIST_ACCEPT, LIST_MAYBE, matchList } from '../src/ai/matchList';

const examples: [string, number][] = [
  ['owala bottle', 1], ['owalla bottle', 1], ['owala', 1], ['my Owala bottle!!', 1],
  ['bottle owala', 1], ['stanley 40 oz', 2], ['stanley cup', 2], ['quencher stanley', 2],
  ['hydroflask', 3], ['hydro flask bottle', 3], ['ti-84', 4], ['graphing calculator', 4],
  ['scientific calculator', 5], ['ti 30', 5], ['airpods pro', 6], ['airpod pros', 6],
  ['air pods', 7], ['iphone charger', 8], ['apple 20w usb c power adapter', 8],
  ['anker power bank', 9], ['sharpie markers', 10], ['crayola', 11],
  ['five star notebook', 12], ['nacho cheese doritos', 13], ['takis fuego', 14],
  ['celsius 12 pack', 15], ['keurig mini', 16], ['colgate toothpaste', 17],
  ['laundry pods', 18], ['uno cards', 19],
];

describe('cleanItemText', () => {
  it.each([
    ['my Owala bottle!!', 'owala bottle', false],
    ['This is a Stanley cup', 'stanley cup', false],
    ["it's an Apple charger", 'apple charger', false],
    ['I have some crayons', 'crayons', false],
    ['the TI-84 Plus CE', 'ti 84 plus ce', false],
    ['🧴 Colgate 5.1 oz ✨', 'colgate 5.1 oz', false],
    ['  Hydro   Flask  ', 'hydro flask', false],
    ["Rubik’s Cube 3x3", 'rubiks cube 3x3', false],
    ['Apple 20W USB-C', 'apple 20w usb c', false],
    ['Takis 9.9oz', 'takis 9.9oz', false],
    ['', '', true], ['   ', '', true], ['1234', '1234', true],
    ['✨!!!', '', true], ['nothing', 'nothing', true], ['idk', 'idk', true],
    ['you idiot', 'you idiot', true], ['a'.repeat(81), 'a'.repeat(81), true],
    ['my a an the some', '', true], ['a'.repeat(80), 'a'.repeat(80), false],
  ])('cleans %j', (raw, clean, rejected) => {
    expect(cleanItemText(raw)).toEqual({ clean, rejected });
  });

  it('uses whole words for moderation and filler', () => {
    expect(cleanItemText('classic nothingness thermometer').rejected).toBe(false);
    expect(cleanItemText('some faggot').rejected).toBe(true);
    expect(cleanItemText('this is my nothing').rejected).toBe(true);
  });
});

describe('matchList', () => {
  it('ranks at least 27 of 30 sample descriptions correctly', () => {
    expect(examples).toHaveLength(30);
    const hits = examples.filter(([raw, number]) =>
      matchList(cleanItemText(raw).clean, items)[0].item.id === `ref_s${String(number).padStart(3, '0')}`);
    expect(hits.length).toBeGreaterThanOrEqual(27);
  });

  it.each(examples)('ranks %s first', (raw, number) => {
    expect(matchList(cleanItemText(raw).clean, items)[0].item.id)
      .toBe(`ref_s${String(number).padStart(3, '0')}`);
  });

  it('matches the remaining sample item and exact canonical names', () => {
    expect(matchList('rubix cube', items)[0].item.id).toBe('ref_s020');
    for (const item of items) {
      const match = matchList(item.name, items)[0];
      expect(match.item.id).toBe(item.id);
      expect(match.score).toBe(1);
    }
  });

  it('keeps unrelated scores below maybe and checks alias boundaries', () => {
    expect(matchList('garden hose', items, 20).every(m => m.score < LIST_MAYBE)).toBe(true);
    expect(matchList('unoriginal', items).find(m => m.item.id === 'ref_s019')?.score ?? 0).toBeLessThan(LIST_MAYBE);
    expect(matchList('owala bottle blue', items)[0].score).toBe(0.9);
    expect(LIST_ACCEPT).toBe(0.85);
  });

  it('caps conflicts and preserves matching sizes and units', () => {
    const conflict = matchList('owala 32 oz', items)[0];
    expect(conflict.item.id).toBe('ref_s001');
    expect(conflict.sizeConflict).toBe(true);
    expect(conflict.score).toBe(0.8);
    expect(matchList('owala 24oz', items)[0].sizeConflict).toBe(false);
    expect(matchList('owala 32 ml', items)[0].sizeConflict).toBe(false);
    expect(matchList('doritos 14.5 oz', items)[0].sizeConflict).toBe(false);
    expect(matchList('doritos 14 oz', items)[0].sizeConflict).toBe(true);
  });

  it.each(['oz', 'ml', 'l', 'pack', 'count', 'inch', 'gb', 'w'])('detects %s size conflicts in sizeNote', unit => {
    const item = { ...items[0], name: 'Acme bottle', aliases: ['acme'], sizeNote: `24 ${unit}` };
    expect(matchList(`acme 32${unit}`, [item])[0]).toMatchObject({ sizeConflict: true, score: 0.8 });
    expect(matchList(`acme 24 ${unit}`, [item])[0].sizeConflict).toBe(false);
  });

  it('uses deterministic ties, bounded scores and safe limits without mutation', () => {
    const original = JSON.stringify(items);
    const result = matchList('garden hose', [...items].reverse(), 20);
    expect(result.map(m => m.item.id)).toEqual(items.map(item => item.id).sort());
    expect(result.every(m => m.score >= 0 && m.score <= 1)).toBe(true);
    expect(matchList('', items).every(m => m.score === 0)).toBe(true);
    expect(matchList('owala', items)).toHaveLength(5);
    expect(matchList('owala', items, 2)).toHaveLength(2);
    expect(matchList('owala', items, -1)).toEqual([]);
    expect(matchList('owala', [])).toEqual([]);
    expect(JSON.stringify(items)).toBe(original);
  });

  it('allows one edit on long words but does not fuzzy-match numbers or short words', () => {
    expect(matchList('owalla bottle', items)[0].score).toBeGreaterThanOrEqual(LIST_ACCEPT);
    expect(matchList('colgte', items)[0].item.id).toBe('ref_s017');
    expect(matchList('ti 85', [items[3]])[0].score).toBeLessThan(LIST_ACCEPT);
    expect(matchList('uno', [items[18]])[0].score).toBe(1);
  });
});
