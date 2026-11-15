// Offline whole-game driver. finalState is the completed finale snapshot, before hangup
// resets the engine for another game; phasesSeen includes the return to wait_call.
// TO VERIFY ON THE REAL LINE: no real integrations are exercised by this simulation.
import { gameConfig } from '../config';
import type { EngineDeps, GameState, Phase, PlayerId, Ports, StageState } from '../contracts';
import { makeFakeDeps, makeFakePorts, type FakePorts } from '../testing/fakes';
import { initialState, reduce } from './reducer';
import { createRunner, VirtualScheduler } from './runner';
import { buildStageState } from './stageState';

export type ScriptedGuess = number | string | { text: string };
export interface ScriptedGameOptions {
  players: { name: string; phone: string }[];
  items: { text: string; priceCents: number }[];
  guesses: Partial<Record<PlayerId, ScriptedGuess>>[];
  demo?: boolean;
  ports?: Partial<Ports>;
  deps?: Partial<EngineDeps>;
  safetyLimitMs?: number;
}

export async function playScriptedGame(opts: ScriptedGameOptions) {
  if (opts.players.length < 2 || opts.players.length > 4) throw new Error('Expected 2 to 4 players');
  const config = { ...gameConfig({ demo: opts.demo }), ...opts.deps?.config };
  const table = Object.fromEntries(opts.items.map((item) => [item.text.trim().toLowerCase(), {
    name: item.text, cents: item.priceCents,
  }]));
  const fakes: FakePorts = makeFakePorts(table);
  const ports: Ports = { ...fakes, ...opts.ports };
  const deps: EngineDeps = { ...makeFakeDeps(config), line: (key, vars) => ports.host.line(key, vars), ...opts.deps };
  const clock = new VirtualScheduler();
  const phasesSeen: Phase[] = [];
  const stageStates: StageState[] = [];
  const resultsCards: { phone: string; text: string }[] = [];
  let finalState: GameState | undefined;
  let ended = false;
  const runner = createRunner({
    ports: {
      ...ports,
      message: {
        send: async (phone, text, idemKey) => {
          if (text.startsWith('🏆 THE PRICE IS LIVE: FINAL SCOREBOARD')) resultsCards.push({ phone, text });
          await ports.message.send(phone, text, idemKey);
        },
        onMessage: (cb) => ports.message.onMessage(cb),
        start: () => ports.message.start(), stop: () => ports.message.stop(),
      },
      call: new Proxy(ports.call, {
        get(target, key) {
          if (key === 'end') return async () => { await target.end(); ended = true; };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
    },
    deps, scheduler: clock, initial: initialState(deps.config),
    reduce: (state, event, d) => {
      const result = reduce(state, event, d);
      if (result.state.phase === 'finale') finalState = structuredClone(result.state);
      return result;
    },
    buildStageState: (state, now, cfg) => {
      const stage = buildStageState(state, now, cfg);
      stageStates.push(stage);
      if (phasesSeen.at(-1) !== state.phase) phasesSeen.push(state.phase);
      return stage;
    },
  });
  let messageId = 0;
  const text = (phone: string, value: string) => runner.dispatch({
    type: 'TEXT_RECEIVED', phone, text: value, msgId: `sim_${++messageId}`, at: clock.now(),
  });
  const say = (value: string) => runner.dispatch({ type: 'SPEECH_FINAL', text: value, confidence: 0.95, at: clock.now() });
  const answered = new Set<string>();
  const confirmed = new Set<string>();
  try {
    runner.start();
    for (const player of opts.players) text(player.phone, `I'm in, I'm ${player.name}`);
    opts.items.forEach((item, i) => { if (opts.players[i]) text(opts.players[i].phone, item.text); });
    text(opts.players[0].phone, 'start');
    await clock.advance(0);
    runner.dispatch({ type: 'CALL_READY', callId: 'sim_call', at: clock.now() });
    const limit = opts.safetyLimitMs ?? 360_000;
    while (clock.now() < limit) {
      await clock.advance(0);
      const state = runner.getState();
      if (ended) {
        runner.dispatch({ type: 'CALL_ENDED', reason: 'script complete', at: clock.now() });
        if (!finalState || runner.getState().phase !== 'wait_call') throw new Error('Simulation ended before finale');
        return { finalState, ports, virtualMs: clock.now(), resultsCards, phasesSeen, stageStates };
      }
      const playerId = state.guessOrder[state.guessIndex];
      const key = `${state.roundIndex}:${playerId}`;
      if (state.phase === 'guess_listen' && !answered.has(key)) {
        answered.add(key);
        const guess = opts.guesses[state.roundIndex]?.[playerId] ?? 'silent';
        if (typeof guess === 'object') {
          const player = state.players.find((p) => p.id === playerId)!;
          text(player.phone, guess.text);
        } else if (guess !== 'silent') say(String(guess));
        continue;
      }
      if (state.phase === 'guess_confirm' && state.pendingGuess && !confirmed.has(key)) {
        confirmed.add(key);
        say('yes');
        continue;
      }
      await clock.advance(100);
    }
    throw new Error(`Simulation safety limit reached in ${runner.getState().phase}`);
  } finally { runner.stop(); }
}
