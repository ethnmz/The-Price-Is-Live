import { describe, expect, it } from 'vitest';
import { createVoice } from '../src/comms/voice';
import { FakeAudioSink } from '../src/testing/fakes';
import type { SttProvider } from '../src/contracts/ports';
import type { Tts } from '../src/comms/tts';

function clip(samples: number): Int16Array {
  return new Int16Array(samples).fill(8000);
}

function fakeTts(pcm: Int16Array | null): Tts {
  return {
    synthesize: async () => pcm,
    warmCache: async () => ({ generated: 0, cached: 0 }),
    stats: () => ({ charsUsed: 0, budget: 0, cacheHits: 0, cacheMisses: 0, mode: 'live' }),
  };
}

function fakeStt() {
  const pushed: Int16Array[] = [];
  let cb: (e: { text: string; confidence: number; isFinal: boolean }) => void = () => {};
  let starts = 0;
  const stt: SttProvider = {
    start: async () => { starts++; },
    pushAudio: (p) => { pushed.push(p); },
    stop: async () => {},
    onTranscript: (c) => { cb = c; },
  };
  return { stt, pushed, emit: (text: string) => cb({ text, confidence: 0.9, isFinal: true }), starts: () => starts };
}

// A sink that yields to the event loop on each write, and tracks overlapping writes.
class SlowSink extends FakeAudioSink {
  inFlight = 0;
  maxInFlight = 0;
  override async write(pcm: Int16Array): Promise<void> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((r) => setImmediate(r));
    await super.write(pcm);
    this.inFlight--;
  }
}

describe('voice', () => {
  it('speak writes the clip rounded up to whole frames, then resolves', async () => {
    const sink = new FakeAudioSink();
    const v = createVoice({ sink, tts: fakeTts(clip(1000)), stt: null });
    await v.speak('a', 'hello');
    expect(sink.samplesWritten).toBe(1440);
  });

  it('resolves after an estimated delay when TTS returns null', async () => {
    const waits: number[] = [];
    const sink = new FakeAudioSink();
    const v = createVoice({ sink, tts: fakeTts(null), stt: null, sleep: async (ms) => { waits.push(ms); } });
    await v.speak('a', 'hi');
    await v.speak('b', 'x'.repeat(100));
    expect(waits).toEqual([600, 6500]);
    expect(sink.samplesWritten).toBe(0);
  });

  it('plays two speaks in order', async () => {
    const order: string[] = [];
    const v = createVoice({ sink: new FakeAudioSink(), tts: fakeTts(clip(480)), stt: null });
    const a = v.speak('a', 'one').then(() => order.push('a'));
    const b = v.speak('b', 'two').then(() => order.push('b'));
    await Promise.all([a, b]);
    expect(order).toEqual(['a', 'b']);
  });

  it('sfx over speech keeps a single writer', async () => {
    const sink = new SlowSink();
    const v = createVoice({ sink, tts: fakeTts(clip(4800)), stt: null });
    const sp = v.speak('a', 'hello');
    await new Promise((r) => setTimeout(r, 5));
    await Promise.all([v.sfx('ding'), sp]);
    expect(sink.maxInFlight).toBe(1);
    expect(sink.samplesWritten).toBeGreaterThanOrEqual(4800);
  });

  it('reports mouth levels > 0 during speech, ending with 0, and speaking order', async () => {
    const v = createVoice({ sink: new FakeAudioSink(), tts: fakeTts(clip(2400)), stt: null });
    const events: string[] = [];
    const levels: number[] = [];
    v.onSpeakingChange((s) => events.push(String(s)));
    v.onMouthLevel((l) => levels.push(l));
    await v.speak('a', 'hello');
    expect(events).toEqual(['true', 'false']);
    expect(levels.length).toBe(6); // 5 frames + final 0
    expect(levels.slice(0, -1).every((l) => l > 0)).toBe(true);
    expect(levels[levels.length - 1]).toBe(0);
  });

  it('gates audio and transcripts while speaking and for 400 ms after', async () => {
    let t = 1000;
    const f = fakeStt();
    const v = createVoice({ sink: new FakeAudioSink(), tts: fakeTts(clip(480)), stt: f.stt, now: () => t });
    const heard: string[] = [];
    v.onSpeech((e) => heard.push(e.text));
    const pcm = new Int16Array(160);

    v.listen(true);
    expect(f.starts()).toBe(1);
    v.listen(true);
    expect(f.starts()).toBe(1);
    t = 5000;
    v.pushRemoteAudio(pcm);
    f.emit('open');
    expect(f.pushed.length).toBe(1);
    expect(heard).toEqual(['open']);

    const sp = v.speak('a', 'hi');
    await Promise.resolve();
    await Promise.resolve();
    v.pushRemoteAudio(pcm);
    f.emit('while speaking');
    await sp;
    t = 5100;
    v.pushRemoteAudio(pcm);
    f.emit('too soon');
    expect(f.pushed.length).toBe(1);
    t = 5500;
    v.pushRemoteAudio(pcm);
    f.emit('later');
    expect(f.pushed.length).toBe(2);
    expect(heard).toEqual(['open', 'later']);

    v.listen(false);
    v.pushRemoteAudio(pcm);
    f.emit('off');
    expect(f.pushed.length).toBe(2);
    expect(heard).toEqual(['open', 'later']);
  });

  it('stopSpeaking resolves the pending speak', async () => {
    const sink = new SlowSink();
    const v = createVoice({ sink, tts: fakeTts(clip(480 * 500)), stt: null });
    const sp = v.speak('a', 'long');
    const queued = v.speak('b', 'next');
    await new Promise((r) => setTimeout(r, 5));
    v.stopSpeaking();
    await sp;
    await queued;
    expect(sink.samplesWritten).toBeLessThan(480 * 500);
  });

  it('stopSpeaking also ends a fallback wait', async () => {
    const v = createVoice({ sink: new FakeAudioSink(), tts: fakeTts(null), stt: null, sleep: () => new Promise(() => {}) });
    const sp = v.speak('a', 'hi');
    await new Promise((r) => setTimeout(r, 5));
    v.stopSpeaking();
    await sp;
  });
});
