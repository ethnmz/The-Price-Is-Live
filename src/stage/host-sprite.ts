// Chip Dollar, the game show host, drawn only with vector shapes (docs/SPEC.md 13.3, 13.4).
// Pure: the picture depends only on (pose, mouth, nowMs). He stays inside LAYOUT.host.
//
// V2 restyle: real shoulders and hands, thinner outlines, painterly shading (soft core shadows,
// highlights and rim light). Classic theme: a lit game-show jacket. Odyssey theme: a Greek chiton
// with a gold key-pattern sash, a terracotta cloak with a gold clasp, and a laurel wreath.
import type { SKRSContext2D } from '@napi-rs/canvas';
import { COLORS, LAYOUT, theme } from './theme';
import { shade } from './fx';
import type { MouthShape } from './mouth';

export type HostPose = 'idle' | 'talking' | 'reveal' | 'celebrate';
type Ctx = SKRSContext2D;
type Pt = [number, number];

const SKIN = '#F2BE8C';
const SKIN_SHADE = '#D4935E';
const HAIR = '#3A2618';
const CX = LAYOUT.host.x + LAYOUT.host.w / 2; // 480
const HEAD_Y = 180;
const HEAD_RX = 38;
const HEAD_RY = 43;
const LINE = 2.5; // outline width (thinner than V1's 4 px)
const SHOULDER_L: Pt = [CX - 58, 244];
const SHOULDER_R: Pt = [CX + 58, 244];

const outline = () => shade(COLORS.ink, 0.08);

function hash(n: number): number {
  let x = Math.imul(n + 1, 2654435761) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 1274126177) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** True while the eyes are shut: 120 ms about every 3 to 5 s. */
export function isBlinking(nowMs: number): boolean {
  const slot = Math.floor(nowMs / 4000);
  const start = slot * 4000 + 1000 + (hash(slot) % 1000);
  return nowMs >= start && nowMs < start + 120;
}

