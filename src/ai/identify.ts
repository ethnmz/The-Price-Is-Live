/** Camera identification keeps frames in memory and never logs them.
 * TO VERIFY ON THE REAL LINE: held-item accuracy and empty-hand rejection on live FaceTime frames.
 */
import { z } from 'zod';
import type { GeminiClient } from './gemini';

const IdentificationSchema = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  notHolding: z.boolean(),
});

const prompt = "This is a screenshot of a FaceTime call. Ignore people's faces and FaceTime buttons or names. Find the ONE physical product a person is holding up to the camera. Return JSON: {label: string (brand + product + size if visible), confidence: 0 to 1, notHolding: boolean}. If you cannot tell, set notHolding true.";

export function createIdentifier(gemini: GeminiClient): (jpegs: Buffer[]) => Promise<{ label: string; confidence: number } | null> {
  return async (jpegs) => {
    if (!gemini.available || jpegs.length === 0) return null;
    try {
      const result = await gemini.json({
        prompt, schema: IdentificationSchema, timeoutMs: 4000, imagesJpeg: jpegs.slice(0, 3),
      });
      const parsed = IdentificationSchema.safeParse(result);
      if (!parsed.success) return null;
      const { label, confidence, notHolding } = parsed.data;
      if (notHolding || confidence < 0.5 || !label.trim()) return null;
      return { label, confidence };
    } catch {
      return null;
    }
  };
}
