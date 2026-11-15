// Static stage look (cached) plus the marquee sign with blinking bulbs. Pure: (ctx, nowMs) -> pixels.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { COLORS, FONTS, LAYOUT, STAGE } from './theme';
import { registerFonts } from './fonts';

let cache: Canvas | null = null;

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

export function drawBackground(ctx: SKRSContext2D, nowMs: number): void {
  registerFonts();
  if (!cache) cache = paintStatic();
  ctx.save();
  ctx.drawImage(cache, 0, 0);
  drawMarquee(ctx, nowMs);
  ctx.restore();
}
