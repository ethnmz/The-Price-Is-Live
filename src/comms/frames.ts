// Caller camera frames: keeps only the newest RGBA frame and turns it into small JPEGs.
// Frames live in memory only. They are never written to disk and never logged.
//
// TO VERIFY ON THE REAL LINE:
// - the Chert bridge really publishes the caller's camera as a video track
//   (ideally named `facetime-remote-video`), so frames show up here at all.
import { createCanvas, ImageData } from '@napi-rs/canvas';

export interface FrameGrabber {
  /** Offer a frame. Only the newest one is kept. */
  push(rgba: Uint8Array, width: number, height: number, at?: number): void;
  /** Forget the current frame (track muted, replaced or gone). */
  clear(): void;
  /** Up to `max` JPEGs about gapMs apart, or null when there is no fresh frame. */
  grab(max: number, gapMs?: number): Promise<Buffer[] | null>;
}

const MAX_AGE_MS = 2000;
const OUT_WIDTH = 768;
const JPEG_QUALITY = 70;

interface Held { rgba: Uint8Array; w: number; h: number; at: number }

function toJpeg(f: Held): Buffer {
  const outH = Math.max(1, Math.round((f.h * OUT_WIDTH) / f.w));
  const src = createCanvas(f.w, f.h);
  const ctx = src.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(f.rgba.buffer, f.rgba.byteOffset, f.w * f.h * 4), f.w, f.h), 0, 0);
  const out = createCanvas(OUT_WIDTH, outH);
  out.getContext('2d').drawImage(src, 0, 0, OUT_WIDTH, outH);
  return out.toBuffer('image/jpeg', JPEG_QUALITY);
}

export function createFrameGrabber(opts: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
} = {}): FrameGrabber {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let held: Held | null = null;

  return {
    push(rgba, width, height, at) {
      if (width <= 0 || height <= 0 || rgba.length < width * height * 4) return;
      held = { rgba, w: width, h: height, at: at ?? now() };
    },
    clear() { held = null; },
    async grab(max, gapMs = 400) {
      const count = Math.floor(max);
      if (!(count >= 1)) return null;
      const out: Buffer[] = [];
      let lastAt = -1;
      for (let i = 0; i < count; i++) {
        if (i > 0) await sleep(gapMs);
        const f = held;
        if (!f || now() - f.at > MAX_AGE_MS) {
          if (i === 0) return null; // never treat an old frame as current
          break;
        }
        if (f.at === lastAt) continue; // same frame again, skip the duplicate
        lastAt = f.at;
        try { out.push(toJpeg(f)); } catch { if (i === 0) return null; }
      }
      return out.length ? out : null;
    },
  };
}
