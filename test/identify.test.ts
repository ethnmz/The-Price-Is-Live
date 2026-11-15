import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { GeminiClient } from '../src/ai/gemini';
import { createIdentifier } from '../src/ai/identify';

const product = { label: 'Owala FreeSip 24 oz', confidence: 0.9, notHolding: false };
function fake(value: unknown = product, available = true) {
  const json = vi.fn(async () => value);
  const client = { available, json, grounded: async () => null, text: async () => null } as unknown as GeminiClient;
  return { client, json };
}
const frames = () => [Buffer.from('fake-jpeg')];

describe('camera identifier', () => {
  it('returns a good label and requests structured vision with a four-second deadline', async () => {
    const { client, json } = fake();
    expect(await createIdentifier(client)(frames())).toEqual({ label: product.label, confidence: 0.9 });
    const request = json.mock.calls[0] as unknown as [{ timeoutMs: number; prompt: string }];
    expect(request[0].timeoutMs).toBe(4000);
    expect(request[0].prompt).toContain("Ignore people's faces and FaceTime buttons or names");
  });

  it.each([
    { ...product, notHolding: true }, { ...product, confidence: 0.49 },
    { ...product, label: ' ' }, { ...product, confidence: 1.1 },
    { ...product, confidence: NaN }, { label: 'cup' }, null,
  ])('returns null for unusable output %j', async (value) => {
    expect(await createIdentifier(fake(value).client)(frames())).toBeNull();
  });

  it('accepts confidence exactly at the threshold', async () => {
    expect(await createIdentifier(fake({ ...product, confidence: 0.5 }).client)(frames()))
      .toEqual({ label: product.label, confidence: 0.5 });
  });

  it('sends only the first three frames without changing the input', async () => {
    const { client, json } = fake();
    const input = Array.from({ length: 5 }, (_, i) => Buffer.from(`fake-${i}`));
    await createIdentifier(client)(input);
    const request = json.mock.calls[0] as unknown as [{ imagesJpeg: Buffer[] }];
    expect(request[0].imagesJpeg).toEqual(input.slice(0, 3));
    expect(input).toHaveLength(5);
  });

  it('skips Gemini for no frames or an unavailable client', async () => {
    for (const available of [true, false]) {
      const { client, json } = fake(product, available);
      expect(await createIdentifier(client)(available ? [] : frames())).toBeNull();
      expect(json).not.toHaveBeenCalled();
    }
  });

  it('returns null on failure', async () => {
    const { client, json } = fake();
    json.mockRejectedValueOnce(new Error('unavailable'));
    expect(await createIdentifier(client)(frames())).toBeNull();
  });

  it('has no filesystem import', () => {
    const source = readFileSync(new URL('../src/ai/identify.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:)?fs(?:\/promises)?['"]/);
  });
});
