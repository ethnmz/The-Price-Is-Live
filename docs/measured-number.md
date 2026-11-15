# The measured number: how to produce it

**Status: NOT MEASURED YET.** `eval/report.md` says "NOT RUN YET: needs GEMINI_API_KEY", and there is no `eval/results.json`. No accuracy number has been written anywhere. The placeholders `{N}`, `{X}`, `{Y}` stay in `docs/devpost.md` and `docs/pitch.md` until a human runs the eval below. Do not make up a number.

## What the eval does (this wording is true, use it as is)

- A reference list of about 200 items with list prices.
- A held-out set of items that are **not** on that list.
- Three variants, all at temperature 0:
  - **A**: Gemini alone.
  - **B**: reference list + Gemini.
  - **C**: reference list + Gemini + Google Search grounding.
- "Within 15%" means the guess is within 15% of the recorded shelf price. The report also gives within 25%, a Wilson 95% interval, a split by tier (`similar` / `novel`), and how many held-out prices are marked verified.

## How a human runs it

1. Put a real `GEMINI_API_KEY` in `.env` (see `.env.example`). Never commit it.
2. Run `npm run eval`. It makes real Gemini calls for every held-out item in three variants, two at a time. Expect a few minutes, roughly 5 to 15 depending on the network and search grounding.
3. It writes `eval/results.json` and `eval/report.md`. (`npm run eval -- --mock` writes an offline fake marked `"mock": true`. Never use mock numbers.)

## Where the three numbers are in `eval/report.md`

In the main table, the column **Within 15% count (%)**:

| Placeholder | Meaning | Table row |
| --- | --- | --- |
| `{N}` | number of held-out items | the `N` column (also "Held-out set: N items") |
| `{X}` | percent within 15% with the full pricing path | variant **C** |
| `{Y}` | percent within 15% for the AI alone | variant **A** |

Use the report's numbers exactly. Do not round up and do not drop items that failed (a failed item counts as a miss).

## Which placeholders to replace

- `docs/devpost.md`: the "measured number" paragraph, the "Replace this sentence" line, and the Gemini paragraph (each has `{N}`, `{X}`, `{Y}`).
- `docs/pitch.md`: the 30-second line and the "do not claim they are exact" paragraph.
- Then remove the `BEFORE SUBMITTING` line at the top of `docs/devpost.md`.

## The sentence to publish

> On N items our pricing had never seen, the host was within 15% of the real shelf price X% of the time, versus Y% for the AI alone.

Also report variant B, the within-25% numbers, the Wilson interval, the tier split, and how many held-out prices are verified (`verified/N` in the report).

## Honest limits (keep these in the submission)

- Small sample, so the Wilson intervals are wide.
- The truth is a recorded retail price on one date. Real prices vary by store.
- Prices not marked verified are not independently checked ground truth.
- One run only, so stability is not established.
- When the game is unsure, the host says "estimate" at the reveal.
