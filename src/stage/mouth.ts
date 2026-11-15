// Mouth flap logic for the host (docs/SPEC.md 13.3). Turns the voice level into a mouth shape.
// Opens above 0.18, closes below 0.10 (hysteresis), half up to 0.35, wide above. A shape is held 80 ms.
// With no level while speaking, the mouth toggles closed/half at 6 Hz.
export type MouthShape = 'closed' | 'half' | 'wide';

const OPEN_AT = 0.18;
const CLOSE_AT = 0.1;
const WIDE_AT = 0.35;
const MIN_HOLD_MS = 80;
const TOGGLE_HZ = 6;

export function createMouthTracker(): { update(level: number | null, speaking: boolean, nowMs: number): MouthShape } {
  let shape: MouthShape = 'closed';
  let changedAt = -Infinity;

  function wanted(level: number): MouthShape {
    const isOpen = shape !== 'closed';
    if (!isOpen && level <= OPEN_AT) return 'closed';
    if (isOpen && level < CLOSE_AT) return 'closed';
    return level > WIDE_AT ? 'wide' : 'half';
  }

  function set(next: MouthShape, nowMs: number): void {
    if (next === shape) return;
    if (nowMs - changedAt < MIN_HOLD_MS) return;
    shape = next;
    changedAt = nowMs;
  }

  return {
    update(level, speaking, nowMs) {
      if (!speaking) {
        // Not speaking: closed right away.
        if (shape !== 'closed') { shape = 'closed'; changedAt = nowMs; }
        return shape;
      }
      if (level === null || !Number.isFinite(level)) {
        const phase = Math.floor((nowMs * TOGGLE_HZ * 2) / 1000) % 2;
        set(phase === 0 ? 'half' : 'closed', nowMs);
      } else {
        set(wanted(level), nowMs);
      }
      return shape;
    },
  };
}
