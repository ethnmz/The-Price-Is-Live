import { z } from 'zod';

const text = z.string().min(1);
const count = z.number().int().nonnegative();
const money = z.number().int().min(100).max(100000);
const confidence = z.number().min(0).max(1);
const timestamp = z.union([z.number().finite(), z.string().min(1), z.date()]);
const ids = z.array(text);
const evidence = z.object({ kind: z.enum(['list', 'web', 'model']), label: text,
  url: z.string().optional(), priceCents: money.optional(), matchScore: confidence.optional() });
export const priceSchema = z.object({ itemId: text, displayName: text, priceCents: money,
  source: z.enum(['list', 'web', 'estimate']), isEstimate: z.boolean(), confidence,
  evidence: z.array(evidence), latencyMs: z.number().nonnegative(), propClosetSuggested: z.boolean().optional() });
export const referenceSchema = z.object({ id: z.string().regex(/^ref_\d{4}$/), name: text,
  aliases: z.array(text), category: text, priceCents: money, sizeNote: z.string().optional(),
  source: text, checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), verified: z.boolean().optional(),
  embedding: z.array(z.number().finite()).length(768).optional() });
const scoreboard = z.array(z.object({ id: text, name: text, total: count, place: count }));
export const schemas = {
  player: z.object({ gameId: text, phone: z.string().regex(/^\+\d{8,15}$/), name: text.max(12), points: count }),
  game: z.object({ gameId: text, startedAt: timestamp, endedAt: timestamp.nullish(), mode: z.enum(['normal', 'demo']),
    callPlan: z.literal('B'), playerIds: ids, totalRounds: count, lightning: z.boolean(), textMode: z.boolean(),
    endReason: z.string().nullish(), finalScoreboard: scoreboard.optional(), championIds: ids.optional() }),
  round: z.object({ gameId: text, roundIndex: count, ownerId: text,
    item: priceSchema.omit({ itemId: true, latencyMs: true, propClosetSuggested: true }).extend({
      rawText: z.string().optional(), origin: z.enum(['text', 'camera', 'voice', 'prop_closet']) }),
    winnerIds: ids, winnerReason: z.enum(['closest_under', 'lowest_over', 'none']), stumpPoints: count, durationMs: count }),
  guess: z.object({ gameId: text, roundIndex: count, playerId: text, cents: z.number().int().min(100).max(9999900).nullable(),
    status: z.enum(['locked', 'silent', 'pass']), channel: z.enum(['voice', 'text']).nullable(), transcript: z.string().nullable(), corrected: z.boolean(), points: count }),
  result: z.object({ gameId: text, scoreboard, items: z.array(z.object({ owner: text, name: text, priceCents: money, isEstimate: z.boolean() })), cardText: text, sentAt: timestamp }),
  priceCache: z.object({ cleanText: text, result: priceSchema, createdAt: timestamp }),
  evalRun: z.object({ runId: text, ranAt: timestamp, variant: z.enum(['A', 'B', 'C']), models: z.union([text, z.array(text), z.record(z.string(), z.string())]), n: count,
    within15: z.number().nonnegative(), within25: z.number().nonnegative(), medianAbsPctError: z.number().nonnegative(), perItem: z.array(z.record(z.string(), z.unknown())) }),
};

/** Remove private fields recursively, including private strings inside otherwise safe fields. */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 20) return undefined;
  if (typeof value === 'string') {
    if (/(?:\+?\d[\s().-]*){10,15}|data:image|^\/9j\/|^iVBOR|bearer\s|eyJ[\w-]+\.[\w-]+\./i.test(value)) return undefined;
    return value;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1)).filter(v => v !== undefined);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (/phone(?!Hash$|Last4$)|token|secret|password|api.?key|image|jpeg|frame|base64/i.test(key)) continue;
      const clean = scrub(v, depth + 1);
      if (clean !== undefined) result[key] = clean;
    }
    return result;
  }
  return value;
}
