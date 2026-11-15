/** Pricing stays bounded even when a provider never settles.
 * TO VERIFY ON THE REAL LINE: grounded prices and camera identification with live credentials.
 */
import pino from 'pino';
import type { PriceResult, PricingPort, ReferenceItem, SearchProvider, StorePort } from '../contracts';
import type { GeminiClient } from './gemini';
import { cleanItemText } from './cleanText';
import { matchList } from './matchList';
import { estimatePrice } from './estimate';

const log = pino();
let warned = false;
const clamp = (n: number) => Math.max(100, Math.min(100000, Math.round(Number.isFinite(n) ? n : 2500)));

export function createPricing(a: {
  items: ReferenceItem[]; gemini: GeminiClient; search?: SearchProvider | null;
  store?: StorePort | null; timeoutMs?: number; webTimeoutMs?: number;
  identify?: PricingPort['identifyFromFrames'];
}): PricingPort {
  const cache = new Map<string, PriceResult>();
  const timeoutMs = Math.max(0, a.timeoutMs ?? 8000);
  const webTimeoutMs = Math.max(0, a.webTimeoutMs ?? 6000);
  const prices = a.items.map(i => i.priceCents).sort((x, y) => x - y);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length ? (prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2) : 2500;
  if (!a.gemini.available && !warned) {
    warned = true;
    log.warn('Gemini key missing; pricing will use reference prices and fallback estimates.');
  }
  return {
    async identifyFromFrames(jpegs) {
      try { return a.identify ? await a.identify(jpegs) : null; } catch { return null; }
    },
    price(req) {
      const started = Date.now();
      return new Promise<PriceResult>(resolve => {
        let done = false;
        let clean = '';
        let matches: ReturnType<typeof matchList> = [];
        const timers: ReturnType<typeof setTimeout>[] = [];
        const fallback = (rejected = false): PriceResult => {
          const best = matches[0];
          const usable = !rejected && best && best.score >= 0.6;
          return {
            itemId: req.itemId, displayName: usable ? best.item.name : clean.replace(/\b\w/g, c => c.toUpperCase()) || 'Mystery Item',
            priceCents: usable ? best.item.priceCents : median, source: 'estimate', isEstimate: true,
            confidence: usable ? 0.4 : 0.2, evidence: [], propClosetSuggested: !usable,
            latencyMs: 0,
          };
        };
        const finish = (result: PriceResult, save = false) => {
          if (done) return;
          done = true;
          timers.forEach(clearTimeout);
          const final = { ...result, itemId: req.itemId, priceCents: clamp(result.priceCents),
            isEstimate: result.source === 'estimate' || result.confidence < 0.5,
            latencyMs: Math.max(0, Date.now() - started) };
          resolve(final);
          if (save) {
            cache.set(clean, final);
            try { a.store?.persist('priceCache', { cleanText: clean, result: final, createdAt: new Date() }); } catch { /* Storage is optional. */ }
          }
        };
        timers.push(setTimeout(() => finish(fallback()), timeoutMs));
        const run = async () => {
          const cleaned = cleanItemText(req.rawText ?? '');
          clean = cleaned.clean;
          if (cleaned.rejected) { finish(fallback(true)); return; }
          matches = matchList(clean, a.items, 5);
          const cached = cache.get(clean) ?? await a.store?.getCachedPrice(clean).catch(() => null);
          if (done) return;
          if (cached) { finish(cached); return; }
          const best = matches[0];
          if (best && best.score >= 0.85 && !best.sizeConflict) {
            finish({ itemId: req.itemId, displayName: best.item.name, priceCents: best.item.priceCents,
              source: 'list', confidence: best.score, isEstimate: false, latencyMs: 0,
              evidence: [{ kind: 'list', label: best.item.name, priceCents: best.item.priceCents, matchScore: best.score }] }, true);
            return;
          }
          if (!a.gemini.available) { finish(fallback()); return; }
          // Track the model independently: a rejection already received must beat web prices.
          const state: { model: Awaited<ReturnType<typeof estimatePrice>> } = { model: null };
          const estimate = Promise.resolve().then(() => estimatePrice(a.gemini, clean, matches.map(m => m.item), timeoutMs))
            .then(result => {
              state.model = result;
              if (result?.notAProduct) finish(fallback(true));
              return result;
            }, () => null);
          const web = new Promise<Awaited<ReturnType<SearchProvider['search']>> | null>(res => {
            if (!a.search) { res(null); return; }
            const timer = setTimeout(() => res(null), webTimeoutMs);
            timers.push(timer);
            Promise.resolve().then(() => a.search!.search(clean)).catch(() => null).then(result => {
              clearTimeout(timer); res(result);
            });
          });
          const found = await web;
          if (done) return;
          if (state.model?.notAProduct) { finish(fallback(true)); return; }
          if (found && found.sources.length > 0 && found.priceCents !== null && Number.isFinite(found.priceCents)) {
            const amounts = [...found.text.matchAll(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g)]
              .map(m => Number(m[1]!.replace(/,/g, '')) * 100).filter(n => n > 0);
            const agree = new Set(found.sources.map(s => s.url)).size >= 2
              && amounts.filter(n => Math.abs(n - found.priceCents!) / found.priceCents! <= 0.2).length >= 2;
            finish({ itemId: req.itemId, displayName: state.model?.displayName || fallback().displayName,
              priceCents: found.priceCents, source: 'web', confidence: agree ? 0.9 : 0.75,
              isEstimate: false, latencyMs: 0, evidence: found.sources.map(s => ({ kind: 'web', label: s.title, url: s.url })) }, true);
            return;
          }
          const result = await estimate;
          if (result && !result.notAProduct) {
            finish({ itemId: req.itemId, displayName: result.displayName || fallback().displayName,
              priceCents: result.priceCents, source: 'estimate', isEstimate: true, confidence: result.confidence,
              evidence: [{ kind: 'model', label: result.displayName }], latencyMs: 0 });
          } else finish(fallback(!!result?.notAProduct));
        };
        void run().catch(() => finish(fallback()));
      });
    },
  };
}
