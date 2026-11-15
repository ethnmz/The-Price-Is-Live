// Stage palette, fonts and layout boxes (docs/SPEC.md 13.1 and 13.2). FROZEN (planner-owned) so the
// stage tasks that run in parallel all draw into the same boxes. Landscape 960x540.
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

export interface Box { x: number; y: number; w: number; h: number }

export const STAGE = { w: 960, h: 540, safeX: 48, safeY: 27 };

export const LAYOUT: Record<string, Box> = {
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
};

export const PODIUM_W = 190;
export const CAPTION = { fontPx: 28, maxLines: 2, tagPx: 18, holdMs: 1500 };

/** Left x of each podium for 2, 3 or 4 players: equal spacing across the podium row. */
export function podiumXs(count: number): number[] {
  const row = LAYOUT.podiums;
  const gap = (row.w - count * PODIUM_W) / (count + 1);
  return Array.from({ length: count }, (_, i) => Math.round(row.x + gap + i * (PODIUM_W + gap)));
}

export const CREDIT_LINE = 'Voice by ElevenLabs · AI by Gemini · Data on MongoDB Atlas';
