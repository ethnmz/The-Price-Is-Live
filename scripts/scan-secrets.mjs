// Fails (exit 1) if a tracked or new file looks like it contains a secret or a real phone number.
// The repo is public. Run with: npm run scan:secrets
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', '.cache', '.relay']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|md|txt|yaml|yml|env|example|sh|html|css)$/i;

const RULES = [
  { name: 'Chert API key', re: /\bftk_[A-Za-z0-9]{16,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: 'ElevenLabs / OpenAI style key', re: /\bsk[-_][A-Za-z0-9_-]{24,}/ },
  { name: 'MongoDB URI with password', re: /mongodb(\+srv)?:\/\/[^\s:/"']+:[^\s@/"'<{]+@/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'LiveKit API secret assignment', re: /LIVEKIT_API_SECRET\s*=\s*[A-Za-z0-9]{20,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // Real-looking US phone numbers. Fake numbers must use the 555-01xx range (e.g. +12145550101).
  { name: 'phone number that is not a 555-01xx fixture', re: /\+1(?!\d{3}55501\d{2})\d{10}\b/ },
];

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (st.size < 2_000_000 && (TEXT_EXT.test(name) || name.startsWith('.env'))) out.push(full);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT, [])) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel === '.env.local' || rel === '.env') continue; // git-ignored local secrets
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push(`${rel}:${i + 1}  ${rule.name}`);
    }
  });
}

if (hits.length > 0) {
  console.error('Possible secrets found (the repo is public; remove them):');
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log('scan:secrets OK');
