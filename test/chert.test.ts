import { describe, it, expect } from 'vitest';
import { createChertClient, ChertError, matchMasked } from '../src/comms/chert';
import { mintToken } from '../src/comms/token';
import * as fx from '../fixtures/chert';

type Call = { url: string; init: RequestInit };
function fakeFetch(replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('no reply queued');
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const cfg = { apiKey: 'test-key', projectId: 'proj-1', lineId: 'line-1', facetimeBase: 'https://ft.test/v1', appBase: 'https://app.test/v1' };
const mk = (replies: (Response | Error)[]) => {
  const { f, calls } = fakeFetch(replies);
  return { client: createChertClient({ ...cfg, fetch: f }), calls };
};
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const callArgs = { livekitUrl: 'wss://x.test', participantToken: 'jwt', agentIdentity: 'host-agent', idemKey: 'idem-key-1' };

describe('chert client', () => {
  it('reads the real shared-messages shape: data.items with masked senders', async () => {
    // As returned by Chert's shared line on 15 Nov 2026 (numbers made up here).
    const body = { data: { items: [
      { id: 'm3', line_id: 'line-1', direction: 'outbound', state: 'sent', masked_recipient: '•••0101', created_at: '2026-11-15T06:06:16Z', text: 'reply' },
      { id: 'm2', line_id: 'line-1', direction: 'inbound', state: 'received', masked_recipient: '•••0101', created_at: '2026-11-15T06:06:15Z', text: 'start' },
      { id: 'm1', line_id: 'line-1', direction: 'inbound', state: 'received', masked_recipient: '•••9999', created_at: '2026-11-15T06:05:00Z', text: "I'm in, I'm Zed" },
    ] }, request_id: 'r1' };
    const { f } = fakeFetch([json(body)]);
    const client = createChertClient({ ...cfg, roster: ['+12145550101', '+12145550102'], fetch: f });
    const msgs = await client.listMessages();
    expect(msgs.find((m) => m.id === 'm2')).toMatchObject({ phone: '+12145550101', text: 'start', inbound: true });
    expect(msgs.find((m) => m.id === 'm1')).toBeUndefined(); // sender not on the roster: ignored
    expect(msgs.find((m) => m.id === 'm3')).toMatchObject({ inbound: false, phone: '+12145550101' });
  });

  it('matches a masked handle only when exactly one roster number fits', () => {
    expect(matchMasked('•••0101', ['+12145550101', '+12145550102'])).toBe('+12145550101');
    expect(matchMasked('•••01', ['+12145550101', '+13125550101'])).toBeNull(); // ambiguous
    expect(matchMasked('•••0101', [])).toBeNull();
    expect(matchMasked(undefined, ['+12145550101'])).toBeNull();
  });

  it('sends auth headers and idempotency key; group body', async () => {
    const { client, calls } = mk([json(fx.CREATE_CALL_RESPONSE, 201)]);
    const r = await client.createCall({ ...callArgs, phones: ['+12145550101', '+12145550102'] });
    expect(r.callId).toBe('call_abc123');
    expect(calls[0].url).toBe('https://ft.test/v1/calls');
    expect(hdr(calls[0]).Authorization).toBe('Bearer test-key');
    expect(hdr(calls[0])['X-Chert-Project-Id']).toBe('proj-1');
    expect(hdr(calls[0])['Idempotency-Key']).toBe('idem-key-1');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.recipients).toEqual([
      { type: 'phone_number', value: '+12145550101' },
      { type: 'phone_number', value: '+12145550102' },
    ]);
    expect(body).toMatchObject({ mode: 'customer_managed', media: { audio: true, video: true }, remote_participant_identity: 'host-agent', line_id: 'line-1' });
    expect(body.destination).toBeUndefined();
  });

  it('single phone uses destination', async () => {
    const { client, calls } = mk([json(fx.CREATE_CALL_RESPONSE, 201)]);
    await client.createCall({ ...callArgs, phones: ['+12145550101'] });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({ destination: '+12145550101', destination_type: 'phone' });
    expect(body.recipients).toBeUndefined();
  });

  it('GET has no idempotency key; endCall posts {}', async () => {
    const { client, calls } = mk([json(fx.CALL_EVENTS_READY), json({}, 200)]);
    const ev = await client.getCallEvents('call_abc123');
    expect(ev.map((e) => e.type)).toContain('bridge_ready');
    expect(hdr(calls[0])['Idempotency-Key']).toBeUndefined();
    await client.endCall('call_abc123', 'idem-end-1');
    expect(calls[1].url).toBe('https://ft.test/v1/calls/call_abc123/end');
    expect(calls[1].init.body).toBe('{}');
    expect(hdr(calls[1])['Idempotency-Key']).toBe('idem-end-1');
  });

  it('getCall marks terminal statuses', async () => {
    const { client } = mk([json(fx.CALL_STATUS_ENDED), json({ data: { status: 'in_progress' } })]);
    expect(await client.getCall('c')).toEqual({ status: 'ended', terminal: true, endReason: 'remote_hangup' });
    expect(await client.getCall('c')).toMatchObject({ terminal: false, endReason: null });
  });

  it('sendMessage posts to the app base', async () => {
    const { client, calls } = mk([json({ data: {} }, 201)]);
    await client.sendMessage('+12145550101', 'hi', 'idem-msg-1');
    expect(calls[0].url).toBe('https://app.test/v1/shared-messages');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ line_id: 'line-1', recipient: '+12145550101', text: 'hi' });
  });

  it.each([
    ['line_busy', 409, /busy/],
    ['recipient_not_verified', 422, /not verified/],
    ['facetime_group_unavailable', 422, /group/],
    ['shared_contact_limit', 429, /contact limit/],
  ])('maps error code %s', async (code, status, re) => {
    const { client } = mk([json({ error: { code, message: 'x' } }, status)]);
    const err = await client.createCall({ ...callArgs, phones: ['+12145550101'] }).catch((e) => e);
    expect(err).toBeInstanceOf(ChertError);
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err.human).toMatch(re);
  });

  it('maps 401, 403 and unknown errors', async () => {
    const { client } = mk([json({}, 401), json({}, 403), json({ error: { code: 'weird' } }, 500)]);
    const a = await client.listMessages().catch((e) => e);
    const b = await client.listMessages().catch((e) => e);
    const c = await client.listMessages().catch((e) => e);
    expect(a.human).toMatch(/API key/);
    expect(b.human).toMatch(/API key/);
    expect(c.code).toBe('weird');
    expect(c.human).toMatch(/unexpected/);
    expect(a.code).toBe('http_401');
  });

  it('retries a 404 calls request on the other base', async () => {
    const { client, calls } = mk([json({}, 404), json(fx.CREATE_CALL_RESPONSE, 201)]);
    const r = await client.createCall({ ...callArgs, phones: ['+12145550101'] });
    expect(r.callId).toBe('call_abc123');
    expect(calls.map((c) => c.url)).toEqual(['https://ft.test/v1/calls', 'https://app.test/v1/calls']);
  });

  it('network error retries once with the same idempotency key', async () => {
    const { client, calls } = mk([new Error('boom'), json(fx.CREATE_CALL_RESPONSE, 201)]);
    await client.createCall({ ...callArgs, phones: ['+12145550101'] });
    expect(calls).toHaveLength(2);
    expect(hdr(calls[1])['Idempotency-Key']).toBe('idem-key-1');
  });

  it('gives up after a second network error', async () => {
    const { client } = mk([new Error('a'), new Error('b')]);
    const err = await client.endCall('c', 'idem-end-2').catch((e) => e);
    expect(err).toBeInstanceOf(ChertError);
    expect(err.code).toBe('network_error');
  });

  it('listMessages normalizes the fixture', async () => {
    const { client } = mk([json(fx.SHARED_MESSAGES_RESPONSE)]);
    const m = await client.listMessages();
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({ id: 'm3', inbound: false, phone: '+12145550101' });
    expect(m[1]).toMatchObject({ id: 'm2', inbound: true, phone: '+12145550102', text: 'im in its diego' });
    expect(m[2].at).toBe(Date.parse('2026-11-14T23:00:01Z'));
  });

  it('listMessages accepts alternative spellings and skips junk', async () => {
    const { client } = mk([
      json({
        data: [
          { message_id: 7, body: 'hello', from: '2145550103', is_from_me: false, timestamp: 1700000000 },
          { message_id: 8, body: 'sent', handle: '+12145550103', is_from_me: true, sent_at: '2026-11-14T23:00:00Z' },
          { id: 'x' },
          'garbage',
          { id: 'y', text: 'no sender', direction: 'inbound' },
        ],
      }),
    ]);
    const m = await client.listMessages();
    expect(m).toEqual([
      { id: '7', phone: '+12145550103', text: 'hello', at: 1700000000000, inbound: true },
      { id: '8', phone: '+12145550103', text: 'sent', at: Date.parse('2026-11-14T23:00:00Z'), inbound: false },
    ]);
  });
});

function decode(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
}

describe('mintToken', () => {
  it('has identity, room, grants and a short life', async () => {
    const p = decode(await mintToken({ apiKey: 'test-key', apiSecret: 'test-secret-that-is-long-enough-123', room: 'room-1', identity: 'bridge-1' }));
    expect(p.sub).toBe('bridge-1');
    expect(p.video).toMatchObject({ roomJoin: true, room: 'room-1', canPublish: true, canSubscribe: true });
    expect(p.exp - (p.nbf ?? p.iat)).toBeLessThanOrEqual(7200);
    expect(p.exp - (p.nbf ?? p.iat)).toBe(3600);
  });

  it('allows 7200 and rejects more', async () => {
    const base = { apiKey: 'test-key', apiSecret: 'test-secret-that-is-long-enough-123', room: 'r', identity: 'i' };
    const p = decode(await mintToken({ ...base, ttlSec: 7200 }));
    expect(p.exp - (p.nbf ?? p.iat)).toBe(7200);
    await expect(mintToken({ ...base, ttlSec: 7201 })).rejects.toThrow();
  });
});
