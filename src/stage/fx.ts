// Stage V2 effects: the "shader" toolkit for a 2D canvas. Gradients, bevels, gloss, glows, grain,
// vignette, gold lettering and sparkles. Everything expensive (noise, vignette) is drawn once and
// cached; the per-frame helpers are a few gradient fills, so a frame stays well under budget.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { STAGE, type Box } from './theme';

type Ctx = SKRSContext2D;

// ---------- color ----------

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lighten (amount > 0, toward white) or darken (amount < 0, toward black) a #hex color. */
export function shade(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = parse(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amount));
  const mix = (c: number) => Math.round(c + (t - c) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** A #hex color with alpha. */
export function alpha(hex: string, a: number): string {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = parse(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- shapes ----------

export function rrect(ctx: Ctx, b: Box, r: number): void {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(r, b.h / 2, b.w / 2));
}

export interface BevelOpts {
  /** Corner radius. */
  r?: number;
  /** Drop shadow under the box (px of blur). 0 = none. */
  shadow?: number;
  /** Outline color; defaults to a darker shade of the fill. */
  stroke?: string | null;
  strokeW?: number;
  /** Glassy highlight over the top half. */
  gloss?: number;
}

/**
 * A raised, lit box: soft drop shadow, top-to-bottom gradient of the base color, a bright top edge,
 * a dark bottom edge and an optional glassy highlight. The look of a game-show podium or button.
 */
export function bevelBox(ctx: Ctx, b: Box, color: string, o: BevelOpts = {}): void {
  const r = o.r ?? 10;
  ctx.save();
  if (o.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = o.shadow;
    ctx.shadowOffsetY = Math.round(o.shadow / 3);
  }
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, shade(color, 0.22));
  g.addColorStop(0.5, color);
  g.addColorStop(1, shade(color, -0.32));
  rrect(ctx, b, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  ctx.save();
  rrect(ctx, b, r);
  ctx.clip();
  // bright top lip and dark bottom lip, like light from above
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(b.x, b.y, b.w, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(b.x, b.y + b.h - 3, b.w, 3);
  if (o.gloss) {
    const gl = ctx.createLinearGradient(0, b.y, 0, b.y + b.h * 0.55);
    gl.addColorStop(0, `rgba(255,255,255,${o.gloss})`);
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    ctx.fillRect(b.x, b.y, b.w, b.h * 0.55);
  }
  ctx.restore();
  if (o.stroke !== null) {
    ctx.save();
    rrect(ctx, b, r);
    ctx.strokeStyle = o.stroke ?? shade(color, -0.45);
    ctx.lineWidth = o.strokeW ?? 2;
    ctx.stroke();
    ctx.restore();
  }
}

/** A sunken panel: dark gradient with an inner shadow at the top, for name plates and screens. */
export function insetBox(ctx: Ctx, b: Box, color: string, r = 6): void {
  ctx.save();
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, shade(color, -0.25));
  g.addColorStop(1, shade(color, 0.12));
  rrect(ctx, b, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(b.x, b.y, b.w, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(b.x, b.y + b.h - 1, b.w, 1);
  ctx.restore();
}

/** A gold metal gradient across a box (vertical), used for trims, coins and ribbons. */
export function goldGradient(ctx: Ctx, y0: number, y1: number, base: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, shade(base, 0.45));
  g.addColorStop(0.45, base);
  g.addColorStop(0.55, shade(base, -0.18));
  g.addColorStop(1, shade(base, 0.12));
  return g;
}
type CanvasGradient = ReturnType<Ctx['createLinearGradient']>;

/**
 * A ribbon banner with folded tails, filled with a metal gradient. The text is drawn by the caller.
 */
export function ribbon(ctx: Ctx, b: Box, base: string, tail = 22): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  // tails, behind and lower
  for (const side of [-1, 1]) {
    const x = side < 0 ? b.x - tail : b.x + b.w + tail;
    const inner = side < 0 ? b.x + 10 : b.x + b.w - 10;
    ctx.fillStyle = shade(base, -0.35);
    ctx.beginPath();
    ctx.moveTo(inner, b.y + 8);
    ctx.lineTo(x, b.y + 8);
    ctx.lineTo(x + side * -10, b.y + 8 + b.h / 2);
    ctx.lineTo(x, b.y + b.h + 8);
    ctx.lineTo(inner, b.y + b.h + 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = goldGradient(ctx, b.y, b.y + b.h, base);
  rrect(ctx, b, 6);
  ctx.fill();
  ctx.strokeStyle = shade(base, -0.45);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  rrect(ctx, { x: b.x + 4, y: b.y + 4, w: b.w - 8, h: b.h - 8 }, 4);
  ctx.stroke();
  ctx.restore();
}

// ---------- lettering ----------

export interface TextFxOpts {
  font: string;
  /** Fill: a solid color, or 'gold' for a metal gradient made from `base`. */
  fill: string;
  base?: string;
  /** Outline color and width. */
  stroke?: string;
  strokeW?: number;
  /** Outer glow color and blur. */
  glow?: string;
  glowBlur?: number;
  /** Drop shadow offset (px). */
  drop?: number;
  align?: 'left' | 'center' | 'right';
  maxW?: number;
}

/** Display lettering: drop shadow, outline, glow, gradient fill and a thin top highlight. */
export function textFx(ctx: Ctx, s: string, x: number, y: number, o: TextFxOpts): void {
  ctx.save();
  ctx.font = o.font;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const m = ctx.measureText(s);
  const h = (m.actualBoundingBoxAscent ?? 30) + (m.actualBoundingBoxDescent ?? 0);
  const fit = o.maxW && m.width > o.maxW ? o.maxW : undefined;
  if (o.drop) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    if (o.stroke) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = (o.strokeW ?? 6) + 2;
      ctx.strokeText(s, x + o.drop * 0.4, y + o.drop, fit);
    }
    ctx.fillText(s, x + o.drop * 0.4, y + o.drop, fit);
  }
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowBlur ?? 16;
  }
  if (o.stroke) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.strokeW ?? 6;
    ctx.strokeText(s, x, y, fit);
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = o.fill === 'gold' ? goldGradient(ctx, y - h / 2, y + h / 2, o.base ?? '#E8C97A') : o.fill;
  ctx.fillText(s, x, y, fit);
  ctx.restore();
}

// ---------- sparkles and particles ----------

/** A four-point twinkle star. */
export function sparkle(ctx: Ctx, x: number, y: number, r: number, a: number, color = '#FFF6D8'): void {
  if (a <= 0 || r <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
  ctx.restore();
}

/** Deterministic pseudo-random (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- full-frame finish (cached) ----------

let grainCanvas: Canvas | null = null;
let vignetteCanvas: Canvas | null = null;

/** A 256 px tile of soft monochrome noise (film grain / paper texture). */
export function grainTile(): Canvas {
  if (grainCanvas) return grainCanvas;
  const c = createCanvas(256, 256);
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  const rand = seeded(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainCanvas = c;
  return c;
}

/** Overlay grain on a box (paper, parchment, stone). Strength is the overlay alpha. */
export function grain(ctx: Ctx, b: Box, strength: number, offset = 0): void {
  ctx.save();
  const pat = ctx.createPattern(grainTile(), 'repeat');
  if (!pat) { ctx.restore(); return; }
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'overlay';
  ctx.translate(-offset, -offset * 0.7);
  ctx.fillStyle = pat;
  ctx.fillRect(b.x + offset, b.y + offset * 0.7, b.w, b.h);
  ctx.restore();
}

function vignette(): Canvas {
  if (vignetteCanvas) return vignetteCanvas;
  const c = createCanvas(STAGE.w, STAGE.h);
  const g = c.getContext('2d');
  const v = g.createRadialGradient(STAGE.w / 2, STAGE.h * 0.45, STAGE.h * 0.35, STAGE.w / 2, STAGE.h * 0.5, STAGE.w * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(4,10,20,0.55)');
  g.fillStyle = v;
  g.fillRect(0, 0, STAGE.w, STAGE.h);
  vignetteCanvas = c;
  return c;
}

/** The final pass over every frame: vignette plus a light, slowly shifting film grain. */
export function finish(ctx: Ctx, nowMs: number): void {
  ctx.save();
  ctx.drawImage(vignette(), 0, 0);
  const shift = Math.floor(nowMs / 66) % 64;
  grain(ctx, { x: 0, y: 0, w: STAGE.w, h: STAGE.h }, 0.06, shift);
  ctx.restore();
}
