// End-to-end demo check (SPEC 14.3, 17.4): plays the 2-minute demo game offline through the real
// reducer, runner, stage state, host lines, guess parser, pricing and renderer.
// Fake call, voice and message ports run under a virtual clock. No network, no keys, no phone.
// Run: npm run demo:check   (exit code 1 and a clear message on any failed assertion)
// TO VERIFY ON THE REAL LINE: real audio, real FaceTime video, real iMessage delivery, real Gemini
// web pricing for round 2 (here it is a labelled estimate because the Gemini key is empty).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameConfig, loadEnv } from '../src/config';
import type { Effect, GameState, Phase, PlayerId, ReferenceItem, StageState } from '../src/contracts';
import { fixturePlayers } from '../fixtures/players';
import { createHost } from '../src/ai/host/lines';
import { createAi } from '../src/ai';
import { reduce } from '../src/engine/reducer';
import { scoreRound } from '../src/engine/scoring';
import { playScriptedGame } from '../src/engine/simGame';
import { parseGuess } from '../src/speech/parseGuess';
import { spokenAmount } from '../src/speech/spokenAmount';
import { createStage } from '../src/stage';
import { createStore } from '../src/store';
import { FakeStage, FakeVoice } from '../src/testing/fakes';

export interface DemoCheckResult {
  virtualMs: number;
  phasesSeen: Phase[];
  pngs: string[];
  timeline: string[];
  failures: string[];
}

const ROUND1_ITEM = 'Owala bottle';
const ROUND2_ITEM = 'Lego Titanic'; // not on the reference list (see the blocker note about "scratching post")
const BAR = 120_000;

/** Records every spoken line in order, with the phase the stage showed at that moment. */
class RecordingVoice extends FakeVoice {
  lines: { phase: Phase | null; text: string }[] = [];
  currentPhase: () => Phase | null = () => null;
  override async speak(id: string, text: string, opts?: Parameters<FakeVoice['speak']>[2]): Promise<void> {
    this.lines.push({ phase: this.currentPhase(), text });
    return super.speak(id, text, opts);
  }
}

