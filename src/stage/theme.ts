// Stage palette, fonts and layout boxes (docs/SPEC.md 13.1 and 13.2). FROZEN (planner-owned) so the
// stage tasks that run in parallel all draw into the same boxes. Landscape 960x540 or square 720x720.
import type { PlayerId } from '../contracts/types';

export const COLORS = {
  navy: '#14123A',
  curtain: '#8B1A2B',
  gold: '#FFC83D',
  cream: '#FFF4D6',
  bulb: '#FFE27A',
  ink: '#1B1B2F',
  alert: '#E63946',
  green: '#2EC46B',
  purple: '#9B5DE5',
  gray: '#8D8FA3',
};

export const SEAT_COLORS: Record<PlayerId, string> = { p1: '#E63946', p2: '#3A86FF', p3: '#2EC4B6', p4: '#FF9F1C' };

/** Font families. Bungee / Lilita One are registered if the files exist in src/stage/assets/fonts; else the fallbacks apply. */
export const FONTS = {
  title: '"Bungee", "Arial Black", "Impact", sans-serif',
  body: '"Lilita One", "Nunito", "Arial Rounded MT Bold", "Arial", sans-serif',
};

// ---------- themes ----------
// The stage has one look per theme. COLORS, SEAT_COLORS and FONTS are switched in place, so every
// layer that reads them at draw time follows the theme; layers with a themed shape check `theme()`.
export type ThemeName = 'classic' | 'odyssey';

const CLASSIC = { colors: { ...COLORS }, seats: { ...SEAT_COLORS }, fonts: { ...FONTS } };

/**
 * Odyssey: HackUTA 2026's sea-voyage look (navy sea and sky, parchment, muted gold, terracotta).
 * Inspired by the event site's palette and fonts; the art is drawn here, nothing is copied from it.
 */
const ODYSSEY = {
  colors: {
    navy: '#102F46', // deep sky and sea
    curtain: '#1A3A52', // banner and panel fill (was curtain red)
    gold: '#E8C97A',
    cream: '#F6EDDF', // parchment
    bulb: '#F3DFA6',
    ink: '#0B2236',
    alert: '#C45C3E', // terracotta
    green: '#4E9A6B', // olive green
    purple: '#3E7CA6', // slate blue (the "?" box)
    gray: '#8FA3B3',
  },
  seats: { p1: '#C45C3E', p2: '#3E7CA6', p3: '#4E8C6A', p4: '#B8862F' } as Record<PlayerId, string>,
  fonts: {
    title: '"Cinzel", "Trajan Pro", "Georgia", serif',
    body: '"Barlow Semi Condensed", "Arial Narrow", "Arial", sans-serif',
  },
};

let current: ThemeName = 'classic';

/** Which theme is active. */
export function theme(): ThemeName {
  return current;
}

/** Switch the stage's look. Unknown names fall back to classic. */
export function applyTheme(name: string | undefined): ThemeName {
  const t: ThemeName = name === 'odyssey' ? 'odyssey' : 'classic';
  const src = t === 'odyssey' ? ODYSSEY : CLASSIC;
  Object.assign(COLORS, src.colors);
  Object.assign(SEAT_COLORS, src.seats);
  Object.assign(FONTS, src.fonts);
  current = t;
  return t;
}

export interface Box { x: number; y: number; w: number; h: number }

// Two frame shapes. 'wide' is the original 960x540. 'square' (720x720) is for group FaceTime,
// which crops each caller's video to a square tile, so nothing may sit outside the box.
export type StageShape = 'wide' | 'square';

const WIDE = {
  stage: { w: 960, h: 540, safeX: 48, safeY: 27 },
  podiumW: 190,
  layout: {
    marquee: { x: 280, y: 10, w: 400, h: 50 },
    roundLabel: { x: 40, y: 18, w: 220, h: 34 },
    callClock: { x: 700, y: 18, w: 220, h: 34 },
    turnStrip: { x: 180, y: 62, w: 600, h: 36 },
    joinHint: { x: 130, y: 104, w: 700, h: 44 },
    host: { x: 330, y: 100, w: 300, h: 250 },
    mysteryCard: { x: 40, y: 120, w: 250, h: 190 },
    timerRing: { x: 680, y: 120, w: 240, h: 190 },
    caption: { x: 60, y: 360, w: 840, h: 70 },
    // Sits just above the caption so the two never overlap (they used to share y 400-430).
    banner: { x: 150, y: 312, w: 660, h: 40 },
    badge: { x: 780, y: 60, w: 160, h: 28 },
    podiums: { x: 48, y: 440, w: 864, h: 100 },
  } as Record<string, Box>,
};

// Square: the host keeps his y (his drawing uses fixed heights), the card and timer flank him,
// and the extra height goes to the caption and the podium row below.
const SQUARE = {
  stage: { w: 720, h: 720, safeX: 24, safeY: 24 },
  podiumW: 158,
  layout: {
    marquee: { x: 170, y: 10, w: 380, h: 50 },
    roundLabel: { x: 16, y: 18, w: 148, h: 34 },
    callClock: { x: 556, y: 18, w: 148, h: 34 },
    turnStrip: { x: 60, y: 64, w: 600, h: 36 },
    joinHint: { x: 24, y: 104, w: 672, h: 44 },
    host: { x: 210, y: 100, w: 300, h: 250 },
    mysteryCard: { x: 14, y: 150, w: 190, h: 190 },
    timerRing: { x: 516, y: 150, w: 190, h: 190 },
    caption: { x: 24, y: 452, w: 672, h: 84 },
    banner: { x: 90, y: 312, w: 540, h: 40 },
    badge: { x: 556, y: 108, w: 148, h: 28 },
    podiums: { x: 24, y: 588, w: 672, h: 100 },
  } as Record<string, Box>,
};

export const STAGE = { ...WIDE.stage };
export const LAYOUT: Record<string, Box> = structuredClone(WIDE.layout);
export let PODIUM_W = WIDE.podiumW;
let currentShape: StageShape = 'wide';

export function shape(): StageShape {
  return currentShape;
}

/** Switch the frame shape. Anything that is not 'square' is 'wide'. */
export function applyShape(name: string | undefined): StageShape {
  const sh: StageShape = name === 'square' ? 'square' : 'wide';
  const src = sh === 'square' ? SQUARE : WIDE;
  Object.assign(STAGE, src.stage);
  for (const k of Object.keys(LAYOUT)) delete LAYOUT[k];
  Object.assign(LAYOUT, structuredClone(src.layout));
  PODIUM_W = src.podiumW;
  currentShape = sh;
  return sh;
}

export const CAPTION = { fontPx: 28, maxLines: 2, tagPx: 18, holdMs: 1500 };

/** Left x of each podium for 2, 3 or 4 players: equal spacing across the podium row. */
export function podiumXs(count: number): number[] {
  const row = LAYOUT.podiums;
  const gap = (row.w - count * PODIUM_W) / (count + 1);
  return Array.from({ length: count }, (_, i) => Math.round(row.x + gap + i * (PODIUM_W + gap)));
}

export const CREDIT_LINE = 'Voice by ElevenLabs · AI by Gemini · Data on MongoDB Atlas';
