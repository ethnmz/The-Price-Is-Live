// Chip Dollar's offline script bank (SPEC 12.1 and 12.2).
// TO VERIFY ON THE REAL LINE: Check pacing and pronunciation with the selected TTS voice.
import pino from 'pino';
import type { HostLineKey } from '../../contracts/hostLines';
import type { HostPort } from '../../contracts/ports';

const log = pino({ name: 'host-lines' });

export const LINE_BANK: Record<HostLineKey, string[]> = {
  'connect.hello': ["Hello, hello, HELLO! Welcome to THE PRICE IS LIVE! I'm your host, Chip Dollar!", "Ladies and gentlemen, the lights are up and the cameras are rolling! I'm Chip Dollar!"],
  'lobby.waiting': ["I only see {n} of you so far. Text me 'I'm in' and your name!", "Waiting on contestants! Text this number 'I'm in', then your name!"],
  'lobby.joined': ['Welcome to the show, {name}!', '{name} just walked on stage! Give it up!'],
  'lobby.nameask': ["Who's our first player? Say your name!", 'Next contestant, say your name!'],
  'lobby.giveup': ['Looks like we need at least two players. Come back with a friend and we will play!', 'Bring a friend along, and we can get this show rolling!'],
  'rules.full': ["Here's how it works. Everyone brings one item from home. Guess the price, closest without going over wins! Go over, and you get zero!", 'Bring an item, guess each price, and stay under to score; the closest guess wins!'],
  'rules.short': ['One item each. Closest without going over wins!', 'Bring your item and your best guess; closest without going over takes the round!'],
  'round.start': ["Round {n}! {owner}, you're up with a mystery item!", "It's round {n}! Come on down, {owner}!"],
  'round.nextprompt': ["{next}, text me your item, you're next!", 'Get your item texted in, {next}!'],
  'item.pricing': ['Let me check the price tag on that one...', 'One moment, flipping through my big book of prices...'],
  'item.camera': ["I didn't get your text, {owner}! Hold it up close and fill the screen.", '{owner}, bring that mystery item close to the camera!'],
  'item.ask': ['What is it, in a few words?', 'Give me a quick name for that mystery item!'],
  'item.propcloset': ["No worries! I'll grab something from my prop closet.", 'Time for a surprise from the prop closet!'],
  'item.holdup': ['{owner}, hold that item up high so everyone can see it!', 'Show it off, {owner}! Nice and close to the camera!'],
  'item.quip': ["Oh, that's a fancy one!", 'I have a feeling about this one.', 'Interesting choice, {owner}!'],
  'guess.prompt': ["{name}, what's your guess?", '{name}, how much? Go!', '{name}, your price, please!'],
  'guess.quiet': ['Everyone else, zip it!', 'Quiet on the stage; let our contestant take the spotlight!'],
  'guess.nudge': ['Take a swing, {name}! Any number!', '{name}, give it your best guess!'],
  'guess.huh': ['That number was too wild for me. Try again, {name}!', '{name}, say that guess once more for me!'],
  'guess.confirm': ['{amount}. Right?', 'I heard {amount}. Is that right?', '{amount}, yes?'],
  'guess.locked': ['Locked in!', 'You got it!', 'Done and done!'],
  'guess.silent': ["Time's up! Zero for {name}. Ouch!", 'Tick tock! No guess, no points, {name}!'],
  'guess.textack': ['Got your text, {name}. {amount}!', '{name}, your text is locked in at {amount}!'],
  'guess.textmode': ['Having trouble hearing you! Text me your guesses instead!', 'Let your thumbs do the talking; text me your guesses!'],
  'reveal.drumroll': ['And the real price is... drumroll, please!', "Let's see what the price tag says!"],
  'reveal.price': ['{price}!'],
  'reveal.estimate': ["That's my best estimate!", 'That price is my best estimate!'],
  'score.winner': ['{winner} wins the round! Plus twenty-five bonus points!', "Closest without going over, it's {winner}!"],
  'score.tie': ['A tie! {winner} and {winner2} both get the bonus!', '{winner} and {winner2}, share the spotlight and the round bonus!'],
  'score.allover': ["Everybody went over! Lowest guess wins, so it's {winner}!", '{winner} takes the round with the lowest guess; everyone went over!'],
  'score.nowinner': ['No winner this round! Nobody guessed!', 'No guesses this round, so the bonus stays backstage!'],
  'score.stump': ['{owner} stumped the crowd for {n} stump points!', '{owner} fooled them! {n} stump points!'],
  'score.stumplow': ['{owner} got {n} stump points. Tough crowd!', '{n} stump points for {owner}; this crowd knows its stuff!'],
  'finale.drumroll': ["That's the game! Drumroll for the final scoreboard!", 'The guesses are in; give that final scoreboard a drumroll!'],
  'finale.champion': ['Your champion is... {winner}! What a show!', '{winner} takes the crown! Give our champion a big hand!'],
  'finale.cochamps': ["It's a tie! {winner} and {winner2} share the crown!", 'Make room for co-champions {winner} and {winner2}!'],
  'finale.shortcap': ["We're out of time! Here's the scoreboard so far!", "Time for the final scoreboard; let's see where everyone landed!"],
  'finale.thanks': ['Check your texts for the results and every real price.', 'Your results and every real price are waiting in your texts!'],
  'rematch.offer': ['Want a rematch? Say rematch, or text me REMATCH!', 'Ready for another show? Say rematch or text me REMATCH!'],
  'end.bye': ['Thanks for playing THE PRICE IS LIVE! See you next time!', 'This is Chip Dollar signing off; thanks for a wonderful show!'],
};

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
      const count = variants.length - (last !== undefined && variants.length > 1 ? 1 : 0);
      const random = rng();
      const unit = Number.isFinite(random) ? Math.max(0, Math.min(random, 1 - Number.EPSILON)) : 0;
      let index = Math.floor(unit * count);
      if (last !== undefined && variants.length > 1 && index >= last) index++;
      previous.set(key, index);
      return variants[index].replace(/\{([^{}]+)\}/g, (_placeholder, name: string) => {
        if (Object.hasOwn(vars, name) && vars[name] != null) return String(vars[name]).replace(/[{}]/g, '');
        log.warn({ key, variable: name }, 'Missing host line variable');
        return '';
      }).replace(/\s+/g, ' ').trim();
    },
    quip: opts.quip ?? (async () => null),
  };
}
