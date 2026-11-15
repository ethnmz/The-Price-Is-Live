// Static stage look (cached) plus the marquee sign with blinking bulbs. Pure: (ctx, nowMs) -> pixels.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { COLORS, FONTS, LAYOUT, STAGE, theme, type ThemeName } from './theme';
import { registerFonts } from './fonts';

let cache: { theme: ThemeName; canvas: Canvas } | null = null;

function paintStatic(): Canvas {
  const c = createCanvas(STAGE.w, STAGE.h);
  const g = c.getContext('2d');
  g.fillStyle = COLORS.navy;
  g.fillRect(0, 0, STAGE.w, STAGE.h);
  // sunburst behind the host box
  const host = LAYOUT.host;
  const cx = host.x + host.w / 2;
  const cy = host.y + host.h / 2;
  const rays = 20;
  for (let i = 0; i < rays; i += 2) {
    const a0 = (i / rays) * Math.PI * 2;
    const a1 = ((i + 1) / rays) * Math.PI * 2;
    g.fillStyle = 'rgba(255, 200, 61, 0.10)';
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 700, a0, a1);
    g.closePath();
    g.fill();
  }
  // checkerboard floor
  const sq = 40;
  for (let y = 440, r = 0; y < STAGE.h; y += sq, r++) {
    for (let x = 0, col = 0; x < STAGE.w; x += sq, col++) {
      g.fillStyle = (r + col) % 2 === 0 ? '#2A2760' : '#1E1B4B';
      g.fillRect(x, y, sq, Math.min(sq, STAGE.h - y));
    }
  }
  // curtains with folds
  for (const [x0, w] of [[0, 150], [810, 150]] as const) {
    g.fillStyle = COLORS.curtain;
    g.fillRect(x0, 0, w, 440);
    for (let fx = x0 + 10; fx < x0 + w; fx += 25) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(fx, 0, 8, 440);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(fx + 10, 0, 5, 440);
    }
  }
  g.fillStyle = COLORS.gold; // curtain valance trim
  g.fillRect(0, 436, 150, 4);
  g.fillRect(810, 436, 150, 4);
  return c;
}

/** Bulb positions around the marquee border. */
function bulbPoints(): { x: number; y: number }[] {
  const m = LAYOUT.marquee;
  const pts: { x: number; y: number }[] = [];
  const step = 20;
  for (let x = m.x + 6; x <= m.x + m.w - 6; x += step) { pts.push({ x, y: m.y + 4 }); pts.push({ x, y: m.y + m.h - 4 }); }
  for (let y = m.y + 14; y <= m.y + m.h - 14; y += step) { pts.push({ x: m.x + 4, y }); pts.push({ x: m.x + m.w - 4, y }); }
  return pts;
}

