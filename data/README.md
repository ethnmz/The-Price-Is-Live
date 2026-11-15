# data/

## reference-items.json
236 common home and school items (17 categories) with US retail prices, in the `ReferenceItem` shape of docs/DATA_MODEL.md section 4. Prices are new, regular US retail, no sales or bundles. `checkedAt` is 2026-11-14.

### Honesty note (this feeds a number we quote to judges)
**Verified items: 0 of 236.** Nobody fetched a source page while building this file, so every item has `"verified": false`. All prices are regular list prices from the model's knowledge, and the `source` field names the manufacturer or retailer domain where that price is normally published (domain only, not a checked URL). A human should spot-check them. When someone reads a price on the real page, set that item's `verified` to true and update this count.

## heldout-test.json
Written by another task. When present, `npm run check:data` validates it and makes sure no held-out item is on the list.

## Checking
`npm run check:data` validates shape, ids, unique aliases, price range, at least 180 items and 12 categories.
