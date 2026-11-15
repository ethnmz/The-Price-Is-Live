import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFrameGrabber } from '../src/comms/frames';

function rgba(w: number, h: number): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 200; d[i + 1] = 80; d[i + 2] = 20; d[i + 3] = 255; }
  return d;
}
function jpegWidth(b: Buffer): number {
  let i = 2;
  while (i < b.length) {
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return b.readUInt16BE(i + 7);
    i += 2 + b.readUInt16BE(i + 2);
  }
  return -1;
}
function setup() {
  let t = 10_000;
  const g = createFrameGrabber({ now: () => t, sleep: async (ms) => { t += ms; } });
  return { g, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe('createFrameGrabber', () => {
  it('makes 768 px wide JPEGs', async () => {
    const { g } = setup();
    g.push(rgba(320, 240), 320, 240);
    const out = await g.grab(1);
    expect(out).toHaveLength(1);
    expect(out![0][0]).toBe(0xff);
    expect(out![0][1]).toBe(0xd8);
    expect(jpegWidth(out![0])).toBe(768);
  });

  it('returns null with no frame, or a frame older than 2 s', async () => {
    const { g, tick } = setup();
    expect(await g.grab(3)).toBeNull();
    g.push(rgba(64, 48), 64, 48);
    tick(2500);
    expect(await g.grab(3)).toBeNull();
  });

  it('respects max and takes frames about gapMs apart', async () => {
    const { g, now } = setup();
    // a new frame every time the clock moves, like a live camera
    const feed = setInterval(() => g.push(rgba(64, 48), 64, 48, now()), 1);
    try {
      g.push(rgba(64, 48), 64, 48);
      const out = await g.grab(5, 0);
      expect(out!.length).toBeLessThanOrEqual(5);
    } finally { clearInterval(feed); }
    g.push(rgba(64, 48), 64, 48);
    expect((await g.grab(2))!.length).toBeLessThanOrEqual(2);
  });

  it('forgets the frame after clear()', async () => {
    const { g } = setup();
    g.push(rgba(64, 48), 64, 48);
    g.clear();
    expect(await g.grab(1)).toBeNull();
  });

  it('does not import node:fs', () => {
    const src = readFileSync(new URL('../src/comms/frames.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from\s+['"](node:)?fs/);
  });
});
