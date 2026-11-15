// npm run preview:stage: writes out/stage/*.png for every fixture, then times 300 frames.
// Exits 1 if the average frame time is over 30 ms.
import { mkdirSync, writeFileSync } from 'node:fs';
import { allStageFixtures, stressStageFixture, stageFixture } from '../fixtures/stage-states';
import { createRenderer } from '../src/stage/render';

// STAGE_W / STAGE_H pick the frame (e.g. 720 x 720 for the square FaceTime layout).
const r = createRenderer({ width: Number(process.env.STAGE_W ?? 960), height: Number(process.env.STAGE_H ?? 540) });
mkdirSync('out/stage', { recursive: true });
for (const f of allStageFixtures()) writeFileSync(`out/stage/${f.name}.png`, r.png(f.state));
writeFileSync('out/stage/stress.png', r.png(stressStageFixture()));

const seq = ['guess_listen', 'reveal', 'round_score', 'finale'].map((p) => stageFixture(p as never, 4));
const times: number[] = [];
for (let i = 0; i < 300; i++) {
  const s = seq[Math.floor(i / 75)];
  const t0 = performance.now();
  r.render(s, i * 66, i % 3 === 0 ? 0.5 : 0.1);
  times.push(performance.now() - t0);
}
const avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`300 frames: average ${avg.toFixed(1)} ms, worst ${Math.max(...times).toFixed(1)} ms`);
if (avg > 30) {
  console.error('average frame time is over 30 ms');
  process.exit(1);
}
