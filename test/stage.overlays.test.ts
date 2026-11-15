import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerFonts } from '../src/stage/fonts';
import { drawTimerRing, drawReveal, timerSecondsLeft, popScale, fitFontPx, priceTextBox, estimateStampBox } from '../src/stage/overlays';
import { COLORS, FONTS, LAYOUT, STAGE } from '../src/stage/theme';

registerFonts();
const fresh = () => createCanvas(STAGE.w, STAGE.h);
const px = (c: ReturnType<typeof fresh>, x: number, y: number) => Array.from(c.getContext('2d').getImageData(x, y, 1, 1).data);
const bytes = (c: ReturnType<typeof fresh>) => Buffer.from(c.getContext('2d').getImageData(0, 0, STAGE.w, STAGE.h).data.buffer);
const save = (c: ReturnType<typeof fresh>, name: string) => {
  mkdirSync('out/stage', { recursive: true });
  writeFileSync(`out/stage/${name}.png`, c.toBuffer('image/png'));
};
const reveal = (priceText: string, extra = {}) => ({ stage: 'price' as const, priceText, itemName: 'Owala FreeSip 24oz Water Bottle', isEstimate: false, sourceLabel: 'Price list', ...extra });

describe('timer ring', () => {
  it('timerSecondsLeft counts down only while running and clamps at 0', () => {
    expect(timerSecondsLeft({ secondsLeft: 10, total: 10, running: true }, 2500)).toBeCloseTo(7.5);
    expect(timerSecondsLeft({ secondsLeft: 10, total: 10, running: false }, 2500)).toBe(10);
    expect(timerSecondsLeft({ secondsLeft: 2, total: 10, running: true }, 9000)).toBe(0);
  });

  it('ring is cream above 4 s and red from 4 s', () => {
    const b = LAYOUT.timerRing;
    const x = b.x + b.w / 2 - 80; // 9 o'clock on the ring
    const y = b.y + b.h / 2;
    const cream = fresh();
    drawTimerRing(cream.getContext('2d'), { secondsLeft: 6, total: 10, running: false }, 0);
    const [r1, g1, b1] = px(cream, x, y);
    expect(r1).toBeGreaterThan(200); expect(g1).toBeGreaterThan(200); expect(b1).toBeGreaterThan(150);
    const red = fresh();
    drawTimerRing(red.getContext('2d'), { secondsLeft: 4, total: 10, running: false }, 0);
    const [r2, g2, b2] = px(red, x, y);
    expect(r2).toBeGreaterThan(180); expect(g2).toBeLessThan(110); expect(b2).toBeLessThan(120);
    save(red, 'timer-red');
    save(cream, 'timer-cream');
  });

  it('empty arc grows clockwise: at 25% left the 9 o\'clock spot is still filled, 3 o\'clock is not', () => {
    const b = LAYOUT.timerRing;
    const c = fresh();
    drawTimerRing(c.getContext('2d'), { secondsLeft: 2, total: 8, running: false }, 0);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    expect(px(c, cx + 80, cy)[3]).toBeLessThan(255); // dark track only, but no red/cream
    expect(px(c, cx + 80, cy)[0]).toBeLessThan(80);
  });
});

describe('price pop', () => {
  it('popScale goes 0 -> above 1.2 -> 1.0 and stays 1.0', () => {
    expect(popScale(0)).toBe(0);
    const samples = Array.from({ length: 50 }, (_, i) => popScale(i * 10));
    expect(Math.max(...samples)).toBeGreaterThan(1.2);
    expect(popScale(499)).toBeLessThan(1.02);
    expect(popScale(500)).toBe(1);
    expect(popScale(5000)).toBe(1);
  });

  it('long and short prices fit inside x 48..912', () => {
    const ctx = fresh().getContext('2d');
    for (const t of ['$1,000.00', '$0.99', '$34.99', '$12,345,678.99']) {
      const size = fitFontPx(ctx, t, FONTS.title, 150, 864);
      ctx.font = `${size}px ${FONTS.title}`;
      expect(ctx.measureText(t).width).toBeLessThanOrEqual(864);
      const box = priceTextBox(ctx, { priceText: t });
      expect(box.x).toBeGreaterThanOrEqual(48);
      expect(box.x + box.w).toBeLessThanOrEqual(912);
    }
  });

  it('estimate stamp does not intersect the price text box', () => {
    const ctx = fresh().getContext('2d');
    const s = estimateStampBox();
    for (const t of ['$1,000.00', '$0.99', '$34.99']) {
      const p = priceTextBox(ctx, { priceText: t });
      const overlap = s.x < p.x + p.w && s.x + s.w > p.x && s.y < p.y + p.h && s.y + s.h > p.y;
      expect(overlap).toBe(false);
    }
  });

  it('draws the price, and writes pictures', () => {
    const c = fresh();
    drawReveal(c.getContext('2d'), reveal('$34.99', { isEstimate: true }), 800, false);
    expect(px(c, 480, 215)[3]).toBe(255);
    save(c, 'price-estimate');
    const long = fresh();
    drawReveal(long.getContext('2d'), reveal('$1,000.00', { itemName: 'A very long item name '.repeat(6) }), 800, false);
    save(long, 'price-long');
    const flash = fresh();
    drawReveal(flash.getContext('2d'), reveal('$34.99'), 10, false);
    expect(px(flash, 5, 5)[0]).toBeGreaterThan(200);
  });
});

describe('drumroll', () => {
  const dr = { stage: 'drumroll' as const, priceText: '', itemName: '', isEstimate: false, sourceLabel: null };
  it('frames differ over time and are deterministic', () => {
    const a = fresh(), b = fresh(), a2 = fresh();
    drawReveal(a.getContext('2d'), dr, 700, false);
    drawReveal(b.getContext('2d'), dr, 800, false);
    drawReveal(a2.getContext('2d'), dr, 700, false);
    expect(bytes(a).equals(bytes(b))).toBe(false);
    expect(bytes(a).equals(bytes(a2))).toBe(true);
    save(a, 'drumroll');
  });

  it('dims the stage to about 55%', () => {
    const c = fresh();
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, STAGE.w, STAGE.h);
    drawReveal(ctx, dr, 1000, false);
    expect(px(c, 480, 520)[0]).toBeLessThan(200);
    expect(COLORS.navy).toBeTruthy();
  });

  it("stage 'none' leaves the canvas untouched", () => {
    const c = fresh();
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#336699';
    ctx.fillRect(0, 0, STAGE.w, STAGE.h);
    const before = bytes(c);
    drawReveal(ctx, { ...dr, stage: 'none' }, 500, false);
    expect(bytes(c).equals(before)).toBe(true);
  });
});
