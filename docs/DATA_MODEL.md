# Data model: The Price Is Live

Typed source of truth: `src/contracts/types.ts` (frozen). Spec: `docs/SPEC.md` §6, §8.5, §10.2, §17.3, §21.4.

## 1. Rules for all data
- **Money is integer cents** (`Cents`). Display with `formatCents()` → `$34.99`. Item prices are clamped to 100..100000 cents. Guesses are clamped to 100..9999900.
- **Rounding is half up** (`Math.round`).
- **Phones are E.164** (`+12145550101`) in memory. Never logged or stored in full: logs use `last4()`, the database stores `phoneLast4` plus a salted SHA-256 `phoneHash`.
- **Fixture phones** use the fake range `+1214555010x`. No real number may be committed.
- All JSON entering the system (model output, polled messages, data files) is validated with `zod`.
- Camera frames live in memory only. Never written to disk, the database or logs.

## 2. Core types (see `types.ts` for every field)
| Type | Purpose |
|---|---|
| `Player` | `id` p1..p4, `seat` (join order = turn order), `name` (max 12 chars), `phone`, `isMain`, `score`, `roundWins` |
| `ItemRequest` | what to price: `itemId` (`r1`, `r2`, ... = round number), `ownerId`, `origin` (`text`/`camera`/`voice`/`prop_closet`), `rawText` |
| `PriceResult` | `displayName`, `priceCents`, `source` (`list`/`web`/`estimate`), `isEstimate`, `confidence`, `evidence[]`, `latencyMs`, `propClosetSuggested?` |
| `Guess` | `playerId`, `status` (`locked`/`silent`/`pass`), `cents`, `rawTranscript`, `channel` (`voice`/`text`), `corrected` |
| `RoundResult` | scored round: `item`, `guesses`, `guessPoints`, `winnerIds`, `winnerReason`, `bonus: 25`, `stumpPoints`, running `totals` |
| `GameState` | everything the engine knows. Only the engine writes it. |
| `StageState` | everything the renderer draws. Built from `GameState` by `buildStageState`. Has **no item name or price before the reveal**. |
| `ParsedGuess` | parser output: `kind` (`amount`/`pass`/`yes`/`no`/`none`), `cents`, `ambiguous`, `confidence`, `spokenForm` |
| `GameConfig` | every timing and rule constant (defaults in `src/config.ts`) |

## 3. Scoring (implemented in `src/engine/scoring.ts`, tested in `test/scoring.test.ts`)
- Guess under $1 → $1. `g <= price`: `round(100 * g / price)` points. `g > price`: 0.
- Round winner (+25): highest valid guess at or under the price; if all are over, the lowest guess; ties all win; no valid guess = no winner.
- Owner stump points: `round(100 * min(1, mean(min(1, |g - price| / price)) / 0.5))` over valid guesses; 0 if none.
- Ranking: total, then round wins, then seat. Equal totals share a place; everyone in place 1 is a co-champion.

## 4. Data files
### `data/reference-items.json`: about 200 `ReferenceItem`s
```json
{ "id": "ref_0042", "name": "Owala FreeSip water bottle 24 oz", "aliases": ["owala", "owala bottle", "owala freesip"],
  "category": "drinkware", "priceCents": 2799, "sizeNote": "24 oz", "source": "owalalife.com", "checkedAt": "2026-11-14", "verified": false }
```
`id` is `ref_` + 4 digits, unique. `aliases` are lowercase and unique across the whole file. `priceCents` 100..100000. Price = new, regular US retail, no sale or bundle. `verified` is `true` only when the price was actually read from the source page during this hackathon; otherwise `false` (a list price from memory).

### `data/heldout-test.json`: 30 to 50 `HeldoutItem`s, none on the reference list
```json
{ "id": "held_001", "text": "Stanley quencher 40oz", "trueCents": 4500, "source": "stanley1913.com", "checkedAt": "2026-11-14",
  "category": "drinkware", "tier": "similar", "verified": false }
```
`tier`: `similar` (same kind of thing as a list item, different brand or model) or `novel` (nothing like it on the list); about half each. Prices span $3 to $400 with at least 5 above $100. Frozen once written: never tuned against.

