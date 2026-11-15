// Deterministic spoken-guess parser (SPEC 9.3 to 9.5). No AI calls.
//
// TO VERIFY ON THE REAL LINE: run a few real phone transcripts through it
// (STT may write numbers as "25" or "twenty five", and may add odd punctuation).
import type { ParsedGuess } from '../contracts';
import { parseYesNo } from './yesno';
import { spokenAmount } from './spokenAmount';

const MIN_CENTS = 100;
const MAX_CENTS = 9_999_900;

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const THOUSANDS = new Set(['thousand', 'grand', 'k']);
const ZEROES = new Set(['zero', 'nothing', 'free']);
const PASS_PHRASES = ['pass', 'skip', 'i dont know', 'no idea', 'i have no idea', 'no clue'];

type Item =
  | { t: 'NUM'; value: number; isInt: boolean }
  | { t: 'DOLLARS' | 'CENTS' | 'OH' | 'RANGE' | 'POINT' };

interface Candidate { cents: number; ambiguous: boolean }

/** Lowercase, remove commas inside numbers and apostrophes, split into tokens. */
function tokenize(text: string): string[] {
  let s = text.toLowerCase();
  while (/\d,\d{3}/.test(s)) s = s.replace(/(\d),(\d{3})/g, '$1$2');
  s = s.replace(/['’]/g, '').replace(/[^a-z0-9$.]+/g, ' ');
  const out: string[] = [];
  for (const raw of s.split(' ')) {
    const t = raw.replace(/\.+$/, '').replace(/^\.+(?!\d)/, '');
    if (t && t !== '$') out.push(t);
  }
  return out;
}

/** "a hundred" -> "one hundred", "a couple" -> "two". Keeps the token list the same length. */
function softenArticles(tokens: string[]): string[] {
  return tokens.map((t, i) => {
    if (t === 'couple') return 'two';
    const next = tokens[i + 1];
    if (t === 'a' && next && (['hundred', 'thousand', 'grand', 'k', 'buck', 'bucks'].includes(next))) return 'one';
    return t;
  });
}

function isNumberWord(w: string | undefined): boolean {
  return !!w && (w in UNITS || w in TEENS || w in TENS || w === 'hundred' || THOUSANDS.has(w));
}

/** Read one run of number words that belong together. Returns null if none start here. */
function readWordNumber(tokens: string[], start: number): { value: number; next: number } | null {
  let total = 0;
  let cur = 0;
  let used = 0;
  let i = start;
  while (i < tokens.length) {
    const w = tokens[i];
    if (w in UNITS) {
      if (!(cur % 100 === 0 || (cur % 100 >= 20 && cur % 10 === 0))) break;
      cur += UNITS[w];
    } else if (w in TEENS || w in TENS) {
      if (cur % 100 !== 0) break;
      cur += w in TEENS ? TEENS[w] : TENS[w];
    } else if (w === 'hundred') {
      if (cur < 1 || cur >= 100) break;
      cur *= 100;
    } else if (THOUSANDS.has(w)) {
      if (used === 0 && w === 'k') break;
      total += (cur || 1) * 1000;
      cur = 0;
    } else if (w === 'and') {
      const joins = used > 0 && isNumberWord(tokens[i + 1]) && cur % 100 === 0 && (cur > 0 || total > 0);
      if (!joins) break;
      i++;
      continue;
    } else break;
    used++;
    i++;
  }
  return used > 0 ? { value: total + cur, next: i } : null;
}

const DIGITS = /^\$?(\d+(?:\.\d+)?|\.\d+)(k)?$/;

/** Turn tokens into numbers, "dollars"/"cents" markers and the like. */
function buildItems(tokens: string[]): Item[] {
  const items: Item[] = [];
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i];
    const digits = DIGITS.exec(w);
    if (digits) {
      const value = parseFloat(digits[1]) * (digits[2] ? 1000 : 1);
      items.push({ t: 'NUM', value, isInt: Number.isInteger(value) });
      i++;
      continue;
    }
    const word = readWordNumber(tokens, i);
    if (word) {
      items.push({ t: 'NUM', value: word.value, isInt: true });
      i = word.next;
      continue;
    }
    if (ZEROES.has(w)) items.push({ t: 'NUM', value: 0, isInt: true });
    else if (w === 'oh') items.push({ t: 'OH' });
    else if (w === 'dollar' || w === 'dollars' || w === 'buck' || w === 'bucks') items.push({ t: 'DOLLARS' });
    else if (w === 'cent' || w === 'cents') items.push({ t: 'CENTS' });
    else if (w === 'to' || w === 'or') items.push({ t: 'RANGE' });
    else if (w === 'point') items.push({ t: 'POINT' });
    i++;
  }
  return items;
}

