// Yes / no detection for the confirm-back (SPEC 9.5). Deterministic word lists.

const YES_WORDS = [
  'yes', 'yeah', 'yep', 'yup', 'correct', 'right', 'thats right', 'locked', 'lock it', 'sure',
  'uh huh', 'mm hm', 'mmhm', 'mhm', 'affirmative',
];
const NO_WORDS = ['no', 'nope', 'wrong', 'not right', 'nah'];

/** Lowercase, drop apostrophes, turn every other symbol into a space. */
function normalize(text: string): string {
  return ' ' + text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
}

/** Position of the earliest whole-word match of any phrase, or -1. */
function firstMatch(padded: string, phrases: string[]): number {
  let best = -1;
  for (const p of phrases) {
    const at = padded.indexOf(` ${p} `);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}

export function parseYesNo(text: string): 'yes' | 'no' | null {
  const padded = normalize(text);
  const no = firstMatch(padded, NO_WORDS);
  // "not right" contains the yes word "right", so a "no" phrase wins when it starts first or overlaps.
  const yes = firstMatch(padded, YES_WORDS.filter((w) => !(no >= 0 && padded.includes(' not right ') && w === 'right')));
  if (no < 0 && yes < 0) return null;
  if (yes < 0) return 'no';
  if (no < 0) return 'yes';
  return no <= yes ? 'no' : 'yes';
}
