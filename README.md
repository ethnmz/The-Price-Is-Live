# The Price Is Live

**The Price Is Right, played on a group FaceTime call with an AI game show host.** Built at HackUTA 2026 (Nov 14 to 15, 2026).

Two to four friends join one FaceTime call. Chip Dollar, a cartoon retro game show host, runs the show from a drawn stage with a podium for each player. Each player holds up a real item from home. Everyone else guesses the price out loud, closest without going over wins, then a drumroll and the real price pops up on screen. At the end the agent texts everyone a results card and offers a rematch.

## What it is
The Price Is Live is a price-guessing game show that runs inside a group FaceTime call. One Node 22 process dials the players, hosts the show as Chip Dollar (an AI voice plus a drawn stage with a podium for each player), prices each item with Gemini, and texts everyone a results card. There is no web server: the phones, the Chert line, iMessage and the LiveKit room are the whole interface.

![The stage](docs/img/stage.png)

The screenshot lives at `docs/img/stage.png` (not committed by the build). Make it with `npm run preview:stage`, which renders every stage fixture to `out/stage/*.png`; copy one of them to `docs/img/stage.png`.

## How a game works
1. **Join by text.** Each player texts the line "I'm in, I'm {name}". The first player is the main player.
2. **Start.** The main player texts `start`. The agent dials everyone in one outbound group call (Plan B) and the show begins when the call is ready.
3. **Rounds.** Each round a player shows an item (they say or text its name, or the camera identifies it). Everyone else guesses the price out loud. Closest without going over wins the round. Then a drumroll and the real price pops up on screen.
4. **Results text.** At the end the agent texts every player a results card.
5. **Rematch.** The agent offers a rematch by text.

If speech-to-text is unavailable the game falls back to TEXT MODE, where guesses arrive by iMessage.

## Quick start
```
npm install
npm run check        # typecheck + tests (offline, no keys)
npm run sim          # a whole game with fake ports and a virtual clock
npm run demo:check   # the 2-minute demo game end to end, offline
```

The real run (needs `.env.local`, see `.env.example`):
```
npm run doctor       # checks keys, Chert, Atlas and the voice before you go live
npm start            # the real agent
```
The step-by-step human checklist is in [docs/runbook.md](docs/runbook.md).

## Architecture
Full contracts: [docs/API.md](docs/API.md), [docs/DATA_MODEL.md](docs/DATA_MODEL.md), [docs/SPEC.md](docs/SPEC.md).

```
iPhones ──FaceTime──> Chert line/bridge ──LiveKit room──> agent process (src/agent.ts)
                                                            ├─ comms/livekit   Room, 1 audio track, 1 video track (same participant)
                                                            ├─ comms/call      CallPort: token, dial (Plan B), bridge_ready, end
                                                            ├─ comms/voice     VoicePort: ElevenLabs TTS + SFX mixer -> AudioSink; STT gate
                                                            ├─ comms/imessage  MessagePort: poll + send (Chert shared-messages)
                                                            ├─ ai/*            PricingPort + HostPort (Gemini)
                                                            ├─ store/*         StorePort (MongoDB Atlas, never blocks)
                                                            ├─ stage/*         StagePort: canvas frames -> VideoSink
                                                            └─ engine/runner   reduce(state, event, deps) -> effects -> ports
```

| Folder | What is in it |
|---|---|
| [src/contracts](src/contracts) | Types and port interfaces shared by every lane |
| [src/engine](src/engine) | Pure game reducer, scoring, join registry, runner that executes effects |
| [src/comms](src/comms) | Chert, LiveKit, iMessage, ElevenLabs voice and speech, audio mixer |
| [src/ai](src/ai) | Gemini client, item text cleaning, reference-list matching, pricing, host lines |
| [src/speech](src/speech) | Spoken guess, yes/no and amount parsing |
| [src/stage](src/stage) | The drawn stage: background, podiums, host sprite, captions, overlays |
| [src/store](src/store) | MongoDB Atlas store and seed script |
| [data](data) | Reference price list and the held-out test set |
| [eval](eval) | The accuracy harness (`npm run eval`) |
| [scripts](scripts) | Sim, demo check, doctor, smoke scripts for the real line |
| [test](test) | Offline tests (fake fetch, WebSocket, SDKs and clock) |