const toCents = (n: { value: number }): number => Math.round(n.value * 100);

/** Find every amount in a list of items (rules 5 to 8). */
function findCandidates(items: Item[]): Candidate[] {
  // "point five", "twelve point five": not whole dollars, so nothing usable.
  if (items.some((it, k) => it.t === 'POINT' && items[k + 1]?.t === 'NUM')) return [];
  const cands: Candidate[] = [];
  const skipDollars = (k: number): number => (items[k]?.t === 'DOLLARS' ? k + 1 : k);
  let i = 0;
  while (i < items.length) {
    const n = items[i];
    if (n.t !== 'NUM') { i++; continue; }
    const a = items[i + 1];
    const b = items[i + 2];
    if (a?.t === 'RANGE' && b?.t === 'NUM') {
      cands.push({ cents: toCents(n), ambiguous: true });
      i = skipDollars(i + 3);
    } else if (a?.t === 'DOLLARS') {
      let cents = toCents(n);
      i += 2;
      const m = items[i];
      if (m?.t === 'NUM' && m.isInt && m.value <= 99 && items[i + 1]?.t !== 'DOLLARS') {
        cents += m.value;
        i++;
        if (items[i]?.t === 'CENTS') i++;
      }
      cands.push({ cents, ambiguous: false });
    } else if (a?.t === 'CENTS') {
      cands.push({ cents: Math.round(n.value), ambiguous: false });
      i += 2;
    } else if (a?.t === 'OH' && b?.t === 'NUM' && n.isInt && b.isInt && b.value >= 1 && b.value <= 9) {
      cands.push({ cents: n.value * 100 + b.value, ambiguous: n.value < 10 });
      i = skipDollars(i + 3);
    } else if (a?.t === 'NUM' && n.isInt && a.isInt && a.value >= 10 && a.value <= 99) {
      cands.push({ cents: n.value * 100 + a.value, ambiguous: n.value < 10 });
      i = skipDollars(i + 2);
    } else {
      cands.push({ cents: toCents(n), ambiguous: false });
      i++;
    }
  }
  return cands;
}

/** Split tokens at "no", "wait", "actually", "i mean", "sorry", "make that" (rule 3). */
function splitAtCorrections(tokens: string[]): string[][] {
  const segments: string[][] = [[]];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pair = `${t} ${tokens[i + 1] ?? ''}`;
    if (pair === 'i mean' || pair === 'make that') { i++; segments.push([]); }
    else if (t === 'no' || t === 'wait' || t === 'actually' || t === 'sorry') segments.push([]);
    else segments[segments.length - 1].push(t);
  }
  return segments;
}

/** The amount the speaker settled on, or null. Cents are not clamped yet. */
function findAmount(text: string): Candidate | null {
  const segments = splitAtCorrections(softenArticles(tokenize(text)));
  for (let s = segments.length - 1; s >= 0; s--) {
    const cands = findCandidates(buildItems(segments[s]));
    if (cands.length === 0) continue;
    const last = cands[cands.length - 1];
    // Two amounts in one breath: keep the last, flag it (rule 6 / rule 7).
    return { cents: last.cents, ambiguous: last.ambiguous || cands.length > 1 };
  }
  return null;
}

function isPass(text: string): boolean {
  const padded = ' ' + text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  return PASS_PHRASES.some((p) => padded.includes(` ${p} `));
}

export function parseGuess(text: string, sttConfidence = 1): ParsedGuess {
  const found = findAmount(text);
  if (found) {
    if (found.cents > MAX_CENTS) return { kind: 'none', ambiguous: false, confidence: sttConfidence };
    const cents = Math.max(MIN_CENTS, found.cents);
    return {
      kind: 'amount',
      cents,
      ambiguous: found.ambiguous,
      confidence: sttConfidence * (found.ambiguous ? 0.8 : 1),
      spokenForm: spokenAmount(cents),
    };
  }
  if (isPass(text)) return { kind: 'pass', ambiguous: false, confidence: sttConfidence };
  const yn = parseYesNo(text);
  if (yn) return { kind: yn, ambiguous: false, confidence: sttConfidence };
  return { kind: 'none', ambiguous: false, confidence: sttConfidence };
}
