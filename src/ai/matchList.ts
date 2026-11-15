/** Local matching only: scores rank candidates, and size conflicts require review. */
import type { ReferenceItem } from '../contracts';
import { cleanItemText } from './cleanText';

export const LIST_ACCEPT = 0.85;
export const LIST_MAYBE = 0.6;
export interface ListMatch { item: ReferenceItem; score: number; sizeConflict: boolean }

function tokens(text: string): string[] {
  return [...new Set(cleanItemText(text).clean.split(/\s+/u).filter(Boolean))];
}

function near(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length <= b.length) j++;
    if (a.length >= b.length) i++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function dice(a: string[], b: string[]): number {
  // Reserve exact matches first so a typo cannot consume another word's match.
  const remaining = [...b];
  const unmatched: string[] = [];
  let hits = 0;
  for (const word of a) {
    const index = remaining.indexOf(word);
    if (index < 0) unmatched.push(word);
    else { hits++; remaining.splice(index, 1); }
  }
  for (const word of unmatched) {
    const index = remaining.findIndex(other => near(word, other));
    if (index >= 0) { hits += 0.9; remaining.splice(index, 1); }
  }
  return a.length + b.length ? 2 * hits / (a.length + b.length) : 0;
}

function sizes(text: string): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  for (const hit of text.toLowerCase().matchAll(/\b(\d+(?:\.\d+)?)\s*(?:fl\s*)?(oz|ml|l|pack|count|inch|gb|w)\b/gu)) {
    const unit = hit[2]!;
    const values = result.get(unit) ?? new Set<number>();
    values.add(Number(hit[1]));
    result.set(unit, values);
  }
  return result;
}

export function matchList(cleanText: string, items: ReferenceItem[], k = 5): ListMatch[] {
  const text = cleanItemText(cleanText).clean;
  const words = tokens(text);
  const inputSizes = sizes(text);
  return items.map(item => {
    const name = cleanItemText(item.name).clean;
    const brand = tokens(name)[0];
    let score = 0;
    for (const candidate of [name, ...item.aliases.map(alias => cleanItemText(alias).clean)]) {
      if (!candidate || !text) continue;
      const exact = text === candidate ? 1 : 0;
      const contained = ` ${text} `.includes(` ${candidate} `) ? 0.9 : 0;
      const similarity = dice(words, tokens(candidate));
      const bonus = similarity > 0 && brand && words.includes(brand) ? 0.05 : 0;
      score = Math.max(score, exact, contained, Math.min(1, similarity + bonus));
    }
    const itemSizes = sizes(`${item.name} ${item.sizeNote ?? ''}`);
    const sizeConflict = [...inputSizes].some(([unit, values]) => {
      const expected = itemSizes.get(unit);
      return expected !== undefined && [...values].some(value => !expected.has(value));
    });
    return { item, score: sizeConflict ? Math.min(0.8, score) : score, sizeConflict };
  }).sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .slice(0, Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0);
}
