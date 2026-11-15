import { describe, expect, it } from 'vitest';
import { createLiveKitSession } from '../src/comms/livekit.js';

describe('livekit session while disconnected', () => {
  it('starts disconnected', () => {
    const s = createLiveKitSession();
    expect(s.connected()).toBe(false);
    expect(s.room()).toBeNull();
  });
  it('audioSink.write resolves after about the chunk duration', async () => {
    const s = createLiveKitSession();
    const t0 = Date.now();
    await s.audioSink.write(new Int16Array(2400), 24000); // 100 ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(80);
  });
  it('videoSink().pushFrame does not throw', () => {
    const s = createLiveKitSession();
    expect(() => s.videoSink(4, 2).pushFrame(new Uint8Array(4 * 2 * 4), 4, 2)).not.toThrow();
  });
  it('registers callbacks and disconnects safely', async () => {
    const s = createLiveKitSession();
    s.onRemoteAudio(() => {});
    s.onDisconnected(() => {});
    await expect(s.disconnect()).resolves.toBeUndefined();
  });
});
