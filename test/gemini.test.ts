import { describe, expect, it, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { createGemini } from '../src/ai/gemini';
import { estimatePrice } from '../src/ai/estimate';
import type { ReferenceItem } from '../src/contracts';

const schema = z.object({ value: z.number() });
const request = { prompt: 'test', schema, timeoutMs: 100 };
function fake() {
  const generateContent = vi.fn();
  return { generateContent, client: createGemini({ apiKey: 'fixture-key', model: 'fixture-model', sdk: { models: { generateContent } } }) };
}
afterEach(() => vi.useRealTimers());

describe('Gemini wrapper', () => {
  it.each(['{"value":3}', '```json\n{"value":3}\n```'])('parses JSON %s and sends image parts', async text => {
    const { client, generateContent } = fake();
    generateContent.mockResolvedValue({ text });
    expect(await client.json({ ...request, system: 'system', imagesJpeg: [Buffer.from('fixture')] })).toEqual({ value: 3 });
    expect(generateContent.mock.calls[0][0]).toMatchObject({
      model: 'fixture-model', config: { temperature: 0, responseMimeType: 'application/json', systemInstruction: 'system' },
      contents: [{ parts: [{ text: 'test' }, { inlineData: { mimeType: 'image/jpeg', data: Buffer.from('fixture').toString('base64') } }] }],
    });
  });
  it.each(['bad json', '{"value":"wrong type"}'])('retries invalid output once: %s', async text => {
    const { client, generateContent } = fake();
    generateContent.mockResolvedValue({ text });
    expect(await client.json(request)).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
  it('recovers after an SDK error', async () => {
    const { client, generateContent } = fake();
    generateContent.mockRejectedValueOnce(new Error('fixture')).mockResolvedValueOnce({ text: '{"value":4}' });
    expect(await client.json(request)).toEqual({ value: 4 });
  });
  it('keeps retries inside one timeout and aborts the hanging request', async () => {
    vi.useFakeTimers();
    const { client, generateContent } = fake();
    generateContent.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      throw new Error('fixture');
    }).mockImplementationOnce(() => new Promise(() => {}));
    const pending = client.json({ ...request, timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].config.abortSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('makes no calls without a key', async () => {
    const generateContent = vi.fn();
    const client = createGemini({ apiKey: '', model: 'fixture', sdk: { models: { generateContent } } });
    expect(client.available).toBe(false);
    expect(await client.json(request)).toBeNull();
    expect(await client.text(request)).toBeNull();
    expect(await client.grounded(request)).toBeNull();
    expect(generateContent).not.toHaveBeenCalled();
  });
  it('extracts distinct grounded URLs and tolerates absent metadata', async () => {
    const { client, generateContent } = fake();
    generateContent.mockResolvedValueOnce({ text: 'answer', candidates: [{ groundingMetadata: { groundingChunks: [
      { web: { uri: 'https://example.com', title: 'Example' } },
      { web: { uri: 'https://example.com', title: 'Duplicate' } },
      { web: { uri: 'https://example.org' } }, {},
    ] } }] }).mockResolvedValueOnce({ text: 'answer' });
    expect(await client.grounded(request)).toEqual({ text: 'answer', sources: [
      { title: 'Example', url: 'https://example.com' }, { title: 'https://example.org', url: 'https://example.org' },
    ] });
    expect(generateContent.mock.calls[0][0].config).toMatchObject({ tools: [{ googleSearch: {} }] });
    expect(await client.grounded(request)).toEqual({ text: 'answer', sources: [] });
  });
  it('returns text and tolerates errors and hanging calls for both plain methods', async () => {
    const { client, generateContent } = fake();
    generateContent.mockResolvedValueOnce({ text: 'hello' }).mockRejectedValueOnce(new Error('fixture'));
    expect(await client.text({ ...request, system: 'system' })).toBe('hello');
    expect(await client.grounded(request)).toBeNull();
    vi.useFakeTimers();
    generateContent.mockImplementation(() => new Promise(() => {}));
    const pending = [client.text({ ...request, timeoutMs: 10 }), client.grounded({ ...request, timeoutMs: 10 })];
    await vi.advanceTimersByTimeAsync(10);
    expect(await Promise.all(pending)).toEqual([null, null]);
  });
});

describe('estimatePrice', () => {
  it.each([[1, 100], [200000, 100000], [1234.5, 1235]])('clamps and rounds %s to %s and includes at most five examples', async (priceCents, expected) => {
    const { client, generateContent } = fake();
    generateContent.mockResolvedValue({ text: JSON.stringify({ displayName: 'Bottle', priceCents, confidence: 0.8, notAProduct: false }) });
    const examples: ReferenceItem[] = Array.from({ length: 6 }, (_, i) => ({ id: `fixture${i}`, name: `Item${i}`, aliases: [], category: 'fixture', priceCents: 1234, source: 'example.com', checkedAt: '2026-11-14' }));
    expect(await estimatePrice(client, 'bottle', examples)).toEqual({ displayName: 'Bottle', priceCents: expected, confidence: 0.8, notAProduct: false });
    const prompt = generateContent.mock.calls[0][0].contents[0].parts[0].text;
    expect(prompt).toContain('other items on our price list: Item0 = $12.34');
    expect(prompt).toContain('Item4 = $12.34');
    expect(prompt).not.toContain('Item5');
  });
  it('returns null on failure or unavailable Gemini', async () => {
    const { client, generateContent } = fake();
    generateContent.mockRejectedValue(new Error('fixture'));
    expect(await estimatePrice(client, 'bottle', [])).toBeNull();
    expect(await estimatePrice({ ...client, available: false }, 'bottle', [])).toBeNull();
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});
