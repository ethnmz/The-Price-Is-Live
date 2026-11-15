// Score fly (round_score) and finale scoreboard (spec 13.3). Pure draw functions: pixels depend only on
// (state, time). Confetti is deterministic: a seeded pseudo-random plus msSincePhase.
//
// TO VERIFY ON THE REAL LINE: nothing needs a phone; check once on a real FaceTime tile that the
// credit line and recap strip stay readable after video compression.
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { StageState } from '../contracts/types';
import { COLORS, CREDIT_LINE, FONTS, SEAT_COLORS, STAGE, podiumXs, PODIUM_W, LAYOUT, type Box } from './theme';

// ---------- score fly ----------

export interface FlyItem { text: string; color: string; x: number; y: number; alpha: number }

export const FLY_MS = 1000; // each number floats for about 1 s
export const FLY_STAGGER_MS = 700; // next number starts this long after the previous
export const FLY_RISE_PX = 90;

/** What floating numbers are visible right now, in order guess, bonus, stump. Zero values are skipped. */
export function scoreFlyItems(s: StageState, msSincePhase: number): FlyItem[] {
  const xs = podiumXs(s.podiums.length);
  const out: FlyItem[] = [];
  s.podiums.forEach((p, i) => {
    if (!p.delta) return;
    const parts: { text: string; color: string }[] = [];
    if (p.delta.guess > 0) parts.push({ text: `+${p.delta.guess}`, color: COLORS.green });
    if (p.delta.bonus > 0) parts.push({ text: `+${p.delta.bonus} BONUS`, color: COLORS.gold });
    if (p.delta.stump > 0) parts.push({ text: `+${p.delta.stump} STUMP!`, color: COLORS.purple });
    parts.forEach((part, k) => {
      const t = (msSincePhase - k * FLY_STAGGER_MS) / FLY_MS;
      if (t < 0 || t > 1) return;
      const alpha = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
      out.push({
        text: part.text,
        color: part.color,
        x: xs[i] + PODIUM_W / 2,
        y: LAYOUT.podiums.y - 10 - FLY_RISE_PX * t,
        alpha: Math.max(0, Math.min(1, alpha)),
      });
    });
  });
  return out;
}

