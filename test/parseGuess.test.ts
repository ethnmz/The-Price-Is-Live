import { describe, expect, it } from 'vitest';
import { parseGuess } from '../src/speech/parseGuess';
import { parseYesNo } from '../src/speech/yesno';

const amountRows: Array<[string, number, boolean?]> = [
  ['twenty five bucks', 2500],
  ['twenty-five dollars', 2500],
  ['25', 2500],
  ['$25.50', 2550],
  ["um, I'll say thirty", 3000],
  ['about thirty-five dollars', 3500],
  ['a hundred', 10000],
  ['one hundred and twenty', 12000],
  ['fifteen hundred', 150000],
  ['a grand', 100000],
  ['five k', 500000],
  ['twelve ninety nine', 1299],
  ['nineteen ninety-five', 1995],
  ['twenty five fifty', 2550],
  ['twelve oh five', 1205],
  ['two fifty', 250, true],
  ['thirty... no, forty', 4000],
  ['wait actually forty five', 4500],
  ['thirty to forty', 3000, true],
  ['twelve dollars and ninety nine cents', 1299],
  ['zero', 100],
  ['nothing', 100],
  ['free', 100],
  ['a buck', 100],
  ['ten thousand dollars', 1000000],
];

describe('parseGuess: SPEC 9.5 table', () => {
  for (const [text, cents, amb] of amountRows) {
    it(`"${text}" -> ${cents}`, () => {
      const r = parseGuess(text);
      expect(r.kind).toBe('amount');
      expect(r.cents).toBe(cents);
      expect(r.ambiguous).toBe(!!amb);
      expect(r.spokenForm).toBeTruthy();
    });
  }
  for (const text of ['pass', 'no idea']) {
    it(`"${text}" -> pass`, () => expect(parseGuess(text).kind).toBe('pass'));
  }
  for (const text of ['yes', 'yeah that\'s right', 'locked', 'mm-hm']) {
    it(`"${text}" -> yes`, () => expect(parseGuess(text).kind).toBe('yes'));
  }
  for (const text of ['no', 'nope', 'wrong']) {
    it(`"${text}" -> no`, () => expect(parseGuess(text).kind).toBe('no'));
  }
  it('"that\'s too low lol" -> none', () => expect(parseGuess("that's too low lol").kind).toBe('none'));
  it('"I want a hundred thousand" -> none (above cap)', () => {
    expect(parseGuess('I want a hundred thousand').kind).toBe('none');
  });
});

describe('parseGuess: extra cases', () => {
  const extra: Array<[string, number, boolean?]> = [
    ['1,200', 120000],
    ['$1,200.50', 120050],
    ['$1.2k', 120000],
    ['5k', 500000],
    ['a couple bucks', 200],
    ['twelve bucks fifty', 1250],
    ['thirty bucks fifty cents', 3050],
    ['twelve five', 500, true],
    ['  TWENTY-FIVE DOLLARS!!!  ', 2500],
    ['Hmm... okay, maybe like forty?', 4000],
    ['thirty or forty', 3000, true],
    ['99999', 9999900],
    ['two thousand five hundred', 250000],
    ['i mean fifty', 5000],
    ['sixty, sorry, seventy', 7000],
    ['make that eighty', 8000],
    ['a thousand', 100000],
    ['two grand', 200000],
    ['five dollars', 500],
    ['twelve ninety nine dollars', 1299],
    ['fifty cents', 100],
    ['ten twenty', 1020],
    ['twenty five and thirty', 2530],
  ];
  for (const [text, cents, amb] of extra) {
    it(`"${text}" -> ${cents}`, () => {
      const r = parseGuess(text);
      expect(r.kind).toBe('amount');
      expect(r.cents).toBe(cents);
      expect(r.ambiguous).toBe(!!amb);
    });
  }

  it('empty string is none', () => expect(parseGuess('').kind).toBe('none'));
  it('emoji only is none', () => expect(parseGuess('😀🎉').kind).toBe('none'));
  it('"point five" is none', () => expect(parseGuess('point five').kind).toBe('none'));
  it('"twelve point five" is none', () => expect(parseGuess('twelve point five').kind).toBe('none'));
  it('above the cap is none', () => expect(parseGuess('100000 dollars').kind).toBe('none'));
  it('yes plus an amount is an amount', () => {
    const r = parseGuess('yes, thirty');
    expect(r.kind).toBe('amount');
    expect(r.cents).toBe(3000);
  });
  it('"no, thirty" is a correction', () => expect(parseGuess('no, thirty').cents).toBe(3000));
  it('"i don\'t know" is pass', () => expect(parseGuess("I don't know").kind).toBe('pass'));
  it('"no clue" is pass', () => expect(parseGuess('no clue!').kind).toBe('pass'));
  it('confidence is multiplied by 0.8 when ambiguous', () => {
    expect(parseGuess('two fifty', 0.5).confidence).toBeCloseTo(0.4);
    expect(parseGuess('thirty', 0.5).confidence).toBeCloseTo(0.5);
  });
  it('sets spokenForm', () => {
    expect(parseGuess('twelve ninety nine').spokenForm).toBe('twelve dollars and ninety-nine cents');
  });
});

describe('parseYesNo', () => {
  it('handles the word lists', () => {
    for (const w of ['yes', 'yeah', 'yep', 'yup', 'correct', 'right', "that's right", 'locked', 'lock it', 'sure', 'uh-huh', 'mm-hm', 'affirmative']) {
      expect(parseYesNo(w)).toBe('yes');
    }
    for (const w of ['no', 'nope', 'wrong', 'not right', 'nah']) expect(parseYesNo(w)).toBe('no');
  });
  it('"not right" is a no', () => expect(parseYesNo("that's not right")).toBe('no'));
  it('returns null otherwise', () => {
    expect(parseYesNo('')).toBeNull();
    expect(parseYesNo('banana')).toBeNull();
    expect(parseYesNo('know')).toBeNull();
  });
});
