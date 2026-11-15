/**
 * Web price lookup: Gemini + Google Search grounding, in two calls (§10.3).
 * Step 1 asks a grounded call for prices in plain text. Step 2 turns that text
 * into JSON. Never throws. No grounding sources means no "web" price.
 *
 * TO VERIFY ON THE REAL LINE:
 * - Whether grounding and JSON output work in ONE call (we assume not: two calls).
 * - That Google Search grounding works on the free API key and returns sources.
 * - That 4 s (grounded) and 2 s (JSON) are enough in practice.
 */
import { z } from 'zod';
import type { SearchProvider } from '../contracts/ports.js';
import type { GeminiClient } from './gemini.js';

const GROUNDED_MS = 4000;
const JSON_MS = 2000;

const extractSchema = z.object({
  displayName: z.string().optional(),
  prices: z.array(z.object({ cents: z.number(), store: z.string().optional() })),
});

export type WebSearchResult = Awaited<ReturnType<SearchProvider['search']>> & { prices?: number[] };

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Median of the prices after dropping outliers above 3x the median. null if none. */
export function pickPrice(cents: number[]): number | null {
  const good = cents.filter((c) => Number.isFinite(c) && c > 0).sort((a, b) => a - b);
  if (good.length === 0) return null;
  if (good.length === 1) return good[0];
  const m = median(good);
  const kept = good.filter((c) => c <= 3 * m);
  return median(kept);
}

/** Do 2+ prices agree: is (max - min) within `tolerance` (0.2 = 20%) of the min? */
export function agreeWithin(cents: number[], tolerance: number): boolean {
  const good = cents.filter((c) => Number.isFinite(c) && c > 0);
  if (good.length < 2) return false;
  const lo = Math.min(...good);
  const hi = Math.max(...good);
  return hi <= lo * (1 + tolerance);
}

const EMPTY = (): WebSearchResult => ({ priceCents: null, sources: [], text: '' });

export function createGeminiSearch(gemini: GeminiClient): SearchProvider {
  return {
    async search(query: string): Promise<WebSearchResult> {
      try {
        if (!gemini.available) return EMPTY();
        const grounded = await gemini.grounded({
          prompt:
            `What is the current NEW, regular US retail price of "${query}"? ` +
            'Use major retailers or the manufacturer. List each price you find with its store. ' +
            'Ignore used items, resellers, bundles and shipping.',
          timeoutMs: GROUNDED_MS,
        });
        if (!grounded) return EMPTY();
        const { text, sources } = grounded;

        const extracted = await gemini.json({
          prompt:
            'From the text below, extract the product name and every new retail price in US cents ' +
            '(for example $19.99 is 1999) with its store. Reply as JSON: ' +
            '{"displayName": string, "prices": [{"cents": number, "store": string}]}.\n\n' + text,
          schema: extractSchema,
          timeoutMs: JSON_MS,
        });
        const prices = (extracted?.prices ?? []).map((p) => Math.round(p.cents)).filter((c) => c > 0);
        const priceCents = sources.length > 0 ? pickPrice(prices) : null;
        return { priceCents, sources, text, prices };
      } catch {
        return EMPTY();
      }
    },
  };
}
