# Verified on the real line

Everything below was built and tested offline with fakes. A human must check each row on the real
line, then write what they saw in the "Observed" column.

## TO VERIFY ON THE REAL LINE

| Module | What to verify | How a human checks it | Observed |
| --- | --- | --- | --- |
| `src/comms/chert.ts` | Field names of `GET /shared-messages` and `/calls/{id}/events` (parsed tolerantly) | Run a call, text the line, log the raw JSON once and compare to `fixtures/chert.ts` | |
| `src/comms/chert.ts` | Calls endpoints live on `facetimeBase` (or need the app base; the 404 fallback covers it) | Start a call and watch the logs for a 404 retry | |
| `src/comms/chert.ts` | `Idempotency-Key` is honoured on a retried POST | Send the same key twice with curl; only one message or call appears | |
| `src/comms/token.ts` | Chert accepts the token (roomJoin + publish + subscribe); bridge identity differs from agent identity | Dial a call; the bridge joins the LiveKit room | |
| `src/comms/call.ts` | The Chert event meaning "bridge joined" is really named `bridge_ready` | Read `getCallEvents` during a real call | |
| `src/comms/call.ts` | A terminal `getCall` status shows up quickly after the last player hangs up | Hang up and time how long until the game returns to `wait_call` | |
| `src/comms/call.ts` | A second `dial()` right after `end()` is accepted | Finish a game, then start another at once | |
| `src/comms/call.ts` | `latestCallerFrames()` is null for now (camera capture is a later task) | Confirm camera identification falls back to voice or the prop closet | |
| `src/comms/livekit.ts` | `connect()` to a real Chert room; exactly one audio publisher shows up in the participant log | Dial, read the participant log line | |
| `src/comms/livekit.ts` | `AudioStream(track, 16000, 1)` returns 16 kHz mono frames | Speak on the call; check the STT transcript is sane | |
| `src/comms/livekit.ts` | The remote track named `facetime-remote-audio` is the one subscribed to | Log the subscribed track name | |
| `src/comms/livekit.ts` | `captureFrame` backpressure keeps host speech real time (no drift or gaps) | Listen to a long host line on the phone | |
| `src/comms/imessage.ts` | `listMessages()` returns the newest messages and flags `inbound` correctly | Text the line from a phone; the agent sees one inbound message | |
| `src/comms/imessage.ts` | Chert honours the idempotency key on `sendMessage` (a retry never double-texts) | Force a retry and check the phone got one text | |
| `src/comms/mixer.ts` | The 6 dB duck keeps sfx audible but not louder than the host voice | Listen on a real call | |
| `src/comms/sfx.ts` | Each effect sounds right over FaceTime (phone speakers and codecs squash highs) | Trigger every sfx and adjust by ear | |
| `src/comms/voice.ts` | The 400 ms hold-off keeps the host's echo out of the transcript | Let the host talk; check no host words reach the guess parser | |
| `src/comms/voice.ts` | The 65 ms-per-character fallback pace feels right when TTS is dead | Run with no ElevenLabs key and watch the captions | |
| `src/comms/tts.ts` | The real voice id and model accept `voice_settings` (stability, similarity_boost, style, speed) | Run `npm run warm:tts` with a real key | |
| `src/comms/tts.ts` | `pcm_24000` is allowed on the account's plan (`pcm_16000` is resampled otherwise) | Same run; check `tts.stats()` | |
| `src/comms/tts.ts` | The billed character count matches the text length we count | Compare the ElevenLabs usage page with `tts.stats().charsUsed` | |
| `src/comms/stt.ts` | Incoming field names (`text` or `transcript`, `confidence`) | Speak on a call; log the raw messages once | |
| `src/comms/stt.ts` | Outgoing field names (`message_type`, `audio_base_64`, `sample_rate`) | Same; transcripts must come back | |
| `src/comms/stt.ts` | The `committed_transcript_with_timestamps` message type name | Same; check the logs | |
| `src/ai/index.ts`, `src/ai/gemini.ts` | A real `GEMINI_API_KEY` works with the model name; grounding returns sources | Price one item with a key; see `source: web` | |
| `src/ai/gemini.ts` | Image parts (`imagesJpeg`) are accepted by the chosen model | Send one test image | |
| `src/ai/pricing.ts` | Grounded prices and camera identification with live credentials | Price an item not on the list | |
| `src/ai/webSearch.ts` | Grounding and JSON do not work in one call (two calls are used); grounding works on the free key; 4 s and 2 s are enough | Time a few web lookups | |
| `src/ai/variants.ts` | Accuracy harness with a real key compares A, B and C | Run the harness and read the table | |
| `src/store/index.ts` | Atlas permissions, indexes and write latency with deployment credentials | Set `MONGODB_URI`, play a game, check the collections | |
| `src/store/seed.ts` | The seed script against a real Atlas cluster | Run the seed script and count documents | |
| `src/agent.ts` | A whole game over a real FaceTime call, and clean shutdown on Ctrl+C | `npm start`, play a game, then press Ctrl+C | |
