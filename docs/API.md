# API contract: The Price Is Live

This file and `docs/DATA_MODEL.md` are the law between lanes. The typed version lives in `src/contracts/` (frozen). The full product spec is `docs/SPEC.md` (section numbers below, like §7.4, point there).

**Do not edit** `src/contracts/**`, `src/config.ts`, `src/testing/fakes.ts`, `src/stage/theme.ts`, `fixtures/**`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `docs/API.md`, `docs/DATA_MODEL.md`. If one of them is wrong or missing something, request a contract change and keep working against the current version.

## 1. Stack (decided)

- TypeScript, Node 22+, ES modules, **one process**. No web server. `tsx` runs everything; there is no build step (`tsc --noEmit` only checks types).
- Imports have **no file extension** (`import { x } from '../contracts'`). `moduleResolution: Bundler`.
- Tests: `vitest`, files in `test/*.test.ts`. **Tests run offline**: no network, no API keys, no phone, no real timers longer than a second. Mock `fetch`, WebSockets and SDK clients by injecting them.
- All dependencies are already in `package.json`: `@livekit/rtc-node`, `livekit-server-sdk`, `@napi-rs/canvas`, `@google/genai`, `mongodb`, `pino`, `ws`, `zod`. Do not add packages. (`sharp`, `@livekit/agents`, `@trychert/sdk`, `openai` are deliberately not installed: use `@napi-rs/canvas` for JPEG work and plain `fetch` for Chert and ElevenLabs.)
- Commands: `npm run check` (typecheck + all tests), `npm run scan:secrets`, `npm run sim`, `npm run demo:check`, `npm run preview:stage`, `npm run eval`, `npm run doctor`, `npm start`. All npm scripts already exist in `package.json`; a task creates the file its script points to.
- Env: read only through `loadEnv()` in `src/config.ts`. Missing keys are empty strings; every module must fall back (log one warning) instead of throwing when its key is missing.
- Logging: `pino`. Never log a full phone number (use `last4()`), a key, a token, or a camera frame.

## 2. Who owns which files

| Path | Lane owner | What |
|---|---|---|
| `src/contracts/**`, `src/config.ts`, `src/testing/fakes.ts`, `fixtures/**`, `src/stage/theme.ts` | planner (frozen) | shared types, ports, fakes, fixtures |
| `src/engine/**`, `scripts/sim-call.ts` | Aditri | pure game engine, runner, sim |
| `src/store/**`, `data/**`, `eval/**`, `scripts/check-data.ts`, `scripts/doctor.ts` | Aditri | MongoDB Atlas, price list, held-out set, accuracy harness |
| `src/speech/**`, `src/comms/**`, `src/agent.ts`, `scripts/smoke-*.ts`, `scripts/warm-tts.ts` | Diego | number parser, Chert, LiveKit, ElevenLabs voice + STT, iMessage, wiring |
| `src/ai/**` | Akshi | Gemini pricing, list match, web search, host lines |
| `src/stage/**` (except `theme.ts`), `scripts/preview-*.ts`, `scripts/demo-check.ts`, `docs/devpost.md`, `docs/pitch.md`, `README.md` | Ethan | drawn stage video, demo, writeups |

## 3. Runtime picture

```
iPhones ──FaceTime──> Chert line/bridge ──LiveKit room──> agent process (src/agent.ts)
                                                            ├─ comms/livekit   Room, 1 audio track, 1 video track (same participant)
                                                            ├─ comms/call      CallPort: token, dial (Plan B), bridge_ready, end
                                                            ├─ comms/voice     VoicePort: ElevenLabs TTS + SFX mixer -> AudioSink; STT gate
                                                            ├─ comms/imessage  MessagePort: poll + send (Chert shared-messages)
                                                            ├─ ai/*            PricingPort + HostPort (Gemini)
                                                            ├─ store/*         StorePort (MongoDB Atlas, never blocks)
                                                            ├─ stage/*         StagePort: canvas frames -> VideoSink
                                                            └─ engine/runner   reduce(state, event, deps) -> effects -> ports
```

Call plan: **Plan B only** (outbound group call, §8.1). Players text "I'm in, I'm {name}", the main player texts `start`, the agent dials everyone with `recipients`. The engine only sees `CALL_READY`.

## 4. Engine (`src/contracts/events.ts`)

`reduce(state: GameState, event: GameEvent, deps: EngineDeps): { state, effects }`. No I/O, no clock, no randomness except through `deps`. Never throws; an event that does not fit the current phase is ignored with a `LOG` effect.

