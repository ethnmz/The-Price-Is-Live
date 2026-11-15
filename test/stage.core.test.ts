import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { allStageFixtures, stressStageFixture } from '../fixtures/stage-states';
import { registerFonts } from '../src/stage/fonts';
import { drawBackground } from '../src/stage/background';
import { drawHud, formatClock } from '../src/stage/hud';
import { drawPodiums, podiumBoxes, fitNameFont } from '../src/stage/podium';
import { LAYOUT, STAGE, FONTS } from '../src/stage/theme';
import { writeFileSync, mkdirSync } from 'node:fs';

const fresh = () => createCanvas(STAGE.w, STAGE.h);

function region(c: ReturnType<typeof fresh>, x: number, y: number, w: number, h: number): Buffer {
  return Buffer.from(c.getContext('2d').getImageData(x, y, w, h).data.buffer);
}

describe('stage core', () => {
  it('registerFonts is safe twice', () => {
    registerFonts();
    registerFonts();
  });

  it('every function runs for every fixture', () => {
    const states = [...allStageFixtures().map((f) => f.state), stressStageFixture()];
    for (const s of states) {
      const c = fresh();
      const ctx = c.getContext('2d');
      expect(() => { drawBackground(ctx, 0); drawHud(ctx, s, 0); drawPodiums(ctx, s, 123); }).not.toThrow();
    }
    mkdirSync('out', { recursive: true });
    const c = fresh();
    const ctx = c.getContext('2d');
    const s = stressStageFixture();
    drawBackground(ctx, 0); drawHud(ctx, s, 0); drawPodiums(ctx, s, 0);
    writeFileSync('out/stage-core.png', c.toBuffer('image/png'));
  });

  it('marquee bulbs blink but curtains stay put', () => {
    const a = fresh(); const b = fresh();
    drawBackground(a.getContext('2d'), 0);
    drawBackground(b.getContext('2d'), 250);
    const m = LAYOUT.marquee;
    expect(region(a, m.x, m.y, m.w, m.h).equals(region(b, m.x, m.y, m.w, m.h))).toBe(false);
    expect(region(a, 0, 0, 150, 440).equals(region(b, 0, 0, 150, 440))).toBe(true);
    expect(region(a, 810, 0, 150, 440).equals(region(b, 810, 0, 150, 440))).toBe(true);
  });

  it('podiums fit the safe area without overlap', () => {
    for (const n of [2, 3, 4]) {
      const boxes = podiumBoxes(n);
      expect(boxes).toHaveLength(n);
      boxes.forEach((b, i) => {
        expect(b.x).toBeGreaterThanOrEqual(STAGE.safeX);
        expect(b.x + b.w).toBeLessThanOrEqual(STAGE.w - STAGE.safeX);
        if (i > 0) expect(b.x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].w);
      });
    }
  });

  it('a 12-character name fits its plate', () => {
    const ctx = fresh().getContext('2d');
    const name = 'WWWWWWWWWWWW';
    const plateW = 190 - 20 - 12;
    const px = fitNameFont(ctx, name, plateW);
    ctx.font = `${px}px ${FONTS.body}`;
    expect(ctx.measureText(name).width).toBeLessThanOrEqual(plateW);
  });

  it('formats the call clock', () => {
    expect(formatClock(32000)).toBe('0:32');
    expect(formatClock(0)).toBe('0:00');
  });

  it('draws 300 frames under 30 ms each on average', () => {
    const c = fresh();
    const ctx = c.getContext('2d');
    const s = stressStageFixture();
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) { drawBackground(ctx, i * 33); drawHud(ctx, s, i * 33); drawPodiums(ctx, s, i * 33); }
    const avg = (performance.now() - t0) / 300;
    console.log(`avg frame ms: ${avg.toFixed(2)}`);
    expect(avg).toBeLessThan(30);
  });
});
