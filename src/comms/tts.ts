// ElevenLabs text-to-speech client with a disk cache and a character budget
// (docs/API.md sections 5 and 6, SPEC 8.2 and 21.2). Plain fetch, no SDK.
// Output is always 24 kHz mono Int16.
// TO VERIFY ON THE REAL LINE:
// - the real voice id and model accept the voice_settings fields (stability, similarity_boost, style, speed)
// - pcm_24000 is allowed on the account's plan (pcm_16000 is resampled here if not)
// - the real character count billed matches the text length we count
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Emotion } from '../contracts/types';

export interface Tts {
  synthesize(text: string, emotion: Emotion): Promise<Int16Array | null>;
  warmCache(lines: string[]): Promise<{ generated: number; cached: number }>;
  stats(): { charsUsed: number; budget: number; cacheHits: number; cacheMisses: number; mode: 'live' | 'cached_only' };
}

export interface TtsConfig {
  apiKey: string;
  voiceId: string;
  model: string;
  format: string;
  charBudget: number;
  cacheDir?: string;
  fetch?: typeof fetch;
}

const OUT_RATE = 24000;
const TIMEOUT_MS = 8000;
const WARN_AT = 0.7;
const CACHED_ONLY_AT = 0.9;
const COUNTER_FILE = 'chars-used.json';

const PRESETS: Record<string, { stability: number; similarity_boost: number; style: number; speed: number }> = {
  hype: { stability: 0.3, similarity_boost: 0.75, style: 0.6, speed: 1.08 },
  drumroll: { stability: 0.4, similarity_boost: 0.75, style: 0.7, speed: 0.95 },
  warm: { stability: 0.5, similarity_boost: 0.75, style: 0.3, speed: 1.0 },
};

/** Sample rate named by a format like "pcm_16000", or null if it is not raw PCM. */
function pcmRate(format: string): number | null {
  const m = /^pcm_(\d+)$/.exec(format);
  return m ? Number(m[1]) : null;
}

/** Raw little-endian 16-bit bytes to samples. An odd trailing byte is dropped. */
function bytesToInt16(buf: Uint8Array): Int16Array {
  const n = buf.length >> 1;
  const view = new DataView(buf.buffer, buf.byteOffset, n * 2);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function int16ToBytes(pcm: Int16Array): Buffer {
  const b = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], i * 2);
  return b;
}

/** Linear resample. */
export function resampleLinear(pcm: Int16Array, from: number, to: number): Int16Array {
  if (from === to || pcm.length === 0) return pcm;
  const n = Math.round((pcm.length * to) / from);
  const out = new Int16Array(n);
  const step = from / to;
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const i0 = Math.min(Math.floor(pos), pcm.length - 1);
    const i1 = Math.min(i0 + 1, pcm.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(pcm[i0] * (1 - frac) + pcm[i1] * frac);
  }
  return out;
}

export function createTts(cfg: TtsConfig): Tts {
  const doFetch = cfg.fetch ?? fetch;
  const cacheDir = cfg.cacheDir ?? '.cache/tts';
  const inflight = new Map<string, Promise<Int16Array | null>>();
  let cacheHits = 0;
  let cacheMisses = 0;
  let warned = false;
  let charsUsed = loadCounter();

  function loadCounter(): number {
    try {
      const n = Number(JSON.parse(readFileSync(join(cacheDir, COUNTER_FILE), 'utf8')).charsUsed);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  function saveCounter(): void {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, COUNTER_FILE), JSON.stringify({ charsUsed }));
    } catch {
      // a read-only disk must not break the show
    }
  }

  function mode(): 'live' | 'cached_only' {
    return cfg.charBudget > 0 && charsUsed >= cfg.charBudget * CACHED_ONLY_AT ? 'cached_only' : 'live';
  }

  function keyFor(text: string, emotion: Emotion): string {
    const h = createHash('sha256');
    h.update([cfg.voiceId, cfg.model, cfg.format, emotion, text].join('\u0000'));
    return h.digest('hex');
  }

  function readCache(key: string): Int16Array | null {
    try {
      const buf = readFileSync(join(cacheDir, `${key}.pcm`));
      return buf.length >= 2 ? bytesToInt16(buf) : null;
    } catch {
      return null;
    }
  }

  function writeCache(key: string, pcm: Int16Array): void {
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, `${key}.pcm`), int16ToBytes(pcm));
    } catch {
      // cache is best effort
    }
  }

  function countChars(n: number): void {
    charsUsed += n;
    saveCounter();
    if (!warned && cfg.charBudget > 0 && charsUsed >= cfg.charBudget * WARN_AT) {
      warned = true;
      console.warn(`[tts] ${charsUsed} of ${cfg.charBudget} ElevenLabs characters used (70% warning)`);
    }
  }

  async function fetchLive(text: string, emotion: Emotion): Promise<Int16Array | null> {
    const rate = pcmRate(cfg.format);
    if (rate === null) return null;
    countChars(text.length);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cfg.voiceId)}/stream?output_format=${encodeURIComponent(cfg.format)}`;
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/octet-stream' },
        body: JSON.stringify({ text, model_id: cfg.model, voice_settings: PRESETS[emotion] ?? PRESETS.warm }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        console.warn(`[tts] ElevenLabs HTTP ${res.status}`);
        return null;
      }
      const pcm = bytesToInt16(new Uint8Array(await res.arrayBuffer()));
      if (pcm.length === 0) return null;
      return resampleLinear(pcm, rate, OUT_RATE);
    } catch (e) {
      console.warn(`[tts] request failed: ${e instanceof Error ? e.name : 'error'}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(key: string, text: string, emotion: Emotion): Promise<Int16Array | null> {
    const hit = readCache(key);
    if (hit) {
      cacheHits++;
      return hit;
    }
    cacheMisses++;
    if (!cfg.apiKey || !cfg.voiceId || mode() === 'cached_only' || !text) return null;
    const pcm = await fetchLive(text, emotion);
    if (pcm) writeCache(key, pcm);
    return pcm;
  }

  function synthesize(text: string, emotion: Emotion): Promise<Int16Array | null> {
    const key = keyFor(text, emotion);
    const running = inflight.get(key);
    if (running) return running;
    const p = run(key, text, emotion).finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function warmCache(lines: string[]): Promise<{ generated: number; cached: number }> {
    let generated = 0;
    let cached = 0;
    for (const line of lines) {
      if (readCache(keyFor(line, 'hype'))) {
        cached++;
        continue;
      }
      if (mode() === 'cached_only') break;
      if (await synthesize(line, 'hype')) generated++;
    }
    return { generated, cached };
  }

  return {
    synthesize,
    warmCache,
    stats: () => ({ charsUsed, budget: cfg.charBudget, cacheHits, cacheMisses, mode: mode() }),
  };
}
