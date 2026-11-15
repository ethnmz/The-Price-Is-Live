/** The A/B/C eval variants (§10.4): AI alone, list + AI, and the full game pipeline.
 * Every variant answers `{ priceCents, displayName, source, latencyMs }` and never throws.
 * TO VERIFY ON THE REAL LINE: run the accuracy harness with a real Gemini key to compare A, B and C.
 */
import type { ReferenceItem, SearchProvider } from '../contracts';
import type { GeminiClient } from './gemini';
import { cleanItemText } from './cleanText';
import { matchList, LIST_ACCEPT } from './matchList';
import { estimatePrice } from './estimate';
import { createPricing } from './pricing';

export interface VariantResult { priceCents: number | null; displayName: string; source: 'list' | 'web' | 'estimate' | 'none'; latencyMs: number }
export type VariantFn = (rawText: string) => Promise<VariantResult>;

const TIMEOUT_MS = 8000;

/** Run a variant body, time it, and turn any failure into an empty result. */
async function timed(body: () => Promise<Omit<VariantResult, 'latencyMs'>>, rawText: string): Promise<VariantResult> {
  const started = Date.now();
  try {
    const r = await body();
    return { ...r, latencyMs: Date.now() - started };
  } catch {
    return { priceCents: null, displayName: rawText.trim(), source: 'none', latencyMs: Date.now() - started };
  }
}

async function modelEstimate(gemini: GeminiClient, clean: string, examples: ReferenceItem[], rawText: string) {
  const r = await estimatePrice(gemini, clean, examples, TIMEOUT_MS);
  if (!r || r.notAProduct) return { priceCents: null, displayName: rawText.trim(), source: 'none' as const };
  return { priceCents: r.priceCents, displayName: r.displayName, source: 'estimate' as const };
}

export function makeVariants(a: { items: ReferenceItem[]; gemini: GeminiClient; search: SearchProvider | null }): { A: VariantFn; B: VariantFn; C: VariantFn } {
  const A: VariantFn = (rawText) => timed(async () => {
    const { clean, rejected } = cleanItemText(rawText ?? '');
    if (rejected) return { priceCents: null, displayName: rawText.trim(), source: 'none' };
    return modelEstimate(a.gemini, clean, [], rawText);
  }, rawText ?? '');

  const B: VariantFn = (rawText) => timed(async () => {
    const { clean, rejected } = cleanItemText(rawText ?? '');
    if (rejected) return { priceCents: null, displayName: rawText.trim(), source: 'none' };
    const matches = matchList(clean, a.items, 5);
    const best = matches[0];
    if (best && best.score >= LIST_ACCEPT && !best.sizeConflict) {
      return { priceCents: best.item.priceCents, displayName: best.item.name, source: 'list' };
    }
    return modelEstimate(a.gemini, clean, matches.map((m) => m.item), rawText);
  }, rawText ?? '');

  const C: VariantFn = (rawText) => timed(async () => {
    // A fresh pricing instance per call: nothing is cached across items.
    const pricing = createPricing({ items: a.items, gemini: a.gemini, search: a.search, store: null });
    const r = await pricing.price({ rawText, itemId: 'variant-c', ownerId: 'p1', origin: 'text' });
    // A bare fallback (no evidence) is not a real answer.
    const real = r.source !== 'estimate' || r.evidence.length > 0;
    return { priceCents: real ? r.priceCents : null, displayName: r.displayName, source: real ? r.source : 'none' };
  }, rawText ?? '');

  return { A, B, C };
}
