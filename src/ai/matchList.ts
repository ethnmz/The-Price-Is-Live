/** Deterministic local matching; no network or real-line verification needed. */
import type { ReferenceItem } from '../contracts';
import { cleanItemText } from './cleanText';

export const LIST_ACCEPT = 0.85;
export const LIST_MAYBE = 0.6;
export interface ListMatch { item: ReferenceItem; score: number; sizeConflict: boolean }

function words(text: string): string[] {
  return [...new Set(text.split(/\s+/).filter(Boolean))];
}

// Only long alphabetic words can be fuzzy: model numbers must stay exact.
function oneEdit(a: string, b: string): boolean {
  if (!/^\p{L}{5,}$/u.test(a) || !/^\p{L}{5,}$/u.test(b)
      || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}

function dice(left: string[], right: string[]): number {
  const remaining = new Set(right);
  let hits = 0;
  const unmatched: string[] = [];
  for (const word of left) {
    if (remaining.delete(word)) hits++;
    else unmatched.push(word);
  }
  for (const word of unmatched) {
    const near = [...remaining].find(other => oneEdit(word, other));
    if (near !== undefined) { remaining.delete(near); hits += 0.9; }
  }
  return left.length + right.length ? 2 * hits / (left.length + right.length) : 0;
}

function sizes(text: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const match of text.toLowerCase().matchAll(/\b(\d+(?:\.\d+)?)\s*(?:fl\s*)?(oz|ml|l|pack|count|inch|gb|w)\b/g)) {
    const values = result.get(match[2]) ?? new Set<number>();
    values.add(Number(match[1]));
    result.set(match[2], values);
  }
  return result;
}

export function matchList(cleanText: string, items: ReferenceItem[], k = 5): ListMatch[] {
  const text = cleanItemText(cleanText).clean;
  const tokens = words(text);
  const requestedSizes = sizes(text);
  const matches = items.map(item => {
    const name = cleanItemText(item.name).clean;
    const brand = words(name)[0];
    const bonus = brand && tokens.includes(brand) ? 0.05 : 0;
    let score = 0;
    for (const candidate of [name, ...item.aliases.map(alias => cleanItemText(alias).clean)]) {
      if (!candidate || !text) continue;
      score = Math.max(score, text === candidate ? 1 : 0,
        candidate !== name && ` ${text} `.includes(` ${candidate} `) ? 0.9 : 0,
        Math.min(1, dice(tokens, words(candidate)) + bonus));
    }
    const listedSizes = sizes(`${item.name} ${item.sizeNote ?? ''}`);
    const sizeConflict = [...requestedSizes].some(([unit, values]) => {
      const listed = listedSizes.get(unit);
      return listed !== undefined && [...values].some(value => !listed.has(value));
    });
    return { item, score: sizeConflict ? Math.min(score, 0.8) : score, sizeConflict };
  });
  matches.sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  return matches.slice(0, Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0);
}
