import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkHeldout, type HeldItem, type RefItem } from "../scripts/check-data";

const root = resolve(__dirname, "..");
const ref: RefItem[] = JSON.parse(readFileSync(resolve(root, "data/reference-items.json"), "utf8"));
const held: HeldItem[] = JSON.parse(readFileSync(resolve(root, "data/heldout-test.json"), "utf8"));

describe("held-out set", () => {
  it("passes every check, including zero overlap with the list", () => {
    expect(checkHeldout(held, ref)).toEqual([]);
  });
  it("has 40 items and balanced tiers", () => {
    expect(held).toHaveLength(40);
    const similar = held.filter((h) => h.tier === "similar").length;
    expect(similar).toBeGreaterThanOrEqual(18);
    expect(similar).toBeLessThanOrEqual(22);
  });
  it("spans $3 to $400 with at least 5 items above $100", () => {
    const cents = held.map((h) => h.trueCents);
    expect(Math.min(...cents)).toBeLessThanOrEqual(500);
    expect(Math.max(...cents)).toBeGreaterThanOrEqual(30000);
    expect(cents.filter((c) => c > 10000).length).toBeGreaterThanOrEqual(5);
  });
  it("has at least half in categories the list covers", () => {
    const cats = new Set(ref.map((r) => r.category));
    expect(held.filter((h) => cats.has(h.category)).length).toBeGreaterThanOrEqual(20);
  });
  it("HELDOUT.md states the true verified count", () => {
    const n = held.filter((h) => h.verified).length;
    expect(readFileSync(resolve(root, "data/HELDOUT.md"), "utf8")).toContain(`${n} of ${held.length}`);
  });
  it("catches an item copied from the list", () => {
    const bad = [...held, { ...held[0]!, id: "held_099", text: ref[1]!.name }];
    expect(checkHeldout(bad, ref).length).toBeGreaterThan(0);
  });
});
