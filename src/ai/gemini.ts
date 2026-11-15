/** Gemini calls fail closed and never retain camera frames.
 * TO VERIFY ON THE REAL LINE: model access, JSON output and Search grounding with a real key.
 */
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';
import type { ZodType } from 'zod';
import pino from 'pino';

export interface GeminiClient {
  available: boolean;
  json<T>(a: { prompt: string; schema: ZodType<T>; timeoutMs: number; system?: string; imagesJpeg?: Buffer[] }): Promise<T | null>;
  grounded(a: { prompt: string; timeoutMs: number }): Promise<{ text: string; sources: { title: string; url: string }[] } | null>;
  text(a: { prompt: string; system?: string; timeoutMs: number }): Promise<string | null>;
}

type Sdk = { models: { generateContent(a: GenerateContentParameters): Promise<GenerateContentResponse> } };

/** The timer covers all attempts, including validation, and is always cleared. */
async function bounded<T>(ms: number, work: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<null>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, ms);
      }),
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function createGemini(cfg: { apiKey: string; model: string; sdk?: unknown }): GeminiClient {
  const available = Boolean(cfg.apiKey.trim());
  let sdk: Sdk | null = null;
  try {
    if (available) sdk = (cfg.sdk ?? new GoogleGenAI({ apiKey: cfg.apiKey })) as Sdk;
  } catch { /* A broken client behaves like a failed request. */ }
  if (!available) pino().warn('Gemini API key missing; using offline pricing fallback');

  return {
    available,
    async json<T>(a: { prompt: string; schema: ZodType<T>; timeoutMs: number; system?: string; imagesJpeg?: Buffer[] }) {
      if (!available || !sdk) return null;
      return bounded<T>(a.timeoutMs, async signal => {
        for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
          try {
            const result = await sdk.models.generateContent({
              model: cfg.model,
              contents: [{ role: 'user', parts: [
                { text: a.prompt },
                ...(a.imagesJpeg ?? []).map(image => ({ inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } })),
              ] }],
              config: { temperature: 0, responseMimeType: 'application/json', systemInstruction: a.system, abortSignal: signal },
            });
            const raw = result.text?.trim() ?? '';
            const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw);
            const parsed = a.schema.safeParse(JSON.parse(fence ? fence[1] : raw));
            if (parsed.success) return parsed.data;
          } catch { /* Retry once while the original deadline remains. */ }
        }
        return null;
      });
    },
    async grounded(a) {
      if (!available || !sdk) return null;
      return bounded(a.timeoutMs, async signal => {
        const result = await sdk.models.generateContent({
          model: cfg.model, contents: a.prompt,
          config: { temperature: 0, tools: [{ googleSearch: {} }], abortSignal: signal },
        });
        if (!result.text?.trim()) return null;
        const sources: { title: string; url: string }[] = [];
        const seen = new Set<string>();
        for (const chunk of result.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) {
          const url = chunk.web?.uri;
          if (url && !seen.has(url)) {
            seen.add(url);
            sources.push({ title: chunk.web?.title || url, url });
          }
        }
        return { text: result.text, sources };
      });
    },
    async text(a) {
      if (!available || !sdk) return null;
      return bounded(a.timeoutMs, async signal => {
        const result = await sdk.models.generateContent({
          model: cfg.model, contents: a.prompt,
          config: { temperature: 0, systemInstruction: a.system, abortSignal: signal },
        });
        return result.text?.trim() ? result.text : null;
      });
    },
  };
}
