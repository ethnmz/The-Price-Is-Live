/** Last-resort price estimate from Gemini's own knowledge (no web). */
import { z } from 'zod';
import type { ReferenceItem } from '../contracts';
import type { GeminiClient } from './gemini';

const EstimateSchema = z.object({
  displayName: z.string(),
  priceCents: z.number(),
  confidence: z.number(),
  notAProduct: z.boolean(),
});

const MIN_CENTS = 100;
const MAX_CENTS = 100000;

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function estimatePrice(
  gemini: GeminiClient,
  cleanText: string,
  examples: ReferenceItem[],
  timeoutMs = 6000,
): Promise<{ displayName: string; priceCents: number; confidence: number; notAProduct: boolean } | null> {
  if (!gemini.available) return null;
  const shown = examples.slice(0, 5).map((e) => `${e.name} = ${money(e.priceCents)}`);
  const prompt = [
    `Estimate the typical NEW, regular US retail price of this item: "${cleanText}"`,
    'Rules: no used or resale prices, no bundles or multipacks unless named, no shipping or tax.',
    'If the text is not a purchasable product, set notAProduct to true.',
    shown.length ? `Calibration examples, other items on our price list:\n${shown.join('\n')}` : '',
    'Answer as JSON: {"displayName": string, "priceCents": integer cents, "confidence": number 0..1, "notAProduct": boolean}',
  ].filter(Boolean).join('\n');
  const r = await gemini.json({ prompt, schema: EstimateSchema, timeoutMs });
  if (!r || !Number.isFinite(r.priceCents) || !Number.isFinite(r.confidence)) return null;
  return {
    displayName: r.displayName,
    priceCents: Math.min(MAX_CENTS, Math.max(MIN_CENTS, Math.round(r.priceCents))),
    confidence: Math.min(1, Math.max(0, r.confidence)),
    notAProduct: r.notAProduct,
  };
}
