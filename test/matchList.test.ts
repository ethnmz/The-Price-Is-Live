import { describe, expect, it } from 'vitest';
import items from '../fixtures/reference-items.sample.json';
import { cleanItemText } from '../src/ai/cleanText';
import { LIST_ACCEPT, LIST_MAYBE, matchList } from '../src/ai/matchList';

const queries: [string, number][] = [
  ['owala bottle', 1], ['owalla bottle', 1], ['owala', 1], ['my Owala bottle!!', 1],
  ['bottle owala', 1], ['stanley 40 oz', 2], ['stanley cup', 2], ['quencher stanley', 2],
  ['hydroflask', 3], ['hydro flask 32 oz', 3], ['ti-84', 4], ['graphing calculator', 4],
  ['scientific calculator', 5], ['airpods pro', 6], ['airpod pros', 6], ['airpods', 7],
  ['iphone charger', 8], ['anker power bank', 9], ['sharpies', 10], ['crayola', 11],
  ['spiral notebook', 12], ['nacho cheese doritos', 13], ['takis fuego', 14],
  ['celsius 12 pack', 15], ['keurig mini', 16], ['toothpaste', 17], ['laundry pods', 18],
  ['uno cards', 19], ['rubix cube', 20], ['crayolla crayons', 11],
];

describe('sample list ranking', () => {
  it.each(queries)('%s ranks reference %i first', (query, number) => {
    expect(matchList(cleanItemText(query).clean, items)[0]?.item.id)
      .toBe(`ref_${String(number).padStart(4, '0')}`);
  });
  it('keeps unrelated scores below the maybe threshold', () => {
    expect(matchList('garden hose', items, 20).every(hit => hit.score < LIST_MAYBE)).toBe(true);
  });
  it('exports the contract thresholds', () => {
    expect([LIST_ACCEPT, LIST_MAYBE]).toEqual([0.85, 0.6]);
  });
  it('caps an exact alias with conflicting size', () => {
    const hit = matchList('owala 32 oz', items)[0]!;
    expect(hit.item.id).toBe('ref_0001');
    expect(hit.sizeConflict).toBe(true);
    expect(hit.score).toBe(0.8);
  });
  it.each(['oz', 'ml', 'l', 'pack', 'count', 'inch', 'gb', 'w'])('detects %s sizes', unit => {
    const item = { ...items[0]!, name: 'Widget', aliases: ['widget'], sizeNote: `24${unit}` };
    expect(matchList(`widget 32${unit}`, [item])[0]?.sizeConflict).toBe(true);
    expect(matchList(`widget 24 ${unit}`, [item])[0]?.sizeConflict).toBe(false);
  });
  it('preserves decimal sizes and compares only the same units', () => {
    expect(matchList('doritos 14.5 oz', items)[0]?.sizeConflict).toBe(false);
    expect(matchList('owala 24 ml', items)[0]?.sizeConflict).toBe(false);
  });
  it('uses whole words for containment and returns exact scores', () => {
    expect(matchList('owala', items)[0]?.score).toBe(1);
    expect(matchList('red owala bottle', items)[0]?.score).toBe(0.9);
    expect(matchList('owalabottle', items)[0]?.score).toBeLessThan(0.9);
  });
  it('handles empty input, limits, ties and does not mutate the list', () => {
    const reversed = [...items].reverse();
    expect(matchList('', reversed).map(hit => hit.item.id)).toEqual(items.slice(0, 5).map(item => item.id));
    expect(matchList('', reversed).every(hit => hit.score === 0)).toBe(true);
    expect(reversed[0]?.id).toBe('ref_0020');
    expect(matchList('owala', items, 0)).toEqual([]);
    expect(matchList('owala', items, -1)).toEqual([]);
    expect(matchList('owala', [], 5)).toEqual([]);
    expect(matchList('owala', items, 2)).toHaveLength(2);
  });
});

const cleaning: [string, string, boolean][] = [
  ['my Owala bottle!!', 'owala bottle', false],
  ['This is a Stanley cup', 'stanley cup', false],
  ["it's an iPhone charger", 'iphone charger', false],
  ['I have some UNO cards', 'uno cards', false],
  ['the TI-84 Plus CE', 'ti 84 plus ce', false],
  ['🥤 Owala 💧24 oz', 'owala 24 oz', false],
  ['  Hydro   Flask  ', 'hydro flask', false],
  ['Doritos 14.5 oz', 'doritos 14.5 oz', false],
  ['Apple 20W USB-C', 'apple 20w usb c', false],
  ["Rubik’s Cube 3x3", 'rubiks cube 3x3', false],
  ['', '', true], ['!!!', '', true], ['123 456', '123 456', true],
  ['my a an the some', '', true], ['nothing', 'nothing', true], ['idk', 'idk', true],
  ['you idiot', 'you idiot', true], ['asshole', 'asshole', true],
  ['x'.repeat(81), 'x'.repeat(81), true],
  ['x'.repeat(80), 'x'.repeat(80), false],
];
describe('cleanItemText', () => {
  it.each(cleaning)('cleans %s', (raw, clean, rejected) => {
    expect(cleanItemText(raw)).toEqual({ clean, rejected });
  });
});