### `fixtures/reference-items.sample.json`
20 items in the same shape, for tests before the real list exists. Tests should use this file, not `data/`.

### `eval/results.json` and `eval/report.md`
Written by `npm run eval`. Per variant (A = Gemini alone, B = list + Gemini, C = B + Google Search grounding): `n`, `within15`, `within25`, `medianAbsPctError`, `overPriceRate`, `medianLatencyMs`, `p95LatencyMs`, Wilson 95% interval for within15, per-tier split, and `perItem[] { id, text, trueCents, priceCents, absPctError, source, latencyMs }`. A run made with a mock is marked `"mock": true` and must never be quoted as a result.

## 5. MongoDB Atlas (database `priceislive`)
| Collection | Fields | Indexes |
|---|---|---|
| `reference_items` | `ReferenceItem` (+ `embedding[768]` optional) | unique `id`; vector index `ref_vec` (optional) |
| `players` | `phoneHash, phoneLast4, name, gamesPlayed, totalPoints, firstSeenAt, lastSeenAt` | unique `phoneHash` |
| `games` | `gameId, startedAt, endedAt, mode ('normal'|'demo'), callPlan ('B'), playerIds[], totalRounds, lightning, textMode, endReason, finalScoreboard[], championIds[]` | unique `gameId` |
| `rounds` | `gameId, roundIndex, ownerId, item { rawText, origin, displayName, priceCents, source, isEstimate, confidence, evidence[] }, winnerIds[], winnerReason, stumpPoints, durationMs` | unique `gameId + roundIndex` |
| `guesses` | `gameId, roundIndex, playerId, cents, status, channel, transcript, corrected, points` | `gameId + roundIndex` |
| `results` | `gameId, scoreboard[], items[] { owner, name, priceCents, isEstimate }, cardText, sentAt` | unique `gameId` |
| `price_cache` | `cleanText, result (PriceResult), createdAt` | unique `cleanText`; TTL 30 days |
| `eval_runs` | `runId, ranAt, variant, models, n, within15, within25, medianAbsPctError, perItem[]` | `ranAt` |

### `PERSIST` effect documents (engine → `StorePort.persist(kind, doc)`)
| kind | Collection | Document the engine sends |
|---|---|---|
| `game` | `games` | the `games` fields above; sent at game start (no `endedAt`) and again at the end. Upsert by `gameId`. |
| `player` | `players` | `{ gameId, phone, name, points }`: the store replaces `phone` with `phoneHash` + `phoneLast4` and increments the lifetime counters. |
| `round` | `rounds` | the `rounds` fields above. Upsert by `gameId + roundIndex`. |
| `guess` | `guesses` | the `guesses` fields above (one per guesser per round). |
| `result` | `results` | the `results` fields above. Upsert by `gameId`. |
| `priceCache` | `price_cache` | `{ cleanText, result, createdAt }` (sent by the pricing pipeline). |
| `evalRun` | `eval_runs` | one per variant per eval run. |

The store validates each document with zod, drops anything that looks like a full phone number, a token or image data, and never throws back into the game.

## 6. Host lines
Keys: `HOST_LINE_KEYS` in `src/contracts/hostLines.ts`; the variables each key may use: `HOST_LINE_VARS`. `{amount}` and `{price}` are **spoken words** from `spokenAmount()` ("twenty-five dollars"), never digits. Text for every key: `src/ai/host/lines.ts` (§12.2). Two keys were added to the spec's list so each line is one key: `reveal.estimate` ("That's my best estimate!") and `score.stumplow` (stump points under 20).

## 7. iMessage templates
`src/engine/messages.ts` (`MSG.*` and `buildResultsCard`), exactly as §11. Idempotency key for a send: `{gameId}:{type}:{last4}:{n}`.
