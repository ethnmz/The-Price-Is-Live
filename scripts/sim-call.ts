// Offline fixture game. No credentials or external services are used.
import { fixturePlayers } from '../fixtures/players';
import { playScriptedGame } from '../src/engine/simGame';
import { rankPlayers } from '../src/engine/scoring';
import { FakeVoice } from '../src/testing/fakes';

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--players');
  const count = index < 0 ? 4 : Number(args[index + 1]);
  if (count !== 2 && count !== 3 && count !== 4) throw new Error('--players must be 2, 3 or 4');
  const voice = new FakeVoice();
  const result = await playScriptedGame({
    players: fixturePlayers(count), demo: args.includes('--demo'), ports: { voice },
    items: fixturePlayers(count).map((p) => ({ text: `${p.name} fixture item`, priceCents: 2000 })),
    guesses: Array.from({ length: count }, () => ({ p1: 20, p2: 15, p3: 10, p4: 25 })),
  });
  console.log(`Phases: ${result.phasesSeen.join(' → ')}`);
  for (const line of voice.spoken) console.log(`HOST: ${line.text}`);
  for (const row of rankPlayers(result.finalState.players, result.finalState.history)) {
    console.log(`${row.place}. ${row.name}: ${row.total} pts`);
  }
  console.log(result.resultsCards[0]?.text);
  console.log(`Virtual duration: ${result.virtualMs} ms`);
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Simulation failed'); process.exitCode = 1; });