/** Fill the current path with a soft "core shadow" on one side, clipped to the shape. */
function coreShadow(ctx: Ctx, x: number, y: number, r: number, a = 0.28): void {
  ctx.save();
  ctx.clip();
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(40,20,10,${a})`);
  g.addColorStop(1, 'rgba(40,20,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function skinFill(ctx: Ctx, x: number, y: number, r: number): ReturnType<Ctx['createRadialGradient']> {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.2);
  g.addColorStop(0, '#FFE1BD');
  g.addColorStop(0.6, SKIN);
  g.addColorStop(1, SKIN_SHADE);
  return g;
}

// ---------- hands ----------

/** A friendly mitten hand with a thumb, turned to `angle` (radians, 0 = pointing right). */
function hand(ctx: Ctx, p: Pt, angle: number, flip = 1): void {
  ctx.save();
  ctx.translate(p[0], p[1]);
  ctx.rotate(angle);
  ctx.scale(1, flip);
  ctx.lineWidth = LINE;
  ctx.strokeStyle = outline();
  ctx.fillStyle = skinFill(ctx, 0, 0, 13);
  ctx.beginPath();
  ctx.ellipse(2, 0, 12, 9.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(120,60,30,0.45)';
  ctx.lineWidth = 1.2;
  for (const y of [-3, 1.5]) { ctx.beginPath(); ctx.moveTo(7, y); ctx.lineTo(12, y); ctx.stroke(); }
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = outline();
  ctx.lineWidth = LINE;
  ctx.beginPath();
  ctx.ellipse(-2, -9, 4.5, 7, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------- arms ----------

function sleeveColor(): string {
  return theme() === 'odyssey' ? COLORS.cream : COLORS.alert;
}

/** A tapered sleeve from shoulder to elbow to wrist, shaded, with a gold cuff. */
function arm(ctx: Ctx, from: Pt, elbow: Pt, wrist: Pt): void {
  if (theme() === 'odyssey') return bareArm(ctx, from, elbow, wrist);
  const base = sleeveColor();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, c, dx, dy] of [
    [21, outline(), 0, 0],
    [16, shade(base, -0.14), 0, 0],
    [7, shade(base, 0.22), -1.5, -2.5],
  ] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(from[0] + dx, from[1] + dy);
    ctx.lineTo(elbow[0] + dx, elbow[1] + dy);
    ctx.lineTo(wrist[0] + dx, wrist[1] + dy);
    ctx.stroke();
  }
  const ang = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
  ctx.save();
  ctx.translate(wrist[0], wrist[1]);
  ctx.rotate(ang);
  ctx.fillStyle = COLORS.gold;
  ctx.strokeStyle = outline();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-5, -9, 7, 18, 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Odyssey: a short chiton sleeve over the shoulder, then a bare, shaded arm with a gold band. */
function bareArm(ctx: Ctx, from: Pt, elbow: Pt, wrist: Pt): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.moveTo(from[0] + dx, from[1] + dy);
    ctx.lineTo(elbow[0] + dx, elbow[1] + dy);
    ctx.lineTo(wrist[0] + dx, wrist[1] + dy);
  };
  for (const [w, c, dx, dy] of [[17, outline(), 0, 0], [12.5, SKIN_SHADE, 0, 0], [6, '#FFD9B0', -1.5, -2]] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    path(dx, dy);
    ctx.stroke();
  }
  // short sleeve: the first 45% of the upper arm
  const mid: Pt = [from[0] + (elbow[0] - from[0]) * 0.45, from[1] + (elbow[1] - from[1]) * 0.45];
  for (const [w, c] of [[24, outline()], [20, shade(COLORS.cream, -0.08)]] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(mid[0], mid[1]);
    ctx.stroke();
  }
  // gold arm band just above the wrist
  const ang = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
  const band: Pt = [elbow[0] + (wrist[0] - elbow[0]) * 0.7, elbow[1] + (wrist[1] - elbow[1]) * 0.7];
  ctx.save();
  ctx.translate(band[0], band[1]);
  ctx.rotate(ang);
  const g = ctx.createLinearGradient(0, -8, 0, 8);
  g.addColorStop(0, '#FFF0B8');
  g.addColorStop(1, shade(COLORS.gold, -0.4));
  ctx.fillStyle = g;
  ctx.strokeStyle = outline();
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-3, -8, 6, 16, 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ---------- mic ----------

function mic(ctx: Ctx, at: Pt, tilt: number): void {
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.rotate(tilt);
  ctx.lineWidth = LINE;
  ctx.strokeStyle = outline();
  const handle = ctx.createLinearGradient(-5, 0, 5, 0);
  handle.addColorStop(0, '#2B3440');
  handle.addColorStop(0.4, '#6E7C8C');
  handle.addColorStop(1, '#1E252E');
  ctx.fillStyle = handle;
  ctx.beginPath();
  ctx.roundRect(-4.5, -18, 9, 34, 3);
  ctx.fill();
  ctx.stroke();
  const ball = ctx.createRadialGradient(-4, -31, 2, 0, -26, 12);
  ball.addColorStop(0, '#FFF3C8');
  ball.addColorStop(0.5, COLORS.gold);
  ball.addColorStop(1, shade(COLORS.gold, -0.4));
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(0, -26, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80,55,10,0.45)';
  ctx.lineWidth = 1;
  for (const y of [-31, -26, -21]) { ctx.beginPath(); ctx.moveTo(-9, y); ctx.lineTo(9, y); ctx.stroke(); }
  ctx.restore();
  hand(ctx, at, -Math.PI / 2 + tilt, -1); // the hand wraps the handle
}

// ---------- torso ----------

/** The body silhouette: rounded shoulders down to the bottom of the frame. */
function bodyPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(CX - 16, 222);
  ctx.quadraticCurveTo(CX - 40, 226, CX - 58, 238);
  ctx.quadraticCurveTo(CX - 72, 246, CX - 70, 268);
  ctx.lineTo(CX - 64, 348);
  ctx.lineTo(CX + 64, 348);
  ctx.lineTo(CX + 70, 268);
  ctx.quadraticCurveTo(CX + 72, 246, CX + 58, 238);
  ctx.quadraticCurveTo(CX + 40, 226, CX + 16, 222);
  ctx.closePath();
}

function shadedBody(ctx: Ctx, base: string): void {
  const g = ctx.createLinearGradient(CX - 70, 0, CX + 70, 0);
  g.addColorStop(0, shade(base, -0.28));
  g.addColorStop(0.3, shade(base, 0.1));
  g.addColorStop(0.55, base);
  g.addColorStop(1, shade(base, -0.32));
  bodyPath(ctx);
  ctx.fillStyle = g;
  ctx.fill();
  bodyPath(ctx);
  coreShadow(ctx, CX + 50, 320, 70, 0.22);
  bodyPath(ctx);
  ctx.strokeStyle = outline();
  ctx.lineWidth = LINE;
  ctx.stroke();
}

function jacket(ctx: Ctx): void {
  shadedBody(ctx, COLORS.alert);
  ctx.lineWidth = LINE;
  ctx.strokeStyle = outline();
  const shirt = ctx.createLinearGradient(0, 222, 0, 300);
  shirt.addColorStop(0, '#FFFFFF');
  shirt.addColorStop(1, shade(COLORS.cream, -0.08));
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.moveTo(CX - 16, 222);
  ctx.lineTo(CX + 16, 222);
  ctx.lineTo(CX, 292);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const s of [-1, 1]) {
    ctx.fillStyle = shade(COLORS.alert, -0.18);
    ctx.strokeStyle = outline();
    ctx.lineWidth = LINE;
    ctx.beginPath();
    ctx.moveTo(CX + s * 16, 222);
    ctx.lineTo(CX + s * 30, 228);
    ctx.lineTo(CX + s * 14, 262);
    ctx.lineTo(CX + s * 2, 290);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(CX + s * 29, 229);
    ctx.lineTo(CX + s * 13, 263);
    ctx.stroke();
  }
  for (const y of [304, 324]) {
    const b = ctx.createRadialGradient(CX - 1, y - 1, 0, CX, y, 5);
    b.addColorStop(0, '#FFF3C8');
    b.addColorStop(1, shade(COLORS.gold, -0.35));
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(CX, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Classic bow tie, drawn after the head so the neck never hides it. */
function bowTie(ctx: Ctx): void {
  const y = 228;
  ctx.fillStyle = COLORS.purple;
  ctx.strokeStyle = outline();
  ctx.lineWidth = LINE;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX, y);
    ctx.quadraticCurveTo(CX + s * 14, y - 13, CX + s * 22, y - 9);
    ctx.lineTo(CX + s * 22, y + 9);
    ctx.quadraticCurveTo(CX + s * 14, y + 13, CX, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = shade(COLORS.purple, 0.25);
  ctx.beginPath();
  ctx.roundRect(CX - 5, y - 6, 10, 12, 3);
  ctx.fill();
  ctx.stroke();
}

/** Odyssey outfit: draped chiton, gold key-pattern sash, terracotta cloak with a gold clasp. */
function chiton(ctx: Ctx): void {
  shadedBody(ctx, COLORS.cream);
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  for (const [x0, x1, a] of [[-38, -20, 0.18], [-8, 6, 0.14], [22, 38, 0.18], [44, 56, 0.12]] as const) {
    ctx.strokeStyle = `rgba(120,95,60,${a})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(CX + x0, 236);
    ctx.quadraticCurveTo(CX + (x0 + x1) / 2 - 6, 290, CX + x1, 348);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CX + x0 + 3, 236);
    ctx.quadraticCurveTo(CX + (x0 + x1) / 2 - 3, 290, CX + x1 + 3, 348);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120,95,60,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX - 20, 224);
  ctx.quadraticCurveTo(CX, 244, CX + 20, 224);
  ctx.stroke();
  const cloak = ctx.createLinearGradient(CX - 72, 0, CX - 20, 0);
  cloak.addColorStop(0, shade(COLORS.alert, -0.35));
  cloak.addColorStop(0.6, COLORS.alert);
  cloak.addColorStop(1, shade(COLORS.alert, 0.15));
  ctx.fillStyle = cloak;
  ctx.beginPath();
  ctx.moveTo(CX - 72, 250);
  ctx.quadraticCurveTo(CX - 52, 230, CX - 24, 232);
  ctx.quadraticCurveTo(CX - 30, 290, CX - 44, 348);
  ctx.lineTo(CX - 72, 348);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = outline();
  ctx.lineWidth = LINE;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(60,20,10,0.35)';
  ctx.lineWidth = 3;
  for (const x of [-56, -44]) { ctx.beginPath(); ctx.moveTo(CX + x, 250); ctx.quadraticCurveTo(CX + x - 4, 300, CX + x - 2, 348); ctx.stroke(); }
  ctx.save();
  ctx.translate(CX - 26, 240);
  ctx.rotate(0.62);
  const sash = ctx.createLinearGradient(0, -9, 0, 9);
  sash.addColorStop(0, '#FFF0B8');
  sash.addColorStop(0.45, COLORS.gold);
  sash.addColorStop(1, shade(COLORS.gold, -0.4));
  ctx.fillStyle = sash;
  ctx.fillRect(0, -9, 150, 18);
  ctx.strokeStyle = outline();
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, -9, 150, 18);
  ctx.strokeStyle = 'rgba(70,45,10,0.75)';
  ctx.beginPath();
  for (let x = 4; x < 146; x += 12) {
    ctx.moveTo(x, 5); ctx.lineTo(x, -5); ctx.lineTo(x + 8, -5); ctx.lineTo(x + 8, 2); ctx.lineTo(x + 3, 2); ctx.lineTo(x + 3, -1);
  }
  ctx.stroke();
  ctx.restore();
  ctx.restore();
  const c = ctx.createRadialGradient(CX - 34, 236, 1, CX - 32, 238, 9);
  c.addColorStop(0, '#FFF6D2');
  c.addColorStop(0.5, COLORS.gold);
  c.addColorStop(1, shade(COLORS.gold, -0.45));
  ctx.fillStyle = c;
  ctx.strokeStyle = outline();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(CX - 32, 238, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLORS.alert;
  ctx.beginPath();
  ctx.arc(CX - 32, 238, 3, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- head ----------

function hair(ctx: Ctx): void {
  const g = ctx.createLinearGradient(0, HEAD_Y - 52, 0, HEAD_Y - 10);
  g.addColorStop(0, shade(HAIR, 0.22));
  g.addColorStop(1, HAIR);
  ctx.fillStyle = g;
  ctx.strokeStyle = outline();
  ctx.lineWidth = LINE;
  ctx.beginPath();
  ctx.moveTo(CX - HEAD_RX - 1, HEAD_Y - 2);
  ctx.bezierCurveTo(CX - HEAD_RX - 6, HEAD_Y - 46, CX - 6, HEAD_Y - 64, CX + 22, HEAD_Y - 52);
  ctx.bezierCurveTo(CX + 40, HEAD_Y - 46, CX + HEAD_RX + 4, HEAD_Y - 28, CX + HEAD_RX + 1, HEAD_Y - 4);
  ctx.bezierCurveTo(CX + 28, HEAD_Y - 26, CX + 10, HEAD_Y - 22, CX - 8, HEAD_Y - 30);
  ctx.bezierCurveTo(CX - 22, HEAD_Y - 34, CX - 30, HEAD_Y - 22, CX - HEAD_RX + 4, HEAD_Y - 6);
  ctx.lineTo(CX - HEAD_RX + 2, HEAD_Y + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,230,200,0.35)';
  ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[-24, -44, 8, -54], [-12, -38, 20, -48], [0, -32, 30, -40]] as const) {
    ctx.beginPath();
    ctx.moveTo(CX + x0, HEAD_Y + y0);
    ctx.quadraticCurveTo(CX + (x0 + x1) / 2, HEAD_Y + Math.min(y0, y1) - 6, CX + x1, HEAD_Y + y1);
    ctx.stroke();
  }
}

