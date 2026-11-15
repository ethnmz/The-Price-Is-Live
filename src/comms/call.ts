// CallPort, Plan B: we dial the players out through Chert and meet them in our LiveKit room.
// Spec: SPEC 8.1 Plan B, 3.3, 3.4. One active call per line; a new room for every call.
//
// TO VERIFY ON THE REAL LINE:
// - the Chert event that means "bridge joined" is really named `bridge_ready`
// - a terminal getCall status shows up quickly after the last player hangs up
// - a second dial() right after end() is accepted (the line is free again)
// - latestCallerFrames() returns real JPEGs of the caller (null if no camera frame is fresh)
import { randomBytes } from 'node:crypto';
import type { Env } from '../config.js';
import type { AudioSink, CallPort, VideoSink } from '../contracts/ports.js';
import { ChertError, type ChertClient } from './chert.js';
import type { LiveKitSession } from './livekit.js';
import { mintToken } from './token.js';

const AGENT_IDENTITY = 'host-agent';
const BRIDGE_TTL_SEC = 3600;
const rand = () => randomBytes(6).toString('hex');

export function createCallPort(a: {
  chert: ChertClient;
  session: LiveKitSession;
  env: Env;
  pollMs?: number;
  now?: () => number;
}): CallPort {
  const { chert, session, env } = a;
  const pollMs = a.pollMs ?? 1000;
  const now = a.now ?? Date.now;
  const readyCbs: Array<(e: { callId: string; at: number }) => void> = [];
  const endedCbs: Array<(e: { reason: string }) => void> = [];

  let room = '';
  let callId: string | null = null;
  let endedSent = true; // true while there is no call
  let readySent = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0; // bumps on every dial/end so stale polls do nothing
  let connecting: Promise<void> | null = null;

  function emitEnded(reason: string): void {
    if (endedSent) return;
    endedSent = true;
    for (const cb of endedCbs) {
      try { cb({ reason }); } catch { /* a bad listener must not break the call */ }
    }
  }

  function stopPolling(): void {
    generation++;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function missingEnv(): string[] {
    const need: Array<[string, string]> = [
      ['LIVEKIT_URL', env.livekitUrl], ['LIVEKIT_API_KEY', env.livekitApiKey],
      ['LIVEKIT_API_SECRET', env.livekitApiSecret], ['CHERT_API_KEY', env.chertApiKey],
      ['CHERT_PROJECT_ID', env.chertProjectId], ['CHERT_LINE_ID', env.chertLineId],
    ];
    return need.filter(([, v]) => !v).map(([k]) => k);
  }

  function requireEnv(): void {
    const missing = missingEnv();
    if (missing.length) throw new Error(`Cannot place a call, missing settings: ${missing.join(', ')}`);
  }

  async function doConnect(): Promise<void> {
    if (session.connected()) return;
    requireEnv();
    room = `pil-${rand()}`;
    const token = await mintToken({
      apiKey: env.livekitApiKey, apiSecret: env.livekitApiSecret, room, identity: AGENT_IDENTITY,
    });
    await session.connect(env.livekitUrl, token);
  }

  function connect(): Promise<void> {
    connecting ??= doConnect().finally(() => { connecting = null; });
    return connecting;
  }

  // One poll round: look for bridge_ready, then check the call status.
  async function pollOnce(id: string, gen: number): Promise<void> {
    const live = () => gen === generation;
    if (!readySent) {
      try {
        const events = await chert.getCallEvents(id);
        if (!live()) return;
        if (events.some((e) => e.type === 'bridge_ready') && !readySent) {
          readySent = true;
          const at = now();
          for (const cb of readyCbs) {
            try { cb({ callId: id, at }); } catch { /* ignore */ }
          }
        }
      } catch (err) {
        console.warn('[call] events poll failed, will retry:', (err as Error).message);
      }
    }
    if (!live()) return;
    try {
      const st = await chert.getCall(id);
      if (!live()) return;
      if (st.terminal) {
        stopPolling();
        emitEnded(st.endReason || st.status || 'ended');
        await session.disconnect().catch(() => {});
        return;
      }
    } catch (err) {
      console.warn('[call] status poll failed, will retry:', (err as Error).message);
    }
    if (live()) schedule(id, gen);
  }

  function schedule(id: string, gen: number): void {
    timer = setTimeout(() => { void pollOnce(id, gen); }, pollMs);
  }

  session.onDisconnected(() => {
    if (!callId || endedSent) return;
    stopPolling();
    emitEnded('room_disconnected');
  });

  /** Which kind of call Chert accepted last (for logs and tests). */
  let lastCallKind = '';

  async function dial(phones: string[]): Promise<{ callId: string }> {
    requireEnv();
    if (callId && !endedSent) throw new Error('A call is already active on this line.');
    stopPolling();
    await connect();
    const token = await mintToken({
      apiKey: env.livekitApiKey, apiSecret: env.livekitApiSecret, room,
      identity: `chert-bridge-${rand()}`, ttlSec: BRIDGE_TTL_SEC,
    });
    // Group calling is enabled per line, and group video separately (docs.trychert.com/facetime/group-calls).
    // Try the best call the line allows: group video, then group audio, then the main player alone
    // (one-to-one works on every eligible line; everyone plays around that phone).
    const attempts: { label: string; phones: string[]; video: boolean }[] = phones.length >= 2
      ? [
          { label: 'group video', phones, video: true },
          { label: 'group audio only', phones, video: false },
          { label: 'main player only (video)', phones: [phones[0]], video: true },
          { label: 'main player only (audio)', phones: [phones[0]], video: false },
        ]
      : [
          { label: 'one-to-one video', phones, video: true },
          { label: 'one-to-one audio', phones, video: false },
        ];
    let id = '';
    let videoOff = false;
    let groupOff = false;
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      // Skip kinds of call Chert already said it can't make right now.
      if ((videoOff && a.video) || (groupOff && a.phones.length >= 2)) continue;
      try {
        ({ callId: id } = await chert.createCall({
          phones: a.phones, livekitUrl: env.livekitUrl, participantToken: token,
          agentIdentity: AGENT_IDENTITY, idemKey: `call-${rand()}`, video: a.video,
        }));
        console.warn(`[call] Chert accepted: ${a.label}`);
        lastCallKind = a.label;
        break;
      } catch (err) {
        // Say why Chert refused (code, HTTP status, its message); never numbers or tokens.
        const detail = err instanceof ChertError ? `${err.code} (HTTP ${err.status}) ${err.detail ?? ''}` : (err as Error).message;
        console.warn(`[call] Chert refused ${a.label}: ${detail}`.replace(/\+?\d{10,15}/g, '<phone>'));
        // Only "no groups here" or "video is switched off" are worth a smaller retry; anything else is final.
        const code = err instanceof ChertError ? err.code : '';
        // A refused group *video* call may still allow group audio; a refused audio group means no groups.
        if (code === 'facetime_group_unavailable' && !a.video) groupOff = true;
        if (code === 'outbound_video_disabled') videoOff = true;
        const more = attempts.slice(i + 1).some((n) => !(videoOff && n.video) && !(groupOff && n.phones.length >= 2));
        if ((code === 'facetime_group_unavailable' || code === 'outbound_video_disabled') && more) continue;
        await session.disconnect().catch(() => {});
        if (err instanceof ChertError) throw new Error(err.human);
        throw err;
      }
    }
    callId = id;
    endedSent = false;
    readySent = false;
    schedule(id, ++generation);
    return { callId: id };
  }

  async function end(): Promise<void> {
    const id = callId;
    stopPolling();
    if (id && !endedSent) {
      try { await chert.endCall(id, `end-${rand()}`); } catch { /* the call may be gone already */ }
    }
    callId = null;
    await session.disconnect().catch(() => {});
    emitEnded('agent_end');
  }

  const audio: AudioSink = { write: (pcm, rate) => session.audioSink.write(pcm, rate) };
  let video: VideoSink | null = null;
  const videoStable: VideoSink = {
    pushFrame(rgba, w, h) {
      video ??= session.videoSink(env.stageW, env.stageH);
      video.pushFrame(rgba, w, h);
    },
  };

  return {
    connect,
    dial,
    end,
    on(ev: 'ready' | 'ended', cb: never) {
      if (ev === 'ready') readyCbs.push(cb);
      else endedCbs.push(cb);
    },
    audioSink: () => audio,
    videoSink: () => videoStable,
    onRemoteAudio: (cb) => session.onRemoteAudio(cb),
    latestCallerFrames: async (max) => (session.frames ? session.frames.grab(max) : null),
    roomHandle: () => session.room(),
  } as CallPort;
}
