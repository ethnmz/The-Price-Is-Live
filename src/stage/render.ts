// Stage renderer (docs/SPEC.md 8.4, 13.5): puts every drawn layer together into one RGBA frame.
// The drawing is always 960x540; other sizes are scaled to fit (letterbox).
// A layer that throws is logged once and skipped, so the video never stops.
// TO VERIFY ON THE REAL LINE: nothing here needs the phone; frame time on the real machine (npm run preview:stage).
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { StageState } from '../contracts/types';
import { registerFonts } from './fonts';
import { STAGE } from './theme';
import { drawBackground } from './background';
import { drawHud } from './hud';
import { drawHost, type HostPose } from './host-sprite';
import { createMouthTracker } from './mouth';
import { drawTimerRing, drawReveal } from './overlays';
import { drawPodiums } from './podium';
import { drawCaption } from './captions';
import { drawScoreFly, drawFinale } from './finale';

export type LayerName = 'background' | 'hud' | 'host' | 'timer' | 'podiums' | 'caption' | 'scoreFly' | 'reveal' | 'finale';

export interface Renderer {
  render(s: StageState, nowMs: number, mouthLevel: number | null): Uint8Array;
  png(s: StageState, nowMs?: number): Buffer;
  /** Debug: the layers drawn by the last render() / png() call, in order. */
  layersDrawn(): LayerName[];
}

export interface RendererOpts {
  width: number;
  height: number;
  /** Tests only: make this layer throw. */
  failLayer?: LayerName;
  log?: (msg: string) => void;
}

interface Stamps { phase: number; reveal: number; caption: number; timer: number }

const SETTLED_MS = 2000;

function hostPose(s: StageState): HostPose {
  if (s.phase === 'finale') return 'celebrate';
  if (s.reveal?.stage === 'price') return 'reveal';
  return s.hostSpeaking ? 'talking' : 'idle';
}

function timerKey(t: StageState['timer']): string {
  return t ? `${t.secondsLeft}|${t.total}|${t.running}` : '';
}

export function createRenderer(opts: RendererOpts): Renderer {
  registerFonts();
  const { width, height } = opts;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const scaled = width !== STAGE.w || height !== STAGE.h;
  const stage: Canvas = createCanvas(STAGE.w, STAGE.h);
  const sctx = stage.getContext('2d');
  const out: Canvas = scaled ? createCanvas(width, height) : stage;
  const octx = out.getContext('2d');
  const mouth = createMouthTracker();
  const warned = new Set<LayerName>();
  let drawn: LayerName[] = [];

  let prev: StageState | null = null;
  let stamps: Stamps = { phase: 0, reveal: 0, caption: 0, timer: 0 };

  function track(s: StageState, nowMs: number): void {
    if (!prev) {
      stamps = { phase: nowMs, reveal: nowMs, caption: nowMs, timer: nowMs };
    } else {
      if (s.phase !== prev.phase) stamps.phase = nowMs;
      if ((s.reveal?.stage ?? 'none') !== (prev.reveal?.stage ?? 'none')) stamps.reveal = nowMs;
      if ((s.caption?.text ?? '') !== (prev.caption?.text ?? '')) stamps.caption = nowMs;
      if (timerKey(s.timer) !== timerKey(prev.timer)) stamps.timer = nowMs;
    }
    prev = s;
  }

  function layer(name: LayerName, fn: () => void): void {
    try {
      if (opts.failLayer === name) throw new Error(`forced failure in ${name}`);
      fn();
      drawn.push(name);
    } catch (err) {
      if (!warned.has(name)) {
        warned.add(name);
        log(`stage: layer "${name}" failed and is skipped: ${(err as Error).message}`);
      }
    }
  }

  function draw(s: StageState, nowMs: number, level: number | null, t: Stamps, settled: boolean): void {
    const ctx: SKRSContext2D = sctx;
    drawn = [];
    ctx.save();
    ctx.clearRect(0, 0, STAGE.w, STAGE.h);
    layer('background', () => drawBackground(ctx, nowMs));
    layer('hud', () => drawHud(ctx, s, nowMs));
    layer('host', () => {
      const shape = mouth.update(level, s.hostSpeaking, nowMs);
      drawHost(ctx, { pose: hostPose(s), mouth: shape, nowMs });
    });
    if (s.timer) {
      const timer = s.timer;
      layer('timer', () => drawTimerRing(ctx, timer, nowMs - t.timer));
    }
    layer('podiums', () => drawPodiums(ctx, s, nowMs));
    layer('caption', () => drawCaption(ctx, s.caption, nowMs - t.caption, settled || s.hostSpeaking));
    if (s.phase === 'round_score') layer('scoreFly', () => drawScoreFly(ctx, s, nowMs - t.phase));
    if (s.reveal && s.reveal.stage !== 'none') {
      const reveal = s.reveal;
      layer('reveal', () => drawReveal(ctx, reveal, nowMs - t.reveal, s.lightning));
    }
    if (s.finale) layer('finale', () => drawFinale(ctx, s, nowMs - t.phase));
    ctx.restore();
    if (scaled) letterbox();
  }

  function letterbox(): void {
    const k = Math.min(width / STAGE.w, height / STAGE.h);
    const w = STAGE.w * k;
    const h = STAGE.h * k;
    octx.save();
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, width, height);
    octx.imageSmoothingEnabled = true;
    octx.drawImage(stage, (width - w) / 2, (height - h) / 2, w, h);
    octx.restore();
  }

  return {
    render(s, nowMs, mouthLevel) {
      track(s, nowMs);
      draw(s, nowMs, mouthLevel, stamps, false);
      return new Uint8Array(octx.getImageData(0, 0, width, height).data.buffer);
    },
    png(s, nowMs = 10_000) {
      // Pretend every change happened 2 s ago so the screenshot shows the final look.
      const old = nowMs - SETTLED_MS;
      const settledStamps: Stamps = { phase: old, reveal: old, caption: old - 8000, timer: nowMs };
      draw(s, nowMs, null, settledStamps, true);
      return out.toBuffer('image/png');
    },
    layersDrawn: () => [...drawn],
  };
}
