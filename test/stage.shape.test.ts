// The square frame (720x720) for group FaceTime tiles: every box fits, and the host stays in his box.
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { LAYOUT, PODIUM_W, STAGE, applyShape, applyTheme, podiumXs, shape } from '../src/stage/theme';
import { createRenderer } from '../src/stage/render';
import { drawHost } from '../src/stage/host-sprite';
import { FINALE_BOXES, drawFinale } from '../src/stage/finale';
import { stageFixture } from '../fixtures/stage-states';

afterEach(() => { applyShape('wide'); applyTheme('classic'); });

const inFrame = (b: { x: number; y: number; w: number; h: number }) =>
  b.x >= 0 && b.y >= 0 && b.x + b.w <= STAGE.w && b.y + b.h <= STAGE.h;

describe('square stage shape', () => {
  it('picks square for a square output and wide for 16:9', () => {
    createRenderer({ width: 720, height: 720 });
    expect(shape()).toBe('square');
    expect(STAGE.w).toBe(720);
    createRenderer({ width: 960, height: 540 });
    expect(shape()).toBe('wide');
    expect(STAGE.w).toBe(960);
  });

  it('keeps every layout box, podium and finale box inside the 720x720 frame', () => {
    applyShape('square');
    for (const [name, b] of Object.entries(LAYOUT)) expect(inFrame(b), name).toBe(true);
    for (const n of [2, 3, 4]) {
      for (const x of podiumXs(n)) expect(x >= 0 && x + PODIUM_W <= STAGE.w).toBe(true);
    }
    const ctx = createCanvas(720, 720).getContext('2d');
    drawFinale(ctx, stageFixture('finale', 4), 5000);
    for (const [name, b] of Object.entries(FINALE_BOXES)) expect(inFrame(b), name).toBe(true);
  });

  it('draws the host only inside the square host box', () => {
    applyShape('square');
    applyTheme('odyssey');
    const c = createCanvas(720, 720);
    drawHost(c.getContext('2d'), { pose: 'celebrate', mouth: 'wide', nowMs: 0 });
    const px = c.getContext('2d').getImageData(0, 0, 720, 720).data;
    const b = LAYOUT.host;
    let inside = 0;
    for (let y = 0; y < 720; y++) {
      for (let x = 0; x < 720; x++) {
        if (px[(y * 720 + x) * 4 + 3] === 0) continue;
        const ok = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
        if (!ok) throw new Error(`host pixel outside its box at ${x},${y}`);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(5000);
  });

  it('renders every phase as a 720x720 frame', () => {
    const r = createRenderer({ width: 720, height: 720, theme: 'odyssey' });
    for (const p of ['lobby', 'guess_listen', 'reveal', 'finale'] as const) {
      expect(r.render(stageFixture(p, 4), 1000, 0.3).length).toBe(720 * 720 * 4);
    }
  });
});
