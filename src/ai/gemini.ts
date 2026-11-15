/**
 * Thin Gemini wrapper. Nothing here ever throws: every method resolves null on
 * timeout, error, bad JSON or a missing API key. The key is never logged.
 *
 * TO VERIFY ON THE REAL LINE:
 * - A real GEMINI key works with this model name, and grounding returns sources.
 * - Image parts (imagesJpeg) are accepted by the chosen model.
 */
import { GoogleGenAI } from '@google/genai';
import type { ZodType } from 'zod';

export interface GeminiClient {
  available: boolean;
  json<T>(a: { prompt: string; schema: ZodType<T>; timeoutMs: number; system?: string; imagesJpeg?: Buffer[] }): Promise<T | null>;
  grounded(a: { prompt: string; timeoutMs: number }): Promise<{ text: string; sources: { title: string; url: string }[] } | null>;
  text(a: { prompt: string; system?: string; timeoutMs: number }): Promise<string | null>;
}

/** The only part of the SDK we use (tests inject a fake with this shape). */
interface SdkLike { models: { generateContent(req: any): Promise<any> } }

const UNAVAILABLE: GeminiClient = {
  available: false,
  json: async () => null,
  grounded: async () => null,
  text: async () => null,
};

/** Race a promise against a timer. Resolves null on timeout or rejection. */
async function raced<T>(work: () => Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, ms)); });
  try {
    return await Promise.race([work().catch(() => null), timeout]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Pull JSON out of model text, also when wrapped in a ```json fence. */
export function parseJsonText(raw: string): unknown {
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* none */ } }
  return undefined;
}

export function createGemini(cfg: { apiKey: string; model: string; sdk?: unknown }): GeminiClient {
  if (!cfg.apiKey) return UNAVAILABLE;
  let sdk: SdkLike;
  try {
    sdk = (cfg.sdk as SdkLike | undefined) ?? (new GoogleGenAI({ apiKey: cfg.apiKey }) as unknown as SdkLike);
  } catch {
    return UNAVAILABLE;
  }
  const model = cfg.model;

  const generate = (req: any) => sdk.models.generateContent({ model, ...req });
  const textOf = (res: any): string | null => {
    const t = typeof res?.text === 'string' ? res.text
      : (res?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('');
    return t ? t : null;
  };

  return {
    available: true,

    async json<T>(a: { prompt: string; schema: ZodType<T>; timeoutMs: number; system?: string; imagesJpeg?: Buffer[] }) {
      const deadline = Date.now() + a.timeoutMs;
      const parts: any[] = [{ text: a.prompt }];
      for (const img of a.imagesJpeg ?? []) parts.push({ inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } });
      const attempt = async (): Promise<T | null> => {
        const left = deadline - Date.now();
        if (left <= 0) return null;
        const res = await raced(() => generate({
          contents: [{ role: 'user', parts }],
          config: { temperature: 0, responseMimeType: 'application/json', ...(a.system ? { systemInstruction: a.system } : {}) },
        }), left);
        const txt = textOf(res);
        if (!txt) return null;
        const parsed = a.schema.safeParse(parseJsonText(txt));
        return parsed.success ? parsed.data : null;
      };
      try {
        return (await attempt()) ?? (await attempt());
      } catch {
        return null;
      }
    },

    async grounded(a) {
      const res = await raced(() => generate({
        contents: a.prompt,
        config: { temperature: 0, tools: [{ googleSearch: {} }] },
      }), a.timeoutMs);
      const txt = textOf(res);
      if (txt === null) return null;
      const seen = new Set<string>();
      const sources: { title: string; url: string }[] = [];
      const chunks = res?.candidates?.[0]?.groundingMetadata?.groundingChunks;
      for (const c of Array.isArray(chunks) ? chunks : []) {
        const uri = c?.web?.uri;
        if (typeof uri !== 'string' || !uri || seen.has(uri)) continue;
        seen.add(uri);
        sources.push({ title: typeof c.web.title === 'string' ? c.web.title : uri, url: uri });
      }
      return { text: txt, sources };
    },

    async text(a) {
      const res = await raced(() => generate({
        contents: a.prompt,
        config: { temperature: 0, ...(a.system ? { systemInstruction: a.system } : {}) },
      }), a.timeoutMs);
      return textOf(res);
    },
  };
}
