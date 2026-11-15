// Mints the LiveKit JWT that the Chert bridge uses to join our room (docs/API.md section 6).
// TO VERIFY ON THE REAL LINE: Chert accepts this token (roomJoin + publish + subscribe) and the bridge identity differs from the agent identity.
import { AccessToken } from 'livekit-server-sdk';

export const DEFAULT_TTL_SEC = 3600;
export const MAX_TTL_SEC = 7200;

export async function mintToken(a: {
  apiKey: string;
  apiSecret: string;
  room: string;
  identity: string;
  ttlSec?: number;
}): Promise<string> {
  const ttl = a.ttlSec ?? DEFAULT_TTL_SEC;
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_TTL_SEC) {
    throw new Error(`token ttl must be between 1 and ${MAX_TTL_SEC} seconds`);
  }
  const at = new AccessToken(a.apiKey, a.apiSecret, { identity: a.identity, ttl });
  at.addGrant({ roomJoin: true, room: a.room, canPublish: true, canSubscribe: true });
  return at.toJwt();
}