### Events in
`BOOT`, `TEXT_RECEIVED {phone,text,msgId}`, `CALL_READY {callId}`, `CALL_FAILED {reason}`, `CALL_ENDED {reason}`, `SPEECH_PARTIAL {text}`, `SPEECH_FINAL {text,confidence}`, `SPEAK_DONE {speakId}`, `TIMER {timerId}`, `PRICE_READY {itemId,result}`, `PRICE_FAILED {itemId}`, `FRAME_ID_READY {itemId,label,confidence}`, `TICK`. Every event has `at` (ms).

### Effects out, and what the runner does with each
| Effect | Runner action | Event sent back |
|---|---|---|
| `SPEAK {speakId,key,text,emotion}` | `voice.speak(speakId, text, {emotion})`, one at a time in order | `SPEAK_DONE {speakId}` (also if speak fails) |
| `SFX {name}` | `voice.sfx(name)` (not awaited) | none |
| `SEND_TEXT {phone,text,idemKey}` | `message.send(...)`; on error log and move on | none |
| `PRICE_ITEM {request}` | `pricing.price(request)` | `PRICE_READY`, or `PRICE_FAILED` if it rejects |
| `IDENTIFY_FROM_CAMERA {itemId,ownerId}` | `call.latestCallerFrames(3)` then `pricing.identifyFromFrames` | `FRAME_ID_READY` (label `null`, confidence 0 when unavailable) |
| `LISTEN {on}` | `voice.listen(on)` | none |
| `START_TIMER {timerId,ms}` / `CANCEL_TIMER {timerId}` | scheduler | `TIMER {timerId}` |
| `DIAL {phones}` | `call.dial(phones)` | `CALL_READY` comes from `call.on('ready')`; a rejected dial sends `CALL_FAILED` |
| `END_CALL` | `call.end()` | `CALL_ENDED` from `call.on('ended')` |
| `PERSIST {kind,doc}` | `store.persist(kind, doc)` | none |
| `LOG` | logger | none |

The runner also: forwards `voice.onSpeech` as `SPEECH_PARTIAL` / `SPEECH_FINAL`, `message.onMessage` as `TEXT_RECEIVED`, sends `TICK` every second, and after **every** dispatch and every tick calls `stage.setState(buildStageState(state, now, config))` with `hostSpeaking` overridden from `voice.onSpeakingChange`. It forwards `voice.onMouthLevel` to `stage.setMouthLevel`. The engine does not emit a stage effect: the stage is always derived from the state.

Timer ids are chosen by the engine and must be unique per use (for example `guess:r1:p2:1`), so a late `TIMER` for an old id is ignored.

### Engine module signatures
```ts
// src/engine/reducer.ts
export function initialState(config: GameConfig): GameState;   // phase 'boot'
export const reduce: Reduce;
// src/engine/stageState.ts
export function buildStageState(state: GameState, now: number, config: GameConfig): StageState;
// src/engine/runner.ts
export interface Scheduler { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export class VirtualScheduler implements Scheduler { advance(ms: number): Promise<void> }   // runs due timers in order, awaiting micro-tasks between them
export interface RunnerOpts {
  ports: Ports; deps: EngineDeps; reduce: Reduce; initial: GameState;
  buildStageState: (s: GameState, now: number, c: GameConfig) => StageState;
  scheduler?: Scheduler; tickMs?: number; log?: (level: string, msg: string, data?: object) => void;
}
export interface Runner { start(): void; stop(): void; dispatch(e: GameEvent): void; getState(): GameState }
export function createRunner(opts: RunnerOpts): Runner;
// src/engine/scoring.ts (done), registry.ts, messages.ts (working first versions exist: keep their exports)
```

