import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTts } from '../src/comms/tts';

function pcmBytes(samples: number, odd = false): Uint8Array {
  const b = new Uint8Array(samples * 2 + (odd ? 1 : 0));
  for (let i = 0; i < samples; i++) b[i * 2] = (i % 100) + 1;
  return b;
}

function fakeFetch(status = 200, samples = 100, odd = false) {
  return vi.fn(async (_u: unknown, _i?: unknown) =>
    new Response(status === 200 ? pcmBytes(samples, odd) : 'nope', { status }));
}

function make(over: Record<string, unknown> = {}, f = fakeFetch()) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'tts-test-'));
  const tts = createTts({
    apiKey: 'test-key', voiceId: 'voice1', model: 'm1', format: 'pcm_24000', charBudget: 1000,
    cacheDir, fetch: f as unknown as typeof fetch, ...over,
  });
  return { tts, f, cacheDir };
}

afterEach(() => vi.restoreAllMocks());

describe('tts', () => {
  it('sends the right request per emotion', async () => {
    const { tts, f } = make();
    const out = await tts.synthesize('hello', 'hype');
    expect(out).toBeInstanceOf(Int16Array);
    expect(out!.length).toBe(100);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice1/stream?output_format=pcm_24000');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('test-key');
    const body = JSON.parse(init.body as string);
    expect(body.text).toBe('hello');
    expect(body.model_id).toBe('m1');
    expect(body.voice_settings).toMatchObject({ stability: 0.3, style: 0.6, speed: 1.08 });
    await tts.synthesize('hello', 'drumroll');
    await tts.synthesize('hello', 'warm');
    const s = (i: number) => JSON.parse((f.mock.calls[i][1] as RequestInit).body as string).voice_settings;
    expect(s(1)).toMatchObject({ stability: 0.4, style: 0.7, speed: 0.95 });
    expect(s(2)).toMatchObject({ stability: 0.5, style: 0.3, speed: 1.0 });
  });

  it('serves the second call from cache with no fetch', async () => {
    const { tts, f } = make();
    const a = await tts.synthesize('hello', 'warm');
    const b = await tts.synthesize('hello', 'warm');
    expect(f).toHaveBeenCalledTimes(1);
    expect(Array.from(b!)).toEqual(Array.from(a!));
    expect(tts.stats()).toMatchObject({ charsUsed: 5, cacheHits: 1, cacheMisses: 1 });
  });

  it('shares in-flight requests', async () => {
    const { tts, f } = make();
    await Promise.all([tts.synthesize('same', 'warm'), tts.synthesize('same', 'warm')]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('drops an odd trailing byte', async () => {
    const { tts } = make({}, fakeFetch(200, 10, true));
    expect((await tts.synthesize('x', 'warm'))!.length).toBe(10);
  });

  it('warns at 70% and goes cached_only at 90%', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { tts, f } = make({ charBudget: 100 });
    await tts.synthesize('a'.repeat(69), 'warm');
    expect(warn).not.toHaveBeenCalled();
    await tts.synthesize('b', 'warm');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(tts.stats().mode).toBe('live');
    await tts.synthesize('c'.repeat(20), 'warm');
    expect(tts.stats().mode).toBe('cached_only');
    expect(await tts.synthesize('new line', 'warm')).toBeNull();
    expect(await tts.synthesize('b', 'warm')).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('70%'))).toHaveLength(1);
  });

  it('keeps the used count across restarts', async () => {
    const { tts, cacheDir, f } = make();
    await tts.synthesize('hello', 'warm');
    const again = createTts({ apiKey: 'test-key', voiceId: 'voice1', model: 'm1', format: 'pcm_24000', charBudget: 1000, cacheDir, fetch: f as unknown as typeof fetch });
    expect(again.stats().charsUsed).toBe(5);
  });

  it('returns null without a key or voice id, and makes no request', async () => {
    const a = make({ apiKey: '' });
    expect(await a.tts.synthesize('hi', 'warm')).toBeNull();
    expect(a.f).not.toHaveBeenCalled();
    const b = make({ voiceId: '' });
    expect(await b.tts.synthesize('hi', 'warm')).toBeNull();
    expect(b.f).not.toHaveBeenCalled();
  });

  it('returns null on HTTP 401 and 429', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of [401, 429]) {
      const { tts, cacheDir } = make({}, fakeFetch(code));
      expect(await tts.synthesize('hi', 'warm')).toBeNull();
      expect(readdirSync(cacheDir).filter((n) => n.endsWith('.pcm'))).toHaveLength(0);
    }
  });

  it('ignores a broken cache file', async () => {
    const { tts, cacheDir, f } = make();
    await tts.synthesize('hi', 'warm');
    const file = readdirSync(cacheDir).find((n) => n.endsWith('.pcm'))!;
    writeFileSync(join(cacheDir, file), Buffer.alloc(0));
    expect(await tts.synthesize('hi', 'warm')).not.toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('warmCache counts generated and cached, and stops in cached_only', async () => {
    const { tts, f } = make();
    await tts.synthesize('one', 'hype');
    const r = await tts.warmCache(['one', 'two', 'three']);
    expect(r).toEqual({ generated: 2, cached: 1 });
    expect(f).toHaveBeenCalledTimes(3);
    const small = make({ charBudget: 10 });
    const r2 = await small.tts.warmCache(['123456789', 'abc', 'def']);
    expect(r2.generated).toBe(1);
    expect(small.f).toHaveBeenCalledTimes(1);
  });

  it('resamples pcm_16000 to 1.5x the samples', async () => {
    const { tts, f } = make({ format: 'pcm_16000' }, fakeFetch(200, 160));
    const out = await tts.synthesize('hi', 'warm');
    expect(out!.length).toBe(240);
    expect((f.mock.calls[0][0] as string)).toContain('output_format=pcm_16000');
  });
});
