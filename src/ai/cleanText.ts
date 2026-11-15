/** Pure product-text cleanup. No external services need real-line verification. */
export function cleanItemText(raw: string): { clean: string; rejected: boolean } {
  const clean = raw.toLowerCase().normalize('NFKC')
    .replace(/['’]/g, '')
    // Keep decimal sizes and model numbers, but separate punctuation noise.
    .replace(/[^\p{L}\p{N}\s.]|(?<!\d)\.|\.(?!\d)/gu, ' ')
    .replace(/\b(?:this\s+is|it\s+is|its|i\s+have|my|a|an|the|some)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const offensive = /\b(?:idiot|moron|asshole|bastard|fuck|shit|bitch|nigger|faggot)\b/u;
  return {
    clean,
    rejected: raw.length > 80 || !/\p{L}/u.test(clean)
      || /^(?:nothing|idk)$/.test(clean) || offensive.test(clean),
  };
}
