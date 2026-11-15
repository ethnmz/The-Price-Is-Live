// Fake ports and deps for tests, the sim and the demo check. No network, no phone, no keys.
// FROZEN (planner-owned). If you need more from a fake, wrap it in your own test file.
import { gameConfig } from '../config';
import type { EngineDeps, PersistKind } from '../contracts/events';
import type { HostLineKey } from '../contracts/hostLines';
import { formatCents } from '../contracts/money';
import type {
  AudioSink, CallPort, HostPort, InboundMessage, MessagePort, Ports, PricingPort, SpeechEvent, StagePort, StorePort,
  VideoSink, VoicePort,
} from '../contracts/ports';
import type {
  Cents, Emotion, GameConfig, ItemRequest, ParsedGuess, PriceResult, ReferenceItem, SfxName, StageState,
} from '../contracts/types';

export class FakeAudioSink implements AudioSink {
  samplesWritten = 0;
  async write(pcm: Int16Array): Promise<void> {
    this.samplesWritten += pcm.length;
  }
}

export class FakeVideoSink implements VideoSink {
  frames = 0;
  last: { width: number; height: number; bytes: number } | null = null;
  pushFrame(rgba: Uint8Array, width: number, height: number): void {
    this.frames += 1;
    this.last = { width, height, bytes: rgba.length };
  }
}

export class FakeCall implements CallPort {
  dialed: string[][] = [];
  ended = 0;
  connected = false;
  failNextDial: string | null = null;
  audio = new FakeAudioSink();
  video = new FakeVideoSink();
  private readyCbs: ((e: { callId: string; at: number }) => void)[] = [];
  private endedCbs: ((e: { reason: string }) => void)[] = [];
  private audioCbs: ((pcm: Int16Array) => void)[] = [];
  frames: Buffer[] | null = null;

  async connect(): Promise<void> {
    this.connected = true;
  }
  async dial(phones: string[]): Promise<{ callId: string }> {
    if (this.failNextDial) {
      const reason = this.failNextDial;
      this.failNextDial = null;
      throw new Error(reason);
    }
    await this.connect();
    this.dialed.push(phones);
    return { callId: `call_${this.dialed.length}` };
  }
  async end(): Promise<void> {
    this.ended += 1;
  }
  on(ev: 'ready' | 'ended', cb: (e: never) => void): void {
    if (ev === 'ready') this.readyCbs.push(cb as (e: { callId: string; at: number }) => void);
    else this.endedCbs.push(cb as (e: { reason: string }) => void);
  }
  audioSink(): AudioSink {
    return this.audio;
  }
  videoSink(): VideoSink {
    return this.video;
  }
  onRemoteAudio(cb: (pcm16k: Int16Array) => void): void {
    this.audioCbs.push(cb);
  }
  async latestCallerFrames(): Promise<Buffer[] | null> {
    return this.frames;
  }
  roomHandle(): unknown {
    return null;
  }
  /** Test helpers */
  emitReady(callId: string, at: number): void {
    for (const cb of this.readyCbs) cb({ callId, at });
  }
  emitEnded(reason: string): void {
    for (const cb of this.endedCbs) cb({ reason });
  }
  emitRemoteAudio(pcm: Int16Array): void {
    for (const cb of this.audioCbs) cb(pcm);
  }
}

export class FakeVoice implements VoicePort {
  spoken: { id: string; text: string; emotion?: Emotion }[] = [];
  sfxPlayed: SfxName[] = [];
  listening = false;
  listenLog: boolean[] = [];
  private speechCbs: ((e: SpeechEvent) => void)[] = [];
  private mouthCbs: ((level: number) => void)[] = [];
  private speakingCbs: ((speaking: boolean) => void)[] = [];

  async speak(id: string, text: string, opts?: { rate?: number; emotion?: Emotion }): Promise<void> {
    this.spoken.push({ id, text, emotion: opts?.emotion });
    for (const cb of this.speakingCbs) cb(true);
    for (const cb of this.mouthCbs) cb(0.5);
    for (const cb of this.speakingCbs) cb(false);
  }
  async sfx(name: SfxName): Promise<void> {
    this.sfxPlayed.push(name);
  }
  stopSpeaking(): void {}
  listen(on: boolean): void {
    this.listening = on;
    this.listenLog.push(on);
  }
  onSpeech(cb: (e: SpeechEvent) => void): void {
    this.speechCbs.push(cb);
  }
  onMouthLevel(cb: (level: number) => void): void {
    this.mouthCbs.push(cb);
  }
  onSpeakingChange(cb: (speaking: boolean) => void): void {
    this.speakingCbs.push(cb);
  }
  /** Test helper: a player says something (delivered whether or not the gate is open; the engine decides). */
  say(text: string, at: number, isFinal = true, confidence = 0.95): void {
    for (const cb of this.speechCbs) cb({ text, confidence, at, isFinal });
  }
}

export class FakeMessage implements MessagePort {
  sent: { phone: string; text: string; idemKey?: string }[] = [];
  started = false;
  private cbs: ((m: InboundMessage) => void)[] = [];
  private n = 0;
  async send(phone: string, text: string, idemKey?: string): Promise<void> {
    this.sent.push({ phone, text, idemKey });
  }
  onMessage(cb: (m: InboundMessage) => void): void {
    this.cbs.push(cb);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.started = false;
  }
  /** Test helper: a phone texts the line. */
  receive(phone: string, text: string, at: number): void {
    this.n += 1;
    for (const cb of this.cbs) cb({ id: `msg_${this.n}`, phone, text, at });
  }
  textsTo(phone: string): string[] {
    return this.sent.filter((s) => s.phone === phone).map((s) => s.text);
  }
}

