// Static stage look (cached) plus the marquee sign with blinking bulbs. Pure: (ctx, nowMs) -> pixels.
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { COLORS, FONTS, LAYOUT, STAGE, applyShape, shape, theme, type StageShape, type ThemeName } from './theme';
import { registerFonts } from './fonts';

let cache: { theme: ThemeName; shape: StageShape; canvas: Canvas } | null = null;

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
  drawPedestal(g, false);
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

// ---------- host podium base ----------

/**
 * The lower half of Chip's lectern: a pedestal from under the lectern (drawn by the host layer,
 * which must stay inside its box) down to the stage floor, so the podium stands on the stage.
 */
function drawPedestal(g: SKRSContext2D, odyssey: boolean): void {
  const cx = LAYOUT.host.x + LAYOUT.host.w / 2;
  const top = 344;
  const floor = 440;
  const base = odyssey ? '#EDE6DA' : COLORS.alert;
  const mix = (hex: string, k: number) => {
    const n = parseInt(hex.slice(1), 16);
    const t = k < 0 ? 0 : 255;
    const a = Math.abs(k);
    const c = (v: number) => Math.round(v + (t - v) * a);
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
  };
  // shadow on the floor
  const sh = g.createRadialGradient(cx, floor + 4, 10, cx, floor + 4, 130);
  sh.addColorStop(0, 'rgba(0,0,0,0.5)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(cx - 140, floor - 10, 280, 40);
  // the column: continues the lectern's slant, then a stepped plinth
  const col = g.createLinearGradient(cx - 72, 0, cx + 72, 0);
  col.addColorStop(0, mix(base, -0.3));
  col.addColorStop(0.3, mix(base, 0.1));
  col.addColorStop(0.7, base);
  col.addColorStop(1, mix(base, -0.38));
  g.fillStyle = col;
  g.beginPath();
  g.moveTo(cx - 72, top);
  g.lineTo(cx + 72, top);
  g.lineTo(cx + 62, floor - 22);
  g.lineTo(cx - 62, floor - 22);
  g.closePath();
  g.fill();
  g.strokeStyle = '#0E2234';
  g.lineWidth = 2.5;
  g.stroke();
  if (odyssey) {
    // fluting: vertical grooves like a Greek column
    for (let x = -50; x <= 50; x += 14) {
      g.strokeStyle = 'rgba(120,110,100,0.35)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx + x, top + 6); g.lineTo(cx + x * 0.88, floor - 26); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx + x + 2.5, top + 6); g.lineTo(cx + x * 0.88 + 2.5, floor - 26); g.stroke();
    }
  } else {
    // a gold stripe down the middle
    g.fillStyle = 'rgba(255,214,120,0.85)';
    g.fillRect(cx - 3, top + 4, 6, floor - top - 30);
  }
  // plinth: two gold steps
  for (const [y, h, w] of [[floor - 22, 10, 156], [floor - 12, 14, 176]] as const) {
    const step = g.createLinearGradient(0, y, 0, y + h);
    step.addColorStop(0, '#FFF0B8');
    step.addColorStop(0.5, '#D9B25A');
    step.addColorStop(1, '#7C6024');
    g.fillStyle = step;
    g.beginPath();
    g.roundRect(cx - w / 2, y, w, h, 3);
    g.fill();
    g.strokeStyle = '#3D2F12';
    g.lineWidth = 1.5;
    g.stroke();
  }
}

// ---------- Odyssey theme V2: a night voyage (HackUTA 2026) ----------
// The static scene is painted once into a cache (gradients, blurred glows, textures). Each frame
// adds only light motion: twinkling stars, moving sea glints and the ship bobbing on the swell.

const HORIZON = 318;
const FLOOR = 440;
const SUN_X = LAYOUT.host.x + LAYOUT.host.w / 2;

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

/** Paint something blurred onto g: draw into a scratch canvas, then composite with a blur filter. */
function blurred(g: SKRSContext2D, px: number, paint: (s: SKRSContext2D) => void, op: GlobalCompositeOperation = 'source-over'): void {
  const c = createCanvas(STAGE.w, STAGE.h);
  const s = c.getContext('2d');
  paint(s);
  g.save();
  g.globalCompositeOperation = op;
  g.filter = `blur(${px}px)`;
  g.drawImage(c, 0, 0);
  g.filter = 'none';
  g.restore();
}
type GlobalCompositeOperation = SKRSContext2D['globalCompositeOperation'];

function paintSky(g: SKRSContext2D, rand: () => number): void {
  const sky = g.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#06182A');
  sky.addColorStop(0.45, '#0F2D47');
  sky.addColorStop(0.8, '#2B5676');
  sky.addColorStop(1, '#7FA7BE');
  g.fillStyle = sky;
  g.fillRect(0, 0, STAGE.w, HORIZON);
  // soft cloud bands catching the sunset
  blurred(g, 14, (s) => {
    for (let i = 0; i < 9; i++) {
      const y = 150 + rand() * 120;
      const x = rand() * STAGE.w;
      const w = 140 + rand() * 220;
      s.fillStyle = `rgba(${200 + rand() * 40},${150 + rand() * 40},${120 + rand() * 30},${0.12 + rand() * 0.14})`;
      s.beginPath();
      s.ellipse(x, y, w / 2, 8 + rand() * 10, 0, 0, Math.PI * 2);
      s.fill();
    }
    for (let i = 0; i < 6; i++) {
      s.fillStyle = 'rgba(11,34,54,0.35)';
      s.beginPath();
      s.ellipse(rand() * STAGE.w, 60 + rand() * 120, 120 + rand() * 160, 10 + rand() * 12, 0, 0, Math.PI * 2);
      s.fill();
    }
  });
  // pixel dither, like the event site's texture, fading toward the horizon
  for (let i = 0; i < 1100; i++) {
    const x = Math.floor(rand() * 240) * 4;
    const y = Math.floor(Math.pow(rand(), 1.8) * (HORIZON / 4)) * 4;
    g.fillStyle = `rgba(246,237,223,${0.025 + rand() * 0.045})`;
    g.fillRect(x, y, 4, 4);
  }
  // static stars (the bright ones twinkle per frame)
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(246,237,223,${0.25 + rand() * 0.5})`;
    const s = rand() < 0.15 ? 2 : 1;
    g.fillRect(Math.floor(rand() * STAGE.w), Math.floor(Math.pow(rand(), 1.4) * 190), s, s);
  }
}

function paintSun(g: SKRSContext2D): void {
  // wide atmospheric haze, then god rays, then the disc with a hot core
  blurred(g, 30, (s) => {
    const haze = s.createRadialGradient(SUN_X, HORIZON, 20, SUN_X, HORIZON, 340);
    haze.addColorStop(0, 'rgba(255,214,140,0.85)');
    haze.addColorStop(0.3, 'rgba(232,170,110,0.35)');
    haze.addColorStop(1, 'rgba(232,170,110,0)');
    s.fillStyle = haze;
    s.fillRect(0, 0, STAGE.w, HORIZON + 40);
  }, 'screen');
  blurred(g, 6, (s) => {
    for (let i = 0; i < 26; i++) {
      const a = Math.PI + (i / 26) * Math.PI;
      const w = 0.025 + (i % 3) * 0.012;
      s.fillStyle = `rgba(255,226,160,${i % 2 ? 0.07 : 0.12})`;
      s.beginPath();
      s.moveTo(SUN_X, HORIZON);
      s.arc(SUN_X, HORIZON, 620, a - w, a + w);
      s.closePath();
      s.fill();
    }
  }, 'screen');
  const disc = g.createRadialGradient(SUN_X, HORIZON - 10, 4, SUN_X, HORIZON, 74);
  disc.addColorStop(0, '#FFF6DA');
  disc.addColorStop(0.55, '#F6D88C');
  disc.addColorStop(1, '#E8A86A');
  g.save();
  g.shadowColor = 'rgba(255,214,140,0.9)';
  g.shadowBlur = 40;
  g.fillStyle = disc;
  g.beginPath();
  g.arc(SUN_X, HORIZON, 72, Math.PI, 0);
  g.fill();
  g.restore();
}

function paintSea(g: SKRSContext2D, rand: () => number): void {
  const sea = g.createLinearGradient(0, HORIZON, 0, FLOOR);
  sea.addColorStop(0, '#5C8AA6');
  sea.addColorStop(0.08, '#2E5B78');
  sea.addColorStop(0.6, '#173C57');
  sea.addColorStop(1, '#0C2639');
  g.fillStyle = sea;
  g.fillRect(0, HORIZON, STAGE.w, FLOOR - HORIZON);
  // horizon line glow
  g.fillStyle = 'rgba(255,226,170,0.55)';
  g.fillRect(0, HORIZON, STAGE.w, 1.5);
  // perspective swell: rows get taller and further apart toward the viewer
  for (let row = 0; row < 26; row++) {
    const t = row / 25;
    const y = HORIZON + 4 + Math.pow(t, 1.7) * (FLOOR - HORIZON - 8);
    const amp = 1 + t * 4;
    const len = 18 + t * 70;
    for (let x = -rand() * len; x < STAGE.w; x += len * (1.5 + rand() * 1.2)) {
      const near = Math.abs(x + len / 2 - SUN_X) / STAGE.w;
      const lit = Math.max(0, 1 - near * 3.2);
      g.strokeStyle = lit > 0.05 ? `rgba(255,220,150,${0.14 + lit * 0.5})` : `rgba(180,215,235,${0.03 + t * 0.07})`;
      g.lineWidth = 1 + t * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len / 2, y - amp, x + len * 0.85, y);
      g.stroke();
    }
  }
  // sun's reflection column
  blurred(g, 3, (s) => {
    for (let y = HORIZON + 3; y < FLOOR; y += 4) {
      const t = (y - HORIZON) / (FLOOR - HORIZON);
      const w = 150 * (1 - t) + 26;
      s.fillStyle = `rgba(255,214,140,${0.45 * (1 - t * 0.6)})`;
      s.fillRect(SUN_X - w / 2 + (rand() - 0.5) * 30 * t, y, w * (0.5 + rand() * 0.5), 1.5);
    }
  }, 'screen');
}

function olive(g: SKRSContext2D, x: number, y: number, size: number, rand: () => number, lit: number): void {
  // twisted trunk with a highlight edge
  g.save();
  g.lineCap = 'round';
  for (const [w, c] of [[Math.max(3, size / 8), '#081B2B'], [Math.max(1, size / 22), `rgba(127,167,190,${0.35 * lit})`]] as const) {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - size * 0.2, y - size * 0.35, x + size * 0.25, y - size * 0.55, x + size * 0.02, y - size * 0.95);
    g.moveTo(x + size * 0.05, y - size * 0.55);
    g.quadraticCurveTo(x + size * 0.35, y - size * 0.7, x + size * 0.45, y - size * 0.95);
    g.stroke();
  }
  // leaves: dark mass, then a lit fringe facing the sun
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 46; i++) {
      const a = rand() * Math.PI * 2;
      const r = size * (0.1 + rand() * 0.6);
      const lx = x + size * 0.15 + Math.cos(a) * r * 1.35;
      const ly = y - size * 0.95 + Math.sin(a) * r * 0.55;
      g.fillStyle = pass === 0 ? '#0B2236' : `rgba(78,140,106,${(0.25 + rand() * 0.35) * lit})`;
      g.beginPath();
      g.ellipse(lx, ly, size * 0.1, size * 0.04, a, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function cliff(g: SKRSContext2D, side: 'left' | 'right', rand: () => number): void {
  const flip = side === 'right';
  const X = (x: number) => (flip ? STAGE.w - x : x);
  const ridge = (top: number, reach: number): [number, number][] => {
    const pts: [number, number][] = [[0, top]];
    for (let x = 6; x <= reach; x += 6 + rand() * 10) {
      const t = x / reach;
      pts.push([x, Math.min(FLOOR, top + (FLOOR - top) * Math.pow(t, 1.8) + (rand() - 0.5) * 14 * (1 - t))]);
    }
    pts.push([reach, FLOOR]);
    return pts;
  };
  for (const [top, reach, dark, lightA] of [[64, 182, '#163B55', 0.18], [116, 152, '#091D2E', 0.32]] as const) {
    const pts = ridge(top, reach);
    // body: dark rock with a vertical gradient toward the sea
    const body = g.createLinearGradient(0, top, 0, FLOOR);
    body.addColorStop(0, shadeHex(dark, 0.12));
    body.addColorStop(1, dark);
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(X(0), FLOOR);
    for (const [px, py] of pts) g.lineTo(X(px), py);
    g.closePath();
    g.fill();
    // warm rim light along the sun-facing edge
    g.save();
    g.strokeStyle = `rgba(255,205,140,${lightA})`;
    g.lineWidth = 2.5;
    g.shadowColor = 'rgba(255,200,140,0.6)';
    g.shadowBlur = 6;
    g.beginPath();
    pts.slice(1, -1).forEach(([px, py], i) => (i ? g.lineTo(X(px), py) : g.moveTo(X(px), py)));
    g.stroke();
    g.restore();
  }
  // rock strata and cracks
  for (let i = 0; i < 9; i++) {
    const y = 160 + rand() * 260;
    g.strokeStyle = `rgba(127,167,190,${0.08 + rand() * 0.1})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(X(2), y);
    g.quadraticCurveTo(X(20 + rand() * 30), y + 6, X(40 + rand() * 50), y + 2 + rand() * 10);
    g.stroke();
  }
  olive(g, X(30), 120, 70, rand, 1);
  olive(g, X(98), 196, 44, rand, 0.8);
}

