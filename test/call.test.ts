import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallPort } from '../src/comms/call';
import { ChertError, type ChertClient } from '../src/comms/chert';
import type { LiveKitSession } from '../src/comms/livekit';
import { loadEnv } from '../src/config';

const env = loadEnv({
  LIVEKIT_URL: 'wss://test.invalid', LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: 'test-secret-test-secret-test-secret',
  CHERT_API_KEY: 'k', CHERT_PROJECT_ID: 'p', CHERT_LINE_ID: 'l',
} as NodeJS.ProcessEnv, { readDotenv: false });

function setup(over: Partial<ChertClient> = {}, envOver = {}) {
  const log: string[] = [];
  let up = false;
  let goneCb: (r: string) => void = () => {};
  const tokens: string[] = [];
  let events: { type: string }[] = [];
  let status = { status: 'active', terminal: false, endReason: null as string | null };
  const chert = {
    createCall: vi.fn(async (a: { participantToken: string; idemKey: string }) => {
      log.push('createCall'); tokens.push(a.participantToken); return { callId: `c${tokens.length}` };
    }),
    getCall: vi.fn(async () => status),
    getCallEvents: vi.fn(async () => events),
    endCall: vi.fn(async () => { log.push('endCall'); }),
    ...over,
  } as unknown as ChertClient;
  const connectTokens: string[] = [];
  const session: LiveKitSession = {
    connect: vi.fn(async (_u: string, t: string) => { log.push('connect'); connectTokens.push(t); up = true; }),
    disconnect: vi.fn(async () => { log.push('disconnect'); up = false; }),
    connected: () => up,
    audioSink: { write: vi.fn(async () => {}) },
    videoSink: vi.fn(() => ({ pushFrame: vi.fn() })),
    onRemoteAudio: vi.fn(),
    onDisconnected: (cb) => { goneCb = cb; },
    room: () => 'room',
  };
  const port = createCallPort({ chert, session, env: { ...env, ...envOver }, pollMs: 100, now: () => 42 });
  const ready = vi.fn();
  const ended = vi.fn();
  port.on('ready', ready);
  port.on('ended', ended);
  return {
    port, chert, session, log, ready, ended, tokens, connectTokens,
    setEvents: (e: { type: string }[]) => { events = e; },
    setStatus: (s: Partial<typeof status>) => { status = { ...status, ...s }; },
    drop: () => goneCb('x'),
  };
}
const tick = (ms = 100) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('createCallPort', () => {
  it('steps down from group video to group audio to the main player alone when groups are off', async () => {
    const seen: { phones: string[]; video?: boolean }[] = [];
    const t = setup({
      createCall: vi.fn(async (a: { phones: string[]; video?: boolean }) => {
        seen.push({ phones: a.phones, video: a.video });
        if (a.phones.length >= 2) throw new ChertError('facetime_group_unavailable', 409, 'no groups');
        return { callId: 'solo' };
      }) as unknown as ChertClient['createCall'],
    });
    const { callId } = await t.port.dial(['+12145550101', '+12145550102']);
    expect(callId).toBe('solo');
    expect(seen).toEqual([
      { phones: ['+12145550101', '+12145550102'], video: true },
      { phones: ['+12145550101', '+12145550102'], video: false },
      { phones: ['+12145550101'], video: true },
    ]);
  });

  it('stops at group audio when the line allows audio groups', async () => {
    const t = setup({
      createCall: vi.fn(async (a: { video?: boolean }) => {
        if (a.video) throw new ChertError('facetime_group_unavailable', 409, 'no group video');
        return { callId: 'group-audio' };
      }) as unknown as ChertClient['createCall'],
    });
    expect((await t.port.dial(['+12145550101', '+12145550102'])).callId).toBe('group-audio');
  });

  it('falls back to a group audio call when Chert switches video off', async () => {
    const seen: { phones: string[]; video?: boolean }[] = [];
    const t = setup({
      createCall: vi.fn(async (a: { phones: string[]; video?: boolean }) => {
        seen.push({ phones: a.phones, video: a.video });
        if (a.video) throw new ChertError('outbound_video_disabled', 503, 'video off');
        return { callId: 'audio-group' };
      }) as unknown as ChertClient['createCall'],
    });
    expect((await t.port.dial(['+12145550101', '+12145550102'])).callId).toBe('audio-group');
    expect(seen).toEqual([
      { phones: ['+12145550101', '+12145550102'], video: true },
      { phones: ['+12145550101', '+12145550102'], video: false },
    ]);
  });

  it('with groups and video both off, calls the main player by audio', async () => {
    const seen: { phones: string[]; video?: boolean }[] = [];
    const t = setup({
      createCall: vi.fn(async (a: { phones: string[]; video?: boolean }) => {
        seen.push({ phones: a.phones, video: a.video });
        if (a.video) throw new ChertError('outbound_video_disabled', 503, 'video off');
        if (a.phones.length >= 2) throw new ChertError('facetime_group_unavailable', 409, 'no groups');
        return { callId: 'solo-audio' };
      }) as unknown as ChertClient['createCall'],
    });
    expect((await t.port.dial(['+12145550101', '+12145550102'])).callId).toBe('solo-audio');
    expect(seen.at(-1)).toEqual({ phones: ['+12145550101'], video: false });
    expect(seen.length).toBe(3); // group video, group audio, main audio (main video skipped: video is off)
  });

  it('does not step down for other refusals', async () => {
    const t = setup({
      createCall: vi.fn(async () => { throw new ChertError('recipient_not_verified', 422, 'not verified'); }) as unknown as ChertClient['createCall'],
    });
    await expect(t.port.dial(['+12145550101', '+12145550102'])).rejects.toThrow('not verified');
    expect(t.chert.createCall).toHaveBeenCalledTimes(1);
  });

  it('connects before createCall and readies only after bridge_ready', async () => {
    const t = setup();
    const { callId } = await t.port.dial(['+12145550101']);
    expect(callId).toBe('c1');
    expect(t.log).toEqual(['connect', 'createCall']);
    await tick();
    expect(t.ready).not.toHaveBeenCalled();
    t.setEvents([{ type: 'bridge_ready' }]);
    await tick(); await tick(); await tick();
    expect(t.ready).toHaveBeenCalledTimes(1);
    expect(t.ready).toHaveBeenCalledWith({ callId: 'c1', at: 42 });
  });

  it('uses a fresh bridge token and a new room per dial', async () => {
    const t = setup();
    await t.port.dial(['+12145550101']);
    await t.port.end();
    await t.port.dial(['+12145550101']);
    expect(t.tokens[0]).not.toBe(t.tokens[1]);
    expect(t.connectTokens).toHaveLength(2);
    expect(t.connectTokens[0]).not.toBe(t.connectTokens[1]);
    expect(t.chert.createCall).toHaveBeenCalledTimes(2);
  });

  it('rejects with the human text when createCall fails', async () => {
    const t = setup({
      createCall: vi.fn(async () => { throw new ChertError('line_busy', 409, 'The line is busy with another call right now.'); }),
    });
    await expect(t.port.dial(['+12145550101'])).rejects.toThrow('The line is busy');
    await tick(500);
    expect(t.chert.getCall).not.toHaveBeenCalled();
  });

  it('emits ended once on a terminal status and disconnects', async () => {
    const t = setup();
    await t.port.dial(['+12145550101']);
    t.setStatus({ status: 'ended', terminal: true, endReason: 'hangup' });
    await tick(); await tick(); await tick();
    expect(t.ended).toHaveBeenCalledTimes(1);
    expect(t.ended).toHaveBeenCalledWith({ reason: 'hangup' });
    expect(t.session.disconnect).toHaveBeenCalled();
    await t.port.end();
    expect(t.ended).toHaveBeenCalledTimes(1);
  });

  it('end() then dial() works, and end() emits agent_end once', async () => {
    const t = setup();
    await t.port.dial(['+12145550101']);
    await t.port.end();
    await t.port.end();
    expect(t.ended).toHaveBeenCalledTimes(1);
    expect(t.ended).toHaveBeenCalledWith({ reason: 'agent_end' });
    expect(t.chert.endCall).toHaveBeenCalledTimes(1);
    await expect(t.port.dial(['+12145550101'])).resolves.toEqual({ callId: 'c2' });
  });

  it('end() with no call is safe', async () => {
    const t = setup();
    await t.port.end();
    expect(t.ended).not.toHaveBeenCalled();
  });

  it('ignores endCall errors', async () => {
    const t = setup({ endCall: vi.fn(async () => { throw new Error('boom'); }) });
    await t.port.dial(['+12145550101']);
    await expect(t.port.end()).resolves.toBeUndefined();
    expect(t.ended).toHaveBeenCalledTimes(1);
  });

  it('room disconnect emits ended once', async () => {
    const t = setup();
    await t.port.dial(['+12145550101']);
    t.drop(); t.drop();
    expect(t.ended).toHaveBeenCalledTimes(1);
    expect(t.ended).toHaveBeenCalledWith({ reason: 'room_disconnected' });
    await t.port.end();
    expect(t.ended).toHaveBeenCalledTimes(1);
  });

  it('keeps polling through errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const t = setup({
      getCallEvents: vi.fn(async () => { if (n++ === 0) throw new Error('net'); return [{ type: 'bridge_ready' }]; }),
    });
    await t.port.dial(['+12145550101']);
    await tick(); await tick(); await tick();
    expect(t.ready).toHaveBeenCalledTimes(1);
  });

  it('rejects clearly when env is missing', async () => {
    const t = setup({}, { chertApiKey: '' });
    await expect(t.port.dial(['+12145550101'])).rejects.toThrow('CHERT_API_KEY');
  });

  it('exposes stable sinks and a null caller frame list', async () => {
    const t = setup();
    expect(t.port.audioSink()).toBe(t.port.audioSink());
    t.port.videoSink().pushFrame(new Uint8Array(4), 1, 1);
    expect(t.session.videoSink).toHaveBeenCalledWith(env.stageW, env.stageH);
    expect(await t.port.latestCallerFrames(3)).toBeNull();
    expect(t.port.roomHandle()).toBe('room');
  });
});
