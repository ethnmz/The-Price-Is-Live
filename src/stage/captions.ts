// Caption bar (docs/SPEC.md 13.2, 13.3): the host's words on screen, revealed word by word.
// Captions carry the game when audio is silent, so they must always fit in CAPTION.maxLines lines.
// TO VERIFY ON THE REAL LINE: the 65 ms per character pace is an estimate of Chip's voice; tune it
// against the real ElevenLabs speech rate.
import { CAPTION, COLORS, FONTS, LAYOUT, theme } from './theme';

type Ctx = import('@napi-rs/canvas').SKRSContext2D;

const MIN_FONT_PX = 20;
const MS_PER_CHAR = 65;
const FADE_MS = 300;
const PAD_X = 16;
const TAG_GAP = 12;
const ELLIPSIS = '…';

/** Greedy word wrap. A single word wider than maxWidth is split across lines. */
export function wrapCaption(text: string, measure: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= maxWidth) { line = tryLine; continue; }
    if (line) { lines.push(line); line = ''; }
    let rest = word;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let n = rest.length - 1;
      while (n > 1 && measure(rest.slice(0, n)) > maxWidth) n--;
      lines.push(rest.slice(0, n));
      rest = rest.slice(n);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

const bodyFont = (px: number, italic = false) => `${italic ? 'italic ' : ''}${px}px ${FONTS.body}`;

/** Width left for text: the caption box minus padding and the "CHIP:" tag. */
function textWidth(ctx: Ctx): number {
  ctx.save();
  ctx.font = `${CAPTION.tagPx}px ${FONTS.body}`;
  const tagW = ctx.measureText('CHIP:').width;
  ctx.restore();
  return LAYOUT.caption.w - 2 * PAD_X - tagW - TAG_GAP;
}

/** Shrink from 28 px toward 20 px until the text fits in 2 lines; if not, cut with an ellipsis. */
export function fitCaption(ctx: Ctx, text: string): { lines: string[]; fontPx: number } {
  const maxWidth = textWidth(ctx);
  ctx.save();
  try {
    let lines: string[] = [];
    for (let px = CAPTION.fontPx; px >= MIN_FONT_PX; px--) {
      ctx.font = bodyFont(px);
      lines = wrapCaption(text, (s) => ctx.measureText(s).width, maxWidth);
      if (lines.length <= CAPTION.maxLines) return { lines, fontPx: px };
    }
    const measure = (s: string) => ctx.measureText(s).width;
    const kept = lines.slice(0, CAPTION.maxLines);
    let last = kept[kept.length - 1] ?? '';
    while (last.length > 0 && measure(last + ELLIPSIS) > maxWidth) last = last.slice(0, -1);
    kept[kept.length - 1] = last.trimEnd() + ELLIPSIS;
    return { lines: kept, fontPx: MIN_FONT_PX };
  } finally {
    ctx.restore();
  }
}

/** Start time (ms) of each word: words appear in step with an estimated speech pace. */
function wordStarts(text: string): number[] {
  const starts: number[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index * MS_PER_CHAR);
  return starts;
}

/** How many words of the text are showing after msSinceShown. */
export function captionWordsVisible(text: string, msSinceShown: number): number {
  return wordStarts(text).filter((s) => s <= msSinceShown).length;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw the caption bar. Pure: depends only on its arguments. */
export function drawCaption(
  ctx: Ctx,
  caption: { text: string; speaker: 'host' | 'system' } | null,
  msSinceShown: number,
  speaking: boolean,
): void {
  if (!caption || !caption.text.trim()) return;
  const starts = wordStarts(caption.text);
  const allShownAt = starts.length ? starts[starts.length - 1] : 0;
  let alpha = 1;
  if (!speaking) {
    const sinceDone = msSinceShown - allShownAt - CAPTION.holdMs;
    if (sinceDone > 0) alpha = 1 - sinceDone / FADE_MS;
  }
  if (alpha <= 0) return;

  const box = LAYOUT.caption;
  const host = caption.speaker === 'host';
  const { lines, fontPx } = fitCaption(ctx, caption.text);
  const visible = captionWordsVisible(lines.join(' '), msSinceShown);

  ctx.save();
  ctx.globalAlpha = alpha;
  const odyssey = theme() === 'odyssey';
  // V2: a glass panel (gradient + top sheen + soft shadow) with a thin gold frame in odyssey
  // No drop shadow: the caption must never paint outside its box (other layers sit right next to it).
  ctx.save();
  const glass = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  glass.addColorStop(0, odyssey ? 'rgba(26,58,82,0.92)' : 'rgba(30,30,40,0.82)');
  glass.addColorStop(1, odyssey ? 'rgba(6,24,40,0.94)' : 'rgba(0,0,0,0.82)');
  ctx.fillStyle = glass;
  roundRect(ctx, box.x, box.y, box.w, box.h, 14);
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, 14);
  ctx.clip();
  const sheen = ctx.createLinearGradient(0, box.y, 0, box.y + box.h * 0.5);
  sheen.addColorStop(0, 'rgba(255,255,255,0.10)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(box.x, box.y, box.w, box.h * 0.5);
  ctx.restore();
  ctx.strokeStyle = odyssey ? 'rgba(232,201,122,0.7)' : 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, box.x + 4, box.y + 4, box.w - 8, box.h - 8, 11);
  ctx.stroke();

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let textX = box.x + PAD_X;
  if (host) {
    // the speaker tag sits in a small gold pill
    ctx.font = bodyFont(CAPTION.tagPx);
    const tw = ctx.measureText('CHIP:').width;
    const tag = ctx.createLinearGradient(0, box.y + box.h / 2 - 12, 0, box.y + box.h / 2 + 12);
    tag.addColorStop(0, '#F6DE9C');
    tag.addColorStop(1, '#B98E36');
    ctx.fillStyle = tag;
    roundRect(ctx, textX - 6, box.y + box.h / 2 - 12, tw + 12, 24, 12);
    ctx.fill();
    ctx.fillStyle = COLORS.ink;
    ctx.fillText('CHIP:', textX, box.y + box.h / 2 + 1);
    textX += ctx.measureText('CHIP:').width + TAG_GAP;
  } else {
    textX += 0;
  }

  ctx.font = bodyFont(fontPx, !host);
  ctx.fillStyle = COLORS.cream;
  const lineH = fontPx * 1.1;
  const top = box.y + box.h / 2 - (lineH * lines.length) / 2 + lineH / 2;
  let left = visible;
  lines.forEach((line, i) => {
    if (left <= 0) return;
    const words = line.split(' ');
    ctx.fillText(words.slice(0, left).join(' '), textX, top + i * lineH);
    left -= words.length;
  });
  ctx.restore();
}
