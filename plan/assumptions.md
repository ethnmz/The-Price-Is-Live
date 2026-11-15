# Planner assumptions (review these)

Written by the planner on Sat Nov 14, 2026, about 6:40 PM Central. Nobody was asked; each choice below was made so the build can run with no human. Source of truth for the product: `.relay/idea.md` and the full spec `.relay/brief.md` (copied to `docs/SPEC.md`).

> **Where this file is.** The planner was asked to write `.relay/tasks.yaml` and `.relay/assumptions.md`, but Relay's own policy hook refuses every write under `.relay/`. So the plan is in `plan/tasks.yaml` and `plan/assumptions.md`. To use it: `cp plan/tasks.yaml .relay/tasks.yaml && cp plan/assumptions.md .relay/assumptions.md`.

## Time and scope
1. **The Devpost deadline is treated as 11:59 PM tonight** (the spec says "reportedly, unconfirmed"). So the plan follows the spec's own cut line (§16.3): P0 items are `must`, P1/P2 items are `nice` or left out. If the deadline is really Sunday, the `nice` tasks simply get built too.
2. **Agents have no phone, and may have no API keys.** No task's acceptance needs a real FaceTime call, a real text, or a real key. Every external edge (Chert, LiveKit, ElevenLabs, Gemini, Atlas) is built against the documented shapes with injected fakes, and each module lists what a human must check under "TO VERIFY ON THE REAL LINE" (collected in `docs/verified.md` by T21). **The first real call is a human job** after the build: follow `docs/runbook.md` (T11) and `docs/demo-checklist.md` (T45).
3. **Human-only work is not in the plan:** Chert line setup and phone verification, the iPhone framing test (E6), rehearsals and backup video (E7), demo video and sponsor screenshots (E10), posting to Devpost, making the repo public, rotating keys.

## Stack (the idea named it; details I fixed)
4. TypeScript on Node 22+, one process, ES modules, `tsx` to run, `vitest` to test, **no build step** (`tsc --noEmit` only). `moduleResolution: Bundler`, imports without file extensions.
5. Versions are whatever npm resolved today: `@livekit/rtc-node` 1.2, `livekit-server-sdk` 2.19, `@napi-rs/canvas` 1.1, `@google/genai` 3.3, `mongodb` 7.9, `zod` 4, `pino` 10, `ws` 8, `typescript` 7, `vitest` 5. `package.json` is frozen; **all dependencies and all npm scripts are already declared** so no task has to touch it.
6. **Left out on purpose:** `sharp` (use `@napi-rs/canvas` for JPEG), `@trychert/sdk` and the ElevenLabs SDK (plain `fetch`/`ws`, easier to mock), `openai` (optional fallback in the spec; not built), `@livekit/agents` (only needed for inbound Plan A), eslint (typecheck + tests are the gate), gitleaks (replaced by `scripts/scan-secrets.mjs`, no pre-commit hook).
7. `check` runs `npm install` first because each agent may start in a fresh worktree.

## Product decisions
8. **Plan B only** (the agent places one outbound group call). The spec says to build B first and lists Plan A (call in, add friends) and Plan C (FaceTime link) as P2. Judges can still play: text "I'm in", then `start`, and the agent calls back. Not built: inbound calls via `chert dev`, the name round (§9.7), `CALL_MODE=inbound|link`.
9. **The roster is kept after a game** (scores reset) so that a `REMATCH` text after the call has ended can redial everyone. The spec says the registry is cleared unless a rematch was asked; keeping it is what makes the texted rematch work.
10. **Camera item identification is `nice`** (T38 to T40). Caller capture is unverified in group calls and the spec puts it at P1. With no item text the must-path is: wait, then the prop closet. Writeups must not claim camera ID unless those tasks ship.
11. **Atlas Vector Search and Gemini embeddings are not built.** `StorePort.vectorSearch` returns `[]` and list matching is local (alias + token similarity). The spec marks them P1. The Devpost and README tasks are told not to claim them.
12. **Model-written quips are `nice`** (T37); canned lines are used by default (spec P2).
13. **Speech-to-text: ElevenLabs Scribe only.** OpenAI / Deepgram fallbacks are not built; with no key or a dead socket the game switches to TEXT MODE.
14. **Sound effects are synthesized in code** (no audio files), so the public repo has no licensing questions.
15. **The host is drawn from vector shapes in code** (no image files). Fonts fall back to system fonts if Bungee / Lilita One cannot be downloaded.
16. Portrait layout, results card as an image, Docker/VM backup (T43 is `nice`), SpaceXSI A-Team track: not built / not entered, as the spec's defaults say.