export function fakePriceResult(itemId: string, displayName: string, priceCents: Cents, extra: Partial<PriceResult> = {}): PriceResult {
  return {
    itemId, displayName, priceCents, source: 'list', isEstimate: false, confidence: 1,
    evidence: [{ kind: 'list', label: displayName, priceCents, matchScore: 1 }], latencyMs: 1, ...extra,
  };
}

/** Prices from a lookup table by lowercase raw text; anything else is a $10.00 estimate. */
export class FakePricing implements PricingPort {
  requests: ItemRequest[] = [];
  delayMs = 0;
  hang = false;
  constructor(public table: Record<string, { name: string; cents: Cents; source?: PriceResult['source'] }> = {}) {}
  async price(req: ItemRequest): Promise<PriceResult> {
    this.requests.push(req);
    if (this.hang) return new Promise<PriceResult>(() => {});
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const hit = this.table[(req.rawText ?? '').trim().toLowerCase()];
    if (hit) return fakePriceResult(req.itemId, hit.name, hit.cents, { source: hit.source ?? 'list' });
    return fakePriceResult(req.itemId, req.rawText ?? 'Mystery item', 1000, {
      source: 'estimate', isEstimate: true, confidence: 0.4, evidence: [],
    });
  }
  async identifyFromFrames(): Promise<{ label: string; confidence: number } | null> {
    return null;
  }
}

/** Host lines as "key|var=value" so tests can assert on keys without the real line bank. */
export class FakeHost implements HostPort {
  line(key: HostLineKey, vars: Record<string, string | number> = {}): string {
    const parts = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
    return [key, ...parts].join('|');
  }
  async quip(): Promise<string | null> {
    return null;
  }
}

export class FakeStore implements StorePort {
  persisted: { kind: PersistKind; doc: Record<string, unknown> }[] = [];
  constructor(public items: ReferenceItem[] = []) {}
  persist(kind: PersistKind, doc: Record<string, unknown>): void {
    this.persisted.push({ kind, doc });
  }
  async loadReferenceItems(): Promise<ReferenceItem[]> {
    return this.items;
  }
  async vectorSearch(): Promise<{ item: ReferenceItem; score: number }[]> {
    return [];
  }
  async getCachedPrice(): Promise<PriceResult | null> {
    return null;
  }
}

export class FakeStage implements StagePort {
  states: StageState[] = [];
  mouthLevels = 0;
  started = false;
  setState(s: StageState): void {
    this.states.push(s);
  }
  setMouthLevel(): void {
    this.mouthLevels += 1;
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.started = false;
  }
  renderPng(): Buffer {
    return Buffer.alloc(0);
  }
  get last(): StageState | undefined {
    return this.states[this.states.length - 1];
  }
}

export interface FakePorts extends Ports {
  call: FakeCall;
  voice: FakeVoice;
  message: FakeMessage;
  pricing: FakePricing;
  host: FakeHost;
  store: FakeStore;
  stage: FakeStage;
}

export function makeFakePorts(priceTable: FakePricing['table'] = {}): FakePorts {
  return {
    call: new FakeCall(),
    voice: new FakeVoice(),
    message: new FakeMessage(),
    pricing: new FakePricing(priceTable),
    host: new FakeHost(),
    store: new FakeStore(),
    stage: new FakeStage(),
  };
}

const YES = /\b(yes|yeah|yep|yup|correct|right|locked|sure)\b/;
const NO = /\b(no|nope|wrong|nah)\b/;
const PASS = /\b(pass|skip|no idea|i don't know)\b/;

/** Digits-only stand-in for src/speech/parseGuess.ts: "25", "$12.99", "yes", "no", "pass". */
export function fakeParseGuess(text: string, sttConfidence = 1): ParsedGuess {
  const t = text.toLowerCase();
  const m = t.replace(/,/g, '').match(/\$?(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const cents = Math.max(100, Math.round(parseFloat(m[1]) * 100));
    if (cents > 9_999_900) return { kind: 'none', ambiguous: false, confidence: sttConfidence };
    return { kind: 'amount', cents, ambiguous: false, confidence: sttConfidence, spokenForm: formatCents(cents) };
  }
  if (PASS.test(t)) return { kind: 'pass', ambiguous: false, confidence: sttConfidence };
  if (YES.test(t)) return { kind: 'yes', ambiguous: false, confidence: sttConfidence };
  if (NO.test(t)) return { kind: 'no', ambiguous: false, confidence: sttConfidence };
  return { kind: 'none', ambiguous: false, confidence: sttConfidence };
}

export const FAKE_PROP_ITEM: ReferenceItem = {
  id: 'ref_prop', name: 'Sharpie permanent markers 12 pack', aliases: ['sharpies'], category: 'school supplies',
  priceCents: 1099, source: 'fixture', checkedAt: '2026-11-14', verified: false,
};

/** EngineDeps for engine tests: fake parser, "key|var=value" lines, fixed prop item, counting game ids. */
export function makeFakeDeps(config: Partial<GameConfig> = {}): EngineDeps {
  const host = new FakeHost();
  let games = 0;
  return {
    config: { ...gameConfig(), ...config },
    parseGuess: fakeParseGuess,
    spokenAmount: (cents) => formatCents(cents),
    line: (key, vars) => host.line(key, vars),
    propItem: () => FAKE_PROP_ITEM,
    newGameId: () => `game_${++games}`,
  };
}
