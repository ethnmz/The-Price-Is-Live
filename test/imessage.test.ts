import { describe, expect, it, vi } from 'vitest';
import { createMessagePort } from '../src/comms/imessage';

type Msg = { id: string; phone: string; text: string; at: number; inbound: boolean };

function setup() {
  const msgs: Msg[] = [];
  const chert = {
    listMessages: vi.fn(async () => [...msgs]),
    sendMessage: vi.fn(async (_p: string, _t: string, _k: string) => {}),
  };
  let tick: () => void = () => {};
  const clear = vi.fn();
  const port = createMessagePort({
    chert: chert as never,
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: clear,
    now: () => 5,
  });
  const got: unknown[] = [];
  port.onMessage((m) => got.push(m));
  const run = async () => { tick(); await new Promise((r) => setTimeout(r, 0)); };
  return { msgs, chert, port, got, run, clear };
}
const m = (id: string, inbound = true): Msg => ({ id, phone: '+12145550101', text: 'hi ' + id, at: 1, inbound });

describe('imessage port', () => {
  it('does not replay history, emits new inbound once over 100 polls', async () => {
    const s = setup();
    s.msgs.push(m('old'));
    s.port.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.got).toHaveLength(0);
    s.msgs.push(m('new'));
    for (let i = 0; i < 100; i++) await s.run();
    expect(s.got).toEqual([{ id: 'new', phone: '+12145550101', text: 'hi new', at: 1 }]);
  });

  it('ignores outbound messages', async () => {
    const s = setup();
    s.port.start();
    await new Promise((r) => setTimeout(r, 0));
    s.msgs.push(m('out', false));
    await s.run();
    expect(s.got).toHaveLength(0);
  });

  it('keeps polling after a failure and warns after three', async () => {
    const s = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    s.port.start();
    await new Promise((r) => setTimeout(r, 0));
    s.chert.listMessages.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 4; i++) await s.run();
    expect(warn).toHaveBeenCalledTimes(1);
    s.chert.listMessages.mockImplementation(async () => [m('x')]);
    await s.run();
    expect(s.got).toHaveLength(1);
    warn.mockRestore(); log.mockRestore();
  });

  it('retries send once with the same key, then rejects', async () => {
    const s = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    s.chert.sendMessage.mockRejectedValueOnce(new Error('x'));
    await s.port.send('+12145550101', 'yo', 'k1');
    expect(s.chert.sendMessage.mock.calls.map((c) => c[2])).toEqual(['k1', 'k1']);
    s.chert.sendMessage.mockReset();
    s.chert.sendMessage.mockRejectedValue(new Error('dead'));
    await expect(s.port.send('+12145550101', 'yo')).rejects.toThrow('dead');
    expect(s.chert.sendMessage).toHaveBeenCalledTimes(2);
    log.mockRestore(); warn.mockRestore();
  });

  it('cuts long text to 4000 characters and stop clears the timer', async () => {
    const s = setup();
    await s.port.send('+12145550101', 'a'.repeat(5000));
    expect(s.chert.sendMessage.mock.calls[0][1]).toHaveLength(4000);
    s.port.start();
    s.port.stop();
    expect(s.clear).toHaveBeenCalled();
  });
});