export async function runDemoCheck(opts: { outDir?: string; log?: (line: string) => void } = {}): Promise<DemoCheckResult> {
  const log = opts.log ?? (() => {});
  const outDir = resolve(opts.outDir ?? 'out/demo');
  const failures: string[] = [];
  const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); };

  const items = JSON.parse(readFileSync(resolve('data/reference-items.json'), 'utf8')) as ReferenceItem[];
  const env = loadEnv({ PHONE_HASH_SALT: 'demo-check-salt' }, { readDotenv: false }); // empty env: no Gemini key, no Mongo, no phone
  const store = createStore(env); // local mode
  const ai = createAi(env, { items, store });
  const host = createHost();
  const players = fixturePlayers(4);
  const voice = new RecordingVoice();
  // A stage that remembers which phase is showing, so each host line can be tagged with it.
  let shownPhase: Phase | null = null;
  const stage = { ...new FakeStage(), setState: (s: StageState) => { shownPhase = s.phase; }, setMouthLevel() {}, start() {}, stop() {}, renderPng: () => Buffer.alloc(0) };
  voice.currentPhase = () => shownPhase;
  let games = 0;

  // Price round 2's item directly too. With an empty Gemini key it must be a labelled estimate.
  const probe = await ai.pricing.price({ itemId: 'probe', ownerId: 'p2', rawText: ROUND2_ITEM, source: 'text' } as never);
  check(probe.isEstimate && probe.source === 'estimate', `off-list item must come back as a labelled estimate, got ${probe.source}`);
  check(probe.priceCents >= 100 && probe.displayName.length > 0, 'off-list estimate has no usable price or name');

  const result = await playScriptedGame({
    players,
    demo: true,
    // The scripted driver only uses these as item texts; the REAL pricing decides the price.
    items: [{ text: ROUND1_ITEM, priceCents: 0 }, { text: ROUND2_ITEM, priceCents: 0 }],
    guesses: [
      { p2: 'thirty dollars', p3: 'twenty five bucks', p4: 'twelve ninety nine' },
      { p3: 'twenty dollars', p4: { text: '$15' }, p1: 'ten dollars' },
    ],
    ports: { pricing: ai.pricing, host, voice, store, stage },
    deps: {
      parseGuess, spokenAmount, line: (key, vars) => host.line(key, vars),
      propItem: () => items[1], newGameId: () => `demo_${++games}`,
    },
  });
  const { finalState, ports, resultsCards, phasesSeen, stageStates } = result;
  void ports;

  // 1. Shape of the game.
  check(phasesSeen.includes('finale'), 'game never reached finale');
  check(phasesSeen.at(-1) === 'wait_call', `game did not return to wait_call (last phase: ${phasesSeen.at(-1)})`);
  check(finalState.history.length === 2, `expected exactly 2 rounds, got ${finalState.history.length}`);
  check(result.virtualMs <= BAR, `demo took ${result.virtualMs} virtual ms, limit ${BAR}`);

  // 2. Pricing: round 1 from the list, round 2 a labelled estimate.
  const [r1, r2] = finalState.history;
  if (r1) {
    check(r1.item.source === 'list' && !r1.item.isEstimate, `round 1 item should come from the price list, got ${r1.item.source}`);
    check(/owala/i.test(r1.item.displayName), `round 1 item should be the Owala, got "${r1.item.displayName}"`);
  }
  if (r2) {
    // Without a Gemini key the estimate asks for the prop closet, so the engine may swap in a list item.
    const swappedForProp = !r2.item.isEstimate && r2.item.displayName === items[1].name;
    check(r2.item.isEstimate || swappedForProp, `round 2 should be a labelled estimate or the prop closet item, got ${r2.item.displayName} (${r2.item.source})`);
    check(r2.item.priceCents >= 100, 'round 2 must have a real price');
  }

  // 3. Results card on every phone, with both items and prices.
  for (const p of players) {
    const card = resultsCards.filter((c) => c.phone === p.phone).at(-1);
    check(!!card, `${p.name} did not get the results card`);
    if (!card) continue;
    for (const round of finalState.history) {
      const price = `$${(round.item.priceCents / 100).toFixed(2)}`;
      check(card.text.includes(price), `${p.name}'s results card is missing ${price}`);
      check(card.text.toLowerCase().includes(round.item.displayName.split(' ')[0].toLowerCase()),
        `${p.name}'s results card is missing the item "${round.item.displayName}"`);
    }
  }

  // 4. Totals match an independent recomputation.
  const totals: Partial<Record<PlayerId, number>> = {};
  const ids = players.map((p) => p.id);
  finalState.history.forEach((round, i) => {
    const again = scoreRound({
      roundIndex: i, ownerId: round.ownerId, item: round.item, guesses: round.guesses, playerIds: ids, prevTotals: totals,
    });
    for (const id of ids) totals[id] = again.totals[id];
  });
  for (const p of finalState.players) {
    check(p.score === (totals[p.id] ?? 0), `${p.name} total ${p.score} != recomputed ${totals[p.id]}`);
  }

  // 5. No spoilers before the reveal price stage.
  for (const s of stageStates) {
    const early = !s.reveal || s.reveal.stage !== 'price';
    if (!early) continue;
    const blob = JSON.stringify(s).toLowerCase();
    for (const round of finalState.history) {
      const price = `$${(round.item.priceCents / 100).toFixed(2)}`;
      // The finale recap legitimately lists items; a spoiler only matters while a round is live.
      if (s.phase === 'finale' || s.phase === 'rematch_offer' || s.phase === 'ending' || s.phase === 'round_score') continue;
      if (s.phase === 'wait_call' || s.phase === 'boot') continue;
      if (roundOfState(s, finalState) !== round.roundIndex) continue;
      check(!blob.includes(price.toLowerCase()), `price ${price} shown in phase ${s.phase} before the reveal`);
      check(!blob.includes(round.item.displayName.toLowerCase()), `item "${round.item.displayName}" shown in phase ${s.phase} before the reveal`);
    }
  }

  // 6. Host lines have no leftover braces.
  for (const line of voice.lines) check(!/[{}]/.test(line.text), `SPEAK text has leftover braces: "${line.text}"`);
  check(voice.lines.length > 10, 'host barely spoke');

  // 7. PNGs: one per phase seen, written by the real stage renderer.
  mkdirSync(outDir, { recursive: true });
  const renderer = createStage({ width: 960, height: 540, fps: 15 });
  const pngs: string[] = [];
  const firstOfPhase = new Map<Phase, StageState>();
  for (const s of stageStates) if (!firstOfPhase.has(s.phase)) firstOfPhase.set(s.phase, s);
  const priceStage = stageStates.find((s) => s.reveal?.stage === 'price');
  const toRender: [string, StageState][] = [...firstOfPhase].map(([phase, s]) => [phase, s]);
  if (priceStage) toRender.push(['reveal_price', priceStage]);
  for (const [name, state] of toRender) {
    renderer.setState(state);
    const png = renderer.renderPng(state);
    const file = resolve(outDir, `${name}.png`);
    writeFileSync(file, png);
    pngs.push(file);
    check(png.length > 0 && statSync(file).size > 0, `PNG for phase ${name} is empty`);
  }
  for (const phase of new Set(stageStates.map((s) => s.phase))) {
    check(firstOfPhase.has(phase) && pngs.some((f) => f.endsWith(`${phase}.png`)), `no PNG for phase ${phase}`);
  }

  // 8. REMATCH after the call: from the finished game, a text dials all four phones again.
  const deps = {
    config: gameConfig({ demo: true }), parseGuess, spokenAmount, line: (k: never, v?: never) => host.line(k, v),
    propItem: () => items[0], newGameId: () => `demo_${++games}`,
  };
  const ended = reduce(finalState, { type: 'CALL_ENDED', at: result.virtualMs, reason: 'demo check' }, deps);
  const rematch = reduce(ended.state, {
    type: 'TEXT_RECEIVED', at: result.virtualMs + 1000, phone: players[0].phone, text: 'REMATCH', msgId: 'demo_rematch',
  }, deps);
  const dial = rematch.effects.find((e): e is Extract<Effect, { type: 'DIAL' }> => e.type === 'DIAL');
  const dialed = (dial?.phones ?? []).slice().sort();
  const wanted = players.map((p) => p.phone).sort();
  check(JSON.stringify(dialed) === JSON.stringify(wanted), `REMATCH should dial all four phones, dialed: ${JSON.stringify(dialed)}`);

  // Timeline for humans: phase and host line, in order, plus the virtual clock at the end.
  const timeline = voice.lines.map((l, i) => `${String(i + 1).padStart(2, '0')}  ${(l.phase ?? '-').padEnd(13)} ${l.text}`);
  log('step phase         host line');
  for (const line of timeline) log(line);
  log(`virtual time from call ready to end: ${result.virtualMs} ms (limit ${BAR})`);
  log(`phases: ${phasesSeen.join(' > ')}`);
  log(`PNGs: ${pngs.length} written to ${outDir}`);
  for (const r of finalState.history) log(`round ${r.roundIndex + 1}: ${r.item.displayName} $${(r.item.priceCents / 100).toFixed(2)} (${r.item.source}${r.item.isEstimate ? ', estimate' : ''})`);

  await store.close().catch(() => {});
  return { virtualMs: result.virtualMs, phasesSeen, pngs, timeline, failures };
}

/** Which round a stage state belongs to, read from its "ROUND n OF m" label. */
function roundOfState(s: StageState, final: GameState): number {
  const m = /(\d+)\s*(?:OF|\/)/i.exec(s.roundLabel ?? '');
  return m ? Number(m[1]) - 1 : final.history.length;
}

async function main(): Promise<void> {
  const result = await runDemoCheck({ log: (line) => console.log(line) });
  if (result.failures.length > 0) {
    console.error('DEMO CHECK FAILED:');
    for (const f of result.failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log('DEMO CHECK PASSED');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`DEMO CHECK FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
