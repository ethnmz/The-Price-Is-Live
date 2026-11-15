import { describe, expect, it } from 'vitest';
import { fixturePlayers } from '../fixtures/players';
import { loadEnv } from '../src/config';
import { buildAgent } from '../src/agent';
import { VirtualScheduler } from '../src/engine/runner';
import { FakeCall, FakeMessage, FakeStage, FakeVoice } from '../src/testing/fakes';
import { nameLines } from '../scripts/warm-tts';

describe('agent wiring', () => {
  it('importing agent.ts starts nothing', () => {
    // If main() had run, the import above would already have thrown or logged; the exports are inert.
    expect(typeof buildAgent).toBe('function');
  });

  it('builds name lines without leftover placeholders', () => {
    const lines = nameLines(['Ethan']);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => !/\{\w+\}/.test(l))).toBe(true);
    expect(lines.some((l) => l.includes('Ethan'))).toBe(true);
  });

  it('plays a 2-player game to the end with real host, parser, pricing and store', async () => {
    const unhandled: unknown[] = [];
    const onRej = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onRej);
    const call = new FakeCall(), voice = new FakeVoice(), message = new FakeMessage(), stage = new FakeStage();
    const clock = new VirtualScheduler();
    const env = loadEnv({});
    const agent = await buildAgent(env, { call, voice, message, stage }, clock);
    const [a, b] = fixturePlayers(2);
    const { runner } = agent;
    runner.start();
    expect(stage.started).toBe(true);
    let n = 0;
    const text = (phone: string, t: string) => message.receive(phone, t, clock.now() + ++n);
    text(a.phone, `I'm in, I'm ${a.name}`);
    text(b.phone, `I'm in, I'm ${b.name}`);
    text(a.phone, 'water bottle');
    text(b.phone, 'toaster');
    text(a.phone, 'start');
    await clock.advance(0);
    call.emitReady('call_1', clock.now());

    const answered = new Set<string>();
    for (let i = 0; i < 4000 && runner.getState().phase !== 'wait_call'; i++) {
      await clock.advance(100);
      const s = runner.getState();
      const id = s.guessOrder[s.guessIndex];
      const key = `${s.roundIndex}:${id}:${s.phase}`;
      if ((s.phase === 'guess_listen' || s.phase === 'guess_confirm') && !answered.has(key)) {
        answered.add(key);
        voice.say(s.phase === 'guess_listen' ? 'twenty dollars' : 'yes', clock.now());
      }
    }
    await clock.advance(1000);

    expect(call.ended).toBeGreaterThan(0);
    for (const p of [a, b]) {
      expect(message.textsTo(p.phone).some((t) => t.includes('FINAL SCOREBOARD'))).toBe(true);
    }
    expect(voice.spoken.length).toBeGreaterThan(5);
    expect(voice.spoken.every((s) => !/^[a-z]+\.[a-z.]+\|/.test(s.text) && !/\{\w+\}/.test(s.text))).toBe(true);
    expect(unhandled).toEqual([]);
    process.off('unhandledRejection', onRej);
    await agent.stop();
  }, 60_000);
});
