import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { stageFixture } from '../fixtures/stage-states';
import { registerFonts } from '../src/stage/fonts';
import { drawBackground } from '../src/stage/background';
import { drawPodiums } from '../src/stage/podium';
import { STAGE, podiumXs, PODIUM_W } from '../src/stage/theme';
import {
  drawFinale, drawScoreFly, scoreFlyItems, FINALE_BOXES, CREDIT_POS, FLY_STAGGER_MS, bannerText,
} from '../src/stage/finale';
import type { StageState } from '../src/contracts/types';

registerFonts();
const fresh = () => createCanvas(STAGE.w, STAGE.h);
const px = (c: ReturnType<typeof fresh>, x: number, y: number, w: number, h: number) =>
  Buffer.from(c.getContext('2d').getImageData(x, y, w, h).data.buffer);
const finaleOf = (n: 2 | 3 | 4) => stageFixture('finale', n);

function render(s: StageState, ms: number) {
  const c = fresh();
  const ctx = c.getContext('2d');
  drawBackground(ctx, 0);
  drawPodiums(ctx, s, 0);
  drawFinale(ctx, s, ms);
  return c;
}

describe('score fly', () => {
  const s = stageFixture('round_score', 4);
  const mid = (txt: string) => scoreFlyItems(s, 0).concat().find((i) => i.text === txt);

  it('shows guess, then bonus, then stump in order and skips zeros', () => {
    const p2 = (ms: number) => scoreFlyItems(s, ms).filter((i) => i.x === podiumXs(4)[1] + PODIUM_W / 2).map((i) => i.text);
    expect(p2(100)).toEqual(['+86']);
    expect(p2(FLY_STAGGER_MS + 200)).toEqual(['+86', '+25 BONUS']);
    expect(p2(5000)).toEqual([]);
    const p1 = scoreFlyItems(s, 100).filter((i) => i.x === podiumXs(4)[0] + PODIUM_W / 2).map((i) => i.text);
    expect(p1).toEqual(['+38 STUMP!']);
    expect(mid('+0')).toBeUndefined();
  });

  it('floats up and uses the right colors', () => {
    const a = scoreFlyItems(s, 100).find((i) => i.text === '+86')!;
    const b = scoreFlyItems(s, 600).find((i) => i.text === '+86')!;
    expect(b.y).toBeLessThan(a.y);
    expect(a.color).toBe('#2EC46B');
  });

  it('nothing for podiums without delta', () => {
    const none = stageFixture('guess_listen', 3);
    expect(scoreFlyItems(none, 300)).toEqual([]);
    const c = fresh();
    const before = px(c, 0, 0, STAGE.w, STAGE.h);
    drawScoreFly(c.getContext('2d'), none, 300);
    expect(px(c, 0, 0, STAGE.w, STAGE.h).equals(before)).toBe(true);
  });

  it('draws pixels when items are visible', () => {
    const c = fresh();
    drawBackground(c.getContext('2d'), 0);
    const before = px(c, 0, 0, STAGE.w, STAGE.h);
    drawScoreFly(c.getContext('2d'), s, 300);
    expect(px(c, 0, 0, STAGE.w, STAGE.h).equals(before)).toBe(false);
  });
});

describe('finale', () => {
  it('runs for 2, 3 and 4 players and a tie, writing PNGs', () => {
    mkdirSync('out/stage', { recursive: true });
    for (const n of [2, 3, 4] as const) {
      const c = render(finaleOf(n), 2500);
      writeFileSync(`out/stage/finale-${n}.png`, c.toBuffer('image/png'));
    }
    const tie = finaleOf(2);
    tie.finale!.ranks = tie.finale!.ranks.map((r) => ({ ...r, total: 100, place: 1 }));
    tie.finale!.champion = [tie.finale!.ranks[0].name, tie.finale!.ranks[1].name];
    expect(bannerText(tie.finale!.champion)).toMatch(/^CO-CHAMPIONS: .+ & .+!$/);
    writeFileSync('out/stage/finale-tie.png', render(tie, 2500).toBuffer('image/png'));
    const fly = stageFixture('round_score', 4);
    const c = fresh();
    drawBackground(c.getContext('2d'), 0);
    drawPodiums(c.getContext('2d'), fly, 0);
    drawScoreFly(c.getContext('2d'), fly, 900);
    writeFileSync('out/stage/score-fly.png', c.toBuffer('image/png'));
  });

  it('does nothing without s.finale', () => {
    const c = fresh();
    const before = px(c, 0, 0, STAGE.w, STAGE.h);
    drawFinale(c.getContext('2d'), stageFixture('guess_listen', 4), 1000);
    expect(px(c, 0, 0, STAGE.w, STAGE.h).equals(before)).toBe(true);
  });

  it('layout boxes sit inside the safe area and do not overlap', () => {
    const boxes = Object.values(FINALE_BOXES);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(STAGE.safeX);
      expect(b.x + b.w).toBeLessThanOrEqual(STAGE.w - STAGE.safeX);
      expect(b.y).toBeGreaterThanOrEqual(STAGE.safeY);
      expect(b.y + b.h).toBeLessThanOrEqual(STAGE.h - STAGE.safeY);
    }
    const order = [FINALE_BOXES.banner, FINALE_BOXES.board, FINALE_BOXES.items, FINALE_BOXES.credit];
    order.forEach((b, i) => { if (i) expect(b.y).toBeGreaterThanOrEqual(order[i - 1].y + order[i - 1].h); });
  });

  it('keeps 12-character names inside the board box', () => {
    const s = finaleOf(4);
    s.finale!.ranks = s.finale!.ranks.map((r) => ({ ...r, name: 'WWWWWWWWWWWW' }));
    s.finale!.champion = ['WWWWWWWWWWWW'];
    s.finale!.items = Array.from({ length: 6 }, () => 'WWWWWWWWWWWW: A very long item name $99.99');
    const c = render(s, 3000);
    writeFileSync('out/stage/finale-long.png', c.toBuffer('image/png'));
    // nothing but the confetti-free dim overlay outside the safe margins on the left/right edges of the board rows
    const b = FINALE_BOXES.board;
    const leftOfBoard = px(render(finaleOf(4), 3000), 0, b.y, 60, b.h);
    expect(px(c, 0, b.y, 60, b.h).equals(leftOfBoard)).toBe(true);
  });

  it('draws the credit line at its position', () => {
    const s = finaleOf(3);
    const bare = fresh();
    drawBackground(bare.getContext('2d'), 0);
    const withCredit = render(s, 7000); // confetti finished
    const w = 300;
    const a = px(bare, CREDIT_POS.x - w / 2, CREDIT_POS.y - 8, w, 16);
    expect(px(withCredit, CREDIT_POS.x - w / 2, CREDIT_POS.y - 8, w, 16).equals(a)).toBe(false);
  });

  it('confetti is deterministic in time', () => {
    const s = finaleOf(4);
    const area = (c: ReturnType<typeof fresh>) => px(c, 0, 0, STAGE.w, 36);
    const a = area(render(s, 2000));
    const a2 = area(render(s, 2000));
    const b = area(render(s, 2400));
    expect(a.equals(a2)).toBe(true);
    expect(a.equals(b)).toBe(false);
  });
});