## Contracts (changes from spec §8.5, all listed in docs/API.md section 5)
17. `StagePort.start(sink: VideoSink)` instead of `start(room)`, and `CallPort` exposes stable `audioSink()` / `videoSink()` / `onRemoteAudio()`. Only `src/comms/livekit.ts` touches `@livekit/rtc-node`. This keeps "same participant, one audio publisher" true by construction and lets the stage be built and tested with no LiveKit.
18. The engine is `reduce(state, event, deps)`: host lines, the number parser, spoken amounts and the prop closet are injected (`EngineDeps`), so the engine, speech and ai lanes can all start in minute one. There is no `STAGE` effect: the runner derives `StageState` from `GameState` after every event.
19. Events `CALL_FAILED` and `SPEECH_PARTIAL` and effect `CANCEL_TIMER` were added; `DIAL_REQUESTED` was dropped. `GameState` has extra documented fields (timer, caption, pendingGuess, textMode, ...). Host line keys `reveal.estimate` and `score.stumplow` were split out so every line is one key.
20. Join-name parsing lives only in `src/engine/registry.ts` (the spec also listed `speech/nameParse.ts`; not needed without the name round).

## Things the planner built (so nobody waits on "M0")
21. Repo skeleton, `LICENSE` (MIT), `.env.example`, README skeleton, `docs/SPEC.md`, the frozen contracts, `src/config.ts`, fakes for every port (`src/testing/fakes.ts`), fixtures, stage theme/layout, the secret scanner, `scripts/check-docs.mjs`, and **working first versions** of `src/engine/scoring.ts` (final, with all six worked examples tested), `registry.ts` and `messages.ts` (T02 hardens them). `npm run check` and `npm run scan:secrets` pass on the starting tree.

## Honesty rules written into the tasks
22. **Prices in the reference list and the held-out set come from the agents' knowledge unless an agent really fetched the page.** Each item has `verified: true|false`. A human should spot-check the held-out set before quoting the number. The 20 sample prices in `fixtures/reference-items.sample.json` are unverified too.
23. **The measured number is never invented.** `npm run eval` needs `GEMINI_API_KEY`. If the agents have no key, `eval/report.md` says "NOT RUN YET", the `{N} {X} {Y}` placeholders stay in `docs/devpost.md`, and a human runs `npm run eval` (T36 explains how). Mock runs go to `out/` and are marked `"mock": true`.
24. README and Devpost text may only describe code that exists; optional features go in an "Only if built" section.

## Process
25. Lane names come from the roster as given. The lane `src` is listed for both Diego and Aditri, so no task uses it.
26. Leases never overlap between tasks that can run at the same time (checked by `out/plan/gen_tasks.py`, the script that generated `plan/tasks.yaml`). Tasks that share a file are chained with `depends_on`.
27. Relay's policy blocks agents from touching env files and `.relay/`, so code reads `process.env` and optionally `.env.local` through `loadEnv`; humans create `.env.local`.
28. `docs/SPEC.md` is a copy of the team's brief and will be public with the repo. It has team first names and strategy notes but no secrets and no real phone numbers. Delete it before making the repo public if the team prefers.
29. Longest dependency chain is 6 tasks (T13 → T20 → T21 → T35 → T45, with the engine and AI chains feeding T21). At 30 to 60 minutes each that is roughly 3 to 4 hours even with perfect parallelism, so **the end-to-end check (T45) may land close to or after the cut-off tonight**. Everything before it is independently tested.
