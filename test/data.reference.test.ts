import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFiles, checkHeldout, checkReference, dice, type RefItem } from "../scripts/check-data";

const root = resolve(__dirname, "..");
const real: RefItem[] = JSON.parse(readFileSync(resolve(root, "data/reference-items.json"), "utf8"));

describe("real data files", () => {
  it("pass every check", () => {
    expect(checkFiles(root)).toEqual([]);
  });
  it("has no item marked verified without being fetched (honesty count matches README)", () => {
    const n = real.filter((i) => i.verified).length;
    const readme = readFileSync(resolve(root, "data/README.md"), "utf8");
    expect(readme).toContain(`${n} of ${real.length}`);
  });
});

describe("broken copies are caught", () => {
  it("duplicate alias and bad price", () => {
    const bad = structuredClone(real);
    bad[1]!.aliases = [bad[0]!.aliases[0]!, "other"];
    bad[2]!.priceCents = 50;
    const problems = checkReference(bad);
    expect(problems.join("\n")).toMatch(/priceCents/);
    const dup = structuredClone(real);
    dup[1]!.aliases = [dup[0]!.aliases[0]!, "other thing"];
    expect(checkReference(dup).join("\n")).toMatch(/alias/);
  });
  it("too few items, duplicate ids and bad id format", () => {
    expect(checkReference(real.slice(0, 50)).join("\n")).toMatch(/need at least 180/);
    const dupId = structuredClone(real);
    dupId[1]!.id = dupId[0]!.id;
    expect(checkReference(dupId).join("\n")).toMatch(/duplicate id/);
    const badId = structuredClone(real);
    badId[0]!.id = "ref_12";
    expect(checkReference(badId).length).toBeGreaterThan(0);
  });
  it("uppercase alias is rejected", () => {
    const bad = structuredClone(real);
    bad[0]!.aliases = ["Owala", "owala 2"];
    expect(checkReference(bad).length).toBeGreaterThan(0);
  });
});

function held(n: number, over: Partial<Record<string, unknown>> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `held_${String(i + 1).padStart(3, "0")}`,
    text: `zzq widget ${i} gadget${i}`,
    trueCents: i < 6 ? 15000 : 1000,
    source: "example.com",
    checkedAt: "2026-11-14",
    category: "misc",
    tier: i % 2 ? "similar" : "novel",
    verified: false,
    ...over,
  }));
}

describe("held-out checks", () => {
  it("accepts a clean set", () => {
    expect(checkHeldout(held(40), real)).toEqual([]);
  });
  it("rejects wrong size, few expensive, unbalanced tiers", () => {
    expect(checkHeldout(held(10), real).join("\n")).toMatch(/need 30 to 50/);
    expect(checkHeldout(held(40, { trueCents: 1000 }), real).join("\n")).toMatch(/above \$100/);
    expect(checkHeldout(held(40, { tier: "novel" }), real).join("\n")).toMatch(/unbalanced/);
  });
  it("flags overlap with a list item and alias equality", () => {
    const set = held(40);
    set[0]!.text = real[0]!.name;
    set[1]!.text = real[1]!.aliases[0]!;
    const out = checkHeldout(set, real).join("\n");
    expect(out).toContain("held_001");
    expect(out).toMatch(/equals an alias/);
  });
});

describe("dice", () => {
  it("is 1 for same words and 0 for none", () => {
    expect(dice("a b c", "c b a")).toBe(1);
    expect(dice("a b", "c d")).toBe(0);
  });
});
