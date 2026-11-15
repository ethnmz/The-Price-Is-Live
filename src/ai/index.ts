/** Builds the ai lane's ports from the environment. Works with an empty env: everything falls back.
 * TO VERIFY ON THE REAL LINE: a real GEMINI_API_KEY and model name; grounding on the free key.
 */
import type { Env } from '../config';
import type { HostPort, PricingPort, ReferenceItem, StorePort } from '../contracts';
import { createGemini, type GeminiClient } from './gemini';
import { createGeminiSearch } from './webSearch';
import { createPricing } from './pricing';
import { createIdentifier } from './identify';
import { createHost } from './host/lines';
import { createQuipper } from './host/quips';

export function createAi(env: Env, a: { items: ReferenceItem[]; store?: StorePort | null }): { pricing: PricingPort; host: HostPort; gemini: GeminiClient } {
  const gemini = createGemini({ apiKey: env.geminiApiKey, model: env.geminiModel });
  const search = env.searchProvider === 'gemini' && gemini.available ? createGeminiSearch(gemini) : null;
  const pricing = createPricing({ items: a.items, gemini, search, store: a.store ?? null, identify: env.geminiApiKey ? createIdentifier(gemini) : undefined });
  const host = createHost({ quip: createQuipper(gemini) });
  return { pricing, host, gemini };
}
