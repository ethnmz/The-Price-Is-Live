import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { createMouthTracker, type MouthShape } from '../src/stage/mouth';
import { drawHost, isBlinking, type HostPose } from '../src/stage/host-sprite';
import { LAYOUT } from '../src/stage/theme';

const POSES: HostPose[] = ['idle', 'talking', 'reveal', 'celebrate'];
const MOUTHS: MouthShape[] = ['closed', 'half', 'wide'];

describe('mouth tracker', () => {
  it('sine level gives all shapes and never flickers faster than 80 ms', () => {
    const t = createMouthTracker();
    const seen = new Set<MouthShape>();
    let last: MouthShape = 'closed';
    let lastChange = -1000;
    for (let ms = 0; ms < 3000; ms += 10) {
      const level = 0.25 + 0.25 * Math.sin((ms / 1000) * Math.PI * 2 * 2.3);
      const s = t.update(level * 1.6, true, ms);
      seen.add(s);
      if (s !== last) {
        expect(ms - lastChange).toBeGreaterThanOrEqual(80);
        lastChange = ms;
        last = s;
      }
    }
    expect([...seen].sort()).toEqual(['closed', 'half', 'wide']);
  });

  it('uses hysteresis thresholds', () => {
    const t = createMouthTracker();
    expect(t.update(0.15, true, 0)).toBe('closed');
    expect(t.update(0.2, true, 100)).toBe('half');
    expect(t.update(0.12, true, 200)).toBe('half'); // stays open above 0.10
    expect(t.update(0.36, true, 300)).toBe('wide');
    expect(t.update(0.3, true, 400)).toBe('half');
    expect(t.update(0.05, true, 500)).toBe('closed');
  });

  it('holds a shape for 80 ms', () => {
    const t = createMouthTracker();
    expect(t.update(0.5, true, 1000)).toBe('wide');
    expect(t.update(0.0, true, 1040)).toBe('wide');
    expect(t.update(0.0, true, 1090)).toBe('closed');
  });

  it('toggles at about 6 Hz with a null level', () => {
    const t = createMouthTracker();
    let changes = 0;
    let last: MouthShape = 'closed';
    for (let ms = 0; ms < 2000; ms += 5) {
      const s = t.update(null, true, ms);
      expect(['closed', 'half']).toContain(s);
      if (s !== last) { changes++; last = s; }
    }
    // 6 Hz is 6 full open/close cycles a second, so about 24 changes in 2 s
    expect(changes).toBeGreaterThanOrEqual(20);
    expect(changes).toBeLessThanOrEqual(26);
  });

  it('is closed when not speaking', () => {
    const t = createMouthTracker();
    t.update(0.9, true, 0);
    for (let ms = 10; ms < 500; ms += 10) expect(t.update(0.9, false, ms)).toBe('closed');
    expect(t.update(null, false, 600)).toBe('closed');
  });
});

function render(pose: HostPose, mouth: MouthShape, nowMs = 0) {
  const c = createCanvas(960, 540);
  const ctx = c.getContext('2d');
  drawHost(ctx, { pose, mouth, nowMs });
  return { c, ctx, data: ctx.getImageData(0, 0, 960, 540).data };
}

describe('drawHost', () => {
  it('paints inside the host box and nothing outside (all poses x mouths)', () => {
    const b = LAYOUT.host;
    for (const pose of POSES) for (const mouth of MOUTHS) {
      for (const nowMs of [0, 150, 2000]) {
        const { data } = render(pose, mouth, nowMs);
        let inside = 0;
        for (let y = 0; y < 540; y++) for (let x = 0; x < 960; x++) {
          if (data[(y * 960 + x) * 4 + 3] === 0) continue;
          const within = x >= b.x + 2 && x < b.x + b.w - 2 && y >= b.y + 2 && y < b.y + b.h - 2;
          if (!within) throw new Error(`${pose}/${mouth} painted outside the box at ${x},${y}`);
          inside++;
        }
        expect(inside).toBeGreaterThan(5000);
      }
    }
  });

  it('three mouths differ in the mouth area', () => {
    const area = (m: MouthShape) => Buffer.from(render('idle', m).ctx.getImageData(460, 200, 40, 40).data);
    const [a, b, c] = MOUTHS.map(area);
    expect(a.equals(b)).toBe(false);
    expect(b.equals(c)).toBe(false);
    expect(a.equals(c)).toBe(false);
  });

  it('blinks for 120 ms about every 3 to 5 s', () => {
    const starts: number[] = [];
    let prev = false;
    for (let ms = 0; ms < 40000; ms++) {
      const b = isBlinking(ms);
      if (b && !prev) starts.push(ms);
      prev = b;
    }
    expect(starts.length).toBeGreaterThan(5);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(3000);
      expect(starts[i] - starts[i - 1]).toBeLessThanOrEqual(5000);
    }
    expect(isBlinking(starts[0] + 119)).toBe(true);
    expect(isBlinking(starts[0] + 120)).toBe(false);
  });

  it('draws fast and leaves the context state alone', () => {
    const c = createCanvas(960, 540);
    const ctx = c.getContext('2d');
    ctx.lineWidth = 7;
    ctx.fillStyle = '#123456';
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) drawHost(ctx, { pose: 'celebrate', mouth: 'wide', nowMs: i * 33 });
    expect((performance.now() - t0) / 20).toBeLessThan(5);
    expect(ctx.lineWidth).toBe(7);
    expect(ctx.fillStyle).toBe('#123456');
  });

  it('writes a preview strip to out/stage/host-strip.png', () => {
    const cells: Array<[HostPose, MouthShape]> = [
      ['idle', 'closed'], ['idle', 'half'], ['idle', 'wide'],
      ['idle', 'closed'], ['talking', 'half'], ['reveal', 'wide'], ['celebrate', 'wide'],
    ];
    const b = LAYOUT.host;
    const strip = createCanvas(cells.length * b.w, b.h);
    const sctx = strip.getContext('2d');
    sctx.fillStyle = '#14123A';
    sctx.fillRect(0, 0, strip.width, strip.height);
    cells.forEach(([pose, mouth], i) => {
      const { c } = render(pose, mouth);
      sctx.drawImage(c, b.x, b.y, b.w, b.h, i * b.w, 0, b.w, b.h, );
    });
    mkdirSync('out/stage', { recursive: true });
    writeFileSync('out/stage/host-strip.png', strip.toBuffer('image/png'));
  });
});
