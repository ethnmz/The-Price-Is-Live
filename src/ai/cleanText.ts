/** Pure text cleanup and a small, conservative prop-closet filter. */
export function cleanItemText(raw: string): { clean: string; rejected: boolean } {
  const clean = raw.toLowerCase().normalize('NFKC')
    .replace(/['’]/gu, '')
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/gu, ' ')
    .replace(/\b(?:this\s+is|its|i\s+have|my|a|an|the|some)\b/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
  const offensive = /\b(?:idiot|moron|asshole|fuck|shit|bitch|nigger|faggot)\b/u;
  return { clean, rejected: raw.length > 80 || !/\p{L}/u.test(clean)
    || /^(?:nothing|idk)$/u.test(clean) || offensive.test(clean) };
}
