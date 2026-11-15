/** Bounded pricing with local fallbacks. Frames stay in memory only.
 * TO VERIFY ON THE REAL LINE: grounded search quality with a live Gemini key.
 */
import pino from 'pino';
import type { PricingPort, PriceResult, ReferenceItem, SearchProvider, StorePort } from '../contracts';
import type { GeminiClient } from './gemini';
import { cleanItemText } from './cleanText';
import { matchList } from './matchList';
import { estimatePrice } from './estimate';

const log = pino();
let warnedMissingKey = false;
const clamp = (n: number) => Math.max(100, Math.min(100000, Math.round(n)));
const titleCase = (s: string) => s.replace(/\b\p{L}/gu, c => c.toUpperCase()) || 'Mystery Item';

/** A deadline also handles injected providers that never settle or throw immediately. */
async function bounded<T>(work: () => Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function createPricing(a: {
  items: ReferenceItem[]; gemini: GeminiClient; search?: SearchProvider | null;
  store?: StorePort | null; timeoutMs?: number; webTimeoutMs?: number;
  identify?: PricingPort['identifyFromFrames'];
}): PricingPort {
  const timeoutMs = Number.isFinite(a.timeoutMs) ? Math.max(0, a.timeoutMs!) : 8000;
  const webTimeoutMs = Number.isFinite(a.webTimeoutMs) ? Math.max(0, a.webTimeoutMs!) : 6000;
  const cache = new Map<string, PriceResult>();
  const prices = a.items.map(i => i.priceCents).filter(Number.isFinite).sort((x, y) => x - y);
  const middle = Math.floor(prices.length / 2);
  const median = prices.length ? (prices.length % 2 ? prices[middle]! : (prices[middle - 1]! + prices[middle]!) / 2) : 100;
  if (!a.gemini.available && !warnedMissingKey) {
    warnedMissingKey = true;
    log.warn('Gemini key missing: pricing uses the reference list and labelled fallback estimates.');
  }

  return {
    async price(req) {
      const started = Date.now();
      const { clean, rejected } = cleanItemText(req.rawText ?? '');
      const matches = rejected ? [] : matchList(clean, a.items, 5);
      const best = matches[0];
      const finish = (result: PriceResult): PriceResult => ({
        ...result, itemId: req.itemId,
        priceCents: clamp(Number.isFinite(result.priceCents) ? result.priceCents : median),
        confidence: Number.isFinite(result.confidence) ? Math.max(0, Math.min(1, result.confidence)) : 0,
        isEstimate: result.source === 'estimate' || !Number.isFinite(result.confidence) || result.confidence < 0.5,
        displayName: result.displayName.trim() || titleCase(clean),
        evidence: result.evidence.map(e => ({ ...e })), latencyMs: Math.max(0, Date.now() - started),
      });
      const fallback = (prop = false): PriceResult => finish({
        itemId: req.itemId, displayName: !prop && best && best.score >= 0.6 ? best.item.name : titleCase(clean),
        priceCents: !prop && best && best.score >= 0.6 ? best.item.priceCents : median,
        source: 'estimate', isEstimate: true, confidence: !prop && best && best.score >= 0.6 ? 0.4 : 0.2,
        evidence: [], latencyMs: 0,
        ...(prop || !best || best.score < 0.6 ? { propClosetSuggested: true } : {}),
      });
      if (rejected) return fallback(true);
      const run = async (): Promise<PriceResult> => {
        const memory = cache.get(clean);
        if (memory) return finish(memory);
        const stored = a.store ? await a.store.getCachedPrice(clean).catch(() => null) : null;
        if (stored) { cache.set(clean, finish(stored)); return finish(stored); }
        if (best && best.score >= 0.85 && !best.sizeConflict) return finish({
          itemId: req.itemId, displayName: best.item.name, priceCents: best.item.priceCents,
          source: 'list', confidence: best.score, isEstimate: false, latencyMs: 0,
          evidence: [{ kind: 'list', label: best.item.name, priceCents: best.item.priceCents, matchScore: best.score }],
        });
        const estimate = Promise.resolve().then(() => estimatePrice(a.gemini, clean, matches.map(m => m.item), timeoutMs)).catch(() => null);
        const web = await bounded(() => a.search ? a.search.search(clean) : Promise.resolve(null), Math.min(webTimeoutMs, timeoutMs));
        if (web && web.priceCents !== null && Number.isFinite(web.priceCents) && web.sources.length) {
          const price = web.priceCents;
          const agreeing = [...web.text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/gu)]
            .map(m => Math.round(Number(m[1]!.replace(/,/gu, '')) * 100))
            .filter(n => n > 0 && Math.abs(n - price) / Math.max(1, price) <= 0.2);
          return finish({ itemId: req.itemId, displayName: titleCase(clean), priceCents: price,
            source: 'web', confidence: new Set(web.sources.map(s => s.url)).size >= 2 && agreeing.length >= 2 ? 0.9 : 0.75,
            isEstimate: false, latencyMs: 0,
            evidence: web.sources.map(s => ({ kind: 'web', label: s.title, url: s.url })),
          });
        }
        const model = await estimate;
        if (!model) return fallback();
        if (model.notAProduct) return fallback(true);
        return finish({ ...model, itemId: req.itemId, source: 'estimate', isEstimate: true, latencyMs: 0,
          evidence: [{ kind: 'model', label: model.displayName || titleCase(clean) }],
        });
      };
      const result = await bounded(run, Math.max(0, timeoutMs - (Date.now() - started)));
      const final = result ? finish(result) : fallback();
      if (final.source === 'list' || final.source === 'web') {
        cache.set(clean, finish(final));
        try { a.store?.persist('priceCache', { cleanText: clean, result: finish(final), createdAt: Date.now() }); }
        catch { /* Persistence must never interrupt the game. */ }
      }
      return final;
    },
    async identifyFromFrames(jpegs) {
      if (!a.identify) return null;
      return bounded(() => a.identify!(jpegs), timeoutMs);
    },
  };
}
