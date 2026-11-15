import { afterEach, describe, expect, it } from 'vitest';
import { COLORS, FONTS, SEAT_COLORS, applyTheme, theme } from '../src/stage/theme';
import { createRenderer } from '../src/stage/render';
import { stageFixture } from '../fixtures/stage-states';

afterEach(() => { applyTheme('classic'); });

describe('stage themes', () => {
  it('odyssey switches colors, seats and fonts, and classic restores them', () => {
    const classicNavy = COLORS.navy;
    applyTheme('odyssey');
    expect(theme()).toBe('odyssey');
    expect(COLORS.navy).toBe('#102F46');
    expect(SEAT_COLORS.p1).toBe('#C45C3E');
    expect(FONTS.title).toContain('Cinzel');
    applyTheme('classic');
    expect(COLORS.navy).toBe(classicNavy);
    expect(FONTS.title).toContain('Bungee');
  });

  it('unknown names fall back to classic', () => {
    expect(applyTheme('pirates')).toBe('classic');
  });

  it('renders every main screen in odyssey without a layer failing', () => {
    const warnings: string[] = [];
    const r = createRenderer({ width: 960, height: 540, theme: 'odyssey', log: (m) => warnings.push(m) });
    for (const p of ['wait_call', 'rules', 'guess_listen', 'reveal', 'round_score', 'finale'] as const) {
      expect(r.png(stageFixture(p as never, 4)).length).toBeGreaterThan(1000);
    }
    expect(warnings).toEqual([]);
  });
});
