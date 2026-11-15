/** Measured A/B/C evaluation; mock output is never a product accuracy claim.
 * TO VERIFY ON THE REAL LINE: run with GEMINI_API_KEY, inspect grounding and Atlas writes,
 * and perform two additional runs for stability before quoting the result.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { loadEnv, type Env } from '../src/config';
import { createAi } from '../src/ai';
import { makeVariants, type VariantFn, type VariantResult } from '../src/ai/variants';
import { createGeminiSearch } from '../src/ai/webSearch';
import { createStore } from '../src/store';
import { referenceSchema, schemas } from '../src/store/schemas';
import type { HeldoutItem } from '../src/contracts';
import { metrics, absPctError } from './metrics';

const root = fileURLToPath(new URL('../', import.meta.url));
const heldoutSchema = z.array(z.object({
  id: z.string().min(1), text: z.string().min(1), trueCents: z.number().int().positive(),
  source: z.string().min(1), checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().min(1), tier: z.enum(['similar', 'novel']), verified: z.boolean().optional(),
})).min(1);
const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];

/** A deadline covers the complete pipeline, including retries. Late answers are ignored. */
export async function runItem(fn: VariantFn, text: string, timeoutMs = 20_000): Promise<VariantResult & { failure: string | null }> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => fn(text)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    if (result.priceCents !== null && (!Number.isSafeInteger(result.priceCents) || result.priceCents < 0)) throw new Error('invalid price');
    return { ...result, latencyMs: performance.now() - start, failure: result.priceCents === null ? 'no answer' : null };
  } catch (error) {
    return { priceCents: null, displayName: text, source: 'none', latencyMs: performance.now() - start,
      failure: error instanceof Error && error.message === 'timeout' ? 'timeout' : 'pricing error' };
  } finally { clearTimeout(timer); }
}

// The mock depends only on input text and variant, never the held-out price.
function mockPricer(variant: Variant): VariantFn {
  return async text => {
    const hash = [...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, variant.charCodeAt(0));
    return { priceCents: hash % 11 === 0 ? null : 100 + hash % 40000, displayName: text, source: 'estimate', latencyMs: 0 };
  };
}

export async function runEval(opts: { mock?: boolean; env?: Env } = {}) {
  const mock = opts.mock ?? false;
  const env = opts.env ?? loadEnv();
  // Check before reading data, creating directories, or touching any report.
  if (!mock && !env.geminiApiKey.trim()) throw new Error('GEMINI_API_KEY is required. Run npm run eval -- --mock for offline validation. eval/ was left unchanged.');
  const heldout = heldoutSchema.parse(JSON.parse(await readFile(resolve(root, 'data/heldout-test.json'), 'utf8')));
  const items = z.array(referenceSchema).min(1).parse(JSON.parse(await readFile(resolve(root, 'data/reference-items.json'), 'utf8')));
  if (new Set(heldout.map(i => i.id)).size !== heldout.length) throw new Error('Duplicate held-out IDs');
  const ai = mock ? null : createAi(env, { items });
  const fns = ai ? makeVariants({ items, gemini: ai.gemini, search: createGeminiSearch(ai.gemini) }) :
    { A: mockPricer('A'), B: mockPricer('B'), C: mockPricer('C') };
  const ranAt = new Date().toISOString();
  const runId = randomUUID();
  const models = mock ? ['deterministic-fake-pricer-v1'] : [env.geminiModel];
  const results = {} as Record<Variant, ReturnType<typeof metrics> & { perItem: (HeldoutItem & VariantResult & { absPctError: number | null; failure: string | null })[] }>;
  for (const variant of variants) {
    const perItem: typeof results.A.perItem = new Array(heldout.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (cursor < heldout.length) {
        const index = cursor++;
        const item = heldout[index];
        const result = await runItem(fns[variant], item.text);
        // Mock latency is synthetic too: make repeated offline runs deterministic.
        if (mock) result.latencyMs = 0;
        const row = { ...item, ...result };
        perItem[index] = { ...row, absPctError: absPctError(row) };
      }
    }));
    results[variant] = { ...metrics(perItem), perItem };
  }
  const output = { mock, runId, ranAt, models, n: heldout.length, referenceN: items.length,
    verified: heldout.filter(i => i.verified === true).length, concurrency: 2, timeoutMs: 20000,
    definitions: 'Percent fields use 0..100; Wilson bounds use 0..1. Nulls are headline misses. Error and over-price rate use answered items. p95 uses nearest rank; latency includes failures. One run; stability not established.',
    variants: results };
  const directory = resolve(root, mock ? 'out/eval-mock' : 'eval');
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'results.json'), JSON.stringify(output, null, 2) + '\n');
  await writeFile(resolve(directory, 'report.md'), renderReport(output));
  if (!mock && env.mongodbUri) {
    // Route store fallback files into the leased directory as well.
    const store = createStore(env, { dataDir: resolve(root, 'eval/store-fallback') });
    try {
      await store.ready();
      await persistEvalRuns(store, output);
    } finally { await store.close(); }
  }
  return output;
}

