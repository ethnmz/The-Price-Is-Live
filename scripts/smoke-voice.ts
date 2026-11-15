// Smoke test for the host voice: one line through createTts -> out/smoke-voice.wav, then tts.stats().
// Usage: npm run smoke:voice -- [--sfx] [--sfx-only] ["text to say"]
//   --sfx also writes every synthesized sound effect to out/sfx-{name}.wav (needs no key).
// TO VERIFY ON THE REAL LINE: the WAV sounds like the host voice at normal speed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from '../src/config';
import { makeTts } from '../src/agent';
import { synthSfx } from '../src/comms/sfx';
import type { SfxName } from '../src/contracts/types';

const USAGE = `Usage: npm run smoke:voice -- [--sfx] [--sfx-only] ["text to say"]
Synthesizes one host line to out/smoke-voice.wav (24 kHz mono) and prints the TTS stats.
  --sfx       also write each sound effect to out/sfx-{name}.wav (no key needed for these)
  --sfx-only  only write sound effects
  --help      show this text
Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID for the voice line.`;

const RATE = 24000;
const SFX: SfxName[] = ['drumroll', 'ding', 'buzzer', 'tada', 'tick'];

/** A 44-byte WAV header (16-bit mono PCM) followed by the samples. */
export function wavBuffer(pcm: Int16Array, sampleRate: number): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function writeSfx(): void {
  mkdirSync('out', { recursive: true });
  for (const name of SFX) {
    const file = `out/sfx-${name}.wav`;
    writeFileSync(file, wavBuffer(synthSfx(name, RATE), RATE));
    console.log(`wrote ${file}`);
  }
}

async function main(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return 0; }
  const sfxOnly = args.includes('--sfx-only');
  if (args.includes('--sfx') || sfxOnly) writeSfx();
  if (sfxOnly) return 0;
  const env = loadEnv(process.env, { readDotenv: true });
  const need: [string, string][] = [['ELEVENLABS_API_KEY', env.elevenLabsApiKey], ['ELEVENLABS_VOICE_ID', env.elevenLabsVoiceId]];
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { console.error(`Missing ${missing.join(', ')}.`); return 1; }
  const text = args.find((a) => !a.startsWith('--')) ?? 'Welcome to The Price Is Live! Come on down!';
  console.log(`Synthesizing one line (${text.length} chars) to out/smoke-voice.wav ...`);
  const tts = makeTts(env);
  const pcm = await tts.synthesize(text, 'hype');
  if (!pcm) { console.error('No audio came back (budget or network). Stats:', tts.stats()); return 1; }
  mkdirSync('out', { recursive: true });
  writeFileSync('out/smoke-voice.wav', wavBuffer(pcm, RATE));
  console.log(`wrote out/smoke-voice.wav (${(pcm.length / RATE).toFixed(1)} s)`);
  console.log(tts.stats());
  return 0;
}

if (process.argv[1]?.endsWith('smoke-voice.ts')) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e: unknown) => { console.error(e instanceof Error ? e.message : 'Smoke failed'); process.exitCode = 1; });
}
