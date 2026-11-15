// Chert HTTP client (docs/API.md section 6, SPEC 3.4). Plain fetch, no SDK.
// TO VERIFY ON THE REAL LINE:
// - field names of GET /shared-messages and /calls/{id}/events (parsed tolerantly here)
// - whether the calls endpoints really live on facetimeBase, or need the app base (404 fallback covers it)
// - the Idempotency-Key is honoured on a retried POST
import { z } from 'zod';
import { last4, toE164 } from '../contracts/money';

export class ChertError extends Error {
  code: string;
  status: number;
  human: string;
  constructor(code: string, status: number, human: string) {
    super(`${code} (${status}): ${human}`);
    this.name = 'ChertError';
    this.code = code;
    this.status = status;
    this.human = human;
  }
}

export interface ChertClient {
  createCall(a: { phones: string[]; livekitUrl: string; participantToken: string; agentIdentity: string; idemKey: string }): Promise<{ callId: string }>;
  getCall(callId: string): Promise<{ status: string; terminal: boolean; endReason: string | null }>;
  getCallEvents(callId: string): Promise<{ type: string }[]>;
  endCall(callId: string, idemKey: string): Promise<void>;
  sendMessage(phone: string, text: string, idemKey: string): Promise<void>;
  listMessages(): Promise<{ id: string; phone: string; text: string; at: number; inbound: boolean }[]>;
}

export interface ChertConfig {
  apiKey: string;
  projectId: string;
  lineId: string;
  facetimeBase: string;
  appBase: string;
  /**
   * Players' full numbers (E.164). The shared-line message API hides senders as "•••0101", so an
   * inbound text is matched to the one roster number ending in those digits. From PLAYER_PHONES.
   */
  roster?: string[];
  fetch?: typeof fetch;
}

const HUMAN: Record<string, string> = {
  line_busy: 'The line is busy with another call right now.',
  recipient_not_verified: 'One of the players is not verified on the trial line.',
  facetime_group_unavailable: 'FaceTime group calls are not available right now.',
  shared_contact_limit: 'The line has hit its shared contact limit.',
};

function humanFor(code: string, status: number): string {
  if (HUMAN[code]) return HUMAN[code];
  if (status === 401 || status === 403) return 'Chert rejected the API key or project id.';
  return 'Chert returned an unexpected error.';
}

const TERMINAL = new Set(['ended', 'failed', 'canceled', 'cancelled', 'completed']);

const str = z.union([z.string(), z.number()]).transform(String);
const callIdBody = z.object({ data: z.object({ id: str }) });
const callBody = z.object({
  data: z.object({ status: str.optional(), end_reason: z.string().nullish() }).passthrough(),
});
const eventsBody = z.object({ data: z.array(z.unknown()) });
/** GET /shared-messages answers { data: { items: [...] } }; older shapes used { data: [...] }. */
const messagesBody = z.object({ data: z.union([z.array(z.unknown()), z.object({ items: z.array(z.unknown()) })]) });

/** The roster number whose last digits match a masked handle like "•••0101" (only if exactly one does). */
export function matchMasked(masked: unknown, roster: string[]): string | null {
  if (typeof masked !== 'string') return null;
  const tail = masked.replace(/\D/g, '');
  if (tail.length < 2) return null;
  const hits = roster.filter((p) => p.replace(/\D/g, '').endsWith(tail));
  return hits.length === 1 ? hits[0] : null;
}

function trimBase(b: string): string {
  return b.replace(/\/+$/, '');
}

