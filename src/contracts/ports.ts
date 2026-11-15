// Interfaces between lanes. FROZEN contract. See docs/API.md.
// Every port has a fake in src/testing/fakes.ts so each lane can build and test alone.
import type { PersistKind } from './events';
import type { HostLineKey } from './hostLines';
import type { Emotion, ItemRequest, PriceResult, ReferenceItem, SfxName, StageState } from './types';

// ---------- media sinks (implemented by src/comms/livekit.ts, the ONLY file that imports @livekit/rtc-node) ----------

/** The one audio publisher of the agent. Mono 16-bit PCM. */
export interface AudioSink {
  /** Resolves when the sink can take more audio (real-time backpressure). Drops audio when no call is connected. */
  write(pcm: Int16Array, sampleRate: number): Promise<void>;
}

/** The one video track of the agent (same participant as the audio). */
export interface VideoSink {
  /** RGBA, width*height*4 bytes. Never queues: a late frame is dropped. No-op when no call is connected. */
  pushFrame(rgba: Uint8Array, width: number, height: number): void;
}

// ---------- comms lane (Diego) ----------

export interface CallPort {
  /** Join our LiveKit room and publish the one audio and one video track. Safe to call twice. */
  connect(): Promise<void>;
  /** Plan B / rematch: connect(), mint a fresh bridge token, POST /v1/calls with recipients. Rejects on Chert errors. */
  dial(phones: string[]): Promise<{ callId: string }>;
  end(): Promise<void>;
  on(ev: 'ready', cb: (e: { callId: string; at: number }) => void): void; // bridge_ready
  on(ev: 'ended', cb: (e: { reason: string }) => void): void;
  /** Stable for the whole process: safe to grab once at boot, before any call. */
  audioSink(): AudioSink;
  videoSink(): VideoSink;
  /** Mixed caller audio (facetime-remote-audio) as mono 16 kHz PCM frames. */
  onRemoteAudio(cb: (pcm16k: Int16Array) => void): void;
  /** JPEGs from facetime-remote-video (768 px wide, q70); null if there is no usable video. */
  latestCallerFrames(max: number): Promise<Buffer[] | null>;
  roomHandle(): unknown; // the connected LiveKit Room, or null. Escape hatch; prefer the sinks.
}

export interface SpeechEvent {
  text: string;
  confidence: number; // 0..1
  at: number;
  isFinal: boolean;
}

export interface VoicePort {
  /** Resolves when the audio has finished playing (or its duration has passed if audio is dead). Never rejects. */
  speak(id: string, text: string, opts?: { rate?: number; emotion?: Emotion }): Promise<void>;
  sfx(name: SfxName): Promise<void>;
  stopSpeaking(): void;
  /** Gate STT. Off while the host talks; stays off 400 ms after the host stops. */
  listen(on: boolean): void;
  onSpeech(cb: (e: SpeechEvent) => void): void;
  onMouthLevel(cb: (level: number) => void): void; // 0..1 RMS of outgoing audio, ~20 per second
  onSpeakingChange(cb: (speaking: boolean) => void): void;
}

/** A streaming speech-to-text backend (ElevenLabs Scribe by default). Used inside src/comms only. */
export interface SttProvider {
  start(): Promise<void>;
  pushAudio(pcm16k: Int16Array): void;
  stop(): Promise<void>;
  onTranscript(cb: (e: { text: string; confidence: number; isFinal: boolean }) => void): void;
}

export interface InboundMessage {
  id: string;
  phone: string; // E.164
  text: string;
  at: number;
}

export interface MessagePort {
  /** idemKey makes retries safe. Rejects after one retry; callers log and move on. */
  send(phone: string, text: string, idemKey?: string): Promise<void>;
  onMessage(cb: (m: InboundMessage) => void): void;
  start(): void; // begin polling
  stop(): void;
}

// ---------- ai lane (Akshi) ----------

export interface PricingPort {
  /** Never throws. Always returns within priceTimeoutMs; worst case a labelled estimate. */
  price(req: ItemRequest): Promise<PriceResult>;
  identifyFromFrames(jpegs: Buffer[]): Promise<{ label: string; confidence: number } | null>;
}

/** Web price lookup (default: Gemini + Google Search grounding). Injected into the pricing pipeline. */
export interface SearchProvider {
  search(query: string): Promise<{ priceCents: number | null; sources: { title: string; url: string }[]; text: string }>;
}

export interface HostPort {
  /** Pure and instant, from the script bank. Picks a random variant, never the same twice in a row. */
  line(key: HostLineKey, vars?: Record<string, string | number>): string;
  /** Optional Gemini one-liner. null on timeout (1.5 s), filter reject, or when disabled. */
  quip(itemName: string, ownerName: string): Promise<string | null>;
}

// ---------- store lane (Aditri) ----------

export interface StorePort {
  /** Fire and forget, queued with retry. The game never waits on the database. */
  persist(kind: PersistKind, doc: Record<string, unknown>): void;
  loadReferenceItems(): Promise<ReferenceItem[]>; // Atlas first, data/reference-items.json fallback
  vectorSearch(queryVector: number[], k: number): Promise<{ item: ReferenceItem; score: number }[]>; // [] if unavailable
  getCachedPrice(cleanText: string): Promise<PriceResult | null>;
}

// ---------- stage lane (Ethan) ----------

export interface StagePort {
  setState(s: StageState): void;
  setMouthLevel(level: number): void;
  /** Begin the frame loop at STAGE_FPS, pushing RGBA frames into the sink. */
  start(sink: VideoSink): void;
  stop(): void;
  renderPng(s: StageState): Buffer; // for previews and Devpost screenshots
}

/** Everything the game runner needs. */
export interface Ports {
  call: CallPort;
  voice: VoicePort;
  message: MessagePort;
  pricing: PricingPort;
  host: HostPort;
  store: StorePort;
  stage: StagePort;
}