## How we use Chert
- [src/comms/chert.ts](src/comms/chert.ts) is a plain-fetch HTTP client for the Chert API: calls, call events and shared messages, with idempotency keys on sends.
- [src/comms/call.ts](src/comms/call.ts) implements Plan B: when the main player texts `start`, it dials all the players in one outbound group call, waits for the bridge to join, and reports ready or ended to the engine.
- [src/comms/token.ts](src/comms/token.ts) mints the LiveKit token the Chert bridge uses to join our room.
- [src/comms/livekit.ts](src/comms/livekit.ts) joins that room as one participant that publishes the host voice (audio track) and the stage (video track), and reads the callers' audio.
- [src/comms/frames.ts](src/comms/frames.ts) keeps the newest caller camera frame in memory (never on disk) so Gemini can identify a held item.
- [src/comms/imessage.ts](src/comms/imessage.ts) polls Chert shared messages for joins, `start`, guesses in TEXT MODE and rematch, and sends the results card.

## How we use ElevenLabs
- [src/comms/tts.ts](src/comms/tts.ts) calls ElevenLabs text-to-speech over plain fetch and returns 24 kHz mono audio.
- It has three voice settings presets, `hype`, `drumroll` and `warm`, that change stability, style and speed; each line is spoken with the preset of its emotion.
- Every synthesized line is cached on disk by voice, model, format, emotion and text, so repeated host lines cost nothing. `npm run warm:tts` pre-generates the line bank.
- A character budget counts what we spend; near the limit it switches to cached-only and the voice falls back to a paced silent estimate instead of failing.
- [src/comms/stt.ts](src/comms/stt.ts) streams the callers' audio to the ElevenLabs Scribe realtime WebSocket and emits partial and final transcripts. With no key it does nothing and TEXT MODE carries the game.
- [src/comms/voice.ts](src/comms/voice.ts) mixes host speech with sound effects, drives the mouth level for the host sprite, and mutes speech-to-text while the host talks (plus a short hold-off) so the host does not hear itself.

## How we use Gemini
- [src/ai/gemini.ts](src/ai/gemini.ts) wraps the Gemini SDK. Every call times out and resolves `null` instead of throwing, and the key is never logged.
- [src/ai/webSearch.ts](src/ai/webSearch.ts) gets web prices with Google Search grounding in two calls (grounded prices as text, then text to JSON). No grounding sources means no "web" price.
- [src/ai/pricing.ts](src/ai/pricing.ts) is the pricing pipeline: it cleans the item text, matches the reference list, then the web, then falls back to [src/ai/estimate.ts](src/ai/estimate.ts) (Gemini's own knowledge).
- [src/ai/identify.ts](src/ai/identify.ts) asks Gemini vision which item is in the caller's camera frames.
- [src/ai/host/quips.ts](src/ai/host/quips.ts) writes optional item jokes with Gemini, filtered for kindness and spoken delivery. Otherwise the canned lines in [src/ai/host/lines.ts](src/ai/host/lines.ts) are used.
- [src/ai/variants.ts](src/ai/variants.ts) holds the A/B/C eval variants: A is AI alone, B is reference list plus AI, C is the full game pipeline. [eval/run-eval.ts](eval/run-eval.ts) runs them.

## How we use MongoDB Atlas
- [src/store/index.ts](src/store/index.ts) is the `StorePort`. Writes go into an in-memory queue (500 documents at most) drained in the background with a short timeout and retries, so Atlas can never slow or stop a game. With no database it runs local-only.
- Collections: `games`, `players`, `rounds`, `guesses`, `results`, `price_cache` and `eval_runs`, plus `reference_items` (see [src/store/mongo.ts](src/store/mongo.ts) and [docs/DATA_MODEL.md](docs/DATA_MODEL.md)). Writes are upserts on unique indexes.
- `price_cache` has a 30-day TTL index and is read first with a tight time limit, so a repeat item is priced instantly.
- The reference list is loaded from Atlas at startup; [src/store/seed.ts](src/store/seed.ts) (`npm run seed`) loads [data/reference-items.json](data/reference-items.json) and creates all indexes.
- [scripts/atlas-stats.ts](scripts/atlas-stats.ts) (`npm run atlas:stats`) runs aggregation pipelines over the game data, such as average points per round and per player.
- Not built: there is no vector search or embeddings. `vectorSearch` returns an empty list and matching is text based.

## The measured number
`npm run eval` prices the 40 held-out items in [data/HELDOUT.md](data/HELDOUT.md) (none are on the reference list) with variants A, B and C and writes [eval/report.md](eval/report.md). The headline number is the percent priced within 15% of the real price, with and without the reference list. No real eval run exists yet (it needs a Gemini key), so no number is quoted here. The held-out prices were written from an AI's knowledge and are not yet human-verified.

## Honest limits
Everything was built and tested offline with fakes. Chert field names, the bridge event, speech echo handling, ElevenLabs and Gemini behavior with live keys, and Atlas permissions all need a human on the real line. The full checklist is [docs/verified.md](docs/verified.md).

## Team
Ethan Meza, Diego, Akshi and Aditri. Built during HackUTA 2026.

## License
MIT. See [LICENSE](LICENSE).
