// Overlays (docs/SPEC.md 13.3): the countdown ring, the drumroll and the price pop.
// Every function is pure: (ctx, data, time) -> pixels. Only the font-fit cache is global.
// TO VERIFY ON THE REAL LINE: the Bungee / Lilita One font files may be missing; the fallback fonts are wider,
// so the price is always fitted by measuring, never by guessing.
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { StageState } from '../contracts/types';
import { COLORS, FONTS, LAYOUT, STAGE } from './theme';
import { shade, sparkle } from './fx';

type Timer = NonNullable<StageState['timer']>;
type Reveal = NonNullable<StageState['reveal']>;

const RING_R = 80;
const RING_W = 14;
const RED_AT = 4;
const POP_MS = 500;
const SAFE_W = STAGE.w - 2 * STAGE.safeX; // 864
const PRICE_CY = 228;
const NAME_Y = 316;
const SOURCE_Y = 350;
/** The price pops to 1.25x; size it so even the peak stays inside the safe area. */
const PRICE_MAX_W = Math.floor(SAFE_W / 1.25);

/** Seconds left now (a fraction), clamped at 0. Counts down only while the timer is running. */
export function timerSecondsLeft(timer: Timer, msSinceSet: number): number {
  const left = timer.secondsLeft - (timer.running ? Math.max(0, msSinceSet) / 1000 : 0);
  return Math.max(0, left);
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Scale of the price while it pops in: 0 -> 1.25 (ease-out) -> 1.0 (settle), done at 500 ms. */
export function popScale(ms: number): number {
  if (ms <= 0) return 0;
  if (ms >= POP_MS) return 1;
  const t = ms / POP_MS;
  if (t < 0.6) {
    const u = t / 0.6;
    return 1.25 * (1 - Math.pow(1 - u, 3));
  }
  const u = (t - 0.6) / 0.4;
  const ease = u * u * (3 - 2 * u);
  return 1.25 - 0.25 * ease;
}

const fitCache = new Map<string, number>();

/** Largest font size (at most startPx) at which `text` is no wider than maxWidth. Never below 10 px. */
export function fitFontPx(ctx: SKRSContext2D, text: string, family: string, startPx: number, maxWidth: number): number {
  const key = `${family}|${startPx}|${maxWidth}|${text}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  ctx.save();
  let px = startPx;
  while (px > 10) {
    ctx.font = `${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 2;
  }
  ctx.restore();
  px = Math.max(10, px);
  if (fitCache.size > 200) fitCache.clear();
  fitCache.set(key, px);
  return px;
}

// ---------- countdown ring ----------

export function drawTimerRing(ctx: SKRSContext2D, timer: Timer, msSinceSet: number): void {
  const b = LAYOUT.timerRing;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const left = timerSecondsLeft(timer, msSinceSet);
  const shown = Math.ceil(left - 1e-9);
  const red = left <= RED_AT;
  const frac = timer.total > 0 ? clamp01(left / timer.total) : 0;
  const pulse = red && left > 0 ? 0.5 + 0.5 * Math.sin((msSinceSet / 1000) * Math.PI * 4) : 0;

  ctx.save();
  ctx.lineCap = 'butt';
  // V2: a dark glass dial with a beveled rim behind the track
  const dial = ctx.createRadialGradient(cx, cy - 20, 10, cx, cy, RING_R + 14);
  dial.addColorStop(0, 'rgba(26,58,82,0.85)');
  dial.addColorStop(1, 'rgba(6,20,34,0.92)');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, RING_R + RING_W / 2 + 6, 0, Math.PI * 2);
  ctx.fillStyle = dial;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, RING_R + RING_W / 2 + 6, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(232,201,122,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // dark track
  ctx.beginPath();
  ctx.arc(cx, cy, RING_R, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = RING_W + 6;
  ctx.stroke();
  // the remaining arc: the empty part grows clockwise from 12 o'clock
  if (frac > 0) {
    const start = -Math.PI / 2 + Math.PI * 2 * (1 - frac);
    ctx.beginPath();
    ctx.arc(cx, cy, RING_R, start, -Math.PI / 2 + Math.PI * 2);
    const arcGrad = ctx.createLinearGradient(cx, cy - RING_R, cx, cy + RING_R);
    arcGrad.addColorStop(0, red ? '#FF9A7A' : '#FFFDF4');
    arcGrad.addColorStop(0.35, red ? COLORS.alert : COLORS.cream);
    arcGrad.addColorStop(0.75, red ? COLORS.alert : COLORS.cream);
    arcGrad.addColorStop(1, red ? shade(COLORS.alert, -0.2) : COLORS.gold);
    ctx.strokeStyle = arcGrad;
    ctx.lineWidth = RING_W + pulse * 4;
    ctx.shadowColor = red ? COLORS.alert : 'rgba(232,201,122,0.8)';
    ctx.shadowBlur = red ? 8 + pulse * 14 : 10;
    ctx.stroke();
  }
  // flash at zero
  if (timer.running && left <= 0) {
    const sinceZero = msSinceSet - timer.secondsLeft * 1000;
    if (sinceZero >= 0 && sinceZero < 300) {
      ctx.beginPath();
      ctx.arc(cx, cy, RING_R, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.alert;
      ctx.globalAlpha = 1 - sinceZero / 300;
      ctx.lineWidth = RING_W + 8;
      ctx.stroke();
    }
  }
  ctx.restore();

  // the digit; in the last three seconds it pops 1.3 -> 1.0 over 250 ms
  let scale = 1;
  if (timer.running && shown >= 1 && shown <= 3) {
    const sinceTick = (shown - left) * 1000;
    scale = 1.3 - 0.3 * clamp01(sinceTick / 250);
  }
  ctx.save();
  ctx.translate(cx, cy + 4);
  ctx.scale(scale, scale);
  ctx.font = `90px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 8;
  ctx.strokeStyle = COLORS.ink;
  ctx.strokeText(String(shown), 0, 0);
  ctx.fillStyle = red ? COLORS.alert : COLORS.cream;
  ctx.fillText(String(shown), 0, 0);
  ctx.restore();
}

// ---------- reveal ----------

/** Slot-machine digit for position i at this time: changes every 100 ms (10 Hz), fully deterministic. */
export function slotDigit(msSinceStage: number, i: number): number {
  const step = Math.floor(Math.max(0, msSinceStage) / 100);
  let h = (step * 2654435761 + (i + 1) * 40503) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return (h >>> 7) % 10;
}

function drawBeam(ctx: SKRSContext2D, x: number, spread: number, color: string): void {
  const g = ctx.createLinearGradient(x, 0, x, STAGE.h);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 14, 0);
  ctx.lineTo(x + 14, 0);
  ctx.lineTo(x + spread + 120, STAGE.h);
  ctx.lineTo(x + spread - 120, STAGE.h);
  ctx.closePath();
  ctx.fill();
}

function drawDrumroll(ctx: SKRSContext2D, ms: number, lightning: boolean): void {
  ctx.save();
  ctx.fillStyle = COLORS.navy;
  ctx.globalAlpha = 0.55 * clamp01(ms / 400);
  ctx.fillRect(0, 0, STAGE.w, STAGE.h);
  // two beams that sweep towards each other and back
  const sweep = Math.sin((ms / 1000) * Math.PI * 1.2);
  ctx.globalAlpha = 0.35 * clamp01(ms / 400);
  const color = lightning ? 'rgba(155,93,229,0.9)' : 'rgba(255,226,122,0.9)';
  drawBeam(ctx, 200, 260 * sweep, color);
  drawBeam(ctx, 760, -260 * sweep, color);
  ctx.restore();

  const digits = [0, 1, 2, 3].map((i) => slotDigit(ms, i));
  const s = `$ ${digits[0]}${digits[1]} . ${digits[2]}${digits[3]}`;
  ctx.save();
  ctx.font = `${fitFontPx(ctx, s, FONTS.title, 130, SAFE_W)}px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#000';
  ctx.strokeText(s, STAGE.w / 2, PRICE_CY);
  ctx.fillStyle = COLORS.gold;
  ctx.fillText(s, STAGE.w / 2, PRICE_CY);
  ctx.restore();
}

interface Rect { x: number; y: number; w: number; h: number }

/** The rectangle the price digits occupy once fully popped (measured with the fitted font). */
export function priceTextBox(ctx: SKRSContext2D, reveal: Pick<Reveal, 'priceText'>): Rect {
  const px = fitFontPx(ctx, reveal.priceText, FONTS.title, 150, PRICE_MAX_W);
  ctx.save();
  ctx.font = `${px}px ${FONTS.title}`;
  const w = ctx.measureText(reveal.priceText).width;
  ctx.restore();
  const h = px * 0.85;
  return { x: STAGE.w / 2 - w / 2, y: PRICE_CY - h / 2, w, h };
}

const STAMP = { cx: 770, cy: 118, w: 200, h: 46, angle: (-8 * Math.PI) / 180 };

/** Bounding box of the (rotated) ESTIMATE stamp. It sits above-right of the price. */
export function estimateStampBox(): Rect {
  const { cx, cy, w, h, angle } = STAMP;
  const bw = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle));
  const bh = Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle));
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function drawStarburst(ctx: SKRSContext2D, ms: number, scale: number): void {
  const cx = STAGE.w / 2;
  ctx.save();
  ctx.translate(cx, PRICE_CY);
  ctx.rotate((ms / 1000) * 0.4);
  const rays = 18;
  const len = 420 * Math.min(1, scale);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const half = Math.PI / rays / 1.6;
    // V2: rays fade out from the center, so the burst reads as light rather than flat wedges
    const ray = ctx.createRadialGradient(0, 0, 20, 0, 0, len);
    ray.addColorStop(0, i % 2 ? 'rgba(255,214,120,0.55)' : 'rgba(255,248,225,0.4)');
    ray.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = ray;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - half) * len, Math.sin(a - half) * len);
    ctx.lineTo(Math.cos(a + half) * len, Math.sin(a + half) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Cut text with an ellipsis until it fits maxWidth at the current font. */
function ellipsize(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function drawPrice(ctx: SKRSContext2D, reveal: Reveal, ms: number): void {
  const scale = popScale(ms);
  const cx = STAGE.w / 2;
  const px = fitFontPx(ctx, reveal.priceText, FONTS.title, 150, PRICE_MAX_W);
  ctx.save();
  ctx.translate(cx, PRICE_CY);
  ctx.scale(scale, scale);
  // V2: molten-gold numerals: a deep outline, a warm glow and a metal gradient, then a top sheen
  ctx.font = `${px}px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(reveal.priceText, 3, 7);
  ctx.shadowColor = 'rgba(255,200,110,0.9)';
  ctx.shadowBlur = 26;
  ctx.lineWidth = Math.max(8, px / 9);
  ctx.strokeStyle = '#2A1A06';
  ctx.strokeText(reveal.priceText, 0, 0);
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(3, px / 30);
  ctx.strokeStyle = '#7C5A1E';
  ctx.strokeText(reveal.priceText, 0, 0);
  const metal = ctx.createLinearGradient(0, -px * 0.42, 0, px * 0.42);
  metal.addColorStop(0, '#FFF6D2');
  metal.addColorStop(0.35, '#F4D27A');
  metal.addColorStop(0.55, '#C8962E');
  metal.addColorStop(1, '#F0C76A');
  ctx.fillStyle = metal;
  ctx.fillText(reveal.priceText, 0, 0);
  ctx.restore();
  // sparkles that pop around the price as it lands
  const box = priceTextBox(ctx, reveal);
  for (let i = 0; i < 9; i++) {
    const life = ((ms + i * 170) % 1100) / 1100;
    const sx = box.x + ((i * 97) % 100) / 100 * box.w;
    const sy = box.y + (((i * 53) % 100) / 100) * box.h;
    sparkle(ctx, sx, sy, 5 + 9 * Math.sin(life * Math.PI), Math.sin(life * Math.PI) * clamp01(ms / 300));
  }

  // item name and source appear once the price has mostly landed
  const fade = clamp01((ms - 200) / 250);
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (reveal.itemName) {
    ctx.font = `40px ${FONTS.body}`;
    const name = ellipsize(ctx, reveal.itemName, SAFE_W);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = COLORS.ink;
    ctx.strokeText(name, cx, NAME_Y);
    ctx.fillStyle = COLORS.cream;
    ctx.fillText(name, cx, NAME_Y);
  }
  if (reveal.sourceLabel) {
    // A dark pill keeps the source readable on top of the starburst.
    ctx.font = `22px ${FONTS.body}`;
    const src = ellipsize(ctx, reveal.sourceLabel, SAFE_W - 40);
    const w = ctx.measureText(src).width + 32;
    ctx.fillStyle = 'rgba(20,18,58,0.85)';
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, SOURCE_Y - 16, w, 32, 16);
    ctx.fill();
    ctx.fillStyle = COLORS.cream;
    ctx.fillText(src, cx, SOURCE_Y + 1);
  }
  ctx.restore();

  if (reveal.isEstimate && ms > 350) drawStamp(ctx, clamp01((ms - 350) / 150));
}

function drawStamp(ctx: SKRSContext2D, a: number): void {
  const { cx, cy, w, h, angle } = STAMP;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.scale(1.4 - 0.4 * a, 1.4 - 0.4 * a);
  ctx.strokeStyle = COLORS.alert;
  ctx.lineWidth = 5;
  ctx.fillStyle = 'rgba(20,18,58,0.55)';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.font = `30px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLORS.alert;
  ctx.fillText('ESTIMATE', 0, 2);
  ctx.restore();
}

export function drawReveal(ctx: SKRSContext2D, reveal: Reveal, msSinceStage: number, lightning: boolean): void {
  if (reveal.stage === 'none') return;
  const ms = Math.max(0, msSinceStage);
  ctx.save();
  if (reveal.stage === 'drumroll') {
    drawDrumroll(ctx, ms, lightning);
  } else {
    // Dim everything above the podiums so the price doesn't fight the host and the name pills.
    // The podiums stay bright: they show everyone's guesses next to the real price.
    ctx.save();
    ctx.fillStyle = `rgba(14,12,40,${0.78 * clamp01(ms / 150)})`;
    ctx.fillRect(0, 0, STAGE.w, LAYOUT.podiums.y);
    ctx.restore();
    drawStarburst(ctx, ms, popScale(ms));
    drawPrice(ctx, reveal, ms);
    if (ms < 60) {
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 1 - ms / 60;
      ctx.fillRect(0, 0, STAGE.w, STAGE.h);
    }
  }
  ctx.restore();
}