function shadeHex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

let shipSprite: Canvas | null = null;

/** The ship as a cached sprite (bobs per frame): hull planks, shields, oars, rigging, lit sail. */
function ship(): Canvas {
  if (shipSprite) return shipSprite;
  const c = createCanvas(200, 140);
  const g = c.getContext('2d');
  g.translate(100, 110);
  // rigging
  g.strokeStyle = 'rgba(11,34,54,0.9)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, -92); g.lineTo(-70, -8);
  g.moveTo(0, -92); g.lineTo(72, -10);
  g.stroke();
  // hull with plank lines and a curled prow and stern
  const hull = g.createLinearGradient(0, -14, 0, 12);
  hull.addColorStop(0, '#2A4A63');
  hull.addColorStop(1, '#081B2B');
  g.fillStyle = hull;
  g.beginPath();
  g.moveTo(-72, -20);
  g.quadraticCurveTo(-74, -2, -56, 4);
  g.quadraticCurveTo(0, 20, 60, 2);
  g.quadraticCurveTo(78, -6, 80, -26);
  g.quadraticCurveTo(70, -12, 58, -10);
  g.lineTo(-56, -10);
  g.quadraticCurveTo(-66, -12, -72, -20);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(127,167,190,0.35)';
  for (const y of [-5, 1]) { g.beginPath(); g.moveTo(-58, y); g.quadraticCurveTo(0, y + 12, 60, y - 4); g.stroke(); }
  // shields along the rail
  for (let x = -46; x <= 46; x += 13) {
    const sh = g.createRadialGradient(x - 1, -12, 0, x, -11, 5);
    sh.addColorStop(0, '#F3DFA6');
    sh.addColorStop(1, x % 26 === 0 ? '#C45C3E' : '#3E7CA6');
    g.fillStyle = sh;
    g.beginPath(); g.arc(x, -11, 4.5, 0, Math.PI * 2); g.fill();
  }
  // oars
  g.strokeStyle = '#081B2B';
  g.lineWidth = 2;
  for (let x = -44; x <= 44; x += 11) { g.beginPath(); g.moveTo(x, 2); g.lineTo(x - 9, 20); g.stroke(); }
  // mast
  g.fillStyle = '#081B2B';
  g.fillRect(-2, -94, 4, 86);
  // sail, lit from the sun side, with a soft shading curve and the diamond emblem
  const sail = g.createLinearGradient(-34, 0, 34, 0);
  sail.addColorStop(0, '#FFF3D6');
  sail.addColorStop(0.6, '#F1E3C8');
  sail.addColorStop(1, '#C8B898');
  g.fillStyle = sail;
  g.beginPath();
  g.moveTo(-36, -80);
  g.quadraticCurveTo(0, -72, 36, -80);
  g.quadraticCurveTo(40, -50, 32, -24);
  g.quadraticCurveTo(0, -16, -32, -24);
  g.quadraticCurveTo(-40, -50, -36, -80);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(26,58,82,0.6)';
  g.lineWidth = 1.5;
  for (const x of [-18, 0, 18]) { g.beginPath(); g.moveTo(x, -76); g.lineTo(x, -21); g.stroke(); }
  g.strokeStyle = '#1A3A52';
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, -60); g.lineTo(13, -48); g.lineTo(0, -36); g.lineTo(-13, -48); g.closePath(); g.stroke();
  g.fillStyle = '#C45C3E';
  g.beginPath(); g.arc(0, -48, 3, 0, Math.PI * 2); g.fill();
  // yard and pennant
  g.fillStyle = '#081B2B';
  g.fillRect(-40, -83, 80, 3);
  g.fillStyle = '#C45C3E';
  g.beginPath(); g.moveTo(2, -94); g.quadraticCurveTo(14, -92, 24, -88); g.quadraticCurveTo(14, -86, 2, -84); g.closePath(); g.fill();
  shipSprite = c;
  return c;
}

