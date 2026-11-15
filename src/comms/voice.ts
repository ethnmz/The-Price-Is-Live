// VoicePort: host voice + sound effects on ONE AudioSink, plus the STT gate (spec 8.2, 9.2).
// Pump: while anything is audible, pull 20 ms frames from the mixer and write them to the sink
// (the sink paces real time). Only this file writes to the sink.
//
// TO VERIFY ON THE REAL LINE:
// - The 400 ms hold-off after the host stops is enough to keep the host's own voice
//   (echo through the caller's phone) out of the transcript.
// - The 65 ms-per-character fallback pace feels right when TTS is dead.

import type { AudioSink, SpeechEvent, SttProvider, VoicePort } from '../contracts/ports';
import type { Emotion, SfxName } from '../contracts/types';
import { createMixer } from './mixer';
import { synthSfx } from './sfx';
import type { Tts } from './tts';

export const VOICE_SAMPLE_RATE = 24000;
const FRAME = 480; // 20 ms at 24 kHz
const GATE_HOLD_MS = 400;
const MS_PER_CHAR = 65;
const MIN_FALLBACK_MS = 600;

export interface VoiceArgs {
  sink: AudioSink;
  tts: Tts;
  stt: SttProvider | null;
  now?: () => number;
  /** Wait for the estimated duration when TTS gives no audio. Tests make this instant. */
  sleep?: (ms: number) => Promise<void>;
}

export function createVoice(a: VoiceArgs): VoicePort & { pushRemoteAudio(pcm16k: Int16Array): void; close(): void } {
  const now = a.now ?? Date.now;
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const mixer = createMixer();

  const speechCbs: ((e: SpeechEvent) => void)[] = [];
  const mouthCbs: ((level: number) => void)[] = [];
  const speakingCbs: ((s: boolean) => void)[] = [];

  // ---- pump ----
  interface Waiter { frames: number; resolve: () => void }
  let waiters: Waiter[] = [];
  let pumping = false;
  let speaking = false;
  let voiceWaiter: Waiter | null = null;

  // Resolves after the clip's last frame has been written.
  function play(pcm: Int16Array, add: (p: Int16Array) => void, isVoice: boolean): Promise<void> {
    if (pcm.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const w: Waiter = { frames: Math.ceil(pcm.length / FRAME), resolve };
      waiters.push(w);
      if (isVoice) voiceWaiter = w;
      add(pcm);
      void pump();
    });
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (mixer.hasAudio()) {
        const active = [...waiters]; // clips added during the write start with the next frame
        const { pcm, level } = mixer.nextFrame(FRAME);
        try { await a.sink.write(pcm, VOICE_SAMPLE_RATE); } catch { /* a dead sink must not stop the game */ }
        if (speaking) for (const cb of mouthCbs) cb(level);
        for (const w of active) w.frames--;
        const done = waiters.filter((w) => w.frames <= 0);
        waiters = waiters.filter((w) => w.frames > 0);
        for (const w of done) w.resolve();
      }
    } finally {
      pumping = false;
    }
  }

  // ---- speaking state and STT gate ----
  let wish = false;
  let stoppedAt = -Infinity;
  let sttStarted = false;

  function setSpeaking(on: boolean): void {
    if (speaking === on) return;
    speaking = on;
    if (!on) {
      stoppedAt = now();
      for (const cb of mouthCbs) cb(0);
    }
    for (const cb of speakingCbs) cb(on);
  }

  function gateOpen(): boolean {
    return wish && !speaking && now() - stoppedAt >= GATE_HOLD_MS;
  }

  a.stt?.onTranscript((e) => {
    if (!gateOpen()) return;
    const ev: SpeechEvent = { text: e.text, confidence: e.confidence, at: now(), isFinal: e.isFinal };
    for (const cb of speechCbs) cb(ev);
  });

  // ---- speak ----
  let epoch = 0; // bumped by stopSpeaking so queued and pending speaks end early
  let cancelWait: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  async function speakNow(text: string, emotion: Emotion, myEpoch: number): Promise<void> {
    if (myEpoch !== epoch) return;
    setSpeaking(true);
    try {
      let pcm: Int16Array | null = null;
      try { pcm = await a.tts.synthesize(text, emotion); } catch { pcm = null; }
      if (myEpoch !== epoch) return;
      if (pcm && pcm.length > 0) {
        await play(pcm, (p) => mixer.addVoice(p), true);
      } else {
        const ms = Math.max(MIN_FALLBACK_MS, text.length * MS_PER_CHAR);
        await Promise.race([sleep(ms), new Promise<void>((r) => { cancelWait = r; })]);
        cancelWait = null;
      }
    } finally {
      voiceWaiter = null;
      setSpeaking(false);
    }
  }

  return {
    speak(_id, text, opts) {
      const myEpoch = epoch;
      const run = chain.then(() => speakNow(text, opts?.emotion ?? 'hype', myEpoch)).catch(() => {});
      chain = run;
      return run;
    },
    sfx(name: SfxName) {
      return play(synthSfx(name, VOICE_SAMPLE_RATE), (p) => mixer.addSfx(p), false);
    },
    stopSpeaking() {
      epoch++;
      mixer.clearVoice();
      const w = voiceWaiter;
      if (w) {
        waiters = waiters.filter((x) => x !== w);
        w.resolve();
      }
      cancelWait?.();
    },
    listen(on) {
      wish = on;
      if (on && a.stt && !sttStarted) {
        sttStarted = true;
        a.stt.start().catch(() => { sttStarted = false; });
      }
    },
    onSpeech(cb) { speechCbs.push(cb); },
    onMouthLevel(cb) { mouthCbs.push(cb); },
    onSpeakingChange(cb) { speakingCbs.push(cb); },
    pushRemoteAudio(pcm16k) {
      if (a.stt && gateOpen()) a.stt.pushAudio(pcm16k);
    },
    close() {
      this.stopSpeaking();
      wish = false;
      if (a.stt && sttStarted) void a.stt.stop().catch(() => {});
    },
  };
}