export function drawScoreFly(ctx: SKRSContext2D, s: StageState, msSincePhase: number): void {
  const items = scoreFlyItems(s, msSincePhase);
  if (items.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `30px ${FONTS.title}`;
  ctx.lineJoin = 'round';
  for (const it of items) {
    ctx.globalAlpha = it.alpha;
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.ink;
    ctx.strokeText(it.text, it.x, it.y);
    ctx.fillStyle = it.color;
    ctx.fillText(it.text, it.x, it.y);
  }
  ctx.restore();
}

// ---------- finale ----------

/** Layout boxes (all inside the safe area). */
export const FINALE_BOXES: Record<'banner' | 'board' | 'items' | 'credit', Box> = {
  banner: { x: STAGE.safeX, y: 40, w: STAGE.w - 2 * STAGE.safeX, h: 64 },
  board: { x: 180, y: 118, w: 600, h: 270 },
  items: { x: STAGE.safeX, y: 408, w: STAGE.w - 2 * STAGE.safeX, h: 40 },
  credit: { x: STAGE.safeX, y: 470, w: STAGE.w - 2 * STAGE.safeX, h: 30 },
};
export const CREDIT_POS = { x: STAGE.w / 2, y: FINALE_BOXES.credit.y + FINALE_BOXES.credit.h / 2 };

export const SLIDE_MS = 600;
export const CONFETTI_MS = 6000;
export const MAX_CONFETTI = 200;

function fitFont(ctx: SKRSContext2D, text: string, family: string, maxPx: number, minPx: number, maxW: number): number {
  let px = maxPx;
  for (; px > minPx; px -= 1) {
    ctx.font = `${px}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = `${px}px ${family}`;
  return px;
}

/** Shrink to fit, and as a last resort cut with an ellipsis. */
function fitText(ctx: SKRSContext2D, text: string, family: string, maxPx: number, minPx: number, maxW: number): string {
  fitFont(ctx, text, family, maxPx, minPx, maxW);
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === text ? text : t.trimEnd() + '…';
}

export function bannerText(champion: string[]): string {
  if (champion.length <= 1) return `CHAMPION: ${champion[0] ?? '—'}!`;
  return `CO-CHAMPIONS: ${champion.slice(0, 2).join(' & ')}!`;
}

const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** Seeded pseudo-random (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONFETTI_COLORS = [COLORS.gold, COLORS.alert, COLORS.green, COLORS.purple, COLORS.cream, SEAT_COLORS.p2, SEAT_COLORS.p3];

function drawConfetti(ctx: SKRSContext2D, ms: number): void {
  if (ms < 0 || ms > CONFETTI_MS) return;
  const rand = rng(20260);
  ctx.save();
  for (let i = 0; i < MAX_CONFETTI; i++) {
    const x0 = rand() * STAGE.w;
    const delay = rand() * 1500;
    const speed = 90 + rand() * 140;
    const swayAmp = 10 + rand() * 30;
    const swayRate = 1 + rand() * 3;
    const size = 5 + rand() * 6;
    const color = CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)];
    const spin = rand() * Math.PI * 2;
    const t = (ms - delay) / 1000;
    if (t < 0) continue;
    const y = -20 + speed * t;
    if (y > STAGE.h + 20) continue;
    const x = x0 + Math.sin(t * swayRate + spin) * swayAmp;
    ctx.globalAlpha = ms > CONFETTI_MS - 600 ? Math.max(0, (CONFETTI_MS - ms) / 600) : 1;
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin + t * swayRate * 2);
    ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    ctx.restore();
  }
  ctx.restore();
}

function drawBanner(ctx: SKRSContext2D, s: StageState): void {
  const b = FINALE_BOXES.banner;
  const text = fitText(ctx, bannerText(s.finale!.champion), FONTS.title, 44, 16, b.w - 24);
  ctx.save();
  ctx.fillStyle = COLORS.curtain;
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 14);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.gold;
  ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2 + 2);
  ctx.restore();
}

function drawBoard(ctx: SKRSContext2D, s: StageState, ms: number): void {
  const f = s.finale!;
  const b = FINALE_BOXES.board;
  const n = Math.max(1, f.ranks.length);
  const rowH = Math.min(70, Math.floor(b.h / n) - 6);
  ctx.save();
  f.ranks.forEach((r, i) => {
    const first = r.place === 1;
    const h = first ? rowH : Math.round(rowH * 0.8);
    const y = b.y + i * (rowH + 6) + (rowH - h) / 2;
    // slide in from the left, a little staggered
    const k = easeOut((ms - i * 80) / SLIDE_MS);
    const x = b.x - (1 - k) * (b.x + b.w);
    ctx.globalAlpha = k;
    ctx.fillStyle = first ? COLORS.gold : COLORS.navy;
    ctx.strokeStyle = first ? COLORS.cream : SEAT_COLORS[r.id];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(x, y, b.w, h, 12);
    ctx.fill();
    ctx.stroke();
    const textColor = first ? COLORS.ink : COLORS.cream;
    const px = first ? 34 : 26;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.textAlign = 'left';
    ctx.font = `${px}px ${FONTS.title}`;
    ctx.fillText(`${r.place}`, x + 18, y + h / 2 + 1);
    // total on the right
    ctx.textAlign = 'right';
    ctx.font = `${px}px ${FONTS.title}`;
    const totalText = String(r.total);
    ctx.fillText(totalText, x + b.w - 18, y + h / 2 + 1);
    const totalW = ctx.measureText(totalText).width;
    // name in the middle, shrunk to fit
    ctx.textAlign = 'left';
    const maxNameW = b.w - 18 - 56 - 18 - totalW - 14;
    const name = fitText(ctx, r.name, FONTS.body, first ? 36 : 28, 12, maxNameW);
    ctx.fillText(name, x + 56, y + h / 2 + 1);
  });
  ctx.restore();
}

function drawItemsStrip(ctx: SKRSContext2D, s: StageState): void {
  const items = s.finale!.items;
  if (items.length === 0) return;
  const b = FINALE_BOXES.items;
  ctx.save();
  ctx.fillStyle = 'rgba(20,18,58,0.75)';
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.cream;
  const text = fitText(ctx, items.join(' · '), FONTS.body, 22, 15, b.w - 36);
  ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2 + 1);
  ctx.restore();
}

function drawCredit(ctx: SKRSContext2D): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const b = FINALE_BOXES.credit;
  fitFont(ctx, CREDIT_LINE, FONTS.body, 20, 12, b.w - 40);
  const w = ctx.measureText(CREDIT_LINE).width + 36;
  ctx.fillStyle = 'rgba(20,18,58,0.85)';
  ctx.beginPath();
  ctx.roundRect(CREDIT_POS.x - w / 2, b.y, w, b.h, b.h / 2);
  ctx.fill();
  ctx.fillStyle = COLORS.gold;
  ctx.fillText(CREDIT_LINE, CREDIT_POS.x, CREDIT_POS.y + 1);
  ctx.restore();
}

export function drawFinale(ctx: SKRSContext2D, s: StageState, msSincePhase: number): void {
  if (!s.finale) return;
  const ms = Math.max(0, msSincePhase);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(10,8,30,${0.82 * Math.min(1, ms / 300)})`;
  ctx.fillRect(0, 0, STAGE.w, STAGE.h);
  drawConfetti(ctx, ms);
  drawBanner(ctx, s);
  drawBoard(ctx, s, ms);
  drawItemsStrip(ctx, s);
  drawCredit(ctx);
  ctx.restore();
}
