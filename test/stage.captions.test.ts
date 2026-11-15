import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { registerFonts } from '../src/stage/fonts';
import { wrapCaption, fitCaption, drawCaption, captionWordsVisible } from '../src/stage/captions';
import { LAYOUT, STAGE, CAPTION } from '../src/stage/theme';

registerFonts();

const NAME = 'Maximilliano';
const AMOUNT = 'one thousand two hundred dollars and ninety-nine cents';
const fill = (s: string) => s.replace(/\{(name|owner|next|winner|winner2)\}/g, NAME).replace(/\{(amount|price)\}/g, AMOUNT).replace(/\{item\}/g, 'Stanley Quencher').replace(/\{n\}/g, '3');

// Every line of the section 12.2 bank (variants as plain text).
const BANK = [
  "Hello, hello, HELLO! Welcome to THE PRICE IS LIVE! I'm your host, Chip Dollar!",
  "Ladies and gentlemen, the lights are up and the cameras are rolling! I'm Chip Dollar!",
  "I only see {n} of you so far. Text me 'I'm in' and your name!",
  "Waiting on contestants! Text this number 'I'm in', then your name!",
  'Welcome to the show, {name}!', '{name} just walked on stage! Give it up!',
  "Who's our first player? Say your name!", 'Next contestant, say your name!',
  'Looks like we need at least two players. Come back with a friend and we will play!',
  "Here's how it works. Everyone brings one item from home. Guess the price, closest without going over wins! Go over, and you get zero!",
  'One item each. Closest without going over wins!',
  "Round {n}! {owner}, you're up with a mystery item!", "It's round {n}! Come on down, {owner}!",
  "{next}, text me your item, you're next!", 'Get your item texted in, {next}!',
  'Let me check the price tag on that one...', 'One moment, flipping through my big book of prices...',
  "I didn't get your text, {owner}! Hold it up close and fill the screen.",
  'What is it, in a few words?', "No worries! I'll grab something from my prop closet.",
  '{owner}, hold that item up high so everyone can see it!', 'Show it off, {owner}! Nice and close to the camera!',
  "Oh, that's a fancy one!", 'I have a feeling about this one.', 'Interesting choice, {owner}!',
  "{name}, what's your guess?", '{name}, how much? Go!', '{name}, your price, please!',
  'Everyone else, zip it!', 'Take a swing, {name}! Any number!',
  'That number was too wild for me. Try again, {name}!',
  '{amount}. Right?', 'I heard {amount}. Is that right?', '{amount}, yes?',
  'Locked in!', 'You got it!', 'Done and done!',
  "Time's up! Zero for {name}. Ouch!", 'Tick tock! No guess, no points, {name}!',
  'Got your text, {name}. {amount}!', 'Having trouble hearing you! Text me your guesses instead!',
  'And the real price is... drumroll, please!', "Let's see what the price tag says!",
  '{price}! That\'s my best estimate!',
  '{winner} wins the round! Plus twenty-five bonus points!', "Closest without going over, it's {winner}!",
  'A tie! {winner} and {winner2} both get the bonus!',
  "Everybody went over! Lowest guess wins, so it's {winner}!", 'No winner this round! Nobody guessed!',
  '{owner} stumped the crowd for {n} stump points!', '{owner} fooled them! {n} stump points!',
  '{owner} got {n} stump points. Tough crowd!',
  "That's the game! Drumroll for the final scoreboard!", 'Your champion is... {winner}! What a show!',
  "It's a tie! {winner} and {winner2} share the crown!", "We're out of time! Here's the scoreboard so far!",
  'Check your texts for the results and every real price.', 'Want a rematch? Say rematch, or text me REMATCH!',
  'Thanks for playing THE PRICE IS LIVE! See you next time!',
];

const ctx = () => createCanvas(STAGE.w, STAGE.h).getContext('2d');

describe('wrapCaption', () => {
  const m = (s: string) => s.length * 10;
  it('wraps greedily', () => {
    expect(wrapCaption('aa bb cc dd', m, 50)).toEqual(['aa bb', 'cc dd']);
  });
  it('splits a word wider than the line', () => {
    const lines = wrapCaption('abcdefghij', m, 40);
    expect(lines.join('')).toBe('abcdefghij');
    for (const l of lines) expect(m(l)).toBeLessThanOrEqual(40);
  });
  it('returns nothing for empty text', () => {
    expect(wrapCaption('  ', m, 50)).toEqual([]);
  });
});

