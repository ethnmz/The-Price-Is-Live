import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeminiClient } from '../src/ai/gemini';
import { createQuipper } from '../src/ai/host/quips';
import { PERSONA } from '../src/ai/host/persona';

function fake(output: string | null, available = true) {
  const text = vi.fn<GeminiClient['text']>().mockResolvedValue(output);
  const client: GeminiClient = { available, text, json: async () => null, grounded: async () => null };
  return { client, text };
}

afterEach(() => vi.useRealTimers());

describe('item quips', () => {
  const good = [
    'That bottle is ready for its closeup!', 'This mug brought its own applause.',
    'That lamp knows how to light up a room.', 'These socks are stepping into the spotlight.',
    'That backpack has a bright future ahead.', 'This kettle is warming up the crowd.',
    'That notebook has a story to tell.', 'This pillow deserves a standing ovation.',
    'Those headphones are tuned for applause.', 'That chair has the best seat tonight.',
    'This toaster is ready to pop on stage.', 'That umbrella has us covered.',
    'This bowl is serving game show energy.', 'That pen is writing its big moment.',
    'This clock has perfect stage timing.', 'That blender is mixing things up.',
    'This candle is glowing with confidence.', 'That suitcase is going places.',
    'This brush is sweeping the crowd away.', 'That plant is growing into a star.',
  ];
  it.each(good)('accepts %s', async output => {
    expect(await createQuipper(fake(output).client)('bottle', 'Alex')).toBe(output);
  });

  it.each(['It has 2 handles.', 'It costs $some.', Array(19).fill('word').join(' '),
    'Great 😀', 'Great 🇺🇸', 'Great ❤️', 'Great #bottle', 'That is STUPID!',
    'What an idiot.', 'You are a loser.', 'Number ٢', '', '   ', '“”'])('rejects %s', async output => {
    expect(await createQuipper(fake(output).client)('bottle', 'Alex')).toBeNull();
  });

  it('strips quotes and sends the specified request and persona', async () => {
    const g = fake('  “That bottle brought its own applause.”  ');
    expect(await createQuipper(g.client)('bottle', 'Alex')).toBe('That bottle brought its own applause.');
    expect(g.text).toHaveBeenCalledWith({ system: PERSONA, timeoutMs: 1500,
      prompt: 'Item: bottle. Owner: Alex. Give one playful one-liner about the item, with no price or number.' });
    expect(await createQuipper(fake(Array(18).fill('word').join(' ')).client)('x', 'y')).not.toBeNull();
  });

  it('makes no calls when unavailable', async () => {
    const g = fake('A cheerful line.', false);
    expect(await createQuipper(g.client)('bottle', 'Alex')).toBeNull();
    expect(g.text).not.toHaveBeenCalled();
  });

  it('returns null for null or failed responses and clears timers', async () => {
    vi.useFakeTimers();
    const g = fake(null);
    expect(await createQuipper(g.client)('x', 'y')).toBeNull();
    g.text.mockRejectedValueOnce(new Error('offline'));
    expect(await createQuipper(g.client)('x', 'y')).toBeNull();
    g.text.mockImplementationOnce(() => { throw new Error('offline'); });
    expect(await createQuipper(g.client)('x', 'y')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out at one and a half seconds even if the client hangs', async () => {
    vi.useFakeTimers();
    const g = fake(null);
    g.text.mockImplementation(() => new Promise(() => {}));
    const result = createQuipper(g.client)('bottle', 'Alex');
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
