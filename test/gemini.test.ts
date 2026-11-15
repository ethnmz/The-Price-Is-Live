import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createGemini } from '../src/ai/gemini';
import { estimatePrice } from '../src/ai/estimate';
import type { ReferenceItem } from '../src/contracts';

const schema = z.object({ a: z.number() });
function fake(...replies: any[]) {
  const generateContent = vi.fn(async () => {
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (r instanceof Error) throw r;
    if (r === 'hang') return new Promise(() => {});
    return r;
  });
  return { sdk: { models: { generateContent } }, generateContent };
}
const mk = (sdk: unknown) => createGemini({ apiKey: 'k', model: 'm', sdk });

describe('gemini json', () => {
  it('parses valid JSON', async () => {
    const f = fake({ text: '{"a":1}' });
    expect(await mk(f.sdk).json({ prompt: 'p', schema, timeoutMs: 500 })).toEqual({ a: 1 });
    const req = (f.generateContent.mock.calls[0] as any)[0];
    expect(req.config.temperature).toBe(0);
    expect(req.config.responseMimeType).toBe('application/json');
  });
  it('parses fenced JSON', async () => {
    const f = fake({ text: '```json\n{"a":2}\n```' });
    expect(await mk(f.sdk).json({ prompt: 'p', schema, timeoutMs: 500 })).toEqual({ a: 2 });
  });
  it('sends images as inline parts', async () => {
    const f = fake({ text: '{"a":1}' });
    await mk(f.sdk).json({ prompt: 'p', schema, timeoutMs: 500, imagesJpeg: [Buffer.from('x')] });
    const parts = (f.generateContent.mock.calls[0] as any)[0].contents[0].parts;
    expect(parts[1].inlineData.mimeType).toBe('image/jpeg');
  });
  it('retries once on bad JSON then returns null', async () => {
    const f = fake({ text: 'nope' });
    expect(await mk(f.sdk).json({ prompt: 'p', schema, timeoutMs: 500 })).toBeNull();
    expect(f.generateContent).toHaveBeenCalledTimes(2);
  });
  it('recovers on the retry after an error', async () => {
    const f = fake(new Error('boom'), { text: '{"a":3}' });
    expect(await mk(f.sdk).json({ prompt: 'p', schema, timeoutMs: 500 })).toEqual({ a: 3 });
  });
  it('returns null at the timeout when the call hangs', async () => {
    const f = fake('hang');
    const t = Date.now();
    expect(await mk(f.sdk).json({ prompt: 'p', schema, timeoutMs: 50 })).toBeNull();
    expect(Date.now() - t).toBeLessThan(500);
  });
  it('is unavailable without a key and makes no calls', async () => {
    const f = fake({ text: '{"a":1}' });
    const g = createGemini({ apiKey: '', model: 'm', sdk: f.sdk });
    expect(g.available).toBe(false);
    expect(await g.json({ prompt: 'p', schema, timeoutMs: 50 })).toBeNull();
    expect(await g.grounded({ prompt: 'p', timeoutMs: 50 })).toBeNull();
    expect(await g.text({ prompt: 'p', timeoutMs: 50 })).toBeNull();
    expect(f.generateContent).not.toHaveBeenCalled();
  });
});

describe('gemini grounded and text', () => {
  it('extracts and dedupes sources', async () => {
    const f = fake({ text: 'hi', candidates: [{ groundingMetadata: { groundingChunks: [
      { web: { uri: 'https://a.com', title: 'A' } },
      { web: { uri: 'https://a.com', title: 'A again' } },
      { web: { uri: 'https://b.com', title: 'B' } },
      {},
    ] } }] });
    const r = await mk(f.sdk).grounded({ prompt: 'p', timeoutMs: 500 });
    expect(r).toEqual({ text: 'hi', sources: [{ title: 'A', url: 'https://a.com' }, { title: 'B', url: 'https://b.com' }] });
    expect((f.generateContent.mock.calls[0] as any)[0].config.tools).toEqual([{ googleSearch: {} }]);
  });
  it('tolerates missing metadata and returns null on error', async () => {
    expect(await mk(fake({ text: 'hi' }).sdk).grounded({ prompt: 'p', timeoutMs: 500 })).toEqual({ text: 'hi', sources: [] });
    expect(await mk(fake(new Error('x')).sdk).grounded({ prompt: 'p', timeoutMs: 500 })).toBeNull();
  });
  it('text returns plain text or null', async () => {
    expect(await mk(fake({ text: 'yo' }).sdk).text({ prompt: 'p', timeoutMs: 500 })).toBe('yo');
    expect(await mk(fake('hang').sdk).text({ prompt: 'p', timeoutMs: 30 })).toBeNull();
  });
});

describe('estimatePrice', () => {
  const ex = (n: number): ReferenceItem => ({ id: `ref_${n}`, name: `Thing ${n}`, aliases: [], category: 'c', priceCents: 1250 + n, source: 's', checkedAt: '2026-01-01' });
  const reply = (o: object) => fake({ text: JSON.stringify(o) });
  it('clamps price and includes at most 5 examples', async () => {
    const f = reply({ displayName: 'X', priceCents: 99999999, confidence: 0.7, notAProduct: false });
    const r = await estimatePrice(mk(f.sdk), 'x', [1, 2, 3, 4, 5, 6].map(ex));
    expect(r?.priceCents).toBe(100000);
    const prompt = (f.generateContent.mock.calls[0] as any)[0].contents[0].parts[0].text as string;
    expect(prompt).toContain('Thing 1 = $12.51');
    expect(prompt).toContain('Thing 5');
    expect(prompt).not.toContain('Thing 6');
    const low = await estimatePrice(mk(reply({ displayName: 'X', priceCents: 5, confidence: 2, notAProduct: false }).sdk), 'x', []);
    expect(low).toMatchObject({ priceCents: 100, confidence: 1 });
  });
  it('returns null on failure or no key', async () => {
    expect(await estimatePrice(mk(fake(new Error('x')).sdk), 'x', [])).toBeNull();
    expect(await estimatePrice(createGemini({ apiKey: '', model: 'm' }), 'x', [])).toBeNull();
  });
});
