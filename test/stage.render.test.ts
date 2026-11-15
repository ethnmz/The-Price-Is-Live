import { describe, it, expect, vi } from 'vitest';
import { allStageFixtures, stageFixture } from '../fixtures/stage-states';
import { createRenderer } from '../src/stage/render';
import { createStage } from '../src/stage/index';
import { FakeVideoSink } from '../src/testing/fakes';

const W = 960;
const H = 540;

describe('renderer', () => {
  it('returns width*height*4 bytes for every fixture', () => {
    const r = createRenderer({ width: W, height: H });
    for (const f of allStageFixtures()) expect(r.render(f.state, 1000, 0.3).length, f.name).toBe(W * H * 4);
  });

  it('scales other sizes to fit', () => {
    const r = createRenderer({ width: 640, height: 480 });
    expect(r.render(stageFixture('guess_listen'), 0, 0).length).toBe(640 * 480 * 4);
  });

  it('animates, and repeats for the same sequence', () => {
    const s = stageFixture('guess_listen');
    const run = () => {
      const r = createRenderer({ width: W, height: H });
      return [r.render(s, 0, 0.5), r.render(s, 700, 0.5)];
    };
    const [a, b] = run();
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).not.toBe(0);
    const [a2, b2] = run();
    expect(Buffer.compare(Buffer.from(a), Buffer.from(a2))).toBe(0);
    expect(Buffer.compare(Buffer.from(b), Buffer.from(b2))).toBe(0);
  });

  it('png starts with the PNG signature', () => {
    const r = createRenderer({ width: W, height: H });
    const p = r.png(stageFixture('finale'));
    expect([...p.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('survives a layer that throws, and logs once', () => {
    const log = vi.fn();
    const r = createRenderer({ width: W, height: H, failLayer: 'hud', log });
    const s = stageFixture('guess_listen');
    expect(r.render(s, 0, 0).length).toBe(W * H * 4);
    r.render(s, 100, 0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(r.layersDrawn()).not.toContain('hud');
    expect(r.layersDrawn()).toContain('podiums');
  });

  it('does not draw the reveal overlay in guess_listen, but does in reveal', () => {
    const r = createRenderer({ width: W, height: H });
    r.render(stageFixture('guess_listen'), 0, 0);
    expect(r.layersDrawn()).not.toContain('reveal');
    r.render(stageFixture('reveal'), 0, 0);
    expect(r.layersDrawn()).toContain('reveal');
    expect(r.layersDrawn()[0]).toBe('background');
  });
});

describe('createStage', () => {
  function fakeClock() {
    let t = 0;
    let fn: (() => void) | null = null;
    let ms = 0;
    return {
      now: () => t,
      setInterval: (f: () => void, m: number) => { fn = f; ms = m; return 1; },
      clearInterval: () => { fn = null; },
      advance(total: number) {
        for (let i = 0; i < total / ms && fn; i++) { t += ms; fn(); }
      },
      get running() { return fn !== null; },
    };
  }

  it('pushes frames at the asked fps and stops on stop()', () => {
    const c = fakeClock();
    const sink = new FakeVideoSink();
    const stage = createStage({ width: W, height: H, fps: 15, ...c });
    stage.start(sink);
    c.advance(1000);
    expect(sink.frames).toBeGreaterThanOrEqual(14);
    expect(sink.frames).toBeLessThanOrEqual(16);
    expect(sink.last).toEqual({ width: W, height: H, bytes: W * H * 4 });
    stage.setState(stageFixture('reveal'));
    stage.setMouthLevel(0.4);
    stage.stop();
    expect(c.running).toBe(false);
    const n = sink.frames;
    c.advance(1000);
    expect(sink.frames).toBe(n);
  });

  it('renderPng returns a PNG', () => {
    const stage = createStage({ width: W, height: H, fps: 15 });
    expect(stage.renderPng(stageFixture('lobby')).subarray(1, 4).toString()).toBe('PNG');
  });
});
