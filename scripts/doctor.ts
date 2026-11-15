/** Safe startup checklist. No credentials, tokens, response bodies or errors are printed.
 * TO VERIFY ON THE REAL LINE: token acceptance, Chert line readiness, voice/STT,
 * Gemini model access and Atlas permissions; successful probes do not prove a call works.
 */
import { pathToFileURL } from 'node:url';
import { loadEnv, type Env } from '../src/config';
import { mintToken } from '../src/comms/token';

export const ENV_NAMES = [
  'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'AGENT_NAME',
  'CHERT_API_KEY', 'CHERT_PROJECT_ID', 'CHERT_LINE_ID', 'CHERT_FACETIME_BASE',
  'CHERT_APP_BASE', 'LINE_DISPLAY_NUMBER', 'CALL_MODE', 'ELEVENLABS_API_KEY',
  'ELEVENLABS_VOICE_ID', 'ELEVENLABS_TTS_MODEL', 'ELEVENLABS_TTS_FORMAT',
  'ELEVENLABS_CHAR_BUDGET', 'STT_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL',
  'GEMINI_EMBED_MODEL', 'SEARCH_PROVIDER', 'MONGODB_URI', 'MONGODB_DB',
  'PHONE_HASH_SALT', 'DEMO', 'STAGE_W', 'STAGE_H', 'STAGE_FPS', 'LOG_LEVEL',
] as const;
export interface Check { name: string; status: 'OK' | 'MISSING' | 'FAIL'; detail: string }
export interface DoctorOptions {
  fetch?: typeof fetch;
  offline?: boolean;
  strict?: boolean;
  timeoutMs?: number;
  mint?: typeof mintToken;
  pingMongo?: (env: Env) => Promise<void>;
}

async function pingMongo(env: Env): Promise<void> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(env.mongodbUri, {
    serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000,
  });
  try { await client.db(env.mongodbDb).command({ ping: 1 }, { timeoutMS: 5000 }); }
  finally { await client.close(); }
}

// A race also bounds clients that ignore AbortSignal. Always consume late rejections.
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, ms);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function checkServices(env: Env, opts: DoctorOptions = {}): Promise<Check[]> {
  if (opts.offline) return [];
  const fetcher = opts.fetch ?? fetch;
  const checks: Check[] = [];
  async function probe(name: string, ready: boolean, run: (signal: AbortSignal) => Promise<string>) {
    if (!ready) { checks.push({ name, status: 'MISSING', detail: 'missing' }); return; }
    try {
      const detail = await bounded(run, Math.min(opts.timeoutMs ?? 5000, 5000));
      checks.push({ name, status: 'OK', detail });
    } catch { checks.push({ name, status: 'FAIL', detail: 'check failed or timed out' }); }
  }
  async function request(url: string, signal: AbortSignal, init: RequestInit = {}) {
    const response = await fetcher(url, { ...init, signal });
    if (!response.ok) throw new Error('request failed');
    return response;
  }
  await probe('LiveKit', !!(env.livekitUrl && env.livekitApiKey && env.livekitApiSecret), async () => {
    await (opts.mint ?? mintToken)({ apiKey: env.livekitApiKey, apiSecret: env.livekitApiSecret,
      room: 'doctor', identity: 'doctor', ttlSec: 300 });
    return 'token minted locally; connection untested';
  });
  await probe('Chert', !!(env.chertApiKey && env.chertProjectId), async signal => {
    await request(`${env.chertAppBase.replace(/\/$/, '')}/lines`, signal, { headers: {
      Authorization: `Bearer ${env.chertApiKey}`, 'X-Chert-Project-Id': env.chertProjectId,
      'Content-Type': 'application/json',
    } });
    return 'lines endpoint reachable; line capabilities untested';
  });
  await probe('ElevenLabs', !!env.elevenLabsApiKey, async signal => {
    const response = await request('https://api.elevenlabs.io/v1/user/subscription', signal,
      { headers: { 'xi-api-key': env.elevenLabsApiKey } });
    const body = await response.json() as { character_limit?: unknown; character_count?: unknown };
    if (typeof body.character_limit !== 'number' || typeof body.character_count !== 'number'
      || !Number.isFinite(body.character_limit) || !Number.isFinite(body.character_count)) throw new Error('bad quota');
    return `characters left: ${Math.max(0, Math.floor(body.character_limit - body.character_count))}`;
  });
  await probe('Gemini', !!env.geminiApiKey, async signal => {
    await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.geminiModel)}:generateContent`, signal, {
      method: 'POST', headers: { 'x-goog-api-key': env.geminiApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
    });
    return 'generateContent accepted';
  });
  await probe('MongoDB', !!env.mongodbUri, async () => {
    await (opts.pingMongo ?? pingMongo)(env); return 'ping accepted';
  });
  return checks;
}

export async function runDoctor(source: NodeJS.ProcessEnv, env: Env, opts: DoctorOptions = {}) {
  const checks: Check[] = ENV_NAMES.map(name => ({ name,
    status: source[name]?.trim() ? 'OK' : 'MISSING', detail: source[name]?.trim() ? 'set' : 'missing',
  }));
  checks.push(...await checkServices(env, opts));
  return { checks, exitCode: checks.some(c => c.status === 'FAIL' || (opts.strict && c.status === 'MISSING')) ? 1 : 0 };
}

export function formatChecklist(checks: Check[]): string {
  return checks.map(c => `${c.status} ${c.name}: ${c.detail}`).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = loadEnv(process.env, { readDotenv: true });
  void runDoctor(process.env, env, { offline: process.argv.includes('--offline'), strict: process.argv.includes('--strict') })
    .then(result => { console.log(formatChecklist(result.checks)); process.exitCode = result.exitCode; })
    .catch(() => { console.log('FAIL Doctor: check failed'); process.exitCode = 1; });
}
