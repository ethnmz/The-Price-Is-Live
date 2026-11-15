// Executes reducer effects without waiting on external services.
// TO VERIFY ON THE REAL LINE: nothing here; port integrations are verified by their owners.
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
    const target = this.time + ms;
    // One event-loop turn drains finite promise chains, including nested port calls.
    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    await settle();
    while (true) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
      }
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
      await settle();
    }
    this.time = target;
  }
}

export interface RunnerOpts {
  ports: Ports; deps: EngineDeps; reduce: Reduce; initial: GameState;
  buildStageState: (s: GameState, now: number, c: GameConfig) => StageState;
  scheduler?: Scheduler; tickMs?: number;
  log?: (level: string, msg: string, data?: object) => void;
}
export interface Runner {
  start(): void;
  stop(): void;
  dispatch(e: GameEvent): void;
  getState(): GameState;
}

export function createRunner(opts: RunnerOpts): Runner {
  const { ports, deps } = opts;
  const clock: Scheduler = opts.scheduler ?? {
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
  const events: GameEvent[] = [];
  let speech = Promise.resolve();
  const log = (level: string, msg: string, data?: object) => {
    try { opts.log?.(level, msg, data); } catch { /* A logger must not stop the game. */ }
  };
  const safe = (work: () => unknown) => {
    try {
      void Promise.resolve(work()).catch(() => log('error', 'Runner port operation failed'));
    } catch { log('error', 'Runner port operation failed'); }
  };
  const render = () => safe(() => ports.stage.setState({
    ...opts.buildStageState(state, clock.now(), deps.config), hostSpeaking,
  }));

  function effect(e: Effect): void {
    switch (e.type) {
      case 'SPEAK':
        speech = speech.then(async () => {
          if (stopped) return;
          try { await ports.voice.speak(e.speakId, e.text, { emotion: e.emotion }); }
          catch { log('error', 'Speech failed'); }
          dispatch({ type: 'SPEAK_DONE', speakId: e.speakId, at: clock.now() });
        });
        break;
      case 'SFX': safe(() => ports.voice.sfx(e.name)); break;
      case 'SEND_TEXT': safe(() => ports.message.send(e.phone, e.text, e.idemKey)); break;
      case 'LISTEN': safe(() => ports.voice.listen(e.on)); break;
      case 'PRICE_ITEM':
        safe(async () => {
          try {
            const result = await ports.pricing.price(e.request);
            dispatch({ type: 'PRICE_READY', itemId: e.request.itemId, result, at: clock.now() });
          } catch { dispatch({ type: 'PRICE_FAILED', itemId: e.request.itemId, at: clock.now() }); }
        });
        break;
      case 'IDENTIFY_FROM_CAMERA':
        safe(async () => {
          let result: { label: string; confidence: number } | null = null;
          try {
            const frames = await ports.call.latestCallerFrames(3);
            if (frames?.length) result = await ports.pricing.identifyFromFrames(frames);
          } catch { log('warn', 'Camera identification unavailable'); }
          dispatch({ type: 'FRAME_ID_READY', itemId: e.itemId,
            label: result?.label ?? null, confidence: result?.confidence ?? 0, at: clock.now() });
        });
        break;
      case 'START_TIMER':
        if (timers.has(e.timerId)) clock.clearTimeout(timers.get(e.timerId));
        timers.set(e.timerId, clock.setTimeout(() => {
          timers.delete(e.timerId);
          dispatch({ type: 'TIMER', timerId: e.timerId, at: clock.now() });
        }, e.ms));
        break;
      case 'CANCEL_TIMER':
        if (timers.has(e.timerId)) clock.clearTimeout(timers.get(e.timerId));
        timers.delete(e.timerId);
        break;
      case 'DIAL':
        safe(async () => {
          try { await ports.call.dial(e.phones); }
          catch (error) {
            dispatch({ type: 'CALL_FAILED', reason: error instanceof Error ? error.message : String(error), at: clock.now() });
          }
        });
        break;
      case 'END_CALL': safe(() => ports.call.end()); break;
      case 'PERSIST': safe(() => ports.store.persist(e.kind, e.doc)); break;
      case 'LOG': log(e.level, e.msg, e.data); break;
    }
  }
  function dispatch(event: GameEvent): void {
    if (stopped) return;
    events.push(event);
    if (processing) return;
    processing = true;
    try {
      while (events.length && !stopped) {
        const next = events.shift()!;
        try {
          const result = opts.reduce(state, next, deps);
          state = result.state;
          for (const e of result.effects) {
            if (stopped) break;
            try { effect(e); } catch { log('error', 'Runner effect failed'); }
          }
        } catch { log('error', 'Reducer failed'); }
        render();
      }
    } finally { processing = false; }
  }
  function scheduleTick(): void {
    if (stopped) return;
    tick = clock.setTimeout(() => {
      dispatch({ type: 'TICK', at: clock.now() });
      scheduleTick();
    }, Math.max(1, opts.tickMs ?? 1000));
  }
  return {
    dispatch,
    getState: () => state,
    start() {
      if (started || stopped) return;
      started = true;
      safe(() => ports.voice.onSpeech((e) => dispatch(e.isFinal
        ? { type: 'SPEECH_FINAL', text: e.text, confidence: e.confidence, at: e.at }
        : { type: 'SPEECH_PARTIAL', text: e.text, at: e.at })));
      safe(() => ports.message.onMessage((m) => dispatch({ type: 'TEXT_RECEIVED', phone: m.phone, text: m.text, msgId: m.id, at: m.at })));
      safe(() => ports.call.on('ready', (e) => dispatch({ type: 'CALL_READY', callId: e.callId, at: e.at })));
      safe(() => ports.call.on('ended', (e) => dispatch({ type: 'CALL_ENDED', reason: e.reason, at: clock.now() })));
      safe(() => ports.voice.onMouthLevel((level) => { if (!stopped) safe(() => ports.stage.setMouthLevel(level)); }));
      safe(() => ports.voice.onSpeakingChange((speaking) => {
        if (!stopped) { hostSpeaking = speaking; render(); }
      }));
      safe(() => ports.message.start());
      dispatch({ type: 'BOOT', at: clock.now() });
      scheduleTick();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      events.length = 0;
      for (const handle of timers.values()) safe(() => clock.clearTimeout(handle));
      timers.clear();
      safe(() => clock.clearTimeout(tick));
      safe(() => ports.message.stop());
      safe(() => ports.voice.stopSpeaking());
    },
  };
}
