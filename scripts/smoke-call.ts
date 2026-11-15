// Smoke test for a real call: dial, wait for ready, say one line, show a test stage for 20 s, end.
// Usage: npm run smoke:call -- --to +1XXXXXXXXXX [--to +1YYYYYYYYYY ...]
// Phone numbers come only from the command line. Never commit one.
// TO VERIFY ON THE REAL LINE: everything. Phones ring, the host is heard, the stage video shows, the call ends.
import { loadEnv } from '../src/config';
import { makeTts } from '../src/agent';
import { createChertClient } from '../src/comms/chert';
import { createLiveKitSession } from '../src/comms/livekit';
import { createCallPort } from '../src/comms/call';
import { createVoice } from '../src/comms/voice';
import { createStage } from '../src/stage';
import type { StageState } from '../src/contracts/types';

const USAGE = `Usage: npm run smoke:call -- --to +1XXXXXXXXXX [--to +1YYYYYYYYYY ...]
Dials the given phones, waits for the bridge, says one line, shows a test stage for 20 s, ends the call.
  --to     phone in E.164 form (repeatable, 1 to 4)
  --help   show this text
Needs LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, CHERT_API_KEY, CHERT_PROJECT_ID, CHERT_LINE_ID,
ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.
Trial calls last 5 minutes each (50 minutes in total): log this call in docs/call-log.md.`;

const READY_WAIT_MS = 60_000;
const STAGE_MS = 20_000;

/** Phone numbers after each --to. */
export function parsePhones(args: string[]): string[] {
  const out: string[] = [];
  args.forEach((a, i) => { if (a === '--to' && args[i + 1]) out.push(args[i + 1]); });
  return out;
}

function testStage(): StageState {
  return {
    phase: 'round_start', title: 'THE PRICE IS LIVE', roundLabel: 'SMOKE TEST', turnOrder: [], podiums: [],
    caption: { text: 'Smoke test: can you see and hear me?', speaker: 'host' }, timer: null, reveal: null,
    mysteryOwner: null, liveTranscript: null, banner: null, joinHint: null, fallbackBadge: null,
    hostSpeaking: false, lightning: false, capRemainingMs: null, finale: null,
  };
}

async function main(args: string[]): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return 0; }
  const env = loadEnv(process.env, { readDotenv: true });
  const need: [string, string][] = [
    ['LIVEKIT_URL', env.livekitUrl], ['LIVEKIT_API_KEY', env.livekitApiKey], ['LIVEKIT_API_SECRET', env.livekitApiSecret],
    ['CHERT_API_KEY', env.chertApiKey], ['CHERT_PROJECT_ID', env.chertProjectId], ['CHERT_LINE_ID', env.chertLineId],
    ['ELEVENLABS_API_KEY', env.elevenLabsApiKey], ['ELEVENLABS_VOICE_ID', env.elevenLabsVoiceId],
  ];
  const missing = need.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) { console.error(`Missing ${missing.join(', ')}.`); return 1; }
  const phones = parsePhones(args);
  if (phones.length < 1 || phones.length > 4) { console.error('Give 1 to 4 phones with --to +1XXXXXXXXXX.'); return 1; }

  console.log(`About to dial ${phones.length} phone(s): ${phones.map((p) => '...' + p.slice(-4)).join(', ')}. Trial minutes are limited.`);
  const chert = createChertClient({
    apiKey: env.chertApiKey, projectId: env.chertProjectId, lineId: env.chertLineId,
    facetimeBase: env.chertFacetimeBase, appBase: env.chertAppBase,
  });
  const call = createCallPort({ chert, session: createLiveKitSession(), env });
  const voice = createVoice({ sink: call.audioSink(), tts: makeTts(env), stt: null });
  const stage = createStage({ width: env.stageW, height: env.stageH, fps: env.stageFps });
  try {
    const ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No ready event within 60 s')), READY_WAIT_MS);
      call.on('ready', () => { clearTimeout(t); resolve(); });
      call.on('ended', (e) => { clearTimeout(t); reject(new Error(`Call ended early: ${e.reason}`)); });
    });
    await call.dial(phones);
    console.log('Dialed. Waiting for ready (answer FaceTime on the phones) ...');
    await ready;
    console.log('Ready. Starting stage and saying one line.');
    stage.setState(testStage());
    stage.start(call.videoSink());
    voice.onMouthLevel((l) => stage.setMouthLevel(l));
    await voice.speak('smoke-1', 'Smoke test. If you can hear me, the show is a go!', { emotion: 'hype' });
    console.log(`Showing the stage for ${STAGE_MS / 1000} s ...`);
    await new Promise((r) => setTimeout(r, STAGE_MS));
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Smoke failed');
    return 1;
  } finally {
    stage.stop();
    voice.close();
    await call.end().catch(() => undefined);
    console.log('Call ended. Log it in docs/call-log.md (trial: 5 minutes per call, 50 minutes total).');
  }
}

if (process.argv[1]?.endsWith('smoke-call.ts')) {
  main(process.argv.slice(2)).then((c) => { process.exit(c); }, (e: unknown) => { console.error(e instanceof Error ? e.message : 'Smoke failed'); process.exit(1); });
}
