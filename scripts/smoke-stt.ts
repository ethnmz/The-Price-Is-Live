// Smoke test for speech-to-text: streams a WAV file to the STT provider and prints the transcripts.
// Usage: npm run smoke:stt -- path/to/speech.wav   (16-bit PCM WAV, any rate)
// TO VERIFY ON THE REAL LINE: transcripts come back for a clear spoken price like "twenty five dollars".
import { readFileSync } from 'node:fs';
import { loadEnv } from '../src/config';
import { createSttProvider } from '../src/comms/stt';
import { resampleInt16, stereoToMono } from '../src/comms/resample';

const USAGE = `Usage: npm run smoke:stt -- path/to/speech.wav
Sends a 16-bit PCM WAV file to the STT provider and prints the transcripts.
  --help   show this text
Needs ELEVENLABS_API_KEY.`;

/** Reads a 16-bit PCM WAV into mono 16 kHz samples. Throws on other formats. */
export function wavToPcm16k(buf: Buffer): Int16Array {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let pos = 12, channels = 1, rate = 16000, bits = 16;
  let data: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') { channels = buf.readUInt16LE(body + 2); rate = buf.readUInt32LE(body + 4); bits = buf.readUInt16LE(body + 14); }
    if (id === 'data') { data = buf.subarray(body, Math.min(body + size, buf.length)); break; }
    pos = body + size + (size % 2);
  }
  if (!data) throw new Error('WAV has no data chunk');
  if (bits !== 16) throw new Error('Only 16-bit WAV is supported');
  const even = data.subarray(0, data.length - (data.length % 2));
  let pcm = new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length));
  if (channels > 1) pcm = stereoToMono(pcm, channels);
  return rate === 16000 ? pcm : resampleInt16(pcm, rate, 16000);
}

async function main(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return 0; }
  const env = loadEnv(process.env, { readDotenv: true });
  if (!env.elevenLabsApiKey) { console.error('Missing ELEVENLABS_API_KEY.'); return 1; }
  if (env.sttProvider === 'none') { console.error('STT_PROVIDER is "none". Set it to elevenlabs.'); return 1; }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('Give a WAV file path.\n' + USAGE); return 1; }
  const pcm = wavToPcm16k(readFileSync(file));
  console.log(`Sending ${(pcm.length / 16000).toFixed(1)} s of audio to ${env.sttProvider} ...`);
  const stt = createSttProvider({ provider: env.sttProvider, apiKey: env.elevenLabsApiKey });
  stt.onTranscript((e) => console.log(`${e.isFinal ? 'final  ' : 'partial'} (${e.confidence.toFixed(2)}): ${e.text}`));
  await stt.start();
  const chunk = 1600; // 100 ms, sent in real time
  for (let i = 0; i < pcm.length; i += chunk) {
    stt.pushAudio(pcm.subarray(i, i + chunk));
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 3000)); // let the last transcript arrive
  await stt.stop();
  return 0;
}

if (process.argv[1]?.endsWith('smoke-stt.ts')) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e: unknown) => { console.error(e instanceof Error ? e.message : 'Smoke failed'); process.exitCode = 1; });
}
