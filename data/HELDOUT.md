# data/heldout-test.json: the held-out test set

## What it is
40 items (`HeldoutItem`, docs/DATA_MODEL.md section 4) used by `npm run eval` to measure how close the price guesses get on items that are NOT on `data/reference-items.json`. This is the one number we quote to judges, so it has to be honest.

- 20 `similar` items: same kind of thing as a list item, different brand or model (for example Sony WF-1000XM5 earbuds vs the headphones on the list).
- 20 `novel` items: nothing like it on the list (pet, garden, tools, music, automotive, outdoors, luggage, crafts). Two of them (a Moleskine notebook, a Logitech webcam) sit in categories the list does cover.
- 22 of 40 items are in categories the list covers (at least half, as required).
- Prices run from $3.99 to $349.99; 10 items are above $100.
- `text` is written the way a player would text it: lowercase, short, no size padding.

## How it was made
Written by an AI agent from its own knowledge of regular US retail prices, then checked with `npm run check:data` (shape, ids, tier balance, price span, and no overlap with the list by word-overlap and alias match).

## Verified count: **0 of 40**
No source page was fetched while building this file, so every item has `"verified": false`. Each `trueCents` is the regular list price the author is fairly confident of, and `source` is the manufacturer or retailer domain where that price is normally published (domain only, not a checked URL). Treat the prices as rounded estimates; some may be off by a few dollars. A human should open the source page, read the price, fix `trueCents` if needed, set `verified` to true, and update the count here.

## Frozen
This set was written before any prompt tuning and must never be tuned against. Do not look at its items while editing prompts, aliases or the reference list. Fixing a wrong price is allowed (that is correcting the answer key); adding, removing or swapping items after a result has been seen is not. If the set is ever replaced, say so in the report.

## Honest limits (spec 17.3)
- Only 40 items, so the Wilson 95% interval on "within 15%" is wide (roughly plus or minus 15 points). Quote the interval, not just the percentage.
- Prices are unverified and from one author's memory, so the answer key itself carries error.
- Retail prices move; this is a snapshot dated 2026-11-14.
- The items were chosen by hand and are not a random sample of what players will text.
- It measures price accuracy on typed item names, not voice recognition or game quality.
