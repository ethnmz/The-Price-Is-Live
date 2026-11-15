import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createSttProvider, int16ToBase64, STT_URL } from '../src/comms/stt';

class FakeWS extends EventEmitter {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string, public opts: any) {
    super();
    FakeWS.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.emit('open');
  }
  drop() {
    this.readyState = 3;
    this.emit('close');
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

function make(extra = {}) {
  FakeWS.instances = [];
  const stt = createSttProvider({ provider: 'elevenlabs', apiKey: 'k', WebSocketImpl: FakeWS, ...extra });
  const events: any[] = [];
  stt.onTranscript((e) => events.push(e));
  return { stt, events };
}

afterEach(() => vi.useRealTimers());

describe('stt', () => {
  it('connects with url and key header, resolves on open', async () => {
    const { stt } = make();
    const p = stt.start();
    const ws = FakeWS.instances[0]!;
    expect(ws.url).toBe(STT_URL);
    expect(ws.opts.headers['xi-api-key']).toBe('k');
    ws.open();
    await p;
  });

  it('resolves after 3 s even if never open', async () => {
    vi.useFakeTimers();
    const { stt } = make();
    const p = stt.start();
    await vi.advanceTimersByTimeAsync(3000);
    await p;
  });

  it('sends audio as base64 of the same bytes, drops when not started', async () => {
    const { stt } = make();
    stt.pushAudio(new Int16Array([1]));
    expect(FakeWS.instances.length).toBe(0);
    const p = stt.start();
    const ws = FakeWS.instances[0]!;
    ws.open();
    await p;
    const pcm = new Int16Array([1, -2, 300, 32767]);
    stt.pushAudio(pcm);
    const msg = JSON.parse(ws.sent[0]!);
    expect(msg.message_type).toBe('input_audio_chunk');
    const bytes = new Int16Array(new Uint8Array(Buffer.from(msg.audio_base_64, 'base64')).buffer);
    expect(Array.from(bytes)).toEqual(Array.from(pcm));
    expect(int16ToBase64(pcm)).toBe(msg.audio_base_64);
  });

  it('buffers at most 1 s during connect and flushes on open', async () => {
    const { stt } = make();
    const p = stt.start();
    const ws = FakeWS.instances[0]!;
    for (let i = 0; i < 5; i++) stt.pushAudio(new Int16Array(8000));
    ws.open();
    await p;
    expect(ws.sent.length).toBe(2);
  });

  it('maps partial and committed messages, ignores junk', async () => {
    const { stt, events } = make();
    const p = stt.start();
    const ws = FakeWS.instances[0]!;
    ws.open();
    await p;
    ws.emit('message', JSON.stringify({ message_type: 'partial_transcript', text: 'twen' }));
    ws.emit('message', JSON.stringify({ message_type: 'committed_transcript', transcript: 'twenty', confidence: 0.5 }));
    ws.emit('message', JSON.stringify({ message_type: 'committed_transcript_with_timestamps', text: 'ok' }));
    ws.emit('message', JSON.stringify({ message_type: 'session_started' }));
    ws.emit('message', 'not json{');
    ws.emit('message', 'null');
    expect(events).toEqual([
      { text: 'twen', confidence: 0.9, isFinal: false },
      { text: 'twenty', confidence: 0.5, isFinal: true },
      { text: 'ok', confidence: 0.9, isFinal: true },
    ]);
  });

  it('reconnects with backoff after a drop, max 5 tries, not after stop', async () => {
    vi.useFakeTimers();
    const { stt } = make();
    const p = stt.start();
    FakeWS.instances[0]!.open();
    await p;
    FakeWS.instances[0]!.drop();
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWS.instances.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWS.instances.length).toBe(2);
    for (let i = 0; i < 10; i++) {
      FakeWS.instances[FakeWS.instances.length - 1]!.drop();
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(FakeWS.instances.length).toBe(6); // 1 + 5 retries
    await stt.stop();
  });

  it('stop closes and prevents reconnect', async () => {
    vi.useFakeTimers();
    const { stt } = make();
    const p = stt.start();
    FakeWS.instances[0]!.open();
    await p;
    await stt.stop();
    await vi.advanceTimersByTimeAsync(10000);
    expect(FakeWS.instances.length).toBe(1);
  });

  it('no key, none, openai, deepgram -> no socket', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const cfg of [
      { provider: 'elevenlabs', apiKey: '' },
      { provider: 'none', apiKey: 'k' },
      { provider: 'openai', apiKey: 'k' },
      { provider: 'deepgram', apiKey: 'k' },
    ]) {
      FakeWS.instances = [];
      const stt = createSttProvider({ ...cfg, WebSocketImpl: FakeWS });
      await stt.start();
      stt.pushAudio(new Int16Array(10));
      await stt.stop();
      expect(FakeWS.instances.length).toBe(0);
    }
  });
});
