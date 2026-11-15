// Turns cents into the plain words the host says back to the players.
// 2500 -> "twenty-five dollars", 1299 -> "twelve dollars and ninety-nine cents".
import type { Cents } from '../contracts';

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0..99 -> "twenty-five" */
function under100(n: number): string {
  if (n < 20) return ONES[n];
  const ones = n % 10;
  return ones === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]}-${ONES[ones]}`;
}

/** 1..999 -> "one hundred fifty" */
function under1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} hundred`);
  if (rest > 0) parts.push(under100(rest));
  return parts.join(' ');
}

/** Whole number -> words, up to the millions (plenty for the $99,999 cap). */
function wholeNumber(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (millions > 0) parts.push(`${under1000(millions)} million`);
  if (thousands > 0) parts.push(`${under1000(thousands)} thousand`);
  if (rest > 0) parts.push(under1000(rest));
  return parts.join(' ');
}

export function spokenAmount(cents: Cents): string {
  const total = Math.max(0, Math.round(cents));
  const dollars = Math.floor(total / 100);
  const rem = total % 100;
  const dollarText = `${wholeNumber(dollars)} ${dollars === 1 ? 'dollar' : 'dollars'}`;
  const centText = `${under100(rem)} ${rem === 1 ? 'cent' : 'cents'}`;
  if (rem === 0) return dollarText;
  if (dollars === 0) return centText;
  return `${dollarText} and ${centText}`;
}
