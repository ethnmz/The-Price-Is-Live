/** Pure eval statistics. Percentages use 0..100; Wilson bounds use 0..1.
 * Null answers are misses. Error and over-price statistics use answered items only.
 * Latencies include failures; p95 is the nearest-rank percentile.
 */
export interface Measurement {
  trueCents: number;
  priceCents: number | null;
  latencyMs: number;
  tier: string;
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function wilson95(hits: number, n: number): { low: number; high: number } | null {
  if (!Number.isInteger(n) || !Number.isInteger(hits) || hits < 0 || hits > n || n < 0) throw new Error('Invalid Wilson counts');
  if (!n) return null;
  const z = 1.959963984540054;
  const p = hits / n;
  const divisor = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / divisor;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / divisor;
  return { low: Math.max(0, center - radius), high: Math.min(1, center + radius) };
}
export function absPctError(row: Measurement): number | null {
  return row.priceCents === null ? null : 100 * Math.abs(row.priceCents - row.trueCents) / row.trueCents;
}
function summarize(rows: Measurement[]) {
  for (const r of rows) {
    if (!Number.isSafeInteger(r.trueCents) || r.trueCents <= 0 ||
      (r.priceCents !== null && (!Number.isSafeInteger(r.priceCents) || r.priceCents < 0)) ||
      !Number.isFinite(r.latencyMs) || r.latencyMs < 0) throw new Error('Invalid measurement');
  }
  const answered = rows.filter(r => r.priceCents !== null);
  const errors = answered.map(r => absPctError(r)!);
  // Compare integer cents directly, so exact percentage boundaries are inclusive.
  const within = (pct: number) => {
    const count = answered.filter(r => Math.abs(r.priceCents! - r.trueCents) * 100 <= pct * r.trueCents).length;
    return { count, percent: rows.length ? 100 * count / rows.length : null };
  };
  const within15 = within(15);
  const latencies = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  return {
    n: rows.length, answered: answered.length, missing: rows.length - answered.length,
    within15, within25: within(25), medianAbsPctError: median(errors),
    overPriceRate: answered.length ? 100 * answered.filter(r => r.priceCents! > r.trueCents).length / answered.length : null,
    medianLatencyMs: median(latencies), p95LatencyMs: latencies.length ? latencies[Math.ceil(latencies.length * .95) - 1] : null,
    wilson95: wilson95(within15.count, rows.length),
  };
}
export function metrics(rows: Measurement[]) {
  return { ...summarize(rows), byTier: Object.fromEntries([...new Set(rows.map(r => r.tier))].sort().map(tier => [tier, summarize(rows.filter(r => r.tier === tier))])) };
}
