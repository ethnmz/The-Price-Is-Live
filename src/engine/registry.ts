// Join registry (docs/SPEC.md 8.1): who is playing, from the "I'm in, I'm {name}" texts.
// Working first version written by the planner. Task T02 hardens it; keep the exported signatures.
import type { Player, PlayerId } from '../contracts/types';
import { PLAYER_IDS } from '../contracts/types';

export const MAX_NAME_LEN = 12;

// "in" must stand alone: "in-ear headphones" and "interesting" are not joins.
const JOIN_RE = /^\s*(?:(?:i\s*'?\s*m|im|i\s+am|we\s*'?\s*re|count me)\s+)?in(?![\p{L}\p{N}]|-[\p{L}\p{N}])/iu;

/** Is this a join text, and what name did they give? name is null when none was given. */
export function parseJoinText(text: string): { isJoin: boolean; name: string | null } {
  text = text.replace(/[\u2018\u2019\u02bc`]/g, "'");
  if (!JOIN_RE.test(text)) return { isJoin: false, name: null };
  let rest = text.replace(JOIN_RE, ' ');
  rest = rest.replace(/\b(?:i\s*['’]?\s*m|im|i\s+am|we\s*'?\s*re|it\s*'?\s*s|its|this is|my name is|name's)\b/gi, ' ');
  rest = rest.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/(^|\s)[-']+|[-']+(\s|$)/g, ' ').trim();
  if (!rest) return { isJoin: true, name: null };
  return { isJoin: true, name: cleanName(rest) };
}

/** Title-case, max 12 characters. */
export function cleanName(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase().replace(/(^|[-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()));
  let name = '';
  for (const w of words) {
    const next = name ? `${name} ${w}` : w;
    if (next.length > MAX_NAME_LEN) break;
    name = next;
  }
  return name || (words[0] ?? '').slice(0, MAX_NAME_LEN);
}

export type JoinOutcome = 'joined' | 'duplicate' | 'renamed' | 'full';

/** Add a player (max 4, first is main). Same phone again = duplicate, or renamed if a new name was given. */
export function addPlayer(
  players: Player[],
  phone: string,
  name: string | null,
  at: number,
  maxPlayers = 4,
): { players: Player[]; outcome: JoinOutcome; player: Player | null } {
  const existing = players.find((p) => p.phone === phone);
  if (existing) {
    if (name && name !== existing.name) {
      const renamed = { ...existing, name };
      return { players: players.map((p) => (p.phone === phone ? renamed : p)), outcome: 'renamed', player: renamed };
    }
    return { players, outcome: 'duplicate', player: existing };
  }
  if (players.length >= maxPlayers) return { players, outcome: 'full', player: null };
  const seat = players.length;
  const player: Player = {
    id: PLAYER_IDS[seat] as PlayerId,
    seat,
    name: name ?? `Player ${seat + 1}`,
    phone,
    isMain: seat === 0,
    score: 0,
    roundWins: 0,
    joinedAt: at,
  };
  return { players: [...players, player], outcome: 'joined', player };
}
