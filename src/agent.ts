// The one process that runs the game (`npm start`). This file only wires things together:
// every real piece lives behind a factory in src/comms, src/ai, src/store and src/stage.
// Importing this file starts nothing; main() runs only when the file is executed directly.
// TO VERIFY ON THE REAL LINE: a full game over a real FaceTime call (see docs/verified.md).
import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { gameConfig, loadEnv, type Env } from './config';
import type { EngineDeps, Ports, ReferenceItem } from './contracts';
import { createAi } from './ai';
import { staticLines } from './ai/host/lines';
import { createCallPort } from './comms/call';
import { createChertClient, type ChertClient } from './comms/chert';
import { createMessagePort } from './comms/imessage';
import { createLiveKitSession } from './comms/livekit';
import { createSttProvider } from './comms/stt';
import { createTts, type Tts } from './comms/tts';
import { createVoice } from './comms/voice';
import { initialState, reduce } from './engine/reducer';
import { createRunner, type Runner, type Scheduler } from './engine/runner';
import { buildStageState } from './engine/stageState';
import { parseGuess } from './speech/parseGuess';
import { spokenAmount } from './speech/spokenAmount';
import { createStage } from './stage';
import { createStore } from './store';

export interface Agent {
  runner: Runner;
  ports: Ports;
  /** The real TTS client, when voice was not overridden (main uses it to warm the cache). */
  tts: Tts | null;
  stop(): Promise<void>;
}

type Closable = { flush?: () => Promise<void>; close?: () => Promise<void> };

export function makeTts(env: Env): Tts {
  return createTts({
    apiKey: env.elevenLabsApiKey, voiceId: env.elevenLabsVoiceId, model: env.elevenLabsTtsModel,
    format: env.elevenLabsTtsFormat, charBudget: env.elevenLabsCharBudget,
  });
}

function makeChert(env: Env): ChertClient {
  return createChertClient({
    apiKey: env.chertApiKey, projectId: env.chertProjectId, lineId: env.chertLineId,
    facetimeBase: env.chertFacetimeBase, appBase: env.chertAppBase,
  });
}

export async function buildAgent(env: Env, overrides: Partial<Ports> = {}, scheduler?: Scheduler): Promise<Agent> {
  const store = overrides.store ?? createStore(env);
  const items: ReferenceItem[] = await store.loadReferenceItems();
  const ai = overrides.pricing && overrides.host ? null : createAi(env, { items, store });
  const pricing = overrides.pricing ?? ai!.pricing;
  const host = overrides.host ?? ai!.host;

  // Only build the real Chert client if a real call or message port needs it.
  const chert = overrides.call && overrides.message ? null : makeChert(env);
  const call = overrides.call ?? createCallPort({ chert: chert!, session: createLiveKitSession(), env });
  let tts: Tts | null = null;
  let voice = overrides.voice;
  if (!voice) {
    tts = makeTts(env);
    const stt = env.sttProvider === 'none' ? null : createSttProvider({ provider: env.sttProvider, apiKey: env.elevenLabsApiKey });
    const real = createVoice({ sink: call.audioSink(), tts, stt });
    call.onRemoteAudio((pcm) => real.pushRemoteAudio(pcm));
    voice = real;
  }
  const message = overrides.message ?? createMessagePort({ chert: chert! });
  const stage = overrides.stage ?? createStage({ width: env.stageW, height: env.stageH, fps: env.stageFps });
  stage.start(call.videoSink());

  const ports: Ports = { call, voice, message, pricing, host, store, stage };
  const config = gameConfig({ demo: env.demo, lineDisplayNumber: env.lineDisplayNumber });
  const deps: EngineDeps = {
    config, parseGuess, spokenAmount,
    line: (key, vars) => host.line(key, vars),
    propItem: () => items[Math.floor(Math.random() * items.length)],
    newGameId: () => `g_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
  };
  const runner = createRunner({ ports, deps, reduce, initial: initialState(config), buildStageState, scheduler });

  return {
    runner, ports, tts,
    async stop() {
      runner.stop();
      try { stage.stop(); } catch { /* already stopped */ }
      try { await call.end(); } catch { /* no call to end */ }
      const s = store as Closable;
      try { await s.flush?.(); } catch { /* best effort */ }
      try { await s.close?.(); } catch { /* best effort */ }
    },
  };
}

/** Which integrations are live and which fall back. Never includes a secret value. */
export function liveReport(env: Env): string[] {
  const on = (live: boolean, name: string, fallback: string) => `${name}: ${live ? 'live' : `fallback (${fallback})`}`;
  return [
    on(!!(env.chertApiKey && env.chertProjectId && env.chertLineId), 'Chert (call + iMessage)', 'calls will fail'),
    on(!!(env.livekitUrl && env.livekitApiKey && env.livekitApiSecret), 'LiveKit', 'no media'),
    on(!!(env.elevenLabsApiKey && env.elevenLabsVoiceId), 'ElevenLabs TTS', 'cached lines or text pace only'),
    on(env.sttProvider !== 'none' && !!env.elevenLabsApiKey, 'Speech-to-text', 'texting only'),
    on(!!env.geminiApiKey, 'Gemini', 'reference list + fallback'),
    on(!!env.mongodbUri, 'MongoDB', 'local files'),
  ];
}

export async function main(): Promise<void> {
  const env = loadEnv(process.env, { readDotenv: true });
  const log = pino({ level: env.logLevel });
  for (const line of liveReport(env)) log.info(line);

  // A broken port must be logged, never kill the show.
  process.on('unhandledRejection', (err) => log.error({ err }, 'Unhandled rejection'));
  process.on('uncaughtException', (err) => log.error({ err }, 'Uncaught exception'));

  const agent = await buildAgent(env);
  void agent.tts?.warmCache(staticLines())
    .then((r) => log.info(r, 'TTS cache warmed'))
    .catch((err) => log.warn({ err }, 'TTS warm failed'));
  agent.runner.start();
  log.info('The Price Is Live agent is running');

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'Shutting down');
    await agent.stop();
    // Everything is stopped now, so the process ends by itself once its handles close.
    process.exitCode = 0;
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : 'Agent failed to start');
    process.exitCode = 1;
  });
}