/** Turn "2026-11-14T23:00:01Z", epoch seconds or epoch ms into ms. */
function toMs(v: unknown): number {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    if (/^\d+(\.\d+)?$/.test(v)) return toMs(Number(v));
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function normalizeMessage(raw: unknown, roster: string[] = []): { id: string; phone: string; text: string; at: number; inbound: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = pick(o, ['id', 'message_id']);
  const text = pick(o, ['text', 'body']);
  if ((typeof id !== 'string' && typeof id !== 'number') || typeof text !== 'string') return null;

  const dir = pick(o, ['direction']);
  const fromMe = pick(o, ['is_from_me']);
  let inbound: boolean;
  if (typeof dir === 'string') inbound = dir.toLowerCase().startsWith('in') || dir.toLowerCase() === 'received';
  else if (typeof fromMe === 'boolean') inbound = !fromMe;
  else inbound = pick(o, ['recipient']) === undefined;

  const who = pick(o, inbound ? ['sender', 'from', 'handle'] : ['recipient', 'to', 'sender', 'from', 'handle']);
  let phone = typeof who === 'string' ? toE164(who) : null;
  if (!phone) phone = matchMasked(pick(o, ['masked_sender', 'masked_handle', 'masked_recipient']), roster);
  if (!phone && inbound) return null; // cannot tell who spoke
  return {
    id: String(id),
    phone: phone ?? '',
    text,
    at: toMs(pick(o, ['created_at', 'timestamp', 'sent_at'])),
    inbound,
  };
}

export function createChertClient(cfg: ChertConfig): ChertClient {
  const doFetch = cfg.fetch ?? fetch;
  const faceBase = trimBase(cfg.facetimeBase);
  const appBase = trimBase(cfg.appBase);

  async function once(method: string, url: string, body: unknown, idemKey?: string): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-Chert-Project-Id': cfg.projectId,
      'Content-Type': 'application/json',
    };
    if (method === 'POST' && idemKey) headers['Idempotency-Key'] = idemKey;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await doFetch(url, init);
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }

  /** One request; a network error is retried once with the same headers (so the same idempotency key). */
  async function send(method: string, url: string, body: unknown, idemKey?: string): Promise<{ status: number; json: unknown }> {
    try {
      return await once(method, url, body, idemKey);
    } catch {
      try {
        return await once(method, url, body, idemKey);
      } catch {
        throw new ChertError('network_error', 0, 'Could not reach Chert.');
      }
    }
  }

  function fail(status: number, json: unknown): never {
    const e = (json as { error?: { code?: unknown } } | null)?.error;
    const code = typeof e?.code === 'string' ? e.code : `http_${status}`;
    throw new ChertError(code, status, humanFor(code, status));
  }

  /** Request a calls endpoint; on 404 try once on the other base URL. */
  async function callsRequest(method: string, path: string, body?: unknown, idemKey?: string): Promise<unknown> {
    let r = await send(method, `${faceBase}${path}`, body, idemKey);
    if (r.status === 404) {
      const other = faceBase === appBase ? null : appBase;
      if (other) r = await send(method, `${other}${path}`, body, idemKey);
    }
    if (r.status < 200 || r.status >= 300) fail(r.status, r.json);
    return r.json;
  }

  async function appRequest(method: string, path: string, body?: unknown, idemKey?: string): Promise<unknown> {
    const r = await send(method, `${appBase}${path}`, body, idemKey);
    if (r.status < 200 || r.status >= 300) fail(r.status, r.json);
    return r.json;
  }

  return {
    async createCall(a) {
      const base = {
        direction: 'outbound',
        mode: 'customer_managed',
        line_id: cfg.lineId,
        media: { audio: true, video: true },
        livekit_url: a.livekitUrl,
        participant_token: a.participantToken,
        remote_participant_identity: a.agentIdentity,
      };
      const who =
        a.phones.length >= 2
          ? { recipients: a.phones.map((p) => ({ type: 'phone_number', value: p })) }
          : { destination: a.phones[0], destination_type: 'phone' };
      const json = await callsRequest('POST', '/calls', { ...base, ...who }, a.idemKey);
      const p = callIdBody.safeParse(json);
      if (!p.success) throw new ChertError('bad_response', 200, 'Chert answered the call request in an unexpected shape.');
      return { callId: p.data.data.id };
    },

    async getCall(callId) {
      const json = await callsRequest('GET', `/calls/${encodeURIComponent(callId)}`);
      const p = callBody.safeParse(json);
      const status = p.success ? (p.data.data.status ?? 'unknown') : 'unknown';
      return {
        status,
        terminal: TERMINAL.has(status.toLowerCase()),
        endReason: p.success ? (p.data.data.end_reason ?? null) : null,
      };
    },

    async getCallEvents(callId) {
      const json = await callsRequest('GET', `/calls/${encodeURIComponent(callId)}/events`);
      const p = eventsBody.safeParse(json);
      if (!p.success) return [];
      const out: { type: string }[] = [];
      for (const e of p.data.data) {
        const t = e && typeof e === 'object' ? pick(e as Record<string, unknown>, ['type', 'event', 'name']) : undefined;
        if (typeof t === 'string') out.push({ type: t });
      }
      return out;
    },

    async endCall(callId, idemKey) {
      await callsRequest('POST', `/calls/${encodeURIComponent(callId)}/end`, {}, idemKey);
    },

    async sendMessage(phone, text, idemKey) {
      // Never log the full phone: only last4 is safe to show.
      try {
        await appRequest('POST', '/shared-messages', { line_id: cfg.lineId, recipient: phone, text }, idemKey);
      } catch (err) {
        if (err instanceof ChertError) err.message = `${err.message} [to ...${last4(phone)}]`;
        throw err;
      }
    },

    async listMessages() {
      const json = await appRequest('GET', '/shared-messages');
      const p = messagesBody.safeParse(json);
      if (!p.success) return [];
      const list = Array.isArray(p.data.data) ? p.data.data : p.data.data.items;
      const out = [];
      for (const raw of list) {
        const m = normalizeMessage(raw, cfg.roster ?? []);
        if (m) out.push(m);
      }
      return out;
    },
  };
}
