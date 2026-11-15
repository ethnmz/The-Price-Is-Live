// Chip Dollar, the game show host, drawn only with vector shapes (docs/SPEC.md 13.3, 13.4).
// Pure: the picture depends only on (pose, mouth, nowMs). He stays inside LAYOUT.host.
import type { SKRSContext2D } from '@napi-rs/canvas';
import { COLORS, LAYOUT, theme } from './theme';
import { shade } from './fx';
import type { MouthShape } from './mouth';

export type HostPose = 'idle' | 'talking' | 'reveal' | 'celebrate';
type Ctx = SKRSContext2D;
type Pt = [number, number];

const SKIN = '#F5C28B';
const HAIR = '#3B2A20';
const CX = LAYOUT.host.x + LAYOUT.host.w / 2; // 480
const HEAD_Y = 188;
const HEAD_R = 46;
const SHOULDER_L: Pt = [CX - 52, 252];
const SHOULDER_R: Pt = [CX + 52, 252];

/** Small deterministic hash so blink times look random but come only from the clock. */
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

function handCircle(ctx: Ctx, p: Pt): void {
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p[0], p[1], 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function arm(ctx: Ctx, from: Pt, elbow: Pt, hand: Pt): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [w, c, dy] of [[22, COLORS.ink, 0], [14, shade(COLORS.alert, -0.12), 0], [5, shade(COLORS.alert, 0.3), -3]] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1] + dy);
    ctx.lineTo(elbow[0], elbow[1] + dy);
    ctx.lineTo(hand[0], hand[1] + dy);
    ctx.stroke();
  }
}

function mic(ctx: Ctx, hand: Pt, tilt: number): void {
  ctx.save();
  ctx.translate(hand[0], hand[1]);
  ctx.rotate(tilt);
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.ink;
  ctx.fillStyle = COLORS.gray;
  ctx.beginPath();
  ctx.rect(-5, -18, 10, 34); // handle
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLORS.gold;
  ctx.beginPath();
  ctx.arc(0, -26, 11, 0, Math.PI * 2); // head of the mic
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-9, -26);
  ctx.lineTo(9, -26);
  ctx.stroke();
  handCircle(ctx, [0, 0]); // the hand wraps the handle
  ctx.restore();
}

