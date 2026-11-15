/** Chip Dollar's offline script bank. No live services are needed. */
import pino from 'pino';
import type { HostLineKey, HostPort } from '../../contracts';

const log = pino({ name: 'host-lines' });

export const LINE_BANK: Record<HostLineKey, string[]> = {
  "connect.hello": [
    "Hello, hello, HELLO! Welcome to THE PRICE IS LIVE! I'm your host, Chip Dollar!",
    "Ladies and gentlemen, the lights are up and the cameras are rolling! I'm Chip Dollar!"
  ],
  "lobby.waiting": [
    "I only see {n} of you so far. Text me 'I'm in' and your name!",
    "Waiting on contestants! Text this number 'I'm in', then your name!"
  ],
  "lobby.joined": [
    "Welcome to the show, {name}!",
    "{name} just walked on stage! Give it up!"
  ],
  "lobby.nameask": [
    "Who's our first player? Say your name!",
    "Next contestant, say your name!"
  ],
  "lobby.giveup": [
    "Looks like we need at least two players. Come back with a friend and we will play!",
    "Bring a friend and we can get this show rolling!"
  ],
  "rules.full": [
    "Here's how it works. Everyone brings one item from home. Guess the price, closest without going over wins! Go over, and you get zero!",
    "Bring an item, guess each price, and stay under to win; going over earns zero!"
  ],
  "rules.short": [
    "One item each. Closest without going over wins!",
    "Closest without going over takes the round!"
  ],
  "round.start": [
    "Round {n}! {owner}, you're up with a mystery item!",
    "It's round {n}! Come on down, {owner}!"
  ],
  "round.nextprompt": [
    "{next}, text me your item, you're next!",
    "Get your item texted in, {next}!"
  ],
  "item.pricing": [
    "Let me check the price tag on that one...",
    "One moment, flipping through my big book of prices..."
  ],
  "item.camera": [
    "I didn't get your text, {owner}! Hold it up close and fill the screen.",
    "{owner}, bring your item close to the camera so I can take a look!"
  ],
  "item.ask": [
    "What is it, in a few words?",
    "Tell me what it is in a few words!"
  ],
  "item.propcloset": [
    "No worries! I'll grab something from my prop closet.",
    "The prop closet is open, and your mystery item is ready!"
  ],
  "item.holdup": [
    "{owner}, hold that item up high so everyone can see it!",
    "Show it off, {owner}! Nice and close to the camera!"
  ],
  "item.quip": [
    "Oh, that's a fancy one!",
    "I have a feeling about this one.",
    "Interesting choice, {owner}!"
  ],
  "guess.prompt": [
    "{name}, what's your guess?",
    "{name}, how much? Go!",
    "{name}, your price, please!"
  ],
  "guess.quiet": [
    "Everyone else, zip it!",
    "A little quiet for our contestant, please!"
  ],
  "guess.nudge": [
    "Take a swing, {name}! Any number!",
    "Give it a go, {name}!"
  ],
  "guess.huh": [
    "That number was too wild for me. Try again, {name}!",
    "Let's try that guess again, {name}!"
  ],
  "guess.confirm": [
    "{amount}. Right?",
    "I heard {amount}. Is that right?",
    "{amount}, yes?"
  ],
  "guess.locked": [
    "Locked in!",
    "You got it!",
    "Done and done!"
  ],
  "guess.silent": [
    "Time's up! Zero for {name}. Ouch!",
    "Tick tock! No guess, no points, {name}!"
  ],
  "guess.textack": [
    "Got your text, {name}. {amount}!",
    "Text received, {name}. {amount}!"
  ],
  "guess.textmode": [
    "Having trouble hearing you! Text me your guesses instead!",
    "Text your guesses and we will keep this show rolling!"
  ],
  "reveal.drumroll": [
    "And the real price is... drumroll, please!",
    "Let's see what the price tag says!"
  ],
  "reveal.price": [
    "{price}!"
  ],
  "score.winner": [
    "{winner} wins the round! Plus twenty-five bonus points!",
    "Closest without going over, it's {winner}!"
  ],
  "score.tie": [
    "A tie! {winner} and {winner2} both get the bonus!",
    "{winner} and {winner2} share the round and both get the bonus!"
  ],
  "score.allover": [
    "Everybody went over! Lowest guess wins, so it's {winner}!",
    "{winner} takes it with the lowest guess! Everyone went over!"
  ],
  "score.nowinner": [
    "No winner this round! Nobody guessed!",
    "No guesses this round! On with the show!"
  ],
  "score.stump": [
    "{owner} stumped the crowd for {n} stump points!",
    "{owner} fooled them! {n} stump points!"
  ],
  "finale.drumroll": [
    "That's the game! Drumroll for the final scoreboard!",
    "Bring on the drumroll! Our final scoreboard is ready!"
  ],
  "finale.champion": [
    "Your champion is... {winner}! What a show!",
    "{winner} takes the crown! Give it up!"
  ],
  "finale.cochamps": [
    "It's a tie! {winner} and {winner2} share the crown!",
    "{winner} and {winner2}, our champions! Give them a hand!"
  ],
  "finale.shortcap": [
    "We're out of time! Here's the scoreboard so far!",
    "Time for the final scoreboard! What a show!"
  ],
  "finale.thanks": [
    "Check your texts for the results and every real price.",
    "Your results and all the real prices are waiting in your texts!"
  ],
  "rematch.offer": [
    "Want a rematch? Say rematch, or text me REMATCH!",
    "Ready for another show? Say rematch or text REMATCH!"
  ],
  "end.bye": [
    "Thanks for playing THE PRICE IS LIVE! See you next time!",
    "This is Chip Dollar signing off! Thanks for playing THE PRICE IS LIVE!"
  ],
  "reveal.estimate": [
    "That's my best estimate!",
    "That's my best estimate, folks!"
  ],
  "score.stumplow": [
    "{owner} got {n} stump points. Tough crowd!",
    "{owner} earned {n} stump points. Give it up!"
  ]
};

/** Every fixed line is available to the TTS warm cache. */
export function staticLines(): string[] {
  return Object.values(LINE_BANK).flat().filter(line => !/[{}]/.test(line));
}

export function createHost(opts: { rng?: () => number; quip?: HostPort['quip'] } = {}): HostPort {
  const rng = opts.rng ?? Math.random;
  const previous = new Map<HostLineKey, number>();
  return {
    line(key, vars = {}) {
      const variants = LINE_BANK[key];
      const last = previous.get(key);
      const choices = variants.length - (last === undefined ? 0 : 1);
      // Skip the previous index rather than retrying a potentially constant RNG.
      const draw = rng();
      const unit = Number.isFinite(draw) ? Math.max(0, Math.min(draw, 1 - Number.EPSILON)) : 0;
      let index = choices > 0 ? Math.floor(unit * choices) : 0;
      if (variants.length > 1 && last !== undefined && index >= last) index++;
      previous.set(key, index);
      return variants[index].replace(/\{([^{}]+)\}/g, (_, name: string) => {
        const value = Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
        if (value === undefined || value === null) {
          log.warn({ key, variable: name }, 'Missing host line variable');
          return '';
        }
        return String(value).replace(/[{}]/g, '');
      }).replace(/\s+/g, ' ').trim();
    },
    quip: opts.quip ?? (async () => null),
  };
}
