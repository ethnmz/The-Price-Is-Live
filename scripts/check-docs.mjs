// Small one-shot checks for the writing tasks. Usage: node scripts/check-docs.mjs <devpost|readme|measured|docker>
// Planner-owned: do not edit in a task.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2];
const read = (f) => {
  if (!existsSync(f)) fail(`${f} does not exist`);
  return readFileSync(f, 'utf8');
};
function fail(msg) {
  console.error(`check-docs ${mode}: ${msg}`);
  process.exit(1);
}

/** A real eval run exists: results.json is present and not marked as a mock. */
function realEval() {
  if (!existsSync('eval/results.json')) return false;
  try {
    const r = JSON.parse(readFileSync('eval/results.json', 'utf8'));
    return r && r.mock !== true;
  } catch {
    return false;
  }
}

if (mode === 'devpost') {
  const d = read('docs/devpost.md');
  const p = read('docs/pitch.md');
  if (d.length < 1500) fail('docs/devpost.md is too short');
  if (p.length < 800) fail('docs/pitch.md is too short');
  for (const w of ['Chert', 'ElevenLabs', 'Gemini', 'MongoDB Atlas', 'Best Use of FaceTime']) {
    if (!d.includes(w)) fail(`docs/devpost.md does not mention "${w}"`);
  }
  if (!realEval() && !d.includes('{X}')) fail('no real eval run yet: the {N} {X} {Y} placeholders must stay in docs/devpost.md');
} else if (mode === 'readme') {
  const t = read('README.md');
  for (const h of ['How we use Chert', 'How we use ElevenLabs', 'How we use Gemini', 'How we use MongoDB Atlas']) {
    if (!t.includes(h)) fail(`README.md is missing the section "${h}"`);
  }
  if (/TODO/.test(t)) fail('README.md still has a TODO');
  const links = [...t.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const broken = links
    .filter((l) => !/^(https?:|#|mailto:)/.test(l))
    .map((l) => l.split('#')[0])
    .filter((l) => l && !l.startsWith('docs/img/') && !existsSync(resolve(l)));
  if (broken.length) fail(`README.md links to files that do not exist: ${broken.join(', ')}`);
} else if (mode === 'measured') {
  const m = read('docs/measured-number.md');
  const d = read('docs/devpost.md');
  if (m.length < 400) fail('docs/measured-number.md is too short');
  if (realEval() && d.includes('{X}')) fail('a real eval run exists but docs/devpost.md still has placeholders');
  if (!realEval() && !d.includes('{X}')) fail('there is no real eval run: do not fill the placeholders with made-up numbers');
} else if (mode === 'docker') {
  const d = read('Dockerfile');
  if (!/FROM node:22/.test(d) || !/npm ci/.test(d)) fail('Dockerfile must start from node:22 and run npm ci');
  if (!read('.dockerignore').includes('node_modules')) fail('.dockerignore must list node_modules');
} else {
  fail('unknown mode');
}
console.log(`check-docs ${mode} OK`);
