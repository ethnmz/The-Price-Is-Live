# The Price Is Live

**The Price Is Right, played on a group FaceTime call with an AI game show host.** Built at HackUTA 2026 (Nov 14 to 15, 2026).

Two to four friends join one FaceTime call. Chip Dollar, a cartoon retro game show host, runs the show from a drawn stage with a podium for each player. Each player holds up a real item from home. Everyone else guesses the price out loud, closest without going over wins, then a drumroll and the real price pops up on screen. At the end the agent texts everyone a results card and offers a rematch.

> Status: under construction during the hackathon. Sections marked TODO are filled in by the build (task T35).

## How to run
```
npm install
npm run check        # typecheck + tests (offline)
npm run sim          # a full game with fake ports, no phone needed
npm run demo:check   # the 2-minute demo game end to end, offline
npm start            # the real agent (needs .env.local, see .env.example and docs/runbook.md)
```

## How it works
See `docs/API.md` (architecture and contracts), `docs/DATA_MODEL.md` (data) and `docs/SPEC.md` (the full spec).

## How we use Chert
TODO (T35): FaceTime line, outbound group call, iMessage. Files: `src/comms/call.ts`, `src/comms/chert.ts`, `src/comms/imessage.ts`, `src/comms/livekit.ts`.

## How we use ElevenLabs
TODO (T35): host voice (streaming TTS with emotion presets and a line cache) and speech-to-text. Files: `src/comms/tts.ts`, `src/comms/stt.ts`, `src/comms/voice.ts`.

## How we use Gemini
TODO (T35): pricing with Google Search grounding, estimates, host lines. Files: `src/ai/pricing.ts`, `src/ai/webSearch.ts`, `src/ai/gemini.ts`, `src/ai/host/`.

## How we use MongoDB Atlas
TODO (T35): price list, games, rounds, guesses, results, price cache, eval runs. Files: `src/store/`.

## The measured number
TODO (T36): percent of held-out items priced within 15%, with and without the reference list. Source: `eval/report.md`.

## License
MIT. See `LICENSE`.
