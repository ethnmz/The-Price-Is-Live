// createStage: the StagePort. A timer at `fps` renders the latest state and pushes RGBA frames to the sink.
// A frame that takes longer than the interval makes the next tick skip (never queued).
// TO VERIFY ON THE REAL LINE: real frame pacing inside LiveKit (the sink drops late frames too).
import type { StagePort, VideoSink } from '../contracts/ports';
import type { StageState } from '../contracts/types';
import { createRenderer } from './render';

export interface StageOpts {
  width: number;
  height: number;
  fps: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
}

/** Title only: shown before the first real state so the video is never blank. */
export function idleStageState(): StageState {
  return {
    phase: 'boot', title: 'THE PRICE IS LIVE', roundLabel: null, turnOrder: [], podiums: [], caption: null,
    timer: null, reveal: null, mysteryOwner: null, liveTranscript: null, banner: null, joinHint: null,
    fallbackBadge: null, hostSpeaking: false, lightning: false, capRemainingMs: null, finale: null,
  };
}

export function createStage(opts: StageOpts): StagePort {
  const { width, height, fps } = opts;
  const now = opts.now ?? Date.now;
  const setIv = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearIv = opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  const renderer = createRenderer({ width, height });
  let state: StageState = idleStageState();
  let mouth = 0;
  let handle: unknown = null;
  let busy = false;
  const intervalMs = 1000 / fps;
  const t0 = now();

  function tick(sink: VideoSink): void {
    if (busy) return;
    busy = true;
    try {
      const start = now();
      sink.pushFrame(renderer.render(state, start - t0, mouth), width, height);
    } catch (err) {
      console.warn(`stage: frame failed: ${(err as Error).message}`);
    } finally {
      busy = false;
    }
  }

  return {
    setState(s) { state = s; },
    setMouthLevel(level) { mouth = level; },
    start(sink) {
      if (handle !== null) return;
      handle = setIv(() => tick(sink), intervalMs);
    },
    stop() {
      if (handle === null) return;
      clearIv(handle);
      handle = null;
    },
    renderPng(s) { return renderer.png(s); },
  };
}
