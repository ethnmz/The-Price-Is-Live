// Sample Chert HTTP bodies, from docs/SPEC.md section 3.4. Use these to mock fetch in tests.
// Shapes marked UNVERIFIED were not confirmed against the real line: parse them tolerantly (zod, optional fields).

export const CREATE_GROUP_CALL_REQUEST = {
  direction: 'outbound',
  mode: 'customer_managed',
  line_id: '00000000-0000-4000-8000-000000000001',
  recipients: [
    { type: 'phone_number', value: '+12145550101' },
    { type: 'phone_number', value: '+12145550102' },
  ],
  media: { audio: true, video: true },
  livekit_url: 'wss://example.livekit.cloud',
  participant_token: '<bridge JWT>',
  remote_participant_identity: 'host-agent',
};

/** HTTP 201: allocated, NOT answered. */
export const CREATE_CALL_RESPONSE = {
  data: { id: 'call_abc123', status: 'allocated' },
  request_id: 'req_1',
};

/** UNVERIFIED shape. GET /v1/calls/{id}/events. Look for an event whose type is "bridge_ready". */
export const CALL_EVENTS_NOT_READY = {
  data: [{ type: 'call.created', created_at: '2026-11-14T23:00:00Z' }],
};
export const CALL_EVENTS_READY = {
  data: [
    { type: 'call.created', created_at: '2026-11-14T23:00:00Z' },
    { type: 'bridge_ready', created_at: '2026-11-14T23:00:06Z' },
  ],
};
/** UNVERIFIED shape. GET /v1/calls/{id}. Terminal statuses: ended, failed, canceled, completed. */
export const CALL_STATUS_ENDED = { data: { id: 'call_abc123', status: 'ended', end_reason: 'remote_hangup' } };

/** Error body. Known codes: line_busy, recipient_not_verified, facetime_group_unavailable, shared_contact_limit. */
export const CALL_ERROR_NOT_VERIFIED = {
  error: { code: 'recipient_not_verified', message: 'One or more recipients are not verified.' },
  request_id: 'req_2',
};

export const SEND_MESSAGE_REQUEST = {
  line_id: '00000000-0000-4000-8000-000000000001',
  recipient: '+12145550101',
  text: "🎉 You're in, Ethan!",
};

/**
 * UNVERIFIED field names. GET /shared-messages returns the newest 50 messages, sent and received.
 * The parser must accept several spellings: id | message_id; text | body; sender | from | handle;
 * direction "inbound"/"outbound" | is_from_me; created_at | timestamp | sent_at.
 */
export const SHARED_MESSAGES_RESPONSE = {
  data: [
    { id: 'm3', direction: 'outbound', recipient: '+12145550101', text: "🎉 You're in, Ethan!", created_at: '2026-11-14T23:00:03Z' },
    { id: 'm2', direction: 'inbound', sender: '(214) 555-0102', text: 'im in its diego', created_at: '2026-11-14T23:00:02Z' },
    { id: 'm1', direction: 'inbound', sender: '+12145550101', text: "I'm in, I'm Ethan", created_at: '2026-11-14T23:00:01Z' },
  ],
};
