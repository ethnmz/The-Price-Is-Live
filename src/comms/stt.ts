// Streaming speech-to-text over the ElevenLabs Scribe realtime WebSocket
// (docs/API.md section 6, SPEC 8.2 and 21.2 item 4).
// No key or provider 'none' -> a provider that does nothing (TEXT MODE carries the game).
// TO VERIFY ON THE REAL LINE:
// - the exact incoming field names (we read `text` or `transcript`, `confidence` if present)
// - the outgoing message field names (message_type, audio_base_64, sample_rate)
// - the committed_transcript_with_timestamps message type name
import WebSocket from 'ws';
import type { SttProvider } from '../contracts/ports';

export const STT_URL =
  'wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=vad';

const CONNECT_WAIT_MS = 3000;
const BACKOFF_MS = [500, 1000, 2000, 2000, 2000]; // max 5 tries
const MAX_BUFFER_SAMPLES = 16000; // 1 s at 16 kHz
const DEFAULT_CONFIDENCE = 0.9;

export interface SttConfig {
  provider: string;
  apiKey: string;
  WebSocketImpl?: unknown;
}

/** Base64 of the little-endian bytes of the samples. */
export function int16ToBase64(pcm: Int16Array): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64');
}

function nothingProvider(): SttProvider {
  return {
    start: async () => {},
    pushAudio: () => {},
    stop: async () => {},
    onTranscript: () => {},
  };
}

type Transcript = { text: string; confidence: number; isFinal: boolean };

// Minimal socket surface we use (matches `ws`).
interface Sock {
  readyState: number;
  on(ev: string, cb: (...a: any[]) => void): unknown;
  send(data: string): void;
  close(): void;
}
type SockCtor = new (url: string, opts?: unknown) => Sock;

export function createSttProvider(cfg: SttConfig): SttProvider {
  if (cfg.provider === 'openai' || cfg.provider === 'deepgram') {
    console.warn(`[stt] provider '${cfg.provider}' is not built; speech-to-text is off (TEXT MODE).`);
    return nothingProvider();
  }
  if (cfg.provider === 'none' || !cfg.apiKey) return nothingProvider();

  const Impl = (cfg.WebSocketImpl ?? WebSocket) as SockCtor;
  const OPEN = 1;
  let sock: Sock | null = null;
  let started = false;
  let tries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: Int16Array[] = [];
  let pendingSamples = 0;
  const listeners: Array<(e: Transcript) => void> = [];

  function emit(e: Transcript): void {
    for (const cb of listeners) {
      try {
        cb(e);
      } catch {
        // a bad listener must not break the socket
      }
    }
  }

  function sendChunk(s: Sock, pcm: Int16Array): void {
    try {
      s.send(
        JSON.stringify({
          message_type: 'input_audio_chunk',
          audio_base_64: int16ToBase64(pcm),
          commit: false,
          sample_rate: 16000,
        }),
      );
    } catch {
      // socket died mid-send; the close handler will reconnect
    }
  }

  function handleMessage(raw: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const type = String(msg.message_type ?? msg.type ?? '');
    let isFinal: boolean;
    if (type === 'partial_transcript') isFinal = false;
    else if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') isFinal = true;
    else return;
    const text = typeof msg.text === 'string' ? msg.text : typeof msg.transcript === 'string' ? msg.transcript : null;
    if (text === null) return;
    const confidence = typeof msg.confidence === 'number' ? msg.confidence : DEFAULT_CONFIDENCE;
    emit({ text, confidence, isFinal });
  }

  function scheduleRetry(): void {
    if (!started || retryTimer || tries >= BACKOFF_MS.length) return;
    const wait = BACKOFF_MS[tries++]!;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (started) connect();
    }, wait);
  }

  // Opens one socket. `onOpen` lets start() learn when it is ready.
  function connect(onOpen?: () => void): void {
    let s: Sock;
    try {
      s = new Impl(STT_URL, { headers: { 'xi-api-key': cfg.apiKey } });
    } catch {
      scheduleRetry();
      return;
    }
    sock = s;
    s.on('open', () => {
      if (sock !== s) return;
      tries = 0;
      for (const chunk of pending) sendChunk(s, chunk);
      pending = [];
      pendingSamples = 0;
      onOpen?.();
    });
    s.on('message', (data: unknown) => handleMessage(data));
    s.on('error', () => {
      // 'close' follows; nothing to do here
    });
    s.on('close', () => {
      if (sock === s) sock = null;
      scheduleRetry();
    });
  }

  return {
    start(): Promise<void> {
      if (started) return Promise.resolve();
      started = true;
      tries = 0;
      return new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, CONNECT_WAIT_MS);
        connect(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },

    pushAudio(pcm: Int16Array): void {
      if (!started || pcm.length === 0) return;
      if (sock && sock.readyState === OPEN) {
        sendChunk(sock, pcm);
        return;
      }
      // Not open: only buffer while a connect is in flight, newest 1 s.
      if (!sock) return;
      pending.push(pcm);
      pendingSamples += pcm.length;
      while (pendingSamples > MAX_BUFFER_SAMPLES && pending.length > 1) {
        pendingSamples -= pending.shift()!.length;
      }
    },

    async stop(): Promise<void> {
      started = false;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      pending = [];
      pendingSamples = 0;
      const s = sock;
      sock = null;
      try {
        s?.close();
      } catch {
        // already closed
      }
    },

    onTranscript(cb): void {
      listeners.push(cb);
    },
  };
}
