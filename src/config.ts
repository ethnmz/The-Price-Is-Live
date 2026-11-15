// Game constants (docs/SPEC.md 7.1) and environment loading. FROZEN contract file.
// Tests must never need real env vars: every value has a safe default.
import type { GameConfig } from './contracts/types';

export const STAGE_DEFAULTS = { width: 960, height: 540, fps: 15 };

export const DEFAULT_GAME_CONFIG: GameConfig = {
  demo: false,
  hardCapMs: 270_000,
  lastRoundStartMs: 250_000,
  guessSeconds: 10,
  textModeGuessSeconds: 20,
  confirmSilenceMs: 3_000,
  minRelistenMs: 4_000,
  guessPromptMaxMs: 1_500,
  priceTimeoutMs: 8_000,
  itemWaitMs: 6_000,
  itemResolveMaxMs: 12_000,
  lobbySettleMs: 8_000,
  lobbyMaxWaitMs: 60_000,
  dialTimeoutMs: 45_000,
  showItemMs: 4_000,
  drumrollMs: 3_000,
  lightningDrumrollMs: 2_000,
  revealHoldMs: 3_000,
  scoreHoldMs: 1_000,
  rematchListenMs: 8_000,
  avgRoundMsInitial: 48_000,
  finaleBufferMs: 25_000,
  lightningConfidence: 0.8,
  minPlayers: 2,
  maxPlayers: 4,
  demoItems: 2,
  lineDisplayNumber: null,
};

/** Demo mode (SPEC 14.1): 2 items, short rules, 1 s lobby settle, 3 s hold-up, lightning timings. */
export function gameConfig(opts: { demo?: boolean; lineDisplayNumber?: string | null } = {}): GameConfig {
  const base = { ...DEFAULT_GAME_CONFIG, lineDisplayNumber: opts.lineDisplayNumber ?? null };
  if (!opts.demo) return base;
  return { ...base, demo: true, lobbySettleMs: 1_000, showItemMs: 3_000 };
}

export interface Env {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  agentName: string;
  chertApiKey: string;
  chertProjectId: string;
  chertLineId: string;
  chertFacetimeBase: string;
  chertAppBase: string;
  lineDisplayNumber: string | null;
  callMode: 'inbound' | 'outbound_group' | 'link';
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsTtsModel: string;
  elevenLabsTtsFormat: string;
  elevenLabsCharBudget: number;
  sttProvider: 'elevenlabs' | 'openai' | 'deepgram' | 'none';
  geminiApiKey: string;
  geminiModel: string;
  geminiEmbedModel: string;
  searchProvider: 'gemini' | 'none';
  mongodbUri: string;
  mongodbDb: string;
  phoneHashSalt: string;
  demo: boolean;
  stageW: number;
  stageH: number;
  stageFps: number;
  logLevel: string;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
}

/**
 * Reads process.env (after trying .env.local, if present). Missing keys become '' so
 * callers can check `if (!env.geminiApiKey)` and fall back. Never throws.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env, opts: { readDotenv?: boolean } = {}): Env {
  if (opts.readDotenv) {
    try {
      process.loadEnvFile('.env.local');
    } catch {
      // no .env.local: fine, use process.env as is
    }
  }
  const s = source;
  return {
    livekitUrl: s.LIVEKIT_URL ?? '',
    livekitApiKey: s.LIVEKIT_API_KEY ?? '',
    livekitApiSecret: s.LIVEKIT_API_SECRET ?? '',
    agentName: s.AGENT_NAME ?? 'price-is-live-agent',
    chertApiKey: s.CHERT_API_KEY ?? '',
    chertProjectId: s.CHERT_PROJECT_ID ?? '',
    chertLineId: s.CHERT_LINE_ID ?? '',
    chertFacetimeBase: s.CHERT_FACETIME_BASE || 'https://facetime.trychert.com/api/v1',
    chertAppBase: s.CHERT_APP_BASE || 'https://app.trychert.com/api/v1',
    lineDisplayNumber: s.LINE_DISPLAY_NUMBER || null,
    callMode: (s.CALL_MODE as Env['callMode']) || 'outbound_group',
    elevenLabsApiKey: s.ELEVENLABS_API_KEY ?? '',
    elevenLabsVoiceId: s.ELEVENLABS_VOICE_ID ?? '',
    elevenLabsTtsModel: s.ELEVENLABS_TTS_MODEL || 'eleven_flash_v2_5',
    elevenLabsTtsFormat: s.ELEVENLABS_TTS_FORMAT || 'pcm_24000',
    elevenLabsCharBudget: num(s.ELEVENLABS_CHAR_BUDGET, 9000),
    sttProvider: (s.STT_PROVIDER as Env['sttProvider']) || 'elevenlabs',
    geminiApiKey: s.GEMINI_API_KEY ?? '',
    geminiModel: s.GEMINI_MODEL || 'gemini-2.5-flash',
    geminiEmbedModel: s.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
    searchProvider: (s.SEARCH_PROVIDER as Env['searchProvider']) || 'gemini',
    mongodbUri: s.MONGODB_URI ?? '',
    mongodbDb: s.MONGODB_DB || 'priceislive',
    phoneHashSalt: s.PHONE_HASH_SALT ?? '',
    demo: s.DEMO === '1' || s.DEMO === 'true',
    stageW: num(s.STAGE_W, STAGE_DEFAULTS.width),
    stageH: num(s.STAGE_H, STAGE_DEFAULTS.height),
    stageFps: num(s.STAGE_FPS, STAGE_DEFAULTS.fps),
    logLevel: s.LOG_LEVEL || 'info',
  };
}
