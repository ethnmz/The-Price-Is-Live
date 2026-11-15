import { describe, expect, it } from 'vitest';
import { PIPELINES, evalErrorPipeline, formatTable, leaderboardPipeline, pointsPipeline, sourceSharePipeline, trickiestPipeline } from '../scripts/atlas-stats';
import { INDEXES, toReferenceDoc } from '../src/store/seed';

const groupKeys = (p: Record<string, unknown>[]) => Object.keys(([...p].reverse().find((s) => '$group' in s) as { $group: object }).$group);

describe('atlas pipelines', () => {
  it('every builder returns stages', () => {
    for (const p of PIPELINES) expect(p.build().length).toBeGreaterThan(0);
  });
  it('has the expected $group keys', () => {
    expect(groupKeys(pointsPipeline())).toContain('avgPerRound');
    expect(groupKeys(sourceSharePipeline())).toEqual(['_id', 'rounds']);
    expect(groupKeys(trickiestPipeline())).toContain('stumpPoints');
    expect(groupKeys(evalErrorPipeline())).toContain('medianAbsPctError');
    expect(leaderboardPipeline()[0]).toEqual({ $sort: { totalPoints: -1 } });
  });
  it('formats a table', () => {
    expect(formatTable([{ a: 1, b: 'xx' }])).toContain('a  b');
    expect(formatTable([])).toContain('no data');
  });
});

describe('seed', () => {
  it('keeps cents as integers and drops unknown fields', () => {
    const d = toReferenceDoc({ id: 'ref_1', name: 'X', aliases: ['x'], category: 'c', priceCents: 1999.6, source: 's', checkedAt: '2026-11-14', embedding: [1], junk: 1 })!;
    expect(d.priceCents).toBe(2000);
    expect(d).not.toHaveProperty('junk');
    expect(d).not.toHaveProperty('embedding');
  });
  it('rejects unusable rows', () => {
    expect(toReferenceDoc({ name: 'no id', priceCents: 1 })).toBeNull();
    expect(toReferenceDoc({ id: 'a', name: 'b', priceCents: 'x' })).toBeNull();
  });
  it('plans a 30-day TTL on price_cache', () => {
    expect(INDEXES.some((i) => i.collection === 'price_cache' && i.options.expireAfterSeconds === 2592000)).toBe(true);
  });
});