function paintFloor(g: SKRSContext2D): void {
  // carved stone deck: a gradient, tile joints, and a raised gold Greek-key frieze
  const stone = g.createLinearGradient(0, FLOOR, 0, STAGE.h);
  stone.addColorStop(0, '#16344C');
  stone.addColorStop(1, '#081A29');
  g.fillStyle = stone;
  g.fillRect(0, FLOOR, STAGE.w, STAGE.h - FLOOR);
  // frieze band
  const band = g.createLinearGradient(0, FLOOR - 4, 0, FLOOR + 18);
  band.addColorStop(0, '#F6D88C');
  band.addColorStop(0.2, '#C9A24A');
  band.addColorStop(0.8, '#7C6024');
  band.addColorStop(1, '#3D2F12');
  g.fillStyle = band;
  g.fillRect(0, FLOOR - 4, STAGE.w, 22);
  // the key pattern: a dark carved groove with a light upper edge (relief)
  drawMeander(g, 6, FLOOR + 1, STAGE.w - 12, 8, 'rgba(40,28,8,0.85)');
  drawMeander(g, 6, FLOOR, STAGE.w - 12, 8, 'rgba(255,240,200,0.45)');
  g.fillStyle = 'rgba(255,240,200,0.7)';
  g.fillRect(0, FLOOR - 4, STAGE.w, 1);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, FLOOR + 18, STAGE.w, 2);
  // tile joints in perspective
  g.strokeStyle = 'rgba(127,167,190,0.12)';
  g.lineWidth = 1;
  for (let i = -12; i <= 12; i++) {
    g.beginPath();
    g.moveTo(STAGE.w / 2 + i * 40, FLOOR + 20);
    g.lineTo(STAGE.w / 2 + i * 95, STAGE.h);
    g.stroke();
  }
  for (const y of [470, 505]) { g.beginPath(); g.moveTo(0, y); g.lineTo(STAGE.w, y); g.stroke(); }
}

