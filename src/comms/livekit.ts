// LiveKit adapter: one room, one audio track (host voice), one video track (host stage).
// The ONLY file in the repo that imports @livekit/rtc-node.
//
// TO VERIFY ON THE REAL LINE:
// - connect() against a real Chert LiveKit room, and that exactly one audio publisher
//   (this participant) shows up in the participant log line.
// - That AudioStream(track, 16000, 1) really returns 16 kHz mono frames (we resample
//   with resample.ts if a frame says otherwise).
// - That the remote track named `facetime-remote-audio` is the one we get subscribed to.
// - That captureFrame backpressure keeps host speech in real time (no drift or gaps).
// - That 960x540 RGBA frames at the stage frame rate are accepted without a backlog.
// - That onDisconnected fires when the phone call ends.
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent,
  TrackKind, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource,
} from '@livekit/rtc-node';
import type { AudioSink, VideoSink } from '../contracts/ports.js';
import { resampleInt16, stereoToMono } from './resample.js';

export interface LiveKitSession {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  connected(): boolean;
  audioSink: AudioSink;
  videoSink(width: number, height: number): VideoSink;
  onRemoteAudio(cb: (pcm16k: Int16Array) => void): void;
  onDisconnected(cb: (reason: string) => void): void;
  room(): unknown;
}

const OUT_RATE = 24000;
const IN_RATE = 16000;
const REMOTE_AUDIO_NAME = 'facetime-remote-audio';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createLiveKitSession(): LiveKitSession {
  let room: Room | null = null;
  let isConnected = false;
  let audioSource: AudioSource | null = null;
  let videoSource: VideoSource | null = null;
  let audioTrack: LocalAudioTrack | null = null;
  let videoTrack: LocalVideoTrack | null = null;
  let connecting: Promise<void> | null = null;
  let videoSize = { width: 960, height: 540 };
  let videoSizeLocked = false;
  const remoteCbs: Array<(pcm: Int16Array) => void> = [];
  const goneCbs: Array<(reason: string) => void> = [];
  let readingSid: string | null = null;
  let readCancel: (() => void) | null = null;

  function emitAudio(pcm: Int16Array): void {
    for (const cb of remoteCbs) {
      try { cb(pcm); } catch { /* a bad listener must not stop the stream */ }
    }
  }

  // Read one remote audio track until it ends. Never throws.
  async function readRemote(track: ConstructorParameters<typeof AudioStream>[0], sid: string): Promise<void> {
    readingSid = sid;
    try {
      const stream = new AudioStream(track, { sampleRate: IN_RATE, numChannels: 1 });
      const reader = stream.getReader();
      readCancel = () => { void reader.cancel().catch(() => {}); };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        let pcm = value.channels > 1 ? stereoToMono(value.data, value.channels) : value.data;
        pcm = resampleInt16(pcm, value.sampleRate, IN_RATE);
        emitAudio(pcm);
      }
    } catch { /* track went away */ }
    if (readingSid === sid) { readingSid = null; readCancel = null; }
  }

  function wireRoom(r: Room): void {
    r.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
      if (track.kind !== TrackKind.KIND_AUDIO) return;
      const preferred = pub.name === REMOTE_AUDIO_NAME;
      // Keep the first remote audio track, unless the preferred one shows up later.
      if (readingSid && !preferred) return;
      if (readingSid && readCancel) readCancel();
      void readRemote(track, pub.sid ?? participant.identity);
    });
    r.on(RoomEvent.TrackUnsubscribed, (_track, pub) => {
      if (pub.sid && pub.sid === readingSid && readCancel) readCancel();
    });
    r.on(RoomEvent.ParticipantDisconnected, () => { /* reads end by themselves */ });
    r.on(RoomEvent.Disconnected, (reason) => {
      isConnected = false;
      for (const cb of goneCbs) {
        try { cb(String(reason)); } catch { /* ignore */ }
      }
    });
  }

  function logRoom(r: Room): void {
    const remotes = [...r.remoteParticipants.values()].map((p) => {
      const tracks = [...p.trackPublications.values()].map((t) => `${t.name ?? '?'}:${t.kind === TrackKind.KIND_AUDIO ? 'audio' : 'video'}`);
      return `${p.identity}[${tracks.join(',')}]`;
    });
    console.log(`[livekit] connected as ${r.localParticipant?.identity ?? '?'}; published: audio + video; remote participants: ${remotes.join(' ') || 'none'}`);
  }

  async function doConnect(url: string, token: string): Promise<void> {
    const r = new Room();
    wireRoom(r);
    await r.connect(url, token, { autoSubscribe: true, dynacast: false });
    room = r;
    audioSource = new AudioSource(OUT_RATE, 1);
    audioTrack = LocalAudioTrack.createAudioTrack('host-audio', audioSource);
    await r.localParticipant!.publishTrack(audioTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    videoSource = new VideoSource(videoSize.width, videoSize.height);
    videoSizeLocked = true;
    videoTrack = LocalVideoTrack.createVideoTrack('host-video', videoSource);
    await r.localParticipant!.publishTrack(videoTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }));
    isConnected = true;
    logRoom(r);
    // Tracks that were already there before we wired up are not announced again.
    for (const p of r.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.kind === TrackKind.KIND_AUDIO && !readingSid) void readRemote(pub.track, pub.sid ?? p.identity);
      }
    }
  }

  const audioSink: AudioSink = {
    async write(pcm, sampleRate) {
      if (pcm.length === 0) return;
      const src = audioSource;
      if (!isConnected || !src) {
        await sleep((pcm.length / sampleRate) * 1000); // stay real time, drop the audio
        return;
      }
      const data = resampleInt16(pcm, sampleRate, OUT_RATE);
      try {
        await src.captureFrame(new AudioFrame(data, OUT_RATE, 1, data.length));
      } catch {
        await sleep((pcm.length / sampleRate) * 1000);
      }
    },
  };

  return {
    connect(url, token) {
      if (isConnected) return Promise.resolve();
      connecting ??= doConnect(url, token).finally(() => { connecting = null; });
      return connecting;
    },
    async disconnect() {
      const r = room;
      const wasConnected = isConnected;
      isConnected = false;
      room = null;
      if (readCancel) readCancel();
      try {
        if (r && wasConnected) {
          for (const t of [audioTrack, videoTrack]) {
            const sid = t?.sid;
            if (sid) await r.localParticipant?.unpublishTrack(sid).catch(() => {});
          }
        }
        await r?.disconnect();
      } catch { /* already gone */ }
      await audioSource?.close().catch(() => {});
      await videoSource?.close().catch(() => {});
      audioSource = videoSource = null;
      audioTrack = videoTrack = null;
      videoSizeLocked = false;
    },
    connected: () => isConnected,
    audioSink,
    videoSink(width, height): VideoSink {
      if (!videoSizeLocked) videoSize = { width, height };
      let busy = false;
      return {
        pushFrame(rgba, w, h) {
          const src = videoSource;
          if (!isConnected || !src || busy) return;
          busy = true;
          try {
            src.captureFrame(new VideoFrame(rgba, w, h, VideoBufferType.RGBA));
          } catch { /* drop the frame */ }
          // captureFrame is synchronous in this SDK, so the next frame may go right away.
          busy = false;
        },
      };
    },
    onRemoteAudio(cb) { remoteCbs.push(cb); },
    onDisconnected(cb) { goneCbs.push(cb); },
    room: () => room,
  };
}
