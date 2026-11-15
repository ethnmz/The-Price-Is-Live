# AI notes (ai lane)

## Where Gemini is used
- `src/ai/webSearch.ts`: Google Search grounding (`gemini.grounded`) for web prices, then a JSON extraction call.
- `src/ai/estimate.ts`: JSON price estimate (`gemini.json`) from the model's own knowledge, with up to 5 list items as calibration examples.
- `src/ai/matchList.ts`: no Gemini. Fuzzy list match; score >= 0.85 without a size conflict is accepted outright.
- `src/ai/pricing.ts`: the game path. List, then web and estimate in parallel, then fallbacks.
- `src/ai/variants.ts`: eval variants. A = estimate only (no examples, list or search). B = list match, else estimate with top 5 matches. C = full pipeline, a fresh `createPricing` per call.
- `src/ai/index.ts`: `createAi(env, { items, store })`. Search is on only when `SEARCH_PROVIDER=gemini` and a key exists.

## Env vars
- `GEMINI_API_KEY` (empty means every path falls back; nothing throws).
- `GEMINI_MODEL` (default `gemini-2.5-flash`).
- `SEARCH_PROVIDER` = `gemini` | `none`.

## Timeouts
Pricing total 8000 ms, web lookup 6000 ms, estimate 6000 ms by default (variants use 8000 ms). After the total timeout the list or median fallback is used.

## Privacy (§21.3)
The free Gemini tier may use prompts for training. Only item text goes to Gemini. Camera frames are not sent by default.

## TO VERIFY ON THE REAL LINE
- Model names (`gemini-2.5-flash` and any newer default) exist for the key.
- Google Search grounding works on the free key, and JSON plus grounding needs two calls.
- A/B/C accuracy numbers with a real key.
