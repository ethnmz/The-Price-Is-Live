/** Executes engine effects. All ports are injected; no live credentials are needed here. */
import type { Effect, EngineDeps, GameConfig, GameEvent, GameState, Ports, Reduce, StageState } from '../contracts';

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export class VirtualScheduler implements Scheduler {
  private time = 0;
  private nextId = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now(): number { return this.time; }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(h: unknown): void { this.timers.delete(h as number); }
  async advance(ms: number): Promise<void> {
    if (!Number.isFinite(ms) || ms < 0) throw new RangeError('advance requires finite nonnegative milliseconds');
    const end = this.time + ms;
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    await settle();
    for (;;) {
      const next = [...this.timers].filter(([, t]) => t.at <= end)
        .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
      await settle();
    }
    this.time = end;
    await settle();
  }
}

export interface RunnerOpts {
  ports: Ports; deps: EngineDeps; reduce: Reduce; initial: GameState;
  buildStageState: (s: GameState, now: number, c: GameConfig) => StageState;
  scheduler?: Scheduler; tickMs?: number;
  log?: (level: string, msg: string, data?: object) => void;
}
export interface Runner {
  start(): void; stop(): void; dispatch(e: GameEvent): void; getState(): GameState;
}

export function createRunner(opts: RunnerOpts): Runner {
  const { ports, deps } = opts;
  const scheduler: Scheduler = opts.scheduler ?? {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let state = opts.initial;
  let started = false;
  let stopped = false;
  let processing = false;
  let hostSpeaking = false;
  let tick: unknown;
  const timers = new Map<string, unknown>();
  const queue: GameEvent[] = [];
  let speech = Promise.resolve();
  const log = (level: string, msg: string, data?: object) => {
    try { opts.log?.(level, msg, data); } catch { /* Logging must not stop play. */ }
  };
  const safely = (fn: () => unknown) => {
    try { return Promise.resolve(fn()).catch(() => { log('warn', 'Runner port failed'); }); }
    catch { log('warn', 'Runner port failed'); return Promise.resolve(); }
  };
  const render = () => safely(() => ports.stage.setState({
    ...opts.buildStageState(state, scheduler.now(), deps.config), hostSpeaking,
  }));
  const cancel = (id: string) => {
    if (timers.has(id)) scheduler.clearTimeout(timers.get(id));
    timers.delete(id);
  };
  const effect = (e: Effect): void => {
    switch (e.type) {
      case 'SPEAK':
        speech = speech.then(async () => {
          if (stopped) return;
          await safely(() => ports.voice.speak(e.speakId, e.text, { emotion: e.emotion }));
          dispatch({ type: 'SPEAK_DONE', speakId: e.speakId, at: scheduler.now() });
        });
        break;
      case 'SFX': void safely(() => ports.voice.sfx(e.name)); break;
      case 'SEND_TEXT': void safely(() => ports.message.send(e.phone, e.text, e.idemKey)); break;
      case 'LISTEN': void safely(() => ports.voice.listen(e.on)); break;
      case 'END_CALL': void safely(() => ports.call.end()); break;
      case 'PERSIST': void safely(() => ports.store.persist(e.kind, e.doc)); break;
      case 'LOG': log(e.level, e.msg, e.data); break;
      case 'START_TIMER': {
        cancel(e.timerId);
        const h = scheduler.setTimeout(() => {
          timers.delete(e.timerId);
          dispatch({ type: 'TIMER', timerId: e.timerId, at: scheduler.now() });
        }, e.ms);
        timers.set(e.timerId, h);
        break;
      }
      case 'CANCEL_TIMER': cancel(e.timerId); break;
      case 'PRICE_ITEM':
        void safely(async () => {
          try {
            const result = await ports.pricing.price(e.request);
            dispatch({ type: 'PRICE_READY', itemId: e.request.itemId, result, at: scheduler.now() });
          } catch {
            dispatch({ type: 'PRICE_FAILED', itemId: e.request.itemId, at: scheduler.now() });
          }
        });
        break;
      case 'IDENTIFY_FROM_CAMERA':
        void safely(async () => {
          let result = null;
          try {
            const frames = await ports.call.latestCallerFrames(3);
            if (frames?.length) result = await ports.pricing.identifyFromFrames(frames);
          } catch { log('warn', 'Camera identification failed'); }
          dispatch({ type: 'FRAME_ID_READY', itemId: e.itemId, label: result?.label ?? null,
            confidence: result?.confidence ?? 0, at: scheduler.now() });
        });
        break;
      case 'DIAL':
        void safely(async () => {
          try { await ports.call.dial(e.phones); }
          catch (error) {
            dispatch({ type: 'CALL_FAILED', reason: error instanceof Error ? error.message : String(error), at: scheduler.now() });
          }
        });
        break;
    }
  };
  function dispatch(e: GameEvent): void {
    if (stopped) return;
    queue.push(e);
    if (processing) return;
    processing = true;
    try {
      while (queue.length && !stopped) {
        const event = queue.shift()!;
        try {
          const result = opts.reduce(state, event, deps);
          state = result.state;
          for (const e of result.effects) {
            if (stopped) break;
            try { effect(e); } catch { log('warn', 'Runner effect failed'); }
          }
        } catch { log('error', 'Runner reducer failed'); }
        void render();
      }
    } finally { processing = false; }
  }
  return {
    dispatch,
    getState: () => state,
    start() {
      if (started || stopped) return;
      started = true;
      void safely(() => ports.voice.onSpeech((e) => dispatch(e.isFinal
        ? { type: 'SPEECH_FINAL', text: e.text, confidence: e.confidence, at: e.at }
        : { type: 'SPEECH_PARTIAL', text: e.text, at: e.at })));
      void safely(() => ports.message.onMessage((m) => dispatch({ type: 'TEXT_RECEIVED', phone: m.phone, text: m.text, msgId: m.id, at: m.at })));
      void safely(() => ports.call.on('ready', (e) => dispatch({ type: 'CALL_READY', ...e })));
      void safely(() => ports.call.on('ended', (e) => dispatch({ type: 'CALL_ENDED', ...e, at: scheduler.now() })));
      void safely(() => ports.voice.onMouthLevel((level) => { if (!stopped) void safely(() => ports.stage.setMouthLevel(level)); }));
      void safely(() => ports.voice.onSpeakingChange((speaking) => {
        if (!stopped) { hostSpeaking = speaking; void render(); }
      }));
      void safely(() => ports.message.start());
      dispatch({ type: 'BOOT', at: scheduler.now() });
      const scheduleTick = () => {
        if (stopped) return;
        tick = scheduler.setTimeout(() => {
          dispatch({ type: 'TICK', at: scheduler.now() });
          scheduleTick();
        }, Math.max(1, opts.tickMs ?? 1000));
      };
      scheduleTick();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      queue.length = 0;
      for (const h of timers.values()) scheduler.clearTimeout(h);
      timers.clear();
      scheduler.clearTimeout(tick);
      void safely(() => ports.message.stop());
      void safely(() => ports.voice.stopSpeaking());
    },
  };
}
