// Checks data/reference-items.json (and data/heldout-test.json if it exists).
// Run with `npm run check:data`. Exits 1 and lists every problem it finds.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const MIN_ITEMS = 180;
export const MIN_CATEGORIES = 12;
export const DICE_LIMIT = 0.7;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ReferenceSchema = z.object({
  id: z.string().regex(/^ref_\d{4}$/),
  name: z.string().min(3),
  aliases: z.array(z.string().regex(/^[^A-Z]+$/, "aliases must be lowercase").min(1)).min(2).max(4),
  category: z.string().min(1),
  priceCents: z.number().int().min(100).max(100000),
  sizeNote: z.string().optional(),
  source: z.string().min(3),
  checkedAt: date,
  verified: z.boolean(),
});

export const HeldoutSchema = z.object({
  id: z.string().regex(/^held_\d{3}$/),
  text: z.string().min(2),
  trueCents: z.number().int().min(300).max(40000),
  source: z.string().min(3),
  checkedAt: date,
  category: z.string().min(1),
  tier: z.enum(["similar", "novel"]),
  verified: z.boolean(),
});

export type RefItem = z.infer<typeof ReferenceSchema>;
export type HeldItem = z.infer<typeof HeldoutSchema>;

function zodProblems(label: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${label}: ${i.path.join(".")} ${i.message}`);
}

/** Lowercase word tokens of a string. */
export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

/** Dice coefficient over the word sets of two strings (0..1). */
export function dice(a: string, b: string): number {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return (2 * both) / (x.size + y.size);
}

function normText(s: string): string {
  return tokens(s).join(" ");
}

/** Checks the reference list. Returns a list of problems (empty = fine). */
export function checkReference(raw: unknown): string[] {
  const parsed = z.array(ReferenceSchema).safeParse(raw);
  if (!parsed.success) return zodProblems("reference", parsed.error);
  const items = parsed.data;
  const problems: string[] = [];
  if (items.length < MIN_ITEMS) problems.push(`reference: only ${items.length} items, need at least ${MIN_ITEMS}`);
  const ids = new Set<string>();
  const aliasOwner = new Map<string, string>();
  for (const it of items) {
    if (ids.has(it.id)) problems.push(`reference: duplicate id ${it.id}`);
    ids.add(it.id);
    for (const a of it.aliases) {
      const owner = aliasOwner.get(a);
      if (owner) problems.push(`reference: alias "${a}" used by ${owner} and ${it.id}`);
      else aliasOwner.set(a, it.id);
    }
  }
  const cats = new Set(items.map((i) => i.category));
  if (cats.size < MIN_CATEGORIES) problems.push(`reference: only ${cats.size} categories, need at least ${MIN_CATEGORIES}`);
  return problems;
}

/** Checks the held-out set, and that none of it is on the reference list. */
export function checkHeldout(raw: unknown, reference: RefItem[]): string[] {
  const parsed = z.array(HeldoutSchema).safeParse(raw);
  if (!parsed.success) return zodProblems("heldout", parsed.error);
  const items = parsed.data;
  const problems: string[] = [];
  if (items.length < 30 || items.length > 50) problems.push(`heldout: ${items.length} items, need 30 to 50`);
  const ids = new Set<string>();
  for (const it of items) {
    if (ids.has(it.id)) problems.push(`heldout: duplicate id ${it.id}`);
    ids.add(it.id);
  }
  const above100 = items.filter((i) => i.trueCents > 10000).length;
  if (above100 < 5) problems.push(`heldout: only ${above100} items above $100, need at least 5`);
  const similar = items.filter((i) => i.tier === "similar").length;
  const share = items.length ? similar / items.length : 0;
  if (share < 0.35 || share > 0.65) problems.push(`heldout: tiers unbalanced (${similar} similar of ${items.length})`);
  for (const h of items) {
    for (const r of reference) {
      const d = dice(h.text, r.name);
      if (d > DICE_LIMIT) problems.push(`heldout: ${h.id} "${h.text}" overlaps list item ${r.id} "${r.name}" (dice ${d.toFixed(2)})`);
      if (r.aliases.some((a) => a === normText(h.text) || a === h.text.toLowerCase())) {
        problems.push(`heldout: ${h.id} "${h.text}" equals an alias of ${r.id}`);
      }
    }
  }
  return problems;
}

/** Reads the real files under `root` and runs every check. */
export function checkFiles(root: string): string[] {
  const refPath = resolve(root, "data/reference-items.json");
  if (!existsSync(refPath)) return [`missing file ${refPath}`];
  const refRaw: unknown = JSON.parse(readFileSync(refPath, "utf8"));
  const problems = checkReference(refRaw);
  const heldPath = resolve(root, "data/heldout-test.json");
  if (existsSync(heldPath) && problems.length === 0) {
    const reference = z.array(ReferenceSchema).parse(refRaw);
    problems.push(...checkHeldout(JSON.parse(readFileSync(heldPath, "utf8")), reference));
  }
  return problems;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkFiles(resolve(here, ".."));
  if (problems.length > 0) {
    console.error(`check:data found ${problems.length} problem(s):`);
    for (const p of problems) console.error(" - " + p);
    process.exit(1);
  }
  console.log("check:data ok");
}