function torso(ctx: Ctx): void {
  ctx.lineWidth = 4;
  ctx.strokeStyle = COLORS.ink;
  // V2: the jacket is lit from above and from the sun behind, darker toward the hem and sides
  const jacket = ctx.createLinearGradient(CX - 72, 0, CX + 72, 0);
  jacket.addColorStop(0, shade(COLORS.alert, -0.3));
  jacket.addColorStop(0.35, shade(COLORS.alert, 0.12));
  jacket.addColorStop(0.65, shade(COLORS.alert, 0.05));
  jacket.addColorStop(1, shade(COLORS.alert, -0.35));
  ctx.fillStyle = jacket;
  ctx.beginPath();
  ctx.moveTo(CX - 56, 246);
  ctx.lineTo(CX + 56, 246);
  ctx.lineTo(CX + 72, 344);
  ctx.lineTo(CX - 72, 344);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // white shirt V
  ctx.fillStyle = COLORS.cream;
  ctx.beginPath();
  ctx.moveTo(CX - 20, 246);
  ctx.lineTo(CX + 20, 246);
  ctx.lineTo(CX, 300);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // gold trim on both lapels and along the hem, plus buttons
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CX - 20, 250);
  ctx.lineTo(CX - 2, 298);
  ctx.moveTo(CX + 20, 250);
  ctx.lineTo(CX + 2, 298);
  ctx.moveTo(CX - 66, 338);
  ctx.lineTo(CX + 66, 338);
  ctx.stroke();
  ctx.fillStyle = COLORS.gold;
  for (const y of [312, 326]) {
    ctx.beginPath();
    ctx.arc(CX, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function bowTie(ctx: Ctx): void {
  const y = 252;
  ctx.fillStyle = COLORS.purple;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 3;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX, y);
    ctx.lineTo(CX + s * 24, y - 12);
    ctx.lineTo(CX + s * 24, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = COLORS.gold;
  ctx.beginPath();
  ctx.arc(CX, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function hair(ctx: Ctx): void {
  ctx.fillStyle = HAIR;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CX - HEAD_R, HEAD_Y - 6);
  ctx.bezierCurveTo(CX - HEAD_R - 2, HEAD_Y - 52, CX + 20, HEAD_Y - 66, CX + HEAD_R, HEAD_Y - 10);
  // swoosh: the front edge sweeps across the forehead
  ctx.bezierCurveTo(CX + 26, HEAD_Y - 30, CX + 4, HEAD_Y - 24, CX - 14, HEAD_Y - 32);
  ctx.bezierCurveTo(CX - 30, HEAD_Y - 36, CX - 40, HEAD_Y - 24, CX - HEAD_R, HEAD_Y - 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // shine
  ctx.strokeStyle = COLORS.gray;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(CX - 20, HEAD_Y - 44);
  ctx.quadraticCurveTo(CX, HEAD_Y - 52, CX + 18, HEAD_Y - 44);
  ctx.stroke();
}

function eyes(ctx: Ctx, blink: boolean): void {
  const y = HEAD_Y - 6;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const x = CX + s * 17;
    if (blink) {
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.stroke();
    } else {
      ctx.fillStyle = COLORS.cream;
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = COLORS.ink;
      ctx.beginPath();
      ctx.arc(x, y + 1, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawMouth(ctx: Ctx, mouth: MouthShape): void {
  const x = CX;
  const y = HEAD_Y + 20;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  if (mouth === 'closed') {
    ctx.beginPath();
    ctx.moveTo(x - 14, y - 2);
    ctx.quadraticCurveTo(x, y + 10, x + 14, y - 2);
    ctx.stroke();
    return;
  }
  const w = mouth === 'half' ? 15 : 20;
  const h = mouth === 'half' ? 9 : 17;
  // a big smile that opens downward
  ctx.fillStyle = COLORS.ink;
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
  ctx.fillStyle = COLORS.cream; // teeth
  ctx.fillRect(x - w, y - 5, w * 2, 5);
  ctx.fillStyle = COLORS.alert; // tongue
  ctx.beginPath();
  ctx.ellipse(x, y + h, w * 0.6, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function head(ctx: Ctx, mouth: MouthShape, blink: boolean): void {
  const face = ctx.createRadialGradient(CX - 14, HEAD_Y - 18, 6, CX, HEAD_Y, HEAD_R + 6);
  face.addColorStop(0, '#FFE2BC');
  face.addColorStop(0.7, SKIN);
  face.addColorStop(1, '#D99A62');
  ctx.fillStyle = face;
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 4;
  ctx.fillRect(CX - 14, HEAD_Y + 34, 28, 26); // neck
  for (const s of [-1, 1]) { // ears
    ctx.beginPath();
    ctx.arc(CX + s * (HEAD_R - 1), HEAD_Y + 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(CX, HEAD_Y, HEAD_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  hair(ctx);
  ctx.fillStyle = '#F29C8B'; // rosy cheeks
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(CX + s * 30, HEAD_Y + 14, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  eyes(ctx, blink);
  ctx.strokeStyle = HAIR; // eyebrows
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + s * 8, HEAD_Y - 22);
    ctx.lineTo(CX + s * 26, HEAD_Y - 24);
    ctx.stroke();
  }
  drawMouth(ctx, mouth);
}

/** Draw Chip Dollar inside LAYOUT.host. Leaves the context as it found it. */
/** Odyssey theme: a gold-and-olive laurel wreath around the crown of the head. */
function wreath(ctx: Ctx): void {
  ctx.save();
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + side * (0.25 + i * 0.2) - (side < 0 ? 0 : 0);
      const ang = side < 0 ? Math.PI + 0.15 + i * 0.2 : -0.15 - i * 0.2;
      const x = CX + Math.cos(ang) * (HEAD_R + 2);
      const y = HEAD_Y - 14 + Math.sin(ang) * (HEAD_R - 6) * 0.9;
      void a;
      ctx.fillStyle = i % 2 ? '#4E8C6A' : COLORS.gold;
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x, y, 10, 4.5, ang + (side < 0 ? 0.9 : -0.9), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawHost(ctx: Ctx, a: { pose: HostPose; mouth: MouthShape; nowMs: number }): void {
  const { pose, mouth, nowMs } = a;
  const bob = pose === 'talking' ? Math.round(1 + Math.sin(nowMs / 120)) : 0; // 0..2 px
  ctx.save();
  ctx.translate(0, -bob);
  let leftElbow: Pt = [CX - 74, 286];
  let leftHand: Pt = [CX - 82, 310];
  let rightElbow: Pt = [CX + 76, 282];
  let rightHand: Pt = [CX + 82, 300];
  let tilt = 0.15;
  if (pose === 'talking') {
    rightElbow = [CX + 82, 284];
    rightHand = [CX + 52, 226];
    tilt = -0.35;
  } else if (pose === 'reveal') {
    leftElbow = [CX - 92, 214];
    leftHand = [CX - 100, 150];
  } else if (pose === 'celebrate') {
    leftElbow = [CX - 92, 214];
    leftHand = [CX - 86, 148];
    rightElbow = [CX + 92, 214];
    rightHand = [CX + 86, 148];
    tilt = 0.2;
  }
  if (theme() === 'odyssey') {
    // the setting sun sits right behind Chip: a warm halo separates him from the sky
    const halo = ctx.createRadialGradient(CX, 250, 30, CX, 250, 190);
    halo.addColorStop(0, 'rgba(255,214,140,0.35)');
    halo.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(CX - 200, 60, 400, 300);
  }
  arm(ctx, SHOULDER_L, leftElbow, leftHand);
  arm(ctx, SHOULDER_R, rightElbow, rightHand);
  torso(ctx);
  bowTie(ctx);
  head(ctx, mouth, isBlinking(nowMs));
  if (theme() === 'odyssey') wreath(ctx);
  handCircle(ctx, leftHand);
  mic(ctx, rightHand, tilt);
  ctx.restore();
}