function paintOdyssey(): Canvas {
  const c = createCanvas(STAGE.w, STAGE.h);
  const g = c.getContext('2d');
  const rand = seededLocal(2026);
  paintSky(g, rand);
  paintSun(g);
  paintSea(g, rand);
  cliff(g, 'left', rand);
  cliff(g, 'right', rand);
  paintFloor(g);
  drawPedestal(g, true);
  return c;
}

function seededLocal(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// twinkling stars and sea glints: fixed positions, per-frame brightness
const TWINKLES = (() => {
  const r = seededLocal(99);
  return Array.from({ length: 16 }, () => ({ x: 170 + r() * 620, y: 10 + r() * 150, p: r() * 6.28, s: 0.6 + r() * 0.6 }));
})();
const GLINTS = (() => {
  const r = seededLocal(5);
  return Array.from({ length: 22 }, () => ({ x: SUN_X - 110 + r() * 220, y: HORIZON + 6 + r() * 110, p: r() * 6.28, w: 6 + r() * 16 }));
})();

function drawOdysseyMotion(ctx: SKRSContext2D, nowMs: number): void {
  const t = nowMs / 1000;
  ctx.save();
  for (const s of TWINKLES) {
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * s.s * 2 + s.p));
    ctx.fillStyle = `rgba(255,248,225,${a})`;
    ctx.fillRect(s.x, s.y, 2, 2);
    if (a > 0.9) { ctx.fillStyle = `rgba(255,248,225,${(a - 0.9) * 4})`; ctx.fillRect(s.x - 2, s.y + 0.5, 6, 1); ctx.fillRect(s.x + 0.5, s.y - 2, 1, 6); }
  }
  ctx.globalCompositeOperation = 'screen';
  for (const gl of GLINTS) {
    const a = Math.max(0, Math.sin(t * 2.4 + gl.p));
    if (a < 0.2) continue;
    ctx.fillStyle = `rgba(255,228,170,${a * 0.7})`;
    ctx.fillRect(gl.x + Math.sin(t + gl.p) * 4, gl.y, gl.w * a, 1.5);
  }
  ctx.restore();
  // the ship rides the swell
  const bob = Math.sin(t * 1.3) * 2;
  const roll = Math.sin(t * 1.3 + 0.8) * 0.02;
  ctx.save();
  ctx.translate(706, HORIZON + 14 + bob);
  ctx.rotate(roll);
  ctx.scale(0.62, 0.62);
  ctx.drawImage(ship(), -100, -110);
  ctx.restore();
  // its reflection
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.translate(706, HORIZON + 18 + bob);
  ctx.scale(0.62, -0.3);
  ctx.drawImage(ship(), -100, -110);
  ctx.restore();
}

