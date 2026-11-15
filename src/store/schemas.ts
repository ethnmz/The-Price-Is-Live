import { z } from 'zod';

const text = z.string().min(1);
const count = z.number().int().nonnegative();
const money = z.number().int().min(100).max(100000);
const confidence = z.number().min(0).max(1);
const playerId = z.enum(['p1', 'p2', 'p3', 'p4']);
const source = z.enum(['list', 'web', 'estimate']);
const evidence = z.object({ kind: z.enum(['list', 'web', 'model']), label: text, url: text.optional(), priceCents: money.optional(), matchScore: confidence.optional() });
export const priceSchema = z.object({ itemId: text, displayName: text, priceCents: money, source, isEstimate: z.boolean(), confidence, evidence: z.array(evidence), latencyMs: z.number().nonnegative(), propClosetSuggested: z.boolean().optional() });
export const referenceSchema = z.object({ id: text, name: text, aliases: z.array(text), category: text, priceCents: money, sizeNote: text.optional(), source: text, checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), verified: z.boolean().optional(), embedding: z.array(z.number().finite()).length(768).optional() });
const scoreboard = z.array(z.object({ id: playerId, name: text, total: count, place: count }));
export const schemas = {
  player: z.object({ gameId: text, phone: z.string().regex(/^\+\d{8,15}$/), name: text.max(12), points: count }),
  game: z.object({ gameId: text, startedAt: count, endedAt: count.optional(), mode: z.enum(['normal', 'demo']), callPlan: z.literal('B'), playerIds: z.array(playerId), totalRounds: count, lightning: z.boolean(), textMode: z.boolean(), endReason: text.optional(), finalScoreboard: scoreboard.optional(), championIds: z.array(playerId).optional() }),
  round: z.object({ gameId: text, roundIndex: count, ownerId: playerId, item: z.object({ rawText: z.string().nullable().optional(), origin: z.enum(['text', 'camera', 'voice', 'prop_closet']), displayName: text, priceCents: money, source, isEstimate: z.boolean(), confidence, evidence: z.array(evidence) }), winnerIds: z.array(playerId), winnerReason: z.enum(['closest_under', 'lowest_over', 'none']), stumpPoints: count, durationMs: z.number().nonnegative() }),
  guess: z.object({ gameId: text, roundIndex: count, playerId, cents: z.number().int().min(100).max(9999900).nullable(), status: z.enum(['locked', 'silent', 'pass']), channel: z.enum(['voice', 'text']).nullable(), transcript: z.string().nullable().optional(), corrected: z.boolean(), points: count }),
  result: z.object({ gameId: text, scoreboard, items: z.array(z.object({ owner: text, name: text, priceCents: money, isEstimate: z.boolean() })), cardText: text.optional(), sentAt: count }),
  priceCache: z.object({ cleanText: text, result: priceSchema, createdAt: z.union([count, z.date(), z.string().datetime()]) }),
  evalRun: z.object({ runId: text, ranAt: z.union([count, z.date(), z.string().datetime()]), variant: text, models: z.union([text, z.array(text), z.record(z.string(), text)]), n: count, within15: z.number().nonnegative(), within25: z.number().nonnegative(), medianAbsPctError: z.number().nonnegative().nullable(), perItem: z.array(z.record(z.string(), z.unknown())) }),
};

// Remove whole fields rather than keeping fragments of private content.
export function sanitize(value: unknown, key = '', depth = 0): unknown {
  if (depth > 20 || /phone(?!Hash|Last4)|token|secret|password|api.?key|image|base64|jpeg|frame|authorization/i.test(key)) return undefined;
  if (key === 'phoneHash' && typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return value;
  if (typeof value === 'string') {
    if (/(?:\+?\d[\s().-]*){10,15}|Bearer\s+\S+|data:image\/|eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:sk-|AIza)[\w-]{16,}/i.test(value)) return undefined;
    return value;
  }
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(v => sanitize(v, '', depth + 1)).filter(v => v !== undefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k, depth + 1)]).filter(([, v]) => v !== undefined));
  return value;
}