describe('fitCaption', () => {
  it('fits every bank line in 2 lines at >= 20 px', () => {
    const c = ctx();
    for (const raw of BANK) {
      const { lines, fontPx } = fitCaption(c, fill(raw));
      expect(lines.length, raw).toBeLessThanOrEqual(CAPTION.maxLines);
      expect(fontPx, raw).toBeGreaterThanOrEqual(20);
      expect(fontPx).toBeLessThanOrEqual(CAPTION.fontPx);
      expect(lines.join(' ')).not.toContain('…');
    }
  });
  it('keeps short text at 28 px', () => {
    expect(fitCaption(ctx(), 'Locked in!').fontPx).toBe(28);
  });
  it('cuts with an ellipsis when nothing fits', () => {
    const { lines, fontPx } = fitCaption(ctx(), 'blah '.repeat(80));
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(fontPx).toBe(20);
    expect(lines[lines.length - 1].endsWith('…')).toBe(true);
  });
  it('leaves the context untouched', () => {
    const c = ctx();
    const before = c.font;
    fitCaption(c, 'hello there');
    expect(c.font).toBe(before);
  });
});

describe('captionWordsVisible', () => {
  it('grows with time and reaches all words', () => {
    const t = 'Closest without going over wins!';
    expect(captionWordsVisible(t, 0)).toBe(1);
    const a = captionWordsVisible(t, 600);
    const b = captionWordsVisible(t, 2000);
    expect(b).toBeGreaterThanOrEqual(a);
    expect(a).toBeGreaterThan(1);
    expect(captionWordsVisible(t, 60000)).toBe(5);
  });
});

describe('drawCaption', () => {
  const snap = (c: ReturnType<typeof ctx>) => Buffer.from(c.getImageData(0, 0, STAGE.w, STAGE.h).data.buffer);
  const host = { text: 'Locked in! Nice and close to the camera!', speaker: 'host' as const };

  it('draws nothing for null', () => {
    const c = ctx();
    const before = snap(c);
    drawCaption(c, null, 1000, true);
    expect(snap(c).equals(before)).toBe(true);
  });

  it('draws inside its box only', () => {
    const c = ctx();
    c.fillStyle = '#336699';
    c.fillRect(0, 0, STAGE.w, STAGE.h);
    const before = snap(c);
    drawCaption(c, { text: fill(BANK[9]), speaker: 'host' }, 100000, true);
    const after = snap(c);
    const b = LAYOUT.caption;
    let changedInside = 0;
    for (let y = 0; y < STAGE.h; y++) for (let x = 0; x < STAGE.w; x++) {
      const i = (y * STAGE.w + x) * 4;
      const same = before[i] === after[i] && before[i + 1] === after[i + 1] && before[i + 2] === after[i + 2];
      const inside = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
      if (!inside) expect(same).toBe(true);
      else if (!same) changedInside++;
    }
    expect(changedInside).toBeGreaterThan(1000);
  });

  it('fades out after the hold when not speaking, stays while speaking', () => {
    const c1 = ctx(); const c2 = ctx(); const c3 = ctx();
    const blank = snap(c1);
    const done = 60000;
    drawCaption(c1, host, done, false);
    expect(snap(c1).equals(blank)).toBe(true);
    drawCaption(c2, host, done, true);
    expect(snap(c2).equals(blank)).toBe(false);
    const allShown = 31 * 65; // last word of the sample starts at char 31
    drawCaption(c3, host, allShown + CAPTION.holdMs - 200, false);
    expect(snap(c3).equals(blank)).toBe(false);
  });

  it('draws system captions without the tag (different pixels than host)', () => {
    const a = ctx(); const b = ctx();
    drawCaption(a, host, 100000, true);
    drawCaption(b, { ...host, speaker: 'system' }, 100000, true);
    expect(snap(a).equals(snap(b))).toBe(false);
  });
});
