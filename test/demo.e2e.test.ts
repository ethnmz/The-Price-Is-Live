import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDemoCheck } from '../scripts/demo-check';

describe('demo check (SPEC 14.3, offline)', () => {
  it('plays the whole 2-minute demo game with every assertion holding', async () => {
    const result = await runDemoCheck({ outDir: mkdtempSync(join(tmpdir(), 'demo-')) });
    expect(result.failures).toEqual([]);
    expect(result.virtualMs).toBeLessThanOrEqual(120_000);
    expect(result.phasesSeen).toContain('finale');
    expect(result.pngs.length).toBeGreaterThan(5);
  }, 60_000);
});