/** Odyssey title: a textured parchment plaque with a carved double border and gold trim. */
function drawPlaque(ctx: SKRSContext2D): void {
  const m = LAYOUT.marquee;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  const paper = ctx.createLinearGradient(0, m.y, 0, m.y + m.h);
  paper.addColorStop(0, '#FBF4E6');
  paper.addColorStop(1, '#E2D3B6');
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.roundRect(m.x, m.y, m.w, m.h, 6);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(m.x, m.y, m.w, m.h, 6);
  ctx.clip();
  // burnt edges
  const edge = ctx.createRadialGradient(m.x + m.w / 2, m.y + m.h / 2, m.h * 0.6, m.x + m.w / 2, m.y + m.h / 2, m.w * 0.62);
  edge.addColorStop(0, 'rgba(120,80,30,0)');
  edge.addColorStop(1, 'rgba(120,80,30,0.35)');
  ctx.fillStyle = edge;
  ctx.fillRect(m.x, m.y, m.w, m.h);
  ctx.restore();
  ctx.strokeStyle = '#0B2236';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(m.x + 5, m.y + 5, m.w - 10, m.h - 10);
  ctx.strokeStyle = 'rgba(201,162,74,0.95)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(m.x + 9, m.y + 9, m.w - 18, m.h - 18);
  for (const side of [-1, 1]) {
    const dx = m.x + m.w / 2 + side * (m.w / 2 - 22);
    const dy = m.y + m.h / 2;
    const gem = ctx.createLinearGradient(dx, dy - 7, dx, dy + 7);
    gem.addColorStop(0, '#E8866A');
    gem.addColorStop(1, '#8E3A24');
    ctx.fillStyle = gem;
    ctx.beginPath();
    ctx.moveTo(dx, dy - 7); ctx.lineTo(dx + 7, dy); ctx.lineTo(dx, dy + 7); ctx.lineTo(dx - 7, dy);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(dx - 1.5, dy - 4, 2, 2);
  }
  // engraved title: a light offset under the ink gives a carved look
  ctx.font = `24px ${FONTS.title}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('THE PRICE IS LIVE', m.x + m.w / 2, m.y + m.h / 2 + 3, m.w - 80);
  ctx.fillStyle = COLORS.ink;
  ctx.fillText('THE PRICE IS LIVE', m.x + m.w / 2, m.y + m.h / 2 + 2, m.w - 80);
}

/** How far the wide scene moves sideways so its centre (x 480) sits behind the host. */
function sceneShiftX(): number {
  return shape() === 'wide' ? 0 : LAYOUT.host.x + LAYOUT.host.w / 2 - 480;
}

/**
 * The scene art is drawn for the wide 960x540 frame. For the square frame it is painted wide,
 * shifted so its centre sits behind the host, and its floor is carried down to the bottom edge.
 */
function paintScene(t: ThemeName, sh: StageShape): Canvas {
  const paint = () => (t === 'odyssey' ? paintOdyssey() : paintStatic());
  if (sh === 'wide') return paint();
  const shiftX = sceneShiftX();
  applyShape('wide');
  let wide: Canvas;
  try {
    wide = paint();
  } finally {
    applyShape(sh);
  }
  const c = createCanvas(STAGE.w, STAGE.h);
  const g = c.getContext('2d');
  g.drawImage(wide, shiftX, 0);
  // below y 540: repeat the bottom band of the floor, darkening towards the bottom edge
  for (let y = 540; y < STAGE.h; y += 60) g.drawImage(wide, 0, 480, 960, 60, shiftX, y, 960, 60);
  const fade = g.createLinearGradient(0, 520, 0, STAGE.h);
  fade.addColorStop(0, 'rgba(6,16,28,0)');
  fade.addColorStop(1, 'rgba(6,16,28,0.45)');
  g.fillStyle = fade;
  g.fillRect(0, 520, STAGE.w, STAGE.h - 520);
  return c;
}

export function drawBackground(ctx: SKRSContext2D, nowMs: number): void {
  registerFonts();
  const t = theme();
  const sh = shape();
  if (!cache || cache.theme !== t || cache.shape !== sh) cache = { theme: t, shape: sh, canvas: paintScene(t, sh) };
  ctx.save();
  ctx.drawImage(cache.canvas, 0, 0);
  if (t === 'odyssey') {
    // the scene's moving parts are placed for the wide frame; shift them with the scene
    ctx.save();
    ctx.translate(sceneShiftX(), 0);
    drawOdysseyMotion(ctx, nowMs);
    ctx.restore();
    drawPlaque(ctx);
  } else drawMarquee(ctx, nowMs);
  ctx.restore();
}
