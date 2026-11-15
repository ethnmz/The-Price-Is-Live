// npm run preview:anim: writes a 15-frame PNG sequence per animation into out/anim/{name}/{00..14}.png.
// Animations: countdown, drumroll, price pop (3 prices), estimate stamp, score fly, finale confetti, mouth flap.
// Each frame uses a fresh renderer: first draw at time 0 (starts the clocks), second draw at the frame time.
// The script also runs a few cheap sanity checks and prints anything odd under "LOOKS WRONG:".
// TO VERIFY ON THE REAL LINE: nothing here needs the phone; look at the frames by eye before filming.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { stageFixture } from '../fixtures/stage-states';
import { createRenderer, type Renderer } from '../src/stage/render';
import type { StageState } from '../src/contracts/types';

const W = 960;
const H = 540;
const FRAMES = 15;
const OUT = 'out/anim';

interface Frame { state: StageState; ms: number; level?: number | null }
type FrameMaker = (i: number) => Frame;

/** Time of frame i when the animation runs from 0 to totalMs (first and last frame included). */
const at = (i: number, totalMs: number): number => Math.round((i / (FRAMES - 1)) * totalMs);

function toPng(rgba: Uint8Array): Buffer {
  const c = createCanvas(W, H);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);
  return c.toBuffer('image/png');
}

function revealState(priceText: string, itemName: string, isEstimate: boolean): StageState {
  const s = stageFixture('reveal', 4);
  if (s.reveal) s.reveal = { ...s.reveal, stage: 'price', priceText, itemName, isEstimate, sourceLabel: isEstimate ? 'Estimate' : 'Price list' };
  return s;
}

function drumrollState(): StageState {
  const s = stageFixture('reveal', 4);
  s.reveal = { stage: 'drumroll', priceText: '', itemName: '', isEstimate: false, sourceLabel: null };
  s.caption = { text: 'And the price is...', speaker: 'host' };
  return s;
}

function countdownState(i: number): StageState {
  const s = stageFixture('guess_listen', 4);
  s.timer = { secondsLeft: 10, total: 10, running: true };
  void i;
  return s;
}

const ANIMS: Record<string, FrameMaker> = {
  countdown: (i) => ({ state: countdownState(i), ms: at(i, 10_000) }),
  drumroll: (i) => ({ state: drumrollState(), ms: at(i, 2800) }),
  'price-pop': (i) => ({ state: revealState('$24.99', 'Owala FreeSip water bottle', false), ms: at(i, 700) }),
  'price-pop-1000': (i) => ({ state: revealState('$1,000.00', 'Owala FreeSip water bottle 24 oz', false), ms: at(i, 700) }),
  'price-pop-099': (i) => ({ state: revealState('$0.99', 'Single gumball', false), ms: at(i, 700) }),
  'estimate-stamp': (i) => ({ state: revealState('$30.00', 'Hot Wheels 5-car pack', true), ms: at(i, 1400) }),
  'score-fly': (i) => ({ state: stageFixture('round_score', 4), ms: at(i, 3200) }),
  'finale-confetti': (i) => ({ state: stageFixture('finale', 4), ms: at(i, 6000) }),
};

/** Draw one frame at its time. A fresh renderer starts every clock at 0, so ms is the time since the change. */
function drawFrame(f: Frame): Uint8Array {
  const r = createRenderer({ width: W, height: H, log: () => undefined });
  r.render(f.state, 0, f.level ?? null);
  return r.render(f.state, f.ms, f.level ?? null);
}

/** Cheap checks: a sequence that never changes, or a frame that is all one colour. */
function checkFrames(name: string, frames: Uint8Array[], wrong: string[]): void {
  const sig = (f: Uint8Array): string => {
    let h = 0;
    for (let i = 0; i < f.length; i += 97) h = (Math.imul(h, 31) + f[i]) | 0;
    return String(h);
  };
  const distinct = new Set(frames.map(sig));
  if (distinct.size < 2) wrong.push(`${name}: all ${frames.length} frames look identical (nothing animates)`);
  else if (distinct.size < 4) wrong.push(`${name}: only ${distinct.size} different frames out of ${frames.length}`);
  frames.forEach((f, i) => {
    const first = [f[0], f[1], f[2]];
    let flat = true;
    for (let p = 0; p < f.length && flat; p += 4 * 251) flat = f[p] === first[0] && f[p + 1] === first[1] && f[p + 2] === first[2];
    // An all-white frame is the intended 60 ms flash at the start of the price pop.
    const white = first[0] === 255 && first[1] === 255 && first[2] === 255;
    if (flat && !white) wrong.push(`${name}: frame ${String(i).padStart(2, '0')} is one flat colour`);
  });
}

function writeSequence(name: string, frames: Uint8Array[]): void {
  const dir = `${OUT}/${name}`;
  mkdirSync(dir, { recursive: true });
  frames.forEach((f, i) => writeFileSync(`${dir}/${String(i).padStart(2, '0')}.png`, toPng(f)));
}

/** Mouth flap: one renderer for the whole run (the mouth keeps its own state), sine level, 100 ms apart. */
function mouthFrames(): Uint8Array[] {
  const r: Renderer = createRenderer({ width: W, height: H, log: () => undefined });
  const s = stageFixture('connected', 4);
  s.hostSpeaking = true;
  const out: Uint8Array[] = [];
  for (let i = 0; i < FRAMES; i++) {
    const level = 0.5 + 0.5 * Math.sin((i / 6) * Math.PI * 2);
    out.push(r.render(s, i * 100, level).slice());
  }
  return out;
}

/** Things seen by eye when these frames were first reviewed (T44). Re-check after stage changes and edit this list. */
const EYE_CHECKED: string[] = [
  'price-pop-1000: at the 1.25x peak (about 300 ms) "$1,000.00" is wider than the 960 px frame and the edges are cut off (src/stage/overlays.ts popScale/fit)',
  'price-pop*: the big price is drawn right over the host\'s head and chest, and the item name is faint (low contrast) in the first 200 ms',
  'score-fly: the floating +38 / +86 / +71 / +25 numbers start on the caption row and overlap the caption text (src/stage/finale.ts scoreFlyItems)',
  'finale-confetti: the caption box is still drawn under the scoreboard and shows through it at the bottom of the frame',
  'countdown: the ring plus the number stay clear, but the caption box and "twenty five..." chip overlap at the bottom left in the first frames',
];

function main(): void {
  rmSync(OUT, { recursive: true, force: true });
  const wrong: string[] = [];
  const names: string[] = [];
  for (const [name, make] of Object.entries(ANIMS)) {
    const frames = Array.from({ length: FRAMES }, (_, i) => drawFrame(make(i)));
    writeSequence(name, frames);
    checkFrames(name, frames, wrong);
    names.push(name);
  }
  const mouth = mouthFrames();
  writeSequence('mouth-flap', mouth);
  checkFrames('mouth-flap', mouth, wrong);
  names.push('mouth-flap');

  console.log(`Wrote ${FRAMES} frames each into:`);
  for (const n of names) console.log(`  ${OUT}/${n}/`);
  console.log('LOOKS WRONG:');
  if (wrong.length === 0) console.log('  (nothing flagged by the automatic checks; still look at the frames)');
  for (const w of wrong) console.log(`  - ${w}`);
  for (const w of EYE_CHECKED) console.log(`  - ${w}`);
}

main();
