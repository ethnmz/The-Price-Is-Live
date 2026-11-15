import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../src/config';
import { ENV_NAMES, formatChecklist, runDoctor } from '../scripts/doctor';

const source = Object.fromEntries(ENV_NAMES.map((name, i) => [name, `private-fixture-${i}`]));
const successfulFetch = () => vi.fn<typeof fetch>().mockImplementation(async () =>
  new Response(JSON.stringify({ character_limit: 1000, character_count: 250 }), { status: 200 }));
const dependencies = () => ({ fetch: successfulFetch(), mint: vi.fn().mockResolvedValue('private-token'),
  pingMongo: vi.fn().mockResolvedValue(undefined) });

describe('doctor', () => {
  it('lists every missing variable and treats missing keys as warnings', async () => {
    const deps = dependencies();
    const result = await runDoctor({}, loadEnv({}), deps);
    expect(result.checks.slice(0, ENV_NAMES.length).every(c => c.status === 'MISSING')).toBe(true);
    expect(result.checks).toHaveLength(ENV_NAMES.length + 5);
    expect(result.exitCode).toBe(0);
    expect((await runDoctor({}, loadEnv({}), { ...deps, strict: true })).exitCode).toBe(1);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.mint).not.toHaveBeenCalled();
    expect(deps.pingMongo).not.toHaveBeenCalled();
  });
  it('checks all configured services with fake dependencies', async () => {
    const deps = dependencies();
    const result = await runDoctor(source, loadEnv(source), deps);
    expect(result.exitCode).toBe(0);
    expect(result.checks.every(c => c.status === 'OK')).toBe(true);
    expect(formatChecklist(result.checks)).toContain('characters left: 750');
    expect(deps.fetch).toHaveBeenCalledTimes(3);
    expect(deps.mint).toHaveBeenCalledOnce();
    expect(deps.pingMongo).toHaveBeenCalledOnce();
    const gemini = deps.fetch.mock.calls.find(([url]) => String(url).includes('generateContent'));
    expect(JSON.parse(String(gemini?.[1]?.body)).generationConfig.maxOutputTokens).toBe(1);
    expect(deps.fetch.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });
  it('continues after a failed service and never includes secret values or error bodies', async () => {
    const deps = dependencies();
    deps.fetch.mockRejectedValueOnce(new Error(Object.values(source).join(' ')));
    const result = await runDoctor(source, loadEnv(source), deps);
    expect(result.exitCode).toBe(1);
    expect(result.checks.find(c => c.name === 'Chert')?.status).toBe('FAIL');
    expect(result.checks.find(c => c.name === 'MongoDB')?.status).toBe('OK');
    const output = formatChecklist(result.checks);
    for (const secret of [...Object.values(source), 'private-token']) expect(output).not.toContain(secret);
  });
  it('skips all service work offline, even with keys present', async () => {
    const deps = dependencies();
    const result = await runDoctor(source, loadEnv(source), { ...deps, offline: true, strict: true });
    expect(result.exitCode).toBe(0);
    expect(result.checks).toHaveLength(ENV_NAMES.length);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(deps.mint).not.toHaveBeenCalled();
    expect(deps.pingMongo).not.toHaveBeenCalled();
  });
  it('bounds a hanging fetch and keeps checking later services', async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies();
      deps.fetch.mockImplementationOnce(() => new Promise(() => {}));
      const pending = runDoctor(source, loadEnv(source), deps);
      await vi.advanceTimersByTimeAsync(5000);
      const result = await pending;
      expect(result.exitCode).toBe(1);
      expect(result.checks.find(c => c.name === 'Chert')?.status).toBe('FAIL');
      expect(result.checks.find(c => c.name === 'Gemini')?.status).toBe('OK');
    } finally { vi.useRealTimers(); }
  });
  it('rejects HTTP failures and malformed subscription quotas', async () => {
    const deps = dependencies();
    deps.fetch.mockResolvedValueOnce(new Response('private error', { status: 403 }))
      .mockResolvedValueOnce(new Response('{}'));
    const result = await runDoctor(source, loadEnv(source), deps);
    expect(result.checks.filter(c => c.status === 'FAIL').map(c => c.name)).toEqual(['Chert', 'ElevenLabs']);
    expect(formatChecklist(result.checks)).not.toContain('private error');
  });
});