### Rules the engine must keep (§4, §7.4, §9)
- States and transitions: the table in §7.4. Phase names are the `Phase` type.
- `start` text from the main player with 2+ players in `wait_call` → `DIAL`. In demo mode the config comes from `gameConfig({ demo: true })`; a `demo` text from the main player in `wait_call` also turns demo on for the next game.
- Item text from a player (any text that is not a join, `start`, `demo`, `rematch` or a guess in their guess window) is stored in `pendingItemTexts` and priced at once with `PRICE_ITEM` (`itemId` = `r{round number}` of that owner's round). The item name and price never appear in `StageState` before `reveal.stage === 'price'`.
- Guess window: first parsable amount wins; confirm-back; silence for `confirmSilenceMs` confirms; timer end with no amount = `silent`, 0 points. Text guess from the **current guesser's phone** locks at once with `channel: 'text'`.
- The game never blocks: pricing slower than `priceTimeoutMs`, or nothing by `itemResolveMaxMs` → prop closet (`deps.propItem()`).
- Hard clock: finale by `hardCapMs` after `CALL_READY`; no new round after `lastRoundStartMs`; lightning mode per §7.4.
- Results card goes to every registered phone at the start of `finale`.

## 5. Ports (`src/contracts/ports.ts`)

`CallPort`, `VoicePort`, `MessagePort`, `PricingPort`, `HostPort`, `StorePort`, `StagePort`, plus the small internal interfaces `AudioSink`, `VideoSink`, `SttProvider`, `SearchProvider`. Read the file; the comments are the contract. Changes from §8.5 of the spec, made on purpose:

1. `StagePort.start(sink: VideoSink)` instead of `start(room)`. Only `src/comms/livekit.ts` imports `@livekit/rtc-node`; the stage just pushes RGBA frames. This keeps audio and video on the same participant by construction.
2. `CallPort` gained `connect()`, `audioSink()`, `videoSink()`, `onRemoteAudio()`. The sinks are stable for the whole process, so `agent.ts` wires them once at boot.
3. `VoicePort.speak` takes `{ emotion }` (§21.2). `MessagePort` has `start()`/`stop()` and an optional `idemKey`.
4. The engine gets host lines, the number parser and the prop closet through `EngineDeps` so it can be built before those exist.

### Factory signatures (each lane exports exactly these)
```ts
// ---- speech (Diego) ----
// src/speech/parseGuess.ts
export function parseGuess(text: string, sttConfidence?: number): ParsedGuess;          // §9.3 to §9.5, deterministic
// src/speech/spokenAmount.ts
export function spokenAmount(cents: Cents): string;   // 2500 -> "twenty-five dollars"; 1299 -> "twelve dollars and ninety-nine cents"

// ---- comms (Diego) ----
// src/comms/chert.ts
export class ChertError extends Error { code: string; status: number; human: string }
export interface ChertClient {
  createCall(a: { phones: string[]; livekitUrl: string; participantToken: string; agentIdentity: string; idemKey: string }): Promise<{ callId: string }>;
  getCall(callId: string): Promise<{ status: string; terminal: boolean; endReason: string | null }>;
  getCallEvents(callId: string): Promise<{ type: string }[]>;
  endCall(callId: string, idemKey: string): Promise<void>;
  sendMessage(phone: string, text: string, idemKey: string): Promise<void>;
  listMessages(): Promise<{ id: string; phone: string; text: string; at: number; inbound: boolean }[]>;
}
export function createChertClient(cfg: { apiKey: string; projectId: string; lineId: string; facetimeBase: string; appBase: string; fetch?: typeof fetch }): ChertClient;
// src/comms/token.ts
export function mintToken(a: { apiKey: string; apiSecret: string; room: string; identity: string; ttlSec?: number }): Promise<string>;
// src/comms/imessage.ts
export function createMessagePort(a: { chert: ChertClient; pollMs?: number }): MessagePort;
// src/comms/sfx.ts and mixer.ts
export function synthSfx(name: SfxName, sampleRate: number): Int16Array;
export interface Mixer { addVoice(pcm: Int16Array): void; addSfx(pcm: Int16Array): void; clearVoice(): void; hasAudio(): boolean; voiceActive(): boolean; nextFrame(samples: number): { pcm: Int16Array; level: number } }
export function createMixer(): Mixer;
// src/comms/tts.ts
export interface Tts { synthesize(text: string, emotion: Emotion): Promise<Int16Array | null>; warmCache(lines: string[]): Promise<{ generated: number; cached: number }>; stats(): { charsUsed: number; budget: number; cacheHits: number; cacheMisses: number; mode: 'live' | 'cached_only' } }
export function createTts(cfg: { apiKey: string; voiceId: string; model: string; format: string; charBudget: number; cacheDir?: string; fetch?: typeof fetch }): Tts;   // output is always 24 kHz mono Int16
// src/comms/stt.ts
export function createSttProvider(cfg: { provider: string; apiKey: string; WebSocketImpl?: unknown }): SttProvider;
// src/comms/voice.ts
export const VOICE_SAMPLE_RATE = 24000;
export function createVoice(a: { sink: AudioSink; tts: Tts; stt: SttProvider | null; now?: () => number }): VoicePort & { pushRemoteAudio(pcm16k: Int16Array): void; close(): void };
// src/comms/livekit.ts   (the only file that imports @livekit/rtc-node)
export interface LiveKitSession { connect(url: string, token: string): Promise<void>; disconnect(): Promise<void>; connected(): boolean; audioSink: AudioSink; videoSink(width: number, height: number): VideoSink; onRemoteAudio(cb: (pcm16k: Int16Array) => void): void; onDisconnected(cb: (reason: string) => void): void; room(): unknown }
export function createLiveKitSession(): LiveKitSession;
// src/comms/call.ts
export function createCallPort(a: { chert: ChertClient; session: LiveKitSession; env: Env; pollMs?: number; now?: () => number }): CallPort;
// src/agent.ts
export function buildAgent(env: Env, overrides?: Partial<Ports>): Promise<{ runner: Runner; ports: Ports; stop(): Promise<void> }>;

// ---- ai (Akshi) ----
// src/ai/host/lines.ts
export const LINE_BANK: Record<HostLineKey, string[]>;                 // §12.2, every key, 1+ variants
export function staticLines(): string[];                               // every variant with no {vars}: for the TTS warm cache
export function createHost(opts?: { rng?: () => number; quip?: HostPort['quip'] }): HostPort;
// src/ai/cleanText.ts
export function cleanItemText(raw: string): { clean: string; rejected: boolean };
// src/ai/matchList.ts
export interface ListMatch { item: ReferenceItem; score: number; sizeConflict: boolean }
export function matchList(cleanText: string, items: ReferenceItem[], k?: number): ListMatch[];   // best first
// src/ai/gemini.ts
export interface GeminiClient {
  available: boolean;                                                  // false when there is no API key
  json<T>(a: { prompt: string; schema: import('zod').ZodType<T>; timeoutMs: number; system?: string; imagesJpeg?: Buffer[] }): Promise<T | null>;   // null on timeout, error or bad JSON; retries once
  grounded(a: { prompt: string; timeoutMs: number }): Promise<{ text: string; sources: { title: string; url: string }[] } | null>;   // Google Search grounding
  text(a: { prompt: string; system?: string; timeoutMs: number }): Promise<string | null>;
}
export function createGemini(cfg: { apiKey: string; model: string; sdk?: unknown }): GeminiClient;
// src/ai/estimate.ts
export function estimatePrice(gemini: GeminiClient, cleanText: string, examples: ReferenceItem[], timeoutMs?: number): Promise<{ displayName: string; priceCents: number; confidence: number; notAProduct: boolean } | null>;
// src/ai/webSearch.ts
export function createGeminiSearch(gemini: GeminiClient): SearchProvider;
// src/ai/pricing.ts
export function createPricing(a: { items: ReferenceItem[]; gemini: GeminiClient; search?: SearchProvider | null; store?: StorePort | null; timeoutMs?: number; webTimeoutMs?: number; identify?: PricingPort['identifyFromFrames'] }): PricingPort;
//   `identify` is the optional camera-identification callback behind PricingPort.identifyFromFrames(jpegs). When omitted, or if it throws, identifyFromFrames resolves null. (There is no separate createIdentifier factory.)
// src/ai/variants.ts   (§10.4, for the accuracy harness)
export interface VariantResult { priceCents: number | null; displayName: string; source: 'list' | 'web' | 'estimate' | 'none'; latencyMs: number }
export type VariantFn = (rawText: string) => Promise<VariantResult>;
export function makeVariants(a: { items: ReferenceItem[]; gemini: GeminiClient; search: SearchProvider | null }): { A: VariantFn; B: VariantFn; C: VariantFn };
// src/ai/index.ts
export function createAi(env: Env, a: { items: ReferenceItem[]; store?: StorePort | null }): { pricing: PricingPort; host: HostPort; gemini: GeminiClient };

// ---- store (Aditri) ----
// src/store/index.ts
export function createStore(env: Env, opts?: { client?: unknown; dataDir?: string }): StorePort & { ready(): Promise<boolean>; flush(timeoutMs?: number): Promise<void>; close(): Promise<void> };

// ---- stage (Ethan) ----  every draw function takes the 2D context of @napi-rs/canvas and draws inside its box from theme.ts
// src/stage/fonts.ts      export function registerFonts(): void;      // safe to call twice; falls back to system fonts
// src/stage/background.ts export function drawBackground(ctx, nowMs: number): void;      // curtains, sunburst, floor (cached), marquee bulbs
// src/stage/hud.ts        export function drawHud(ctx, s: StageState, nowMs: number): void;   // round label, turn strip, join hint, mystery card, banner, badge, call clock
// src/stage/podium.ts     export function drawPodiums(ctx, s: StageState, nowMs: number): void;
// src/stage/mouth.ts      export type MouthShape = 'closed' | 'half' | 'wide';
//                         export function createMouthTracker(): { update(level: number | null, speaking: boolean, nowMs: number): MouthShape };
// src/stage/host-sprite.ts export function drawHost(ctx, a: { pose: 'idle' | 'talking' | 'reveal' | 'celebrate'; mouth: MouthShape; nowMs: number }): void;
// src/stage/captions.ts   export function wrapCaption(text: string, measure: (s: string) => number, maxWidth: number): string[];
//                         export function drawCaption(ctx, caption: StageState['caption'], msSinceShown: number, speaking: boolean): void;
// src/stage/overlays.ts   export function drawTimerRing(ctx, timer: NonNullable<StageState['timer']>, msSinceSet: number): void;
//                         export function drawReveal(ctx, reveal: NonNullable<StageState['reveal']>, msSinceStage: number, lightning: boolean): void;
// src/stage/finale.ts     export function drawScoreFly(ctx, s: StageState, msSincePhase: number): void;
//                         export function drawFinale(ctx, s: StageState, msSincePhase: number): void;
// src/stage/render.ts     export function createRenderer(o?: { width?: number; height?: number }): { render(s: StageState, nowMs: number, mouthLevel: number | null): Uint8Array; png(s: StageState, nowMs?: number): Buffer };
// src/stage/index.ts      export function createStage(o?: { width?: number; height?: number; fps?: number }): StagePort;
```

Stage timing rule: the renderer is a pure function of `(StageState, nowMs, mouthLevel)` plus timestamps that `createStage` records when a field changes (`phase`, `reveal.stage`, `caption.text`, `timer`). `timer.secondsLeft` is exact when the state is set; while `running`, the stage counts down from that moment on its own.

## 6. External services (all UNVERIFIED details must be handled tolerantly; record what you learn in `docs/verified.md`)

### Chert (§3.4). Sample bodies: `fixtures/chert.ts`
Headers on every request: `Authorization: Bearer $CHERT_API_KEY`, `X-Chert-Project-Id`, `Content-Type: application/json`, and on POST `Idempotency-Key` (8 to 200 chars; same key = same request).
- `POST {facetimeBase}/calls`: outbound group call with `recipients` (one phone: `destination` + `destination_type: "phone"`). 201 = allocated, not answered.
- `GET {facetimeBase}/calls/{id}`, `GET {facetimeBase}/calls/{id}/events` (wait for `bridge_ready`), `POST {facetimeBase}/calls/{id}/end` with body `{}`.
- `POST {appBase}/shared-messages` `{ line_id, recipient, text }`; `GET {appBase}/shared-messages` (newest 50, sent and received). Poll every 1.5 s, dedupe by id, ignore outbound.
- If a call to one base URL fails with 404, retry once on the other base.
- Bridge token: LiveKit JWT (`livekit-server-sdk` `AccessToken`), `roomJoin, canPublish, canSubscribe`, one room, TTL at most 7200 s, fresh per call. The bridge identity must differ from the agent identity.
- Greet only after `bridge_ready`. One audio publisher only. Trial calls end at 5:00.

### ElevenLabs (§8.2, §21.2)
- TTS: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000`, header `xi-api-key`, body `{ text, model_id, voice_settings: { stability, similarity_boost, style, speed } }`, response = raw 16-bit little-endian PCM. Emotion presets: hype (0.30 / style 0.60 / speed 1.08), drumroll (0.40 / 0.70 / 0.95), warm (0.50 / 0.30 / 1.0).
- STT: WebSocket `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=vad`; send `input_audio_chunk` messages with base64 audio; receive `partial_transcript` and `committed_transcript`.
- Cache every synthesized line on disk in `.cache/tts/` (git-ignored). Count characters against `ELEVENLABS_CHAR_BUDGET`.

### Gemini (§10.3, §21.3)
`@google/genai`: `ai.models.generateContent({ model, contents, config: { tools: [{ googleSearch: {} }], responseMimeType, responseSchema, temperature: 0 } })`. Grounding sources are in `candidates[0].groundingMetadata.groundingChunks[].web.{uri,title}`. JSON plus grounding in one call may not work: use two calls (grounded plain text, then a JSON extraction call).

### MongoDB Atlas (§21.4)
Driver `mongodb`. Collections in `docs/DATA_MODEL.md`. Every write is queued and retried in the background; a dead database must not slow the game.

## 7. What "done" means for every task
- `npm run check` passes (types + every test in the repo).
- New logic has a test in `test/` that runs offline.
- No secret, real phone number, camera frame or personal data in any file. Fake phones use `+1214555010x`.
- Things that need a real phone call, a real key or a human are **not** part of any task's acceptance. Write the code, mock the edge, and list what a human must verify in `docs/verified.md` under "TO VERIFY ON THE REAL LINE".
