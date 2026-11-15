import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { metrics, wilson95 } from '../eval/metrics';
import { persistEvalRuns, runEval, runItem } from '../eval/run-eval';
import { createStore } from '../src/store';
import { loadEnv } from '../src/config';

const row = (priceCents: number | null, latencyMs = 10, tier = 'similar') => ({ trueCents: 10000, priceCents, latencyMs, tier });

describe('eval metrics', () => {
  it('counts inclusive boundaries and null misses, with answered-only error and direction', () => {
    const r = metrics([row(11500, 10), row(8500, 20), row(12500, 30, 'novel'), row(null, 40, 'novel')]);
    expect(r.n).toBe(4);
    expect(r.answered).toBe(3);
    expect(r.missing).toBe(1);
    expect(r.within15).toEqual({ count: 2, percent: 50 });
    expect(r.within25).toEqual({ count: 3, percent: 75 });
    expect(r.medianAbsPctError).toBe(15);
    expect(r.overPriceRate).toBeCloseTo(200 / 3);
    expect(r.medianLatencyMs).toBe(25);
    expect(r.p95LatencyMs).toBe(40);
    expect(r.byTier.novel.within15).toEqual({ count: 0, percent: 0 });
    expect(r.byTier.similar.within15).toEqual({ count: 2, percent: 100 });
    expect(metrics([row(11501)]).within15.count).toBe(0);
    expect(metrics([row(12501)]).within25.count).toBe(0);
    expect(metrics([row(10000)]).overPriceRate).toBe(0);
  });
  it('matches a known Wilson 95% interval for 20 successes in 40 trials', () => {
    expect(wilson95(20, 40)!.low).toBeCloseTo(0.35199526933465375, 12);
    expect(wilson95(20, 40)!.high).toBeCloseTo(0.6480047306653463, 12);
    expect(wilson95(0, 0)).toBeNull();
    expect(() => wilson95(2, 1)).toThrow();
  });
  it('handles empty and all-null sets without invented errors', () => {
    const empty = metrics([]);
    expect(empty.within15).toEqual({ count: 0, percent: null });
    expect(empty.wilson95).toBeNull();
    expect(empty.medianLatencyMs).toBeNull();
    const r = metrics([row(null)]);
    expect(r.medianAbsPctError).toBeNull();
    expect(r.overPriceRate).toBeNull();
    expect(r.within15.percent).toBe(0);
    expect(() => metrics([{ ...row(100), trueCents: 0 }])).toThrow();
  });
  it('uses ordinary even median and nearest-rank p95 without mutating input', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(10000, 20 - i));
    expect(metrics(rows).p95LatencyMs).toBe(19);
    expect(metrics(rows).medianLatencyMs).toBe(10.5);
    expect(rows[0].latencyMs).toBe(20);
    expect(metrics([row(9000), row(14000)]).medianAbsPctError).toBe(25);
  });
});

describe('eval harness', () => {
  it('records failures and enforces the outer deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = runItem(() => new Promise(() => {}), 'item', 50);
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toMatchObject({ priceCents: null, failure: 'timeout' });
      expect(await runItem(async () => { throw new Error('private provider details'); }, 'item')).toMatchObject({ priceCents: null, failure: 'pricing error' });
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('refuses a keyless live run before changing eval files', async () => {
    const before = await readFile(new URL('../eval/report.md', import.meta.url), 'utf8');
    await expect(runEval({ env: loadEnv({}) })).rejects.toThrow('GEMINI_API_KEY');
    expect(await readFile(new URL('../eval/report.md', import.meta.url), 'utf8')).toBe(before);
  });
  it('writes well-formed mock results for every held-out item without changing the live report', async () => {
    const before = await readFile(new URL('../eval/report.md', import.meta.url), 'utf8');
    const result = await runEval({ mock: true, env: loadEnv({}) });
    const saved = JSON.parse(await readFile(new URL('../out/eval-mock/results.json', import.meta.url), 'utf8'));
    expect(saved).toEqual(result);
    expect(saved.mock).toBe(true);
    expect(saved.n).toBeGreaterThanOrEqual(30);
    for (const variant of ['A', 'B', 'C']) {
      const r = saved.variants[variant];
      expect(r.n).toBe(saved.n);
      expect(r.perItem).toHaveLength(saved.n);
      expect(r.byTier.similar.n + r.byTier.novel.n).toBe(saved.n);
      expect(r.within15.count + r.missing).toBeLessThanOrEqual(saved.n);
      expect(r.perItem.every((i: { latencyMs: number }) => i.latencyMs === 0)).toBe(true);
    }
    const report = await readFile(new URL('../out/eval-mock/report.md', import.meta.url), 'utf8');
    expect(report).toContain('MOCK ONLY');
    expect(report).toContain('| Variant | N |');
    expect(report).toContain('## Per tier');
    expect(await readFile(new URL('../eval/report.md', import.meta.url), 'utf8')).toBe(before);
  });
});

describe('eval persistence', () => {
  it('writes all three real-store variants including unanswered items with null metrics', async () => {
    const writes: { collection: string; filter: Record<string, unknown>; doc: Record<string, unknown> }[] = [];
    const client = {
      connect: async () => {}, close: async () => {},
      db: () => ({ collection: (collection: string) => ({
        createIndex: async () => {},
        updateOne: async (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
          writes.push({ collection, filter, doc: update.$set });
        },
      }) }),
    };
    const store = createStore(loadEnv({ MONGODB_URI: 'mongodb://fixture.invalid', LOG_LEVEL: 'silent' }), { client });
    const perItem = [{ id: 'fixture', text: 'Fixture item', ...row(null), source: 'none' }];
    const missing = { ...metrics(perItem), perItem };
    const answeredItems = [{ ...perItem[0], priceCents: 10000, source: 'estimate' }];
    const answered = { ...metrics(answeredItems), perItem: answeredItems };
    try {
      await persistEvalRuns(store, {
        runId: 'fixture-run', ranAt: '2026-11-14T12:00:00.000Z', models: ['fixture-model'],
        variants: { A: answered, B: missing, C: answered },
      });
      expect(writes.map(w => [w.collection, w.filter])).toEqual(['A', 'B', 'C'].map(variant =>
        ['eval_runs', { runId: `fixture-run:${variant}`, variant }]));
      expect(writes.map(w => w.doc.medianAbsPctError)).toEqual([0, null, 0]);
      expect(writes[0].doc).toMatchObject({ n: 1, within15: 100, within25: 100, perItem: answeredItems });
      expect(writes[1].doc).toMatchObject({ n: 1, within15: 0, within25: 0, medianAbsPctError: null, perItem });
      expect(writes[0].doc.ranAt).toBeInstanceOf(Date);
    } finally { await store.close(); }
  });
});
