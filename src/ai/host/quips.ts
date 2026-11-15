/** Optional generated item jokes; rejected lines leave the canned host script in charge.
 * TO VERIFY ON THE REAL LINE: review live Gemini quips for kindness and spoken delivery.
 */
import type { HostPort } from '../../contracts';
import type { GeminiClient } from '../gemini';
import { PERSONA } from './persona';

const UNKIND = new Set(['stupid', 'idiot', 'dumb', 'ugly', 'loser', 'pathetic', 'worthless', 'hate', 'moron', 'trash']);
const FORBIDDEN = /[\p{Nd}$#\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3\ufe0f]/u;

function filter(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.trim().replace(/^["'“‘]+|["'”’]+$/gu, '').trim();
  if (!text || text.split(/\s+/u).length > 18 || FORBIDDEN.test(text)) return null;
  const words = text.normalize('NFKC').toLowerCase().match(/\p{L}+/gu) ?? [];
  return words.some(word => UNKIND.has(word)) ? null : text;
}

export function createQuipper(gemini: GeminiClient): HostPort['quip'] {
  return async (itemName, ownerName) => {
    if (!gemini.available) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 1500); });
      const raw = await Promise.race([gemini.text({
        system: PERSONA,
        prompt: `Item: ${itemName}. Owner: ${ownerName}. Give one playful one-liner about the item, with no price or number.`,
        timeoutMs: 1500,
      }), timeout]);
      return filter(raw);
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
}
