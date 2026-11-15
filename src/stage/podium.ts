// Podiums along the bottom row: seat-color body, name plate, score, guess chip, role decorations.
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { StageState } from '../contracts/types';
import { COLORS, FONTS, LAYOUT, PODIUM_W, SEAT_COLORS, STAGE, podiumXs, theme, type Box } from './theme';
import { bevelBox, goldGradient, insetBox, shade, textFx } from './fx';

type Podium = StageState['podiums'][number];

/** Box of each podium for 2, 3 or 4 players (full podium row height). */
export function podiumBoxes(count: number): Box[] {
  const row = LAYOUT.podiums;
  return podiumXs(count).map((x) => ({ x, y: row.y, w: PODIUM_W, h: row.h }));
}

/** Largest font size (<= startPx, >= minPx) at which `name` fits in maxWidth. */
export function fitNameFont(ctx: SKRSContext2D, name: string, maxWidth: number, startPx = 22, minPx = 9): number {
  ctx.save();
  let px = startPx;
  for (; px > minPx; px--) {
    ctx.font = `${px}px ${FONTS.body}`;
    if (ctx.measureText(name).width <= maxWidth) break;
  }
  ctx.restore();
  return px;
}

function seatColor(p: Podium): string {
  return SEAT_COLORS[p.id] ?? COLORS.gray;
}

function chipStyle(p: Podium): { text: string; fill: string; color: string } | null {
  switch (p.guessState) {
    case 'pending': return { text: p.guessText ?? '?', fill: COLORS.cream, color: COLORS.ink };
    case 'locked': return { text: p.guessText?.includes('✓') ? p.guessText : `✓ ${p.guessText ?? ''}`.trim(), fill: COLORS.green, color: '#fff' };
    case 'silent': return { text: '—', fill: COLORS.gray, color: '#fff' };
    case 'over': return { text: `${p.guessText ?? ''} OVER`.trim(), fill: COLORS.alert, color: '#fff' };
    default: return null;
  }
}

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCrown(ctx: SKRSContext2D, cx: number, y: number): void {
  ctx.fillStyle = COLORS.gold;
  ctx.beginPath();
  ctx.moveTo(cx - 20, y + 22);
  ctx.lineTo(cx - 24, y + 4);
  ctx.lineTo(cx - 10, y + 12);
  ctx.lineTo(cx, y);
  ctx.lineTo(cx + 10, y + 12);
  ctx.lineTo(cx + 24, y + 4);
  ctx.lineTo(cx + 20, y + 22);
  ctx.closePath();
  ctx.fill();
}

function drawOne(ctx: SKRSContext2D, p: Podium, box: Box, nowMs: number, transcript: string | null): void {
  const color = seatColor(p);
  const over = p.guessState === 'over';
  if (p.role === 'guesser') {
    // spotlight cone from above
    const g = ctx.createLinearGradient(0, 380, 0, box.y);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,244,214,0.28)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(box.x + box.w / 2 - 20, 380);
    ctx.lineTo(box.x + box.w / 2 + 20, 380);
    ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.lineTo(box.x, box.y + box.h);
    ctx.closePath();
    ctx.fill();
  }
  // body: a lit, beveled block (V2), with a gold glow for the item's owner
  const body = { x: box.x, y: box.y + 14, w: box.w, h: box.h - 14 };
  if (p.role === 'owner') {
    ctx.save();
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 22;
    rr(ctx, body.x, body.y, body.w, body.h, 10);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  bevelBox(ctx, body, color, { r: 10, shadow: 14, gloss: 0.16 });
  if (theme() === 'odyssey') {
    // a gold capital band across the top, like the head of a column
    ctx.save();
    rr(ctx, body.x, body.y, body.w, body.h, 10);
    ctx.clip();
    ctx.fillStyle = goldGradient(ctx, body.y, body.y + 7, '#C9A24A');
    ctx.fillRect(body.x, body.y, body.w, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(body.x, body.y + 7, body.w, 1.5);
    ctx.restore();
  }
  if (over) { rr(ctx, body.x, body.y, body.w, body.h, 10); ctx.fillStyle = 'rgba(230,57,70,0.35)'; ctx.fill(); }
  if (p.role === 'guesser') {
    const pulse = 3 + 2 * Math.sin(nowMs / 200);
    rr(ctx, body.x, body.y, body.w, body.h, 10);
    ctx.lineWidth = pulse;
    ctx.strokeStyle = COLORS.gold;
    ctx.stroke();
  } else if (p.role === 'owner') {
    rr(ctx, body.x, body.y, body.w, body.h, 10);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.gold;
    ctx.stroke();
  }
  // name plate: a sunken screen
  const plate = { x: box.x + 10, y: box.y + 22, w: box.w - 20, h: 25 };
  insetBox(ctx, plate, COLORS.ink, 6);
  const px = fitNameFont(ctx, p.name, plate.w - 12);
  ctx.font = `${px}px ${FONTS.body}`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.name, plate.x + plate.w / 2, plate.y + plate.h / 2 + 1);
  // score: embossed white numerals with a soft drop shadow
  textFx(ctx, String(p.score), box.x + box.w / 2, box.y + 63, {
    font: `27px ${FONTS.title}`, fill: '#FFFFFF', stroke: shade(color, -0.55), strokeW: 4, drop: 2, maxW: box.w - 20,
  });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // guess chip
  const chip = chipStyle(p);
  if (chip) {
    const c = { x: box.x + 16, y: box.y + 76, w: box.w - 32, h: 22 };
    bevelBox(ctx, c, chip.fill, { r: 11, gloss: 0.3, strokeW: 1.5 });
    ctx.font = `19px ${FONTS.body}`;
    ctx.fillStyle = chip.color;
    ctx.fillText(chip.text, c.x + c.w / 2, c.y + c.h / 2 + 1, c.w - 8);
  }
  if (p.role === 'owner') {
    const tag = { x: box.x + box.w - 84, y: box.y, w: 78, h: 20 };
    bevelBox(ctx, tag, COLORS.gold, { r: 10, shadow: 6, gloss: 0.35, strokeW: 1.5 });
    ctx.font = `14px ${FONTS.title}`;
    ctx.fillStyle = COLORS.ink;
    ctx.fillText('OWNER', tag.x + tag.w / 2, tag.y + tag.h / 2 + 1);
  }
  if (p.role === 'winner') drawCrown(ctx, box.x + box.w / 2, box.y - 12);
  if (transcript) {
    // Above the caption bar (y 360-430), so the two never overlap.
    ctx.font = `22px ${FONTS.body}`;
    const w = Math.min(box.w + 60, ctx.measureText(transcript).width + 28);
    const cx = Math.min(STAGE.w - STAGE.safeX - w / 2, Math.max(STAGE.safeX + w / 2, box.x + box.w / 2));
    const t = { x: cx - w / 2, y: LAYOUT.caption.y - 38, w, h: 32 };
    rr(ctx, t.x, t.y, t.w, t.h, 16);
    ctx.fillStyle = 'rgba(255,244,214,0.92)';
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(transcript, t.x + t.w / 2, t.y + t.h / 2 + 1, t.w - 12);
  }
}

export function drawPodiums(ctx: SKRSContext2D, s: StageState, nowMs: number): void {
  const count = s.podiums.length;
  if (count === 0) return;
  const boxes = podiumBoxes(count);
  ctx.save();
  s.podiums.forEach((p, i) => {
    ctx.save();
    drawOne(ctx, p, boxes[i], nowMs, p.role === 'guesser' ? s.liveTranscript : null);
    ctx.restore();
  });
  ctx.restore();
}