/** Validate the complete batch before the best-effort store can silently drop a run. */
export async function persistEvalRuns(
  store: Pick<ReturnType<typeof createStore>, 'persist' | 'flush'>,
  output: { runId: string; ranAt: string; models: string[];
    variants: Record<Variant, { n: number; within15: { percent: number | null };
      within25: { percent: number | null }; medianAbsPctError: number | null;
      perItem: object[] }> },
): Promise<void> {
  const documents = variants.map(variant => {
    const r = output.variants[variant];
    const parsed = schemas.evalRun.safeParse({ runId: `${output.runId}:${variant}`, ranAt: output.ranAt,
      variant, models: output.models, n: r.n, within15: r.within15.percent,
      within25: r.within25.percent, medianAbsPctError: r.medianAbsPctError, perItem: r.perItem });
    if (!parsed.success) throw new Error(`Cannot persist eval variant ${variant}: store schema rejects metrics (${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}). No variants were written; retain the JSON report for undefined metrics.`);
    return parsed.data;
  });
  for (const document of documents) store.persist('evalRun', document);
  await store.flush(5000);
}

type Output = Awaited<ReturnType<typeof runEval>>;
// Truncate displayed numbers: never round a measured headline upward.
const number = (n: number | null) => n === null ? 'N/A' : String(Math.floor(n * 100) / 100);
const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
function renderReport(o: Output): string {
  const lines = [o.mock ? 'MOCK ONLY: synthetic prices and latency; do not quote as accuracy.' : '# Pricing accuracy evaluation',
    '', `Date: ${o.ranAt}. Models: ${o.models.join(', ')}.`,
    `Held-out set: ${o.n} items; reference set: ${o.referenceN}; verified held-out prices: ${o.verified}/${o.n}.`,
    'A = Gemini alone; B = list + Gemini; C = B + Google Search grounding.', '',
    '| Variant | N | Answers | Within 15% count (%) | Within 25% count (%) | Median error % | Over-price % | Median ms | p95 ms | Wilson 95% |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  const tableRow = (label: string, r: ReturnType<typeof metrics>) =>
    `| ${label} | ${r.n} | ${r.answered} | ${r.within15.count} (${number(r.within15.percent)}%) | ${r.within25.count} (${number(r.within25.percent)}%) | ${number(r.medianAbsPctError)} | ${number(r.overPriceRate)} | ${number(r.medianLatencyMs)} | ${number(r.p95LatencyMs)} | ${r.wilson95 ? `${number(r.wilson95.low * 100)}%–${number(r.wilson95.high * 100)}%` : 'N/A'} |`;
  for (const v of variants) lines.push(tableRow(v, o.variants[v]));
  lines.push('', '## Per tier', '', lines[6], lines[7]);
  for (const v of variants) for (const [tier, r] of Object.entries(o.variants[v].byTier)) lines.push(tableRow(`${v} / ${tier}`, { ...r, byTier: {} }));
  lines.push('', '## Every item', '', '| Item | Tier | Truth cents | A cents / error % / source | B cents / error % / source | C cents / error % / source |', '| --- | --- | --- | --- | --- | --- |');
  o.variants.A.perItem.forEach((item, index) => lines.push(`| ${escapeCell(item.text)} | ${item.tier} | ${item.trueCents} | ${variants.map(v => {
    const r = o.variants[v].perItem[index];
    return `${r.priceCents ?? 'null'} / ${number(r.absPctError)} / ${r.source}${r.failure ? ` (${r.failure})` : ''}`;
  }).join(' | ')} |`));
  lines.push('', '## Worst misses', '');
  for (const v of variants) {
    const worst = [...o.variants[v].perItem].sort((a, b) => (b.absPctError ?? Infinity) - (a.absPctError ?? Infinity)).slice(0, 5);
    for (const r of worst) lines.push(`- ${v}: ${escapeCell(r.text)} — ${r.absPctError === null ? r.failure : `${number(r.absPctError)}% error (${r.source})`}. ${r.failure ? 'No usable answer was returned.' : 'The cause cannot be established from this run.'}`);
  }
  lines.push('', '## Three plain sentences', '',
    `C was within 15% on ${o.variants.C.within15.count} of ${o.n} items (${number(o.variants.C.within15.percent)}%).`,
    `A was within 15% on ${o.variants.A.within15.count} of ${o.n} items (${number(o.variants.A.within15.percent)}%).`,
    `Only ${o.verified} held-out prices are marked verified, so these results need that qualification.`, '',
    '## Honest limits', '', o.definitions,
    'The truth is a recorded retail price on one date; real prices vary by store. The sample is small and Wilson intervals are wide. The game labels low-confidence prices as estimates.',
    'No prompt or threshold tuning was performed by this harness. Two repeat runs are still required to assess stability. A timeout ignores a late response but does not cancel underlying SDK work.',
    o.mock ? 'All values in this report come from an offline fake and are not evidence of product accuracy.' : 'Unverified recorded prices are not independently checked ground truth.', '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEval({ mock: process.argv.includes('--mock') }).then(o => {
    console.log(`Completed ${o.mock ? 'MOCK ' : ''}eval: ${o.n} items × 3 variants.`);
  }).catch(() => {
    console.error(!loadEnv().geminiApiKey && !process.argv.includes('--mock')
      ? 'GEMINI_API_KEY is required. Run npm run eval -- --mock for offline validation. eval/ was left unchanged.'
      : 'Evaluation failed; no accuracy claim should be made. Check data and provider configuration.');
    process.exitCode = 1;
  });
}
