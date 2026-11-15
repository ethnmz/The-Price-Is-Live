// Always-on HUD layers: round label, turn strip, join hint, mystery card, banner, badge, call clock.
// Each is drawn only when its StageState field is set.
import type { SKRSContext2D } from '@napi-rs/canvas';
import type { StageState } from '../contracts/types';
import { COLORS, FONTS, LAYOUT, SEAT_COLORS, type Box } from './theme';

function pill(ctx: SKRSContext2D, b: Box, fill: string, stroke?: string): void {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, b.h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function text(ctx: SKRSContext2D, s: string, x: number, y: number, font: string, color: string, align: 'left' | 'center' | 'right' = 'center', maxW?: number): void {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (maxW) ctx.fillText(s, x, y, maxW); else ctx.fillText(s, x, y);
}

/** "TIME LEFT 0:32" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function drawTurnStrip(ctx: SKRSContext2D, s: StageState): void {
  const n = s.turnOrder.length;
  if (n === 0) return;
  const b = LAYOUT.turnStrip;
  const gap = 10;
  const w = Math.min(140, (b.w - gap * (n - 1)) / n);
  const total = n * w + (n - 1) * gap;
  let x = b.x + (b.w - total) / 2;
  for (const t of s.turnOrder) {
    const color = SEAT_COLORS[t.id] ?? COLORS.gray;
    const grow = t.current ? 4 : 0;
    const box = { x: x - grow, y: b.y + 3 - grow, w: w + grow * 2, h: b.h - 6 + grow * 2 };
    pill(ctx, box, color, t.current ? COLORS.gold : undefined);
    if (t.current) { ctx.lineWidth = 3; ctx.strokeStyle = COLORS.gold; ctx.stroke(); }
    const label = t.done ? `✓ ${t.name}` : t.name;
    text(ctx, label, box.x + box.w / 2, box.y + box.h / 2 + 1, `${t.current ? 21 : 19}px ${FONTS.body}`, '#fff', 'center', box.w - 16);
    x += w + gap;
  }
}

function drawMystery(ctx: SKRSContext2D, owner: string): void {
  const b = LAYOUT.mysteryCard;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 14);
  ctx.fillStyle = COLORS.cream;
  ctx.fill();
  ctx.strokeStyle = COLORS.gold;
  ctx.lineWidth = 4;
  ctx.stroke();
  const q = { x: b.x + b.w / 2 - 40, y: b.y + 18, w: 80, h: 80 };
  ctx.fillStyle = COLORS.purple;
  ctx.beginPath();
  ctx.roundRect(q.x, q.y, q.w, q.h, 12);
  ctx.fill();
  text(ctx, '?', q.x + q.w / 2, q.y + q.h / 2 + 3, `56px ${FONTS.title}`, COLORS.gold);
  text(ctx, 'MYSTERY ITEM', b.x + b.w / 2, b.y + 128, `20px ${FONTS.title}`, COLORS.ink, 'center', b.w - 20);
  text(ctx, `from ${owner}`, b.x + b.w / 2, b.y + 158, `22px ${FONTS.body}`, COLORS.ink, 'center', b.w - 20);
}

/** The gold banner ("CLOSEST WITHOUT GOING OVER WINS"). Drawn after the host so he never covers it. */
export function drawBanner(ctx: SKRSContext2D, s: StageState): void {
  if (!s.banner) return;
  const b = LAYOUT.banner;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  pill(ctx, b, COLORS.gold, COLORS.cream);
  ctx.shadowBlur = 0;
  text(ctx, s.banner, b.x + b.w / 2, b.y + b.h / 2 + 1, `22px ${FONTS.title}`, COLORS.ink, 'center', b.w - 30);
  ctx.restore();
}

export function drawHud(ctx: SKRSContext2D, s: StageState, nowMs: number): void {
  void nowMs;
  ctx.save();
  if (s.roundLabel) {
    const b = LAYOUT.roundLabel;
    pill(ctx, b, COLORS.ink, COLORS.gold);
    text(ctx, s.roundLabel, b.x + b.w / 2, b.y + b.h / 2 + 1, `18px ${FONTS.title}`, COLORS.gold, 'center', b.w - 20);
  }
  if (s.capRemainingMs !== null) {
    const b = LAYOUT.callClock;
    pill(ctx, b, COLORS.alert);
    text(ctx, `TIME LEFT ${formatClock(s.capRemainingMs)}`, b.x + b.w / 2, b.y + b.h / 2 + 1, `18px ${FONTS.title}`, '#fff', 'center', b.w - 20);
  }
  drawTurnStrip(ctx, s);
  if (s.joinHint) {
    const b = LAYOUT.joinHint;
    pill(ctx, b, COLORS.cream, COLORS.gold);
    text(ctx, s.joinHint, b.x + b.w / 2, b.y + b.h / 2 + 1, `24px ${FONTS.body}`, COLORS.ink, 'center', b.w - 30);
  }
  if (s.mysteryOwner) drawMystery(ctx, s.mysteryOwner);
  if (s.fallbackBadge) {
    const b = LAYOUT.badge;
    pill(ctx, b, COLORS.alert, '#fff');
    text(ctx, s.fallbackBadge, b.x + b.w / 2, b.y + b.h / 2 + 1, `14px ${FONTS.title}`, '#fff', 'center', b.w - 16);
  }
  ctx.restore();
}