function eyes(ctx: Ctx, blink: boolean): void {
  const y = HEAD_Y - 2;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const x = CX + s * 15;
    if (blink) {
      ctx.strokeStyle = outline();
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 1);
      ctx.quadraticCurveTo(x, y + 4, x + 7, y + 1);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = outline();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, 7.5, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const iris = ctx.createRadialGradient(x, y + 1, 0, x, y + 1, 5.5);
    iris.addColorStop(0, '#7A4A22');
    iris.addColorStop(1, '#3B2210');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(x, y + 1.5, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#120804';
    ctx.beginPath();
    ctx.arc(x, y + 1.5, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x - 2, y - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 1.8, y + 3.2, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = outline();
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 8, 9.5, 0, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  }
}

function drawMouth(ctx: Ctx, mouth: MouthShape): void {
  const x = CX;
  const y = HEAD_Y + 22;
  ctx.strokeStyle = outline();
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  if (mouth === 'closed') {
    ctx.beginPath();
    ctx.moveTo(x - 13, y - 2);
    ctx.quadraticCurveTo(x, y + 9, x + 13, y - 2);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * 13, y - 4); ctx.lineTo(x + s * 15, y); ctx.stroke(); }
    return;
  }
  const w = mouth === 'half' ? 13 : 18;
  const h = mouth === 'half' ? 9 : 16;
  ctx.fillStyle = '#3A0E0A';
  ctx.beginPath();
  ctx.moveTo(x - w, y - 4);
  ctx.quadraticCurveTo(x, y - 2, x + w, y - 4);
  ctx.quadraticCurveTo(x + w - 2, y + h, x, y + h);
  ctx.quadraticCurveTo(x - w + 2, y + h, x - w, y - 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#FFFDF6'; // teeth
  ctx.fillRect(x - w, y - 5, w * 2, 5);
  ctx.fillStyle = '#D0574A'; // tongue
  ctx.beginPath();
  ctx.ellipse(x, y + h, w * 0.6, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function faceEllipse(ctx: Ctx): void {
  ctx.beginPath();
  ctx.ellipse(CX, HEAD_Y, HEAD_RX, HEAD_RY, 0, 0, Math.PI * 2);
}

function head(ctx: Ctx, mouth: MouthShape, blink: boolean): void {
  ctx.lineWidth = LINE;
  ctx.strokeStyle = outline();
  ctx.fillStyle = SKIN;
  ctx.beginPath();
  ctx.roundRect(CX - 13, HEAD_Y + 30, 26, 30, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(120,60,30,0.35)';
  ctx.fillRect(CX - 12, HEAD_Y + 32, 24, 9);
  for (const s of [-1, 1]) {
    ctx.fillStyle = skinFill(ctx, CX + s * HEAD_RX, HEAD_Y + 4, 9);
    ctx.strokeStyle = outline();
    ctx.beginPath();
    ctx.ellipse(CX + s * (HEAD_RX - 1), HEAD_Y + 4, 7, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = skinFill(ctx, CX, HEAD_Y, HEAD_RY);
  faceEllipse(ctx);
  ctx.fill();
  faceEllipse(ctx);
  coreShadow(ctx, CX + 30, HEAD_Y + 20, 34, 0.25);
  faceEllipse(ctx);
  ctx.strokeStyle = outline();
  ctx.lineWidth = LINE;
  ctx.stroke();
  hair(ctx);
  for (const s of [-1, 1]) {
    const b = ctx.createRadialGradient(CX + s * 25, HEAD_Y + 14, 0, CX + s * 25, HEAD_Y + 14, 10);
    b.addColorStop(0, 'rgba(235,120,105,0.55)');
    b.addColorStop(1, 'rgba(235,120,105,0)');
    ctx.fillStyle = b;
    ctx.fillRect(CX + s * 25 - 10, HEAD_Y + 4, 20, 20);
  }
  eyes(ctx, blink);
  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + s * 7, HEAD_Y - 17);
    ctx.quadraticCurveTo(CX + s * 15, HEAD_Y - 22, CX + s * 23, HEAD_Y - 18);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(150,80,40,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX + 1, HEAD_Y + 2);
  ctx.quadraticCurveTo(CX + 6, HEAD_Y + 11, CX - 2, HEAD_Y + 13);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,240,220,0.7)';
  ctx.beginPath();
  ctx.arc(CX - 1, HEAD_Y + 6, 1.6, 0, Math.PI * 2);
  ctx.fill();
  drawMouth(ctx, mouth);
}

/** Odyssey theme: a gold-and-olive laurel wreath around the crown of the head. */
function wreath(ctx: Ctx): void {
  ctx.save();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const ang = side < 0 ? Math.PI + 0.12 + i * 0.2 : -0.12 - i * 0.2;
      const x = CX + Math.cos(ang) * (HEAD_RX + 3);
      const y = HEAD_Y - 12 + Math.sin(ang) * (HEAD_RY - 8) * 0.95;
      const base = i % 2 ? '#4E8C6A' : COLORS.gold;
      const leaf = ctx.createLinearGradient(x - 8, y - 4, x + 8, y + 4);
      leaf.addColorStop(0, shade(base, 0.3));
      leaf.addColorStop(1, shade(base, -0.25));
      ctx.fillStyle = leaf;
      ctx.strokeStyle = outline();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, y, 9.5, 4.2, ang + (side < 0 ? 0.9 : -0.9), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- the host ----------

export function drawHost(ctx: Ctx, a: { pose: HostPose; mouth: MouthShape; nowMs: number }): void {
  const { pose, mouth, nowMs } = a;
  const b = LAYOUT.host;
  const bob = pose === 'talking' ? Math.round(1 + Math.sin(nowMs / 120)) : 0; // 0..2 px
  ctx.save();
  // everything stays inside the host box (2 px margin)
  ctx.beginPath();
  ctx.rect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
  ctx.clip();
  const odyssey = theme() === 'odyssey';
  if (odyssey) {
    // the setting sun sits right behind Chip: a warm halo separates him from the sky
    const halo = ctx.createRadialGradient(CX, 240, 30, CX, 240, 170);
    halo.addColorStop(0, 'rgba(255,214,140,0.35)');
    halo.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  ctx.translate(0, -bob);
  let leftElbow: Pt = [CX - 82, 288];
  let leftHand: Pt = [CX - 84, 316];
  let rightElbow: Pt = [CX + 82, 286];
  let rightHand: Pt = [CX + 86, 304];
  let tilt = 0.15;
  let leftAngle = Math.PI / 2;
  if (pose === 'talking') {
    rightElbow = [CX + 88, 280];
    rightHand = [CX + 58, 226];
    tilt = -0.35;
  } else if (pose === 'reveal') {
    leftElbow = [CX - 98, 214];
    leftHand = [CX - 104, 156];
    leftAngle = -Math.PI / 2;
  } else if (pose === 'celebrate') {
    leftElbow = [CX - 98, 214];
    leftHand = [CX - 92, 154];
    rightElbow = [CX + 98, 214];
    rightHand = [CX + 92, 154];
    tilt = 0.2;
    leftAngle = -Math.PI / 2;
  }
  arm(ctx, SHOULDER_L, leftElbow, leftHand);
  arm(ctx, SHOULDER_R, rightElbow, rightHand);
  if (odyssey) chiton(ctx);
  else jacket(ctx);
  head(ctx, mouth, isBlinking(nowMs));
  if (odyssey) wreath(ctx);
  else bowTie(ctx);
  hand(ctx, leftHand, leftAngle);
  mic(ctx, rightHand, tilt);
  if (odyssey) {
    // rim light from the sun behind: a warm edge along the shoulders
    ctx.strokeStyle = 'rgba(255,214,140,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CX - 64, 246);
    ctx.quadraticCurveTo(CX - 44, 230, CX - 18, 226);
    ctx.moveTo(CX + 18, 226);
    ctx.quadraticCurveTo(CX + 44, 230, CX + 64, 246);
    ctx.stroke();
  }
  ctx.restore();
}
