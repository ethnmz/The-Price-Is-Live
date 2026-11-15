/**
 * iMessage MessagePort on top of the Chert client (trial iMessage, spec §3.4, task D6).
 *
 * TO VERIFY ON THE REAL LINE:
 *  - listMessages() returns the newest messages and flags `inbound` correctly.
 *  - Chert honours the idempotency key on sendMessage (so the retry never double-texts).
 */
import { randomUUID } from 'node:crypto';
import type { InboundMessage, MessagePort } from '../contracts/ports';
import type { ChertClient } from './chert';

export interface MessagePortOptions {
  chert: ChertClient;
  pollMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (t: unknown) => void;
  now?: () => number;
}

const MAX_TEXT = 4000;
const MAX_SEEN = 2000;

function last4(phone: string): string {
  return phone.slice(-4);
}

export function createMessagePort(opts: MessagePortOptions): MessagePort {
  const { chert, pollMs = 1500 } = opts;
  const setI = opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = opts.clearInterval ?? ((t) => clearInterval(t as ReturnType<typeof setInterval>));
  const now = opts.now ?? Date.now;

  const seen = new Set<string>(); // insertion-ordered, trimmed from the front
  const listeners: ((m: InboundMessage) => void)[] = [];
  let timer: unknown = null;
  let first = true;
  let polling = false;
  let failures = 0;

  function remember(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > MAX_SEEN) {
      const oldest = seen.values().next().value as string;
      seen.delete(oldest);
    }
    return true;
  }

  async function poll(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const msgs = await chert.listMessages();
      failures = 0;
      const wasFirst = first;
      first = false;
      for (const m of msgs) {
        if (!remember(m.id) || wasFirst || !m.inbound) continue;
        const out: InboundMessage = { id: m.id, phone: m.phone, text: m.text, at: m.at || now() };
        for (const cb of listeners) {
          try { cb(out); } catch (e) { console.warn('[imessage] listener threw:', (e as Error).message); }
        }
      }
    } catch (err) {
      failures++;
      console.log(`[imessage] poll failed: ${(err as Error).message}`);
      if (failures === 3) console.warn('[imessage] warning: 3 polls failed in a row');
    } finally {
      polling = false;
    }
  }

  async function send(phone: string, text: string, idemKey?: string): Promise<void> {
    const key = idemKey ?? randomUUID();
    const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
    try {
      await chert.sendMessage(phone, body, key);
    } catch (first) {
      console.log(`[imessage] send to ...${last4(phone)} failed, retrying once`);
      try {
        await chert.sendMessage(phone, body, key);
      } catch (second) {
        console.warn(`[imessage] send to ...${last4(phone)} failed: ${(second as Error).message}`);
        throw second;
      }
    }
  }

  return {
    send,
    onMessage(cb) { listeners.push(cb); },
    start() {
      if (timer !== null) return;
      void poll();
      timer = setI(() => { void poll(); }, pollMs);
    },
    stop() {
      if (timer !== null) clearI(timer);
      timer = null;
    },
  };
}
