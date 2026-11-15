// Warms the TTS cache: static host lines plus the name lines for names given as arguments.
// Usage: npm run warm:tts -- Ethan Diego
// TO VERIFY ON THE REAL LINE: a real ELEVENLABS key and voice id (without them nothing is generated).
import { loadEnv } from '../src/config';
import { LINE_BANK, staticLines } from '../src/ai/host/lines';
import { makeTts } from '../src/agent';

const NAME_KEYS = ['guess.prompt', 'round.start', 'lobby.joined', 'guess.silent'] as const;

/** Every variant of the name lines, for each name ({name} and {owner} are the name, {n} is 1 to 4). */
export function nameLines(names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const key of NAME_KEYS) {
      for (const variant of LINE_BANK[key]) {
        const filled = variant.replace(/\{(name|owner)\}/g, name);
        if (!filled.includes('{n}')) out.push(filled);
        else for (let n = 1; n <= 4; n++) out.push(filled.replace(/\{n\}/g, String(n)));
      }
    }
  }
  return out.filter((t) => !/\{\w+\}/.test(t));
}

async function main() {
  const env = loadEnv(process.env, { readDotenv: true });
  const tts = makeTts(env);
  const lines = [...new Set([...staticLines(), ...nameLines(process.argv.slice(2))])];
  const result = await tts.warmCache(lines);
  console.log(`Lines: ${lines.length}`, result);
  console.log(tts.stats());
}

if (process.argv[1]?.endsWith('warm-tts.ts')) {
  main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : 'Warm failed'); process.exitCode = 1; });
}