function drawMarquee(ctx: SKRSContext2D, nowMs: number): void {
  const m = LAYOUT.marquee;
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(m.x, m.y, m.w, m.h);
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(m.x + 8, m.y + 8, m.w - 16, m.h - 16);
  const phase = Math.floor(nowMs / 250) % 2; // 2 Hz: flips every 250 ms
  bulbPoints().forEach((p, i) => {
    const on = (i + phase) % 2 === 0;
    ctx.fillStyle = on ? COLORS.bulb : '#5A4A1A';
    ctx.beginPath();
    ctx.arc(p.x, p.y, on ? 3.5 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = COLORS.gold;
  ctx.font = `22px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('THE PRICE IS LIVE', m.x + m.w / 2, m.y + m.h / 2 + 1, m.w - 30);
}

// ---------- Odyssey theme: a night voyage (HackUTA 2026) ----------

/** Deterministic pseudo-random, so the static art is the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HORIZON = 318;
const FLOOR = 440;

/** Greek key (meander) strip: a run of hooked squares, drawn as one stroked path. */
export function drawMeander(g: SKRSContext2D, x0: number, y: number, w: number, unit: number, color: string): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, unit / 4);
  g.lineJoin = 'miter';
  g.beginPath();
  for (let x = x0; x + unit * 2 <= x0 + w; x += unit * 2) {
    const u = unit;
    g.moveTo(x, y + u);
    g.lineTo(x, y);
    g.lineTo(x + u * 1.5, y);
    g.lineTo(x + u * 1.5, y + u * 0.75);
    g.lineTo(x + u * 0.5, y + u * 0.75);
    g.lineTo(x + u * 0.5, y + u * 0.35);
    g.moveTo(x, y + u);
    g.lineTo(x + u * 2, y + u);
  }
  g.stroke();
  g.restore();
}

function olive(g: SKRSContext2D, x: number, y: number, size: number, rand: () => number, color: string): void {
  // trunk
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, size / 10);
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x, y);
  g.bezierCurveTo(x - size * 0.15, y - size * 0.4, x + size * 0.2, y - size * 0.6, x, y - size);
  g.stroke();
  // leafy crown: clusters of small ellipses
  g.fillStyle = color;
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = size * (0.15 + rand() * 0.55);
    const lx = x + Math.cos(a) * r * 1.3;
    const ly = y - size + Math.sin(a) * r * 0.6;
    g.beginPath();
    g.ellipse(lx, ly, size * 0.11, size * 0.05, a, 0, Math.PI * 2);
    g.fill();
  }
}

function cliff(g: SKRSContext2D, side: 'left' | 'right', rand: () => number): void {
  const flip = side === 'right';
  const X = (x: number) => (flip ? STAGE.w - x : x);
  // back ridge (lighter), then front ridge (darker)
  for (const [fill, top, reach] of [['#1E4560', 70, 175], ['#0B2236', 120, 150]] as const) {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(X(0), FLOOR);
    g.lineTo(X(0), top);
    // A rocky edge that slopes from the clifftop out to the floor.
    for (let x = 6; x <= reach; x += 6 + rand() * 10) {
      const t = x / reach;
      const y = top + (FLOOR - top) * Math.pow(t, 1.8) + (rand() - 0.5) * 14 * (1 - t);
      g.lineTo(X(x), Math.min(y, FLOOR));
    }
    g.lineTo(X(reach), FLOOR);
    g.closePath();
    g.fill();
  }
  // a few rock strata on the front cliff
  g.strokeStyle = 'rgba(79,134,168,0.22)';
  g.lineWidth = 2;
  for (const y of [190, 250, 320, 390]) {
    g.beginPath();
    g.moveTo(X(4), y);
    g.lineTo(X(40 + rand() * 30), y + 8);
    g.stroke();
  }
  olive(g, X(34), 122, 64, rand, '#0B2236');
  olive(g, X(96), 190, 40, rand, '#0B2236');
}

function ship(g: SKRSContext2D, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  // hull
  g.fillStyle = '#0B2236';
  g.beginPath();
  g.moveTo(-60, 0);
  g.quadraticCurveTo(0, 22, 62, -2);
  g.lineTo(70, -14);
  g.lineTo(54, -6);
  g.lineTo(-52, -6);
  g.lineTo(-66, -16);
  g.closePath();
  g.fill();
  // oars
  g.strokeStyle = '#0B2236';
  g.lineWidth = 2;
  for (let i = -40; i <= 40; i += 13) { g.beginPath(); g.moveTo(i, 2); g.lineTo(i - 7, 16); g.stroke(); }
  // mast and square sail
  g.fillStyle = '#0B2236';
  g.fillRect(-2, -78, 4, 74);
  g.fillStyle = '#F6EDDF';
  g.beginPath();
  g.moveTo(-30, -66);
  g.quadraticCurveTo(0, -60, 30, -66);
  g.lineTo(26, -20);
  g.quadraticCurveTo(0, -14, -26, -20);
  g.closePath();
  g.fill();
  g.strokeStyle = '#1A3A52';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -60); g.lineTo(0, -18); g.stroke();
  g.beginPath(); g.moveTo(-14, -40); g.lineTo(0, -48); g.lineTo(14, -40); g.lineTo(0, -32); g.closePath(); g.stroke();
  // pennant
  g.fillStyle = '#C45C3E';
  g.beginPath(); g.moveTo(2, -78); g.lineTo(20, -73); g.lineTo(2, -68); g.closePath(); g.fill();
  g.restore();
}

function paintOdyssey(): Canvas {
  const c = createCanvas(STAGE.w, STAGE.h);
  const g = c.getContext('2d');
  const rand = seeded(2026);
  // sky: deep navy down to a warm horizon
  const sky = g.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#0B2236');
  sky.addColorStop(0.6, '#1A3A52');
  sky.addColorStop(1, '#4F86A8');
  g.fillStyle = sky;
  g.fillRect(0, 0, STAGE.w, HORIZON);
  // pixel dither, like the event site's texture, fading toward the horizon
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(rand() * 240) * 4;
    const y = Math.floor(Math.pow(rand(), 1.6) * (HORIZON / 4)) * 4;
    g.fillStyle = `rgba(246,237,223,${0.03 + rand() * 0.05})`;
    g.fillRect(x, y, 4, 4);
  }
  // stars
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(246,237,223,${0.4 + rand() * 0.5})`;
    g.fillRect(Math.floor(rand() * STAGE.w), Math.floor(rand() * 150), 2, 2);
  }
  // low sun and rays behind the host
  const host = LAYOUT.host;
  const cx = host.x + host.w / 2;
  const glow = g.createRadialGradient(cx, HORIZON, 10, cx, HORIZON, 260);
  glow.addColorStop(0, 'rgba(232,201,122,0.75)');
  glow.addColorStop(0.35, 'rgba(232,201,122,0.25)');
  glow.addColorStop(1, 'rgba(232,201,122,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, STAGE.w, HORIZON);
  for (let i = 0; i < 18; i += 2) {
    const a0 = Math.PI + (i / 18) * Math.PI;
    const a1 = Math.PI + ((i + 1) / 18) * Math.PI;
    g.fillStyle = 'rgba(232,201,122,0.08)';
    g.beginPath();
    g.moveTo(cx, HORIZON);
    g.arc(cx, HORIZON, 600, a0, a1);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#E8C97A';
  g.beginPath();
  g.arc(cx, HORIZON, 70, Math.PI, 0);
  g.fill();
  // sea: bands that darken toward the floor, with wave strokes
  const sea = g.createLinearGradient(0, HORIZON, 0, FLOOR);
  sea.addColorStop(0, '#305873');
  sea.addColorStop(1, '#102F46');
  g.fillStyle = sea;
  g.fillRect(0, HORIZON, STAGE.w, FLOOR - HORIZON);
  // sun's reflection
  for (let y = HORIZON + 4; y < FLOOR; y += 7) {
    const w = 120 * (1 - (y - HORIZON) / (FLOOR - HORIZON)) + 20;
    g.fillStyle = 'rgba(232,201,122,0.35)';
    g.fillRect(cx - w / 2 + (rand() - 0.5) * 20, y, w, 2);
  }
  g.lineWidth = 2;
  for (let y = HORIZON + 10; y < FLOOR; y += 14) {
    g.strokeStyle = `rgba(246,237,223,${0.08 + ((y - HORIZON) / (FLOOR - HORIZON)) * 0.12})`;
    g.beginPath();
    for (let x = 0; x <= STAGE.w; x += 8) {
      const yy = y + Math.sin(x / 26 + y) * 3;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  ship(g, 690, HORIZON + 6, 0.7);
  cliff(g, 'left', rand);
  cliff(g, 'right', rand);
  // stage floor: a dark deck with a gold Greek-key border
  g.fillStyle = '#0B2236';
  g.fillRect(0, FLOOR, STAGE.w, STAGE.h - FLOOR);
  for (let x = 0; x < STAGE.w; x += 48) {
    g.fillStyle = 'rgba(48,88,115,0.35)';
    g.fillRect(x, FLOOR + 14, 2, STAGE.h - FLOOR);
  }
  g.fillStyle = '#E8C97A';
  g.fillRect(0, FLOOR - 2, STAGE.w, 3);
  drawMeander(g, 4, FLOOR + 4, STAGE.w - 8, 8, 'rgba(232,201,122,0.75)');
  return c;
}

/** Odyssey title: a parchment plaque with a navy border, Greek-key edge and laurel sprigs. */
function drawPlaque(ctx: SKRSContext2D): void {
  const m = LAYOUT.marquee;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = COLORS.cream;
  ctx.beginPath();
  ctx.roundRect(m.x, m.y, m.w, m.h, 6);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(m.x + 5, m.y + 5, m.w - 10, m.h - 10);
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(m.x + 9, m.y + 9, m.w - 18, m.h - 18);
  // small gold diamonds at the ends, like the event site's sail mark
  for (const side of [-1, 1]) {
    const dx = m.x + m.w / 2 + side * (m.w / 2 - 22);
    const dy = m.y + m.h / 2;
    ctx.fillStyle = COLORS.alert;
    ctx.beginPath();
    ctx.moveTo(dx, dy - 7); ctx.lineTo(dx + 7, dy); ctx.lineTo(dx, dy + 7); ctx.lineTo(dx - 7, dy);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = COLORS.ink;
  ctx.font = `24px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('THE PRICE IS LIVE', m.x + m.w / 2, m.y + m.h / 2 + 2, m.w - 80);
  ctx.restore();
}

export function drawBackground(ctx: SKRSContext2D, nowMs: number): void {
  registerFonts();
  const t = theme();
  if (!cache || cache.theme !== t) cache = { theme: t, canvas: t === 'odyssey' ? paintOdyssey() : paintStatic() };
  ctx.save();
  ctx.drawImage(cache.canvas, 0, 0);
  if (t === 'odyssey') drawPlaque(ctx);
  else drawMarquee(ctx, nowMs);
  ctx.restore();
}
