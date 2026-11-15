# The Price Is Live: full build spec

Version 1.0, written Saturday Nov 14, 2026 (Central time) for Ethan Meza's HackUTA team.
This file is meant to be **self-contained**. Any coding agent (use whichever tool you like) that reads only this file should have everything it needs. Do not assume you can ask a human; where something is unknown it is marked **UNVERIFIED** and has a fallback.

How to read this:
- Sections 0 to 5 are the context and the rules of the game.
- Sections 6 to 14 are the shared design: scoring, state machine, architecture and data contracts, speech, pricing, messages, host script, stage video, demo.
- Section 15 is one section per teammate (Ethan, Diego, Akshi, Aditri). Read the shared sections first, then your own.
- Sections 16 to 21 are build order, tests and accuracy harness, risks, open questions for Gary, the Devpost writeup, and the **sponsor tracks** (ElevenLabs, Gemini, MongoDB Atlas, optional SpaceXSI A-Team) with a submission checklist.
- **Sponsor stack (read section 21 early):** the host voice is **ElevenLabs**, the AI (pricing, camera ID, host lines) is **Gemini**, and the data is stored in **MongoDB Atlas**. Where older text in this file says "OpenAI", it now means "optional fallback only".

---

## 0. Read this first: things that can break the plan

These come from reading the real Chert docs today (links in section 3). Each one conflicts with, or is not covered by, a locked game decision. Nothing was quietly changed. Each has a plan and a question for Gary (section 19).

1. **"Main player FaceTimes the number, then adds friends" is NOT documented.** Chert's group-call docs only describe an **outbound** group: our agent starts the call with a list of phone numbers (`recipients`). They say there is no add/remove-person control, and that "incoming group invitations require separate qualification." So:
   - **Plan A (the locked flow, UNVERIFIED):** main player FaceTimes the agent line, then taps "add person" in FaceTime for the friends. Only works if Chert has enabled inbound group calls on our line.
   - **Plan B (fully documented, build this first as the safe path):** each player texts the line "I'm in, I'm {name}". Then the main player texts `start`. The agent places ONE outbound group call to everyone's phone with `recipients`. The call looks like "the agent FaceTimed all of us."
   - **Plan C (experimental, enabled separately by Chert):** main player makes a FaceTime link and texts it; the agent joins by link (`destination_type: "facetime_link"`).
   - Build the game so it does not care which plan connected the call (section 8.1). Ask Gary which of A/B/C work.
2. **Every phone in a group call must be "verified" on Free and Shared lines.** One unverified number makes Chert reject the whole group. A phone is verified by texting a 6-digit code from the phone to the line (done in the Chert dashboard). This means **Gary's phone (or any judge's phone) must be verified before it can join**. Fallback: hand Gary a team iPhone that is already verified. Plan the demo around this.
3. **On the free trial, iMessage is reply-only.** The agent can only text phones that joined the project, and only within 24 hours of that phone's last text to the line. So each player must **text the line first** ("I'm in, I'm Diego"). We use that first text for three things: it opens the reply window, it tells us the player's name, and it tells us their phone number.
4. **Caller names are probably not available.** The call event has `from_handle_hash: null` in Chert's example, and there is no per-person participant list. Names come from the join text. Fallback: the host asks out loud.
5. **Camera capture is one composite picture, not one camera per person.** Chert says capture "may include FaceTime window controls, names, or self-preview" and does not give a separate video track per person in a group, and "does not guarantee that all group tiles are visible." So the camera fallback (identify the item from the owner's camera) is UNVERIFIED in a group call. The host will say "hold it close and fill the screen." The iMessage item text is the main path for exactly this reason.
6. **Agent audio and agent video must come from the same LiveKit participant, and there must be exactly one audio publisher.** Video from a different participant is not shown, and a second voice track can end the call. So the stage video and the host voice are published by the SAME agent process. Do not use a separate avatar service that publishes its own audio.
7. **Trial calls are capped at 5 minutes.** A full 4-player game is about 3:30 to 4:15. The game has a hard clock (section 7.4) so it always ends by 4:30.
8. **Audio was digitally silent in both directions** on one team's shared trial line at Emory (Onset). So captions and on-screen numbers must carry the whole game, and guesses can also be sent by text (section 9.6).
9. **Devpost deadline.** hackuta.com reportedly lists 11:59 PM **tonight, Saturday Nov 14** (UNCONFIRMED). The current time of writing is about 5:45 PM Central. If true, "overnight" is not available. See section 16.3 for the compressed plan. Confirm this in the first 10 minutes.
10. **API address mismatch.** Chert's docs say calls go to `https://facetime.trychert.com/api/v1/...`. Chert's `skills.md` file says `https://app.trychert.com/api/v1`. Try the facetime host first for calls, and use the app host for texts. If one fails, try the other.
11. **Sponsor tracks change the stack and the repo rules (section 21).** The repo must be **public with an open-source license** (ElevenLabs track), so **no secret may ever be committed**. ElevenLabs free tier has small character limits, so TTS audio is cached. Gemini free tier is not for sensitive data, so camera frames are a fallback only. The A-Team raffle is optional and pending a decision (needs Cursor as the main coding agent).
---

## 1. One-paragraph pitch

**The Price Is Live** is The Price Is Right, played on a group FaceTime call with an AI game show host. Two to four friends join one call. A cartoon retro game show host (suit, microphone, big mouth-flap) hosts from a full game show stage with a podium for each player. Each player takes a turn holding a real item from their home up to the camera (an Owala bottle, a calculator, a bag of chips). Everyone else guesses the price out loud, closest without going over wins, and the host drops a drumroll and then the real price pops up huge on screen. The person who brought the item earns "stump points" if they fooled everybody. At the end the agent texts everyone a results card with the final scoreboard and every item's real price, and offers a rematch. The AI prices each item from a ~200-item reference list of real prices first, then web search. We measure that pricing on a held-out test set and report one number: the percent of items priced within 15%, with and without the reference list.

---

## 2. Hackathon context (so you know why choices were made)

- **Event:** HackUTA 2026 at UT Arlington, Nov 14 to 15, 2026. Team: Ethan Meza (lead), Diego (Navibytes), Akshi (biswalakshi), Aditri (aditrit06).
- **Track we are going for:** Chert "Best Use of FaceTime." Chert (YC Spring 2026, CEO Gary Gao, CTO Ian Fong) sells iMessage and FaceTime lines for AI agents.
- **Prize:** $400 for 1st. The top 3 teams get guaranteed interviews for Chert's FDE and SWE intern roles (the Chert flyer calls it the Chert Fellowship).
- **Rules:** build on the Chert FaceTime API. iMessage is optional but encouraged. Bring at least one iPhone. During the demo the agent must make or take a **real FaceTime call**. On Devpost, pick "Best Use of FaceTime (Chert)".
- **Judging (live, in person, by Gary Gao at the Chert table):**
  - **Fresh use of FaceTime video: counts DOUBLE.** "It uses what it sees in a way we haven't seen."
  - **Wow factor:** "People stop and say wait, how did you do that?"
  - **Usefulness:** "It solves a real problem people want solved."
- The agent does not need a face. "It can be a character or no character at all. What matters is what it does with what it sees."
- **Already built by others (do not clone):** ClawdTime (coding agent calls you), Capy Quest (capybara quests), GEORGE (travel companion), Jane Doe (rehearsal coach), Brodie (fitness coaches), Squaggle (plumbing estimator), Togather, Onset (stroke check-in). Chert's own template ideas include a "group-call game master," so a group game is on their list; ours must stand out by what the video does (the live stage, real home items, price reveal, a judge can play).
- **Lessons from losing 1st at HackUTD and from past Chert winners:** (1) prove ONE measured number, (2) have a live link or live way for the judge to try it, (3) have an interactive wow moment. Our answers: (1) price accuracy %, (2) judges call the FaceTime number or hand Gary the iPhone, (3) the drumroll and big price reveal, plus Gary can be the 4th player.
- **Other tracks we are also entering (section 21):** Best Project Built with ElevenLabs, MLH Best Use of Gemini API, MLH Best Use of MongoDB Atlas, and (optional, pending decision) MLH Build Your Hackathon A-Team with SpaceXSI.
- **Devpost:** deadline reportedly 11:59 PM Sat Nov 14 (UNCONFIRMED). The public Devpost URL for HackUTA was not found; ask the organizers.
- **Free line:** HackUTA teams get a free Chert line for 48 hours, set up by pasting this into a coding agent: `Connect my agent to Chert so I can FaceTime it. Follow https://app.trychert.com/skills.md`

---

## 3. Chert API facts (verified from docs on Nov 14, 2026, unless marked)

Docs: https://docs.trychert.com (add `.md` to any page URL to get plain Markdown). Copies of the pages used here are saved in `/workspace/hackuta/docs/` on Ethan's box.

### 3.1 How the pieces fit
- Chert gives us a real FaceTime line (an Apple identity answered by a Chert Mac). We run a **LiveKit** room. Chert's "bridge" joins our room and carries the call audio/video in and out. We own the agent and the room.
- Our agent publishes: **one unmuted audio track** (the host voice) and **one video track** (the stage), both from the same participant.
- The bridge publishes: `facetime-remote-audio` (everyone's voices **mixed into one track**) and, only if caller capture is enabled on our line, `facetime-remote-video`.
- For `chert dev` (inbound), the bridge participant is named `chert-bridge-<callId>`. For our own outbound calls we choose the bridge identity in the token.

### 3.2 Capabilities
| Thing | Status |
|---|---|
| Two-way audio | Yes on a ready line. Greet only after `bridge_ready` (or outbound `call.started`). If silent for about 10 s after `bridge_ready`, Chert may end the call. |
| Agent video to caller | Yes if line and agent publish a video track. Starter: `chert new <name> --video`. Caller must use **FaceTime Video**, not FaceTime Audio. Until our video is ready the caller sees a holding screen; startup time varies. |
| Caller camera to agent | Only if **caller capture** is enabled on the line. Separate from agent video. May include FaceTime UI chrome, names, self-preview. Handle mute/missing track; never treat an old frame as current. **UNVERIFIED for our line.** |
| Inbound calls | Yes. `chert dev --agent <name>` handles them without a webhook. Webhook path must accept/decline within 5 s. |
| Outbound calls | Yes on an outbound-enabled ready line. `POST /v1/calls`. HTTP 201 = allocated, NOT answered. |
| Group calls | Rolling out, must be enabled on our line. **Outbound only** via `recipients`. One mixed audio track, no speaker IDs, no per-person controls. Group video needs separate confirmation. |
| FaceTime link join | Experimental, separate enablement. `destination_type: "facetime_link"`, `destination: "https://facetime.apple.com/join#<fragment>"`. |
| Screen share | NOT supported. We render our own picture as the agent's video. |
| iMessage | Separate API. Trial uses the "shared messages" endpoints (below). |

### 3.3 Limits
- **One active call per line.** Trial: **up to 5 minutes per call**, 50 FaceTime minutes total, valid 24 hours (48 hours for trials started by Nov 18, 2026, which covers us).
- Free/Shared group calls: every recipient must have current phone verification. One missing verification rejects the whole group. Each distinct recipient counts toward a **100-contact limit**. Group size input limit is 31 (not a tested capacity).
- Trial iMessage: only text phones that joined the project; the agent can reply only within 24 hours of that phone's last text; inbound within 50 messages per hour per project; 100 messages per hour per project and 400 per line (Shared). Text up to 4,000 characters.
- Bridge token: `exp - nbf` at most 7,200 s, and more than 90 s remaining when the call is created. Use a **fresh token per call**.
- Idempotency: every POST needs an `Idempotency-Key` of 8 to 200 characters. Reuse the same key to retry the same request. A different body with the same key returns 409.
- No published latency number exists. Treat the first 1 to 2 seconds after pickup as a holding screen.
- Busy shared line: `when_busy: "queue"` can wait up to 2 minutes (HTTP 202). Default is fail.

### 3.4 Auth and HTTP shapes
Headers on every request:
```
Authorization: Bearer $CHERT_API_KEY        (key starts with ftk_)
X-Chert-Project-Id: <project UUID>
Idempotency-Key: <8-200 chars>              (POST only)
Content-Type: application/json
```
Scopes: `facetime:write` (create/end calls) and `facetime:read` (read status/events).

**Create a group call (Plan B)** `POST https://facetime.trychert.com/api/v1/calls`
```json
{
  "direction": "outbound",
  "mode": "customer_managed",
  "line_id": "<line UUID>",
  "recipients": [
    { "type": "phone_number", "value": "+12125550100" },
    { "type": "phone_number", "value": "+12125550101" }
  ],
  "media": { "audio": true, "video": true },
  "livekit_url": "wss://<project>.livekit.cloud",
  "participant_token": "<bridge JWT>",
  "remote_participant_identity": "host-agent"
}
```
Single person instead of a group: replace `recipients` with `"destination": "+1555...", "destination_type": "phone"`. Optional `"when_busy": "queue"`. Response 201: `{ "data": { "id": "<callId>", ... }, "request_id": "..." }`.

**Bridge token (JWT, HS256, signed with our LiveKit API secret):** `sub` = bridge identity (different from the agent's identity), `iss` = LiveKit API key, `nbf` and `exp` as integer Unix seconds with `exp - nbf <= 7200`, and `video: { roomJoin: true, canPublish: true, canSubscribe: true, room: "<one room name>" }`. Easiest: use `livekit-server-sdk` `AccessToken` with those grants.

**Other call endpoints:** `GET /v1/calls/{id}`, `GET /v1/calls/{id}/events` (look for `bridge_ready`), `POST /v1/calls/{id}/end` (new idempotency key, body `{}`, 202 means requested; keep watching until terminal).

**Inbound without a webhook:** run `chert dev --agent <AGENT_NAME>` in a second terminal next to the agent. It accepts the call and wires the room. Inbound webhook (if used): `call.incoming` event with `data.call_id`, `data.media`, `data.from_handle_hash` (may be null); reply 2xx within 5 s with `{ "action": "accept", "livekit_url", "participant_token", "remote_participant_identity" }` or `{ "action": "decline" }`.

**Trial iMessage (shared messages)** (base `https://app.trychert.com/api/v1`):
- Send: `POST /shared-messages` body `{ "line_id": "<line UUID>", "recipient": "+1...", "text": "..." }` (text up to 4,000 characters, Idempotency-Key required). A send whose state is `unknown` is kept, not sent twice: read it again, do not retry with a new key.
- Read (poll): `GET /shared-messages` returns the newest 50 messages sent and received.
- Lines: `GET /lines` returns the project's line `id`s.
- **UNVERIFIED:** field names in the polled message objects (expect something like sender handle, text, id, timestamp; print one real message and adapt), whether `message.received` webhooks work on Shared lines, and whether image attachments can be sent on Shared. Messaging API (non-shared, `/api/v1/chats`, `/api/v1/send`, attachments) exists but may not be available on the trial. **Design: text-only, polled every 1.5 s.** If webhooks/SSE work, swap them in behind the same interface.

### 3.5 Starter and packages
- CLI: `@trychert/facetime` (skills.md pins `0.1.0-beta.21`; docs mention beta.19). SDK: `@trychert/sdk@0.3.0` (`ChertControlPlane.createCall`, `getCall`, `getCallEvents`, `endCall`; `ChertClient` for texts and events). Use exact versions. Needs Node 22.23.2 or 24.x on macOS or Linux.
- Starter: `chert new price-is-live-agent --video`, then `npm install`, fill `.env.local` with `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY`, `AGENT_NAME` (only the starter needs the OpenAI key; our game uses ElevenLabs and Gemini, see section 21). Run `npm run check`, `npm start`, and in a second terminal `chert login`, `chert doctor`, `chert dev --agent <AGENT_NAME>`. The starter uses `@livekit/agents` 1.8.0, `@livekit/agents-plugin-openai` 1.8.0, `AutoSubscribe.AUDIO_ONLY`, `videoEnabled: false`. **We must change both to subscribe to video** (only if caller capture is available).
- The starter publishes an animated face; **read its video-publishing code first** and reuse that mechanism for our stage frames. Do not invent a different publishing path.
- Setup prompt for the human: `Connect my agent to Chert so I can FaceTime it. Follow https://app.trychert.com/skills.md`.

### 3.6 Lessons from Onset (Emory) to copy
Their Chert trial line had audio silent in both directions while video worked; they went caption-first. They used a Python LiveKit agent. Their write-up: https://dev.to/arnav_t_173f963b39a3c9c52/i-built-a-stroke-check-in-you-facetime-and-the-hardest-bug-wasnt-mine-1a26 . We use TypeScript (section 8).

---

## 4. Locked game decisions (all of these are final; do not change them)

1. **Name:** The Price Is Live. A group FaceTime Price Is Right using real items from players' homes.
2. **Start:** the main player FaceTimes the agent's Chert number, then adds friends (needs group calls on the line). See section 0 item 1 for the Plan B/C fallbacks.
3. **Players:** 2 to 4. Names come from FaceTime caller names; fallback: the host asks each person to say their name. (In practice we get names from the join text, section 8.1.)
4. **Full game:** one item per player, then a final scoreboard. Fixed turn order shown on screen. The host calls each player by name.
5. **Item flow:** the owner texts (iMessage) the item description (for example "Owala bottle") to the agent right before their turn. The AI prices it: first a reference list of about 200 common home/school items with real prices; then web search if there is no match. If unclear, the AI uses its best judgment and labels the price "estimate" at the reveal. If the owner forgets to text, the agent identifies the item from the owner's camera (depends on caller-camera capture).
6. **The owner holds the item up** to their camera so everyone sees it.
7. **Guessing:** spoken out loud, one player at a time, with a **10-second countdown** on the host's video. The host repeats each guess back and the player says yes or corrects it. **Silence when the timer ends = 0 points** for that round.
8. **Scoring:** a guess at or under the price earns up to 100 points scaled by closeness. Any guess over earns 0. Round winner (closest without going over) gets +25. If everyone goes over, the lowest guess wins the round and gets the +25. The owner earns "stump points," up to 100, based on how far off the other players' guesses are on average. Exact formulas in section 6.
9. **Reveal:** a drumroll, then the price pops up big on the host's video.
10. **End:** the agent texts a results card (final scoreboard plus each item and its real price) and offers a rematch.
11. **Host:** lively, funny, big game show energy, light jokes, never mean. **Avatar:** cartoon retro game show host in a suit with a mic, with a simple mouth-flap animation while talking.
12. **Video:** a full game show stage with a podium for each player (name and score), captions of the host's lines, the timer, and the turn order.
13. **No web link. FaceTime only.** Judges call the number.
14. **Demo mode:** 2 minutes maximum, 2 items. The team of four plays: the owner gets stump points, the other three guess each round.
15. **Measured number:** price accuracy. Build the reference list (about 200 items) plus a **held-out test set of 30 to 50 items NOT on the list**. Report the percent within 15% (and maybe 25%). Compare **list + AI** against **AI alone**.
16. **Team:** Ethan (ethnmz) leads design, host avatar and stage video, overlays, captions, demo, Devpost/pitch, and the measured-number write-up. Diego (Navibytes): Chert bridge, voice (speech-to-text, text-to-speech), calls, iMessage. Akshi (biswalakshi): AI and vision, item identification and pricing logic, host script and personality prompts. Aditri (aditrit06): backend, game state and scoring, deployment, reference list and test set and accuracy harness.

### 4.1 Small additions made while writing this spec (flagged so Ethan can veto)
- A. Players join by texting "I'm in" (needed for the reply window and names).
- B. A guess can also be sent by **text** as a backup if audio is dead or unclear (section 9.6). Spoken stays primary.
- C. Confirm-back: if the player stays silent for 3 s after the host repeats the guess, it counts as "yes" so the game never stalls.
- D. Guesses under $1 are raised to $1. Ties for round winner both get the +25.
- E. A hard game clock of 4:30 with a "lightning mode" to finish in time (section 7.4).
- F. A stump-point cap per guesser and a scale so that an average miss of 50% earns the full 100 (section 6).
- H. **Sponsor stack (added Nov 14, 5:55 PM):** ElevenLabs is the host voice (and optionally the speech-to-text), Gemini does pricing, camera identification, and host lines, MongoDB Atlas stores the data. Section 21.
- G. Rematch is a **new outbound group call** to everyone's phone when someone texts REMATCH (a trial call cannot go past 5 minutes).

---

## 5. The game in plain words

1. 2 to 4 players are on one group FaceTime with the host (our agent).
2. Everyone has texted the line "I'm in, I'm {name}". The host greets them by name and explains in 12 seconds.
3. The host goes through the players in a fixed order. Each player gets **one turn as the owner**.
4. On a turn, the owner holds up a real item from their home. Their item text has already told the agent what it is, and the agent has priced it behind the scenes. The other players do not see the name or price on the stage.
5. The other players guess the price **one at a time**, out loud, with a 10-second countdown. The host repeats each guess back. The player says "yes" or corrects it.
6. Drumroll. The real price pops up. Points are given (section 6).
7. After the last turn, the host shows the final scoreboard, names the champion, texts everyone a results card, and offers a rematch.

Number of rounds = number of players (4 players = 4 rounds). In a round with 4 players, 3 people guess and 1 is the owner. In a 2-player game, 1 person guesses each round.

---

## 6. Scoring (exact formulas)

Money is stored as **integer cents**. `price` = the item price in cents (always at least 100). `g` = a guess in cents.
Rounding rule everywhere: **round half up** (`Math.round`). Do not use banker's rounding.

### 6.1 Guesser points (for each guess in a round)
- Normalize: if the player gave a number, `g = max(g, 100)` (a guess under $1, including "zero", counts as $1).
- If the player said nothing usable before the timer ended, or passed: status `silent` (or `pass`), **0 points**, and they cannot win the round.
- If `g <= price`: `guessPoints = round(100 * g / price)`. Exactly the price gives 100.
- If `g > price`: `guessPoints = 0` ("over").

### 6.2 Round winner (+25 bonus)
- Look at valid guesses (status `locked`).
- If any are at or under the price: the **highest** one wins. If two or more players tie on the same highest guess, **all of them** win and each gets +25.
- Else if there are valid guesses and all are over: the **lowest** guess wins, and gets +25 (a tie again shares it).
- If nobody gave a valid guess: no winner, no bonus.
- `roundPoints(player) = guessPoints + (isWinner ? 25 : 0)`. The most a guesser can earn in a round is 125.

### 6.3 Owner stump points (up to 100)
- Take every valid guess. For each: `miss = min(1, abs(g - price) / price)`. The cap of 1 stops one silly guess like $10,000 from breaking the math. Over guesses count too.
- `meanMiss = average(miss)` over valid guesses. If there are no valid guesses, stump = 0.
- `stumpPoints = round(100 * min(1, meanMiss / 0.5))`. An average miss of 50% or more gives the full 100.
- The owner gets no guesser points in their own round.

### 6.4 Game result
- Total = sum of all round points and stump points. Highest total wins. A tie at the top is a shared title ("co-champions"). Sort the scoreboard by total, then by number of round wins, then by seat order.
- Maximum: a player can earn at most about 125 per guessing round plus up to 100 as the owner.

### 6.5 Worked examples (the test suite must include all of these; computed with the formulas above)

**Example 1: normal round.** Price $34.99 (3499). Owner Ethan. Guesses: Diego $30.00, Akshi $40.00, Aditri $25.00.
- Diego: round(100 × 3000/3499) = round(85.74) = **86**. Akshi: over = **0**. Aditri: round(100 × 2500/3499) = round(71.45) = **71**.
- Highest at or under = Diego, so Diego +25 → **111**. Akshi 0. Aditri 71.
- Misses: Diego 0.1426, Akshi 0.1432, Aditri 0.2855 → mean 0.1904 → round(100 × 0.1904/0.5) = **38** stump points for Ethan.

**Example 2: everyone goes over.** Price $12.00 (1200). Guesses: Diego $15, Akshi $20, Aditri $13.
- All guess points 0. Lowest guess = Aditri ($13), so Aditri gets **25**. Diego 0, Akshi 0.
- Misses: 0.25, 0.6667 (|2000-1200|/1200), 0.0833 → mean 0.3333 → round(100 × 0.3333/0.5) = **67** stump points.

**Example 3: tie.** Price $50.00 (5000). Guesses: Diego $45, Akshi $45, Aditri $30.
- Diego round(100 × 4500/5000) = 90, Akshi 90, Aditri 60. Diego and Akshi tie for highest, so both get +25 → **115, 115, 60**.
- Misses: 0.1, 0.1, 0.4 → mean 0.2 → round(100 × 0.2/0.5) = **40** stump points.

**Example 4: zero guess and silence.** Price $8.00 (800). Diego says "zero", Akshi says nothing, Aditri says $6.
- Diego's guess is raised to $1.00 (100): round(100 × 100/800) = round(12.5) = **13** (half up). Akshi: silent, **0**. Aditri: round(100 × 600/800) = **75**, and Aditri wins, +25 → **100**.
- Misses (Diego, Aditri only): 0.875, 0.25 → mean 0.5625 → capped at 1 after dividing by 0.5 → **100** stump points.

**Example 5: exact hit.** Price $20.00. Guesses: A $20.00, B $15.00, C $25.00. A = 100 + 25 = **125**. B = 75. C = 0. Misses 0, 0.25, 0.25 → mean 0.1667 → **33** stump points.

**Example 6: demo mode.** Same rules. Two rounds, 3 guessers each, so the four teammates each score as owner once (stump) and as a guesser once.

---

## 7. Game flow as a state machine

The game engine (Aditri) is a **pure function**: `reduce(state, event) → { state, effects[] }`. It does no I/O. Other modules execute the effects and send events back. This lets us test the whole game with fake events and no phone call (section 17).

### 7.1 Config constants (`src/config.ts`)
| Name | Value | Meaning |
|---|---|---|
| `HARD_CAP_MS` | 270000 | The game must reach FINALE by 4:30 after `bridge_ready`. Trial calls end at 5:00. |
| `GUESS_SECONDS` | 10 | Countdown on screen per guess. |
| `CONFIRM_SILENCE_MS` | 3000 | Silence after the host repeats a guess counts as "yes". |
| `PRICE_TIMEOUT_MS` | 8000 | Max wait for pricing, then use an estimate. |
| `ITEM_WAIT_MS` | 6000 | After "hold it up", wait this long for a camera ID result before asking out loud. |
| `LOBBY_SETTLE_MS` | 8000 | Start when 2 or more players joined and nobody new joined for this long. |
| `LOBBY_MAX_WAIT_MS` | 60000 | Give up if still under 2 players. |
| `DIAL_TIMEOUT_MS` | 45000 | Max wait for `bridge_ready` after dialing (Plan B). |
| `MIN_PLAYERS`, `MAX_PLAYERS` | 2, 4 | |
| `DEMO_ITEMS` | 2 | Rounds in demo mode. |
| `STAGE_FPS` | 15 | |
| `STAGE_W`, `STAGE_H` | 960, 540 | Landscape default. UNVERIFIED best size for FaceTime; make configurable. |

### 7.2 Events the engine receives
`BOOT`, `TEXT_RECEIVED {phone, text, msgId, at}`, `DIAL_REQUESTED`, `CALL_READY {callId, at}`, `CALL_ENDED {reason}`, `SPEECH_FINAL {text, confidence, at}`, `SPEAK_DONE {speakId}`, `TIMER {timerId}`, `PRICE_READY {itemId, result}`, `PRICE_FAILED {itemId}`, `FRAME_ID_READY {itemId, label, confidence}`, `TICK {now}` (once per second, drives the hard clock and countdown).

### 7.3 Effects the engine returns
`SPEAK {speakId, line, priority}` (host line, also shown as a caption), `SFX {name}`, `STAGE {StageState}` (full snapshot; Ethan's renderer redraws), `SEND_TEXT {phone, text}`, `PRICE_ITEM {ItemRequest}`, `IDENTIFY_FROM_CAMERA {itemId, ownerId}`, `LISTEN {on|off}`, `START_TIMER {timerId, ms}`, `DIAL {phones[]}`, `END_CALL`, `PERSIST {kind, doc}` (store this in MongoDB Atlas; see 21.4), `LOG {...}`.

### 7.4 States, triggers, timeouts, host lines, stage

The host line keys (like `connect.hello`) point to the script in section 12. `lightning` means lightning mode (below the table).

| # | State | Enter when | What happens | Host says (key) | Stage shows | Exits when / timeout |
|---|---|---|---|---|---|---|
| 0 | `BOOT` | process starts | Load config, reference list, start LiveKit agent worker, check Chert line. | none | none (no call) | ready → `WAIT_CALL` |
| 1 | `WAIT_CALL` | boot done, or game over | Registry collects join texts. Accept inbound call (Plan A), or wait for `start` text (Plan B). | none | none | inbound `CALL_READY` → `CONNECTED`. `start` text from main player with 2+ registered players → `DIALING`. |
| 2 | `DIALING` | Plan B start | `DIAL {phones}`: build bridge token, `POST /v1/calls` with `recipients`. Text the group "Calling you now! Pick up FaceTime." | none | none | `CALL_READY` → `CONNECTED`. After `DIAL_TIMEOUT_MS` or a Chert error → retry once, then text "Couldn't connect. FaceTime this number instead." → `WAIT_CALL`. |
| 3 | `CONNECTED` | `CALL_READY` | **Start hard clock** (`callStart = at`). Publish stage video immediately. Greet within 2 s (Chert ends silent calls about 10 s after `bridge_ready`). | `connect.hello` | Title card "THE PRICE IS LIVE" | immediately → `LOBBY` |
| 4 | `LOBBY` | after hello | Show a podium for each registered player. Wait for roster to settle. If the roster is empty (Plan A, nobody texted), run the **name round** (section 9.7): host asks "Who's first? Say your name!" and listens 6 s per name, repeating until the person says "that's everyone" or 4 names are collected. | `lobby.waiting` / `lobby.joined` / `lobby.nameask` | Podiums fill in as players join, big text "Text this number: I'm in, I'm {name}" until 2+ joined. | Roster has 2 or more and no change for `LOBBY_SETTLE_MS`, or roster is 4, or someone says/texts "start" or "let's go" → `RULES`. Under 2 players after `LOBBY_MAX_WAIT_MS` → host `lobby.giveup` → `ENDING`. |
| 5 | `RULES` | lobby done | Fix turn order = join order (main player first). Number of rounds = players (or `DEMO_ITEMS`). Text item prompt (section 11) to owner 1. | `rules.full` (`rules.short` in lightning/demo) | Rules card with turn order list and "Closest without going over wins". | `SPEAK_DONE` → `ROUND_START` (round 1) |
| 6 | `ROUND_START` | next round | Pick owner. **Text the item prompt to the next owner** (k+1) if not yet sent. If an item text for this owner already arrived, its `PRICE_ITEM` is already running. | `round.start` + (`round.nextprompt` if a next owner exists) | Spotlight on owner podium, "ROUND 2 OF 4", turn order strip, mystery crate icon. | `SPEAK_DONE` → `ITEM_RESOLVE` |
| 7 | `ITEM_RESOLVE` | after round start line | Branches: **(a)** price ready → go. **(b)** item text arrived, price pending → vamp line, wait up to `PRICE_TIMEOUT_MS`, then use an estimate. **(c)** no item text → `IDENTIFY_FROM_CAMERA` (grab frames after "hold it close and fill the screen"), wait up to `ITEM_WAIT_MS`. **(d)** camera unavailable or low confidence → ask out loud "What is it, in a few words?", listen 8 s, price from speech. **(e)** still nothing by 12 s → **prop closet**: the engine picks a random item from the reference list (the game never blocks). | (b) `item.pricing` (c) `item.camera` (d) `item.ask` (e) `item.propcloset` | Mystery crate, spinner "Checking the price tag...". Never show the item name or price. | Priced item exists → `SHOW_ITEM`. |
| 8 | `SHOW_ITEM` | item priced | Wait 4 s (3 s in demo) for owner to hold it up. | `item.holdup` (+ `item.quip` if lightning is off and a quip came back in time) | Big "MYSTERY ITEM" card from owner's name. Owner podium glows. | timer → `GUESS_TURN` (first guesser) |
| 9a | `GUESS_PROMPT` | guesser j starts | `LISTEN off` while the host talks (so the host voice is not mistaken for a guess). | `guess.prompt` ("{name}, what's your guess?") and sometimes `guess.quiet` ("everyone else, zip it!") | Guesser podium lit, "{name} is guessing". Timer ring full, not running yet. | `SPEAK_DONE` (or 1.5 s max after speak start) → `GUESS_LISTEN` |
| 9b | `GUESS_LISTEN` | after prompt | `LISTEN on`. Start the 10-s countdown (the `TICK` or a `START_TIMER`). Each `SPEECH_FINAL` goes through the number parser (section 9). The **first parsable amount** wins. Text guesses from this player's phone also count (section 9.6). | none (host silent; caption "Listening...") | **Countdown ring 10→0** on screen, big numbers, last 3 s turn red. Live transcript fragment under podium ("twenty five..."). | amount found → `GUESS_CONFIRM`. Timer hits 0 with no amount → `GUESS_SILENT`. Player says "pass" / "I don't know" → host `guess.nudge` once and the timer keeps running; second time = silent. |
| 9c | `GUESS_CONFIRM` | amount found | `LISTEN off` briefly while host repeats, then `LISTEN on` for up to `CONFIRM_SILENCE_MS` (3 s). "yes/yeah/correct/locked/that's right" → lock. A different amount → replace it and say `guess.confirm` again once; a second correction is accepted as final with no more repeat. "no" with no amount → go back to `GUESS_LISTEN` with only the time that was left (minimum 4 s). Silence → lock. | `guess.confirm` ("Twenty-five dollars. Right?") then `guess.locked` ("Locked in!") | Podium shows "$25.00 ?" then "$25.00 ✓". | → next `GUESS_PROMPT`, or `REVEAL` after the last guesser. |
| 9d | `GUESS_SILENT` | timer 0, no amount | Record `silent`, 0 points. | `guess.silent` ("Time's up! Zero for {name}!") | Podium shows "—" and a buzzer flash. | → next guesser or `REVEAL` |
| 10 | `REVEAL` | all guesses in | `LISTEN off`. `SFX drumroll`, wait 3 s (2 s in lightning), `SFX ding`. | `reveal.drumroll` then `reveal.price` (read the price; add "That's an estimate!" if estimate) | **Drumroll animation** (podiums shake, spotlight sweep). Then the price **pops up huge** in the center, with the item name below it and "ESTIMATE" tag if so. Holds 3 s. | `SPEAK_DONE` → `ROUND_SCORE` |
| 11 | `ROUND_SCORE` | after reveal | Engine runs section 6. Updates totals. | `score.winner` / `score.allover` / `score.nowinner` / `score.stump` + `score.tie` when needed | Points fly onto podiums (+86, +25 bonus, owner +38 STUMP!). Winner gets a crown. Guess vs price shown for each guesser for 3 s. | `SPEAK_DONE` + 1 s → next `ROUND_START`, or `FINALE` if last round |
| 12 | `FINALE` | last round done, or hard clock hit | `SEND_TEXT` results card to every player **right away** (so it arrives while they watch). | `finale.drumroll`, `finale.champion` (or `finale.cochamps`), `finale.thanks` | Podiums rearrange by rank, confetti, big winner banner, final scoreboard. Item recap strip ("Ethan: Owala $34.99"). | `SPEAK_DONE` → `REMATCH_OFFER` |
| 13 | `REMATCH_OFFER` | after finale | Listen for "rematch/again/yes" for up to 8 s, and watch for REMATCH text. | `rematch.offer` | Banner "TEXT REMATCH TO PLAY AGAIN". | Any rematch signal → set `rematchRequested`. 8 s timeout or either → `ENDING`. |
| 14 | `ENDING` | finale done, clock expired, or fatal error | Host goodbye, then `END_CALL` (API `end` with its own idempotency key). Clean up room and timers. If `rematchRequested`, wait for the call to be terminal, then `DIAL` all players again (new game). | `end.bye` | "THANKS FOR PLAYING" card | `CALL_ENDED` → `WAIT_CALL` (registry kept if rematch, else cleared) |

**Hard clock (every `TICK`, any state from `CONNECTED` on):**
- `elapsed = now - callStart`.
- At `elapsed >= HARD_CAP_MS` (4:30): abandon any round in progress (do not score it), go to `FINALE` with scores so far, and shorten the finale (no drumroll, say `finale.shortcap`).
- **Lightning mode**: at each `ROUND_START`, compute `projected = elapsed + (roundsLeft * avgRoundMs) + 25000`. `avgRoundMs` is the average of finished rounds, starting at 48000. If `projected > HARD_CAP_MS`, set `lightning = true` for the rest of the game: use short rules, skip quips and jokes, 2-s drumroll, skip confirm-back when the parser is sure (confidence 0.8 or more, no "ambiguous" flag), and hold the reveal 2 s.
- At `elapsed >= 4:10`, do not start a new round that cannot finish; go to `FINALE`.

**Failure rules:**
- Call ends unexpectedly (`CALL_ENDED` before `ENDING`): if at least one round was scored, text everyone "The call dropped. Here are the scores so far" with the results card and rematch offer; clear state; go to `WAIT_CALL`.
- Engine receives a timer or event that does not belong to the current state: ignore it and log it. Never crash.
- Any thrown error in an effect handler: log it, keep the game going using a fallback (for example, pricing failure → estimate or prop closet).

### 7.5 Timing budget (to check the game fits)
| Piece | Normal | Lightning | Demo |
|---|---|---|---|
| Connect + hello + lobby | 10 s | 8 s | 6 s |
| Rules | 12 s | 5 s | 4 s |
| Per round: start line + item (priced already) + hold-up | 9 s | 6 s | 6 s |
| Per guess (prompt 2 s + say 3-6 s + confirm 2-3 s; max 15 s) | 7-13 s | 6-9 s | 7-9 s |
| Reveal (drumroll 3 s + price 2 s + hold) | 8 s | 5 s | 6 s |
| Score | 5 s | 3 s | 4 s |
| Finale + rematch + bye | 15 s | 8 s | 8 s |
A 4-player normal game is roughly 10+12+4×(9+3×9+8+5)+15 ≈ 3:45 to 4:15. That is why the hard clock exists. A 2-player game is about 2:15.

---

## 8. Architecture and stack

### 8.1 How the call gets connected (the game does not care which)
The engine only sees `CALL_READY`. A `CallPort` hides the plan.
- **Plan A (locked, UNVERIFIED):** Diego runs `chert dev --agent <AGENT_NAME>`. A player FaceTimes the number and adds friends. Players still text "I'm in, I'm {name}" for names, phones, and the reply window. If nobody texts, run the name round (state 4).
- **Plan B (build first):** `CallPort.dial(phones)` builds a fresh bridge token (section 3.4), joins the agent to the room first (publishing silent audio and the stage video), then `POST /v1/calls` with `recipients`. Players just answer FaceTime. **Do not greet on room join. Greet on `bridge_ready`** (poll `GET /v1/calls/{id}/events` every 1 s, or use the SDK).
- **Plan C (experimental):** main player texts a FaceTime link; Diego sends `destination_type: "facetime_link"`. Same as Plan B otherwise.
- Config flag `CALL_MODE=inbound|outbound_group|link`.
- Join registry (all plans): `registry[phone] = { name, joinedAt, isMain }`. Name parsing from the text: strip "I'm in", "im in", "i'm", "it's", "this is"; take the remaining words, title-case, 12 characters max, default `Player N`. First registrant is the main player.

### 8.2 Recommended stack (and why)
- **TypeScript on Node 22/24**, running one process: the LiveKit agent. Reasons: (1) it matches Chert's official starter (`chert new --video`, `@livekit/agents`, `@trychert/sdk`, all JavaScript/TypeScript), so the video publishing and `chert dev` plumbing already work; (2) one language for four people and four coding agents; (3) the stage is drawn in-process, so there is no extra service to break. Python also works (Onset used a Python LiveKit agent) but there is no Python Chert SDK, and glue between the Node starter and a Python renderer is extra risk overnight.
- Packages: `@livekit/agents`, `@livekit/rtc-node` (audio and video tracks), `livekit-server-sdk` (bridge token), `@trychert/sdk@0.3.0` (optional; plain `fetch` also works), `@napi-rs/canvas` (draw the stage), `sharp` (resize and JPEG-encode camera frames), `@google/genai` (Gemini: pricing, vision, host lines, embeddings), `@elevenlabs/elevenlabs-js` or plain `fetch`/`ws` (ElevenLabs voice and speech-to-text), `mongodb` (Atlas), `zod` (validate JSON from the model), `vitest`, `tsx`, `pino` for logs. `openai` is an **optional fallback** only (the Chert starter uses it). Exact JS API names for rtc-node (`VideoSource`, `VideoFrame`, `LocalVideoTrack`, `AudioSource`, `AudioFrame`, `AudioStream`, `VideoStream`) and for the sponsor SDKs are from memory of their docs: **UNVERIFIED, check them against the installed versions and the Chert starter.**
- **Host voice (ElevenLabs, sponsor track):** the host speaks with **ElevenLabs text-to-speech**, streamed (model `eleven_flash_v2_5` for speed; WebSocket `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input` or the HTTP streaming endpoint; ask for PCM output such as `pcm_24000`). We push the PCM into one `AudioSource` we own, and mix sound effects into the same stream in code. Reasons: exactly one audio publisher is required; we need to mix the drumroll in; we get the loudness of the outgoing audio to drive the mouth flap; and we control exactly when a line starts and ends. A lively game show voice is chosen from the ElevenLabs voice library with low stability and some style (section 21.2). **Free-tier character limits are small, so static lines are pre-generated and cached on disk and the API is only called for lines with names or amounts.** Fallback if ElevenLabs fails or the quota is gone: OpenAI TTS (optional) or pre-cached lines only. Do not use a realtime voice model as the host; it is too hard to keep on script.
- **Listening:** subscribe to `facetime-remote-audio` and stream it to speech-to-text **only while `listen(true)`** (this also saves credits). Default: **ElevenLabs Scribe v2 Realtime** over WebSocket `wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=vad` (send `input_audio_chunk` messages, receive `partial_transcript` and `committed_transcript` events; **UNVERIFIED:** exact message fields and that it works on our key). Fallbacks, switched by `STT_PROVIDER`: OpenAI streaming transcription, or Deepgram `nova-3`. Diego checks the live API.
- **AI model: Gemini (sponsor track).** `@google/genai` with a Gemini Flash-class model for pricing (with **Google Search grounding**), camera item identification (vision), host-line generation, and embeddings. Model names go in env vars (`GEMINI_MODEL`, `GEMINI_EMBED_MODEL`); **UNVERIFIED which names the free key can use today** (a search on Nov 14 mentioned `gemini-3.5-flash`; `gemini-2.5-flash` is the safe older default). Free key from Google AI Studio. Not for sensitive data on the free tier (section 21.3).
- **Database: MongoDB Atlas (sponsor track).** Free M0 cluster. Stores the reference list (and its embeddings for Atlas Vector Search), games, players, rounds, guesses, scores, results, a price cache, and eval runs. The game never waits on the database (section 21.4).
- **Where it runs:** one Mac or Linux laptop on solid Wi-Fi is the most reliable (the Chert connector needs macOS or Linux and a foreground terminal). Backup: the same Docker image on a small cloud VM with `chert dev` in a tmux session. Aditri owns this.
- **No web server needed.** Polling covers iMessage; the call API covers calls.

### 8.3 Repo layout (create exactly this; one owner per folder)
```
price-is-live/
  README.md  SPEC.md (copy of this file)  package.json  tsconfig.json  .env.example  .gitignore
  src/
    agent.ts                 entry point, wires ports to the engine           (Diego, helped by Aditri)
    config.ts                constants from section 7.1 + env loading         (Aditri)
    contracts/types.ts       all shared types (section 8.5)                   (Aditri; FROZEN at M0)
    contracts/ports.ts       interfaces between modules (section 8.5)         (Aditri; FROZEN at M0)
    engine/                  reducer.ts scoring.ts registry.ts clock.ts effects.ts   (Aditri)
    comms/                   call.ts token.ts voice.ts mixer.ts stt.ts tts.ts (ElevenLabs) imessage.ts   (Diego)
    speech/                  parseGuess.ts yesno.ts nameParse.ts              (Diego)
    ai/                      pricing.ts matchList.ts webSearch.ts estimate.ts identify.ts
                             host/lines.ts host/persona.ts host/quips.ts      (Akshi)
    store/                   mongo.ts schemas.ts seed.ts vectorSearch.ts persist.ts   (Aditri; MongoDB Atlas)
    stage/                   render.ts layout.ts host-sprite.ts podium.ts overlays.ts captions.ts
                             reveal.ts publish.ts assets/ (sprites, fonts)   (Ethan)
  data/                      reference-items.json  heldout-test.json  README.md (sources)   (Aditri)
  eval/                      run-eval.ts  report.md  results.json            (Aditri)
  scripts/                   sim-call.ts (fake ports, full game with no phone)  preview-stage.ts (writes PNGs)
  test/                      scoring.test.ts parseGuess.test.ts engine.sim.test.ts pricing.test.ts
```
Ownership rule: **only the owner edits their folder.** To change a shared contract, message the owner of `contracts/` and bump `CONTRACT_VERSION` in `types.ts`. Everyone codes against the ports (fakes exist in `scripts/sim-call.ts`), so nobody waits for anyone.

### 8.4 Runtime picture
```
players' iPhones ──FaceTime──> Chert line/bridge ──LiveKit room──> agent process (Node)
                                                                     ├─ comms/voice: ElevenLabs TTS + SFX mixer -> 1 audio track (host)
                                                                     ├─ stage/publish: canvas frames -> 1 video track (same participant)
                                                                     ├─ comms/stt: remote audio -> text -> speech/parseGuess
                                                                     ├─ comms/call: token, dial, events, end
                                                                     ├─ comms/imessage: poll + send (shared-messages)
                                                                     ├─ ai/*: Gemini pricing (+Google Search grounding), camera ID, host lines
                                                                     ├─ store/*: MongoDB Atlas (games, rounds, guesses, list, cache), never blocks the game
                                                                     └─ engine/*: reduce(state,event) -> effects
players' iMessage <──────────── Chert shared-messages API <───────── comms/imessage
```
Frame loop: `setInterval(1000/STAGE_FPS)` calls `render(stageState, nowMs)` → RGBA buffer → `VideoSource.captureFrame`. The renderer is a pure function of `StageState` plus time, so it can also write PNGs for previews.

### 8.5 Shared data contracts (single source of truth; everything below goes in `src/contracts/`)

```ts
// types.ts   CONTRACT_VERSION = 1
export type Cents = number;                    // integer cents
export type PlayerId = 'p1' | 'p2' | 'p3' | 'p4';

export interface Player {
  id: PlayerId; seat: number;                  // seat 0..3, fixed turn order
  name: string;                                // max 12 chars
  phone: string;                               // E.164, e.g. "+12145550100"
  isMain: boolean; score: number; roundWins: number; joinedAt: number; // ms epoch
}

export interface ItemRequest {
  itemId: string;                              // "r1", "r2", ...
  ownerId: PlayerId;
  origin: 'text' | 'camera' | 'voice' | 'prop_closet';
  rawText?: string;                            // "Owala bottle"
  imageJpegBase64?: string;                    // camera frames (max 3)
}

export interface PriceEvidence {
  kind: 'list' | 'web' | 'model';   // 'web' = Gemini + Google Search grounding source
  label: string;                               // list item name, or page title
  url?: string; priceCents?: Cents; matchScore?: number; // 0..1 for list matches
}

export interface ReferenceItem { id: string; name: string; aliases: string[]; category: string; priceCents: Cents; sizeNote?: string; source: string; checkedAt: string; embedding?: number[]; }

export interface PriceResult {
  itemId: string;
  displayName: string;                         // clean name host can say: "Owala FreeSip water bottle"
  priceCents: Cents;                           // >= 100
  source: 'list' | 'web' | 'estimate';
  isEstimate: boolean;                         // true when source === 'estimate' or confidence < 0.5
  confidence: number;                          // 0..1
  evidence: PriceEvidence[];
  latencyMs: number;
}

export interface Guess {
  playerId: PlayerId;
  status: 'locked' | 'silent' | 'pass';
  cents: Cents | null;                         // after the max(100) rule
  rawTranscript: string | null;
  channel: 'voice' | 'text' | null;
  corrected: boolean;                          // player changed it after confirm-back
}

export interface RoundResult {
  roundIndex: number;                          // 0-based
  ownerId: PlayerId;
  item: { displayName: string; priceCents: Cents; isEstimate: boolean; source: PriceResult['source'] };
  guesses: Guess[];
  guessPoints: Record<PlayerId, number>;       // 0 for owner and non-guessers
  winnerIds: PlayerId[];
  winnerReason: 'closest_under' | 'lowest_over' | 'none';
  bonus: 25;
  stumpPoints: number;                         // goes to owner
  totals: Record<PlayerId, number>;            // running totals after this round
}

export type Phase = 'boot'|'wait_call'|'dialing'|'connected'|'lobby'|'rules'|'round_start'|'item_resolve'
  |'show_item'|'guess_prompt'|'guess_listen'|'guess_confirm'|'guess_silent'|'reveal'|'round_score'
  |'finale'|'rematch_offer'|'ending';

export interface GameState {
  phase: Phase; callId: string | null; callStartAt: number | null;
  demo: boolean; lightning: boolean;
  players: Player[]; turnOrder: PlayerId[];
  roundIndex: number; totalRounds: number;
  currentItem: { itemId: string; ownerId: PlayerId; request: ItemRequest; price: PriceResult | null } | null;
  guessOrder: PlayerId[]; guessIndex: number; guesses: Guess[];
  history: RoundResult[]; pendingItemTexts: Record<PlayerId, string>; // texts received early
  rematchRequested: boolean;
}

// What the renderer needs. Engine builds it, Stage draws it. Nothing else.
export interface StageState {
  phase: Phase;
  title: string | null;                        // "THE PRICE IS LIVE"
  roundLabel: string | null;                   // "ROUND 2 OF 4"
  turnOrder: { id: PlayerId; name: string; done: boolean; current: boolean }[];
  podiums: {
    id: PlayerId; name: string; score: number; seat: number;
    role: 'idle' | 'owner' | 'guesser' | 'winner';
    guessText: string | null;                  // "$25.00" or "—" or "$25.00 ?"
    guessState: 'none' | 'pending' | 'locked' | 'silent' | 'over';
    delta: { guess: number; bonus: number; stump: number } | null; // animate on ROUND_SCORE
  }[];
  caption: { text: string; speaker: 'host' | 'system' } | null;  // latest host line
  timer: { secondsLeft: number; total: number; running: boolean } | null;
  reveal: { stage: 'none' | 'drumroll' | 'price'; priceText: string; itemName: string; isEstimate: boolean; sourceLabel: string | null } | null;   // sourceLabel e.g. "Price list", "Google Search: target.com", "Estimate"
  banner: string | null;                       // "TEXT REMATCH TO PLAY AGAIN"
  joinHint: string | null;                     // "Text this number: I'm in, I'm {name}"
  fallbackBadge: 'TEXT MODE' | 'NO CAMERA' | null;
  hostSpeaking: boolean;                       // renderer also gets live mouth level from VoicePort
  lightning: boolean;
  capRemainingMs: number | null;
  finale: { ranks: { id: PlayerId; name: string; total: number; place: number }[]; champion: string[] } | null;
}
```
```ts
// ports.ts   (every module implements or consumes these; fakes live in scripts/sim-call.ts)
export interface CallPort {
  dial(phones: string[]): Promise<{ callId: string }>;       // Plan B / rematch
  end(): Promise<void>;
  on(ev: 'ready', cb: (e: { callId: string; at: number }) => void): void;   // bridge_ready
  on(ev: 'ended', cb: (e: { reason: string }) => void): void;
  latestCallerFrames(max: number): Promise<Buffer[] | null>;  // JPEGs from facetime-remote-video, null if unavailable
  roomHandle(): unknown;                                      // the connected LiveKit room, for stage/publish
}
export interface VoicePort {
  speak(id: string, text: string, opts?: { rate?: number }): Promise<void>;  // resolves when audio finished
  sfx(name: 'drumroll' | 'ding' | 'buzzer' | 'tada' | 'tick'): Promise<void>;
  stopSpeaking(): void;
  listen(on: boolean): void;                                  // gate STT (off while host talks)
  onSpeech(cb: (e: { text: string; confidence: number; at: number; isFinal: boolean }) => void): void;
  onMouthLevel(cb: (level: number) => void): void;            // 0..1 RMS of outgoing audio, ~20 per second
  onSpeakingChange(cb: (speaking: boolean) => void): void;
}
export interface MessagePort {
  send(phone: string, text: string): Promise<void>;
  onMessage(cb: (m: { id: string; phone: string; text: string; at: number }) => void): void;
}
export interface PricingPort {
  price(req: ItemRequest): Promise<PriceResult>;              // never throws; always returns, worst case an estimate
  identifyFromFrames(jpegs: Buffer[]): Promise<{ label: string; confidence: number } | null>;
}
export interface HostPort {
  line(key: HostLineKey, vars: Record<string, string | number>): string;   // pure, instant, from the script bank
  quip(itemName: string, ownerName: string): Promise<string | null>;       // optional LLM one-liner, returns null on timeout (1.5 s)
}
export interface StorePort {                                   // MongoDB Atlas; every call is non-blocking for the game
  persist(kind: 'player' | 'game' | 'round' | 'guess' | 'result' | 'priceCache', doc: object): void;   // fire and forget, queued with retry
  loadReferenceItems(): Promise<ReferenceItem[]>;                // Atlas first, local JSON fallback
  vectorSearch(queryVector: number[], k: number): Promise<{ item: ReferenceItem; score: number }[]>;   // Atlas Vector Search, [] if unavailable
  getCachedPrice(cleanText: string): Promise<PriceResult | null>;
}
export interface StagePort {
  setState(s: StageState): void;
  setMouthLevel(level: number): void;
  start(room: unknown): Promise<void>;                        // begin publishing frames
  stop(): void;
  renderPng(s: StageState): Buffer;                           // for previews and Devpost screenshots
}
export type HostLineKey = string;   // keys listed in section 12
```
**Rules for all contracts:** money in cents; phones in E.164; all JSON validated with `zod` where it enters the system (model output, polled messages); never log phone numbers in full (last 4 digits only), API keys, or bridge tokens.

---

## 9. Speech handling (mixed audio, turn-taking, confirm-back, number parsing)

### 9.1 The problem
Chert gives us **one mixed audio track** for everyone on the call. No per-person audio, no speaker IDs. So the code cannot know who is talking. We handle it with **turn-taking by design** and **confirm-back**, not with speaker recognition.

### 9.2 Rules
1. **STT is gated.** The speech-to-text only counts words while `listen(true)`. It is off while the host is talking and for **400 ms after** the host stops (players' phones can play the host voice into their mic). It is on only in: `LOBBY` (for "start" and, in the name round, names), `GUESS_LISTEN`, `GUESS_CONFIRM`, the `ITEM_RESOLVE` ask, and `REMATCH_OFFER`.
2. **Only transcripts that start after `listen(true)` count.** Throw away anything older.
3. **One question, one answer.** The host always says whose turn it is by name ("Diego, what's your guess?"). The first parsable amount in the window is that guess, whoever said it.
4. **The host asks everyone else to stay quiet** ("everyone else, zip it!") on the first guess of every round, and in lightning mode only on round 1.
5. **Confirm-back always.** The host repeats the amount in plain words ("Twenty-five dollars. Right?"). If it was a bystander or a misheard number, the real guesser says "no, thirty" and we replace it. Anyone saying "yes" confirms (we cannot tell who). Silence for 3 s also confirms.
6. **If two amounts show up in one transcript** (two people talking at once), take the **last one** and mark `ambiguous`. The confirm-back then catches it.
7. **Partial transcripts** (`isFinal=false`) are used only to show the live fragment on the stage. Only final transcripts are parsed.
8. If STT sends nothing for the whole countdown for two guess windows in a row, assume the audio path is dead: switch on **TEXT MODE** (section 9.6).

### 9.3 Parsed result shape
```ts
interface ParsedGuess {
  kind: 'amount' | 'pass' | 'yes' | 'no' | 'none';
  cents?: number;           // for 'amount', after clamping to [100, 9999900]
  ambiguous: boolean;       // e.g. "two fifty" could be $2.50 or $250
  confidence: number;       // sttConfidence, times 0.8 if ambiguous
  spokenForm?: string;      // what the host repeats: "twenty-five dollars", "twelve dollars and ninety-nine cents"
}
```
`parseGuess(text: string, sttConfidence = 1): ParsedGuess` lives in `src/speech/parseGuess.ts`. It is **deterministic** (no AI call). If it returns `none` but the transcript has digits or number words, the engine may call an optional LLM fallback `ai.parseAmountLLM(text)` (Akshi) with a 1.2 s timeout.

### 9.4 Parsing rules (in this order)
1. Lowercase. Remove filler: um, uh, like, maybe, about, around, probably, i guess, i think, i'll say, my guess is, it's, it is, hmm, ok, okay, "dollars" and "bucks" words are kept to find the boundary, then dropped.
2. **Pass:** "pass", "skip", "i don't know", "no idea", "i have no idea", "no clue" → `pass`.
3. **Self-correction:** if the text contains "no", "wait", "actually", "i mean", "sorry", "make that" followed by another amount, use the amount **after** the last one.
4. **Digits:** `$25`, `25`, `25.50`, `1,200`, `$1.2k`, `12.99` → direct.
5. **Number words** → integer: "twenty five", "twenty-five", "a hundred", "one hundred and twenty", "fifteen hundred" (1500), "two thousand", "a grand" / "a thousand" (1000), "two grand", "a buck" (1), "a couple bucks" (2), "five k" or "5k" (5000).
6. **Dollars and cents:** "twelve dollars and ninety nine cents", "twelve bucks fifty" → 12.50, "thirty bucks fifty cents" → 30.50.
7. **Two-number price talk (no "dollars" word):** two consecutive numbers, the second between 1 and 99 and no "hundred" or "thousand" between them → `dollars.cents`. "twelve ninety nine" → 12.99; "nineteen ninety five" → 19.95; "twenty five fifty" → 25.50; "twelve oh five" → 12.05. If the first number is under 10 (like "two fifty"), set `ambiguous = true` (could be 250). If the second number is a single digit with no "oh" ("twelve five"), it is not a price pattern: treat it as two separate amounts, **take the last one** (5), and flag `ambiguous`. The confirm-back resolves it.
8. **Ranges** ("thirty to forty", "thirty or forty") → take the **first**, `ambiguous = true`.
9. Reject amounts above $99,999 (`none`; the host says `guess.huh`) and non-integers like "point five" alone (`none`).
10. `confidence = sttConfidence * (ambiguous ? 0.8 : 1)`.

### 9.5 Test table for `parseGuess` (all must pass; put these in `test/parseGuess.test.ts`)
| Spoken | Result |
|---|---|
| "twenty five bucks" | 2500 |
| "twenty-five dollars" | 2500 |
| "25" | 2500 |
| "$25.50" | 2550 |
| "um, I'll say thirty" | 3000 |
| "about thirty-five dollars" | 3500 |
| "a hundred" | 10000 |
| "one hundred and twenty" | 12000 |
| "fifteen hundred" | 150000 |
| "a grand" | 100000 |
| "five k" | 500000 |
| "twelve ninety nine" | 1299 |
| "nineteen ninety-five" | 1995 |
| "twenty five fifty" | 2550 |
| "twelve oh five" | 1205 |
| "two fifty" | 250 (ambiguous) |
| "thirty... no, forty" | 4000 |
| "wait actually forty five" | 4500 |
| "thirty to forty" | 3000 (ambiguous) |
| "twelve dollars and ninety nine cents" | 1299 |
| "zero" / "nothing" / "free" | 100 (raised to $1) |
| "a buck" | 100 |
| "pass" / "no idea" | pass |
| "yes" / "yeah that's right" / "locked" / "mm-hm" | yes |
| "no" / "nope" / "wrong" | no |
| "that's too low lol" | none |
| "ten thousand dollars" | 1000000 |
| "I want a hundred thousand" | none (above cap) |

`yes` words: yes, yeah, yep, yup, correct, right, that's right, locked, lock it, sure, uh-huh, mm-hm, affirmative. `no` words: no, nope, wrong, not right, nah. An utterance with both a yes word and an amount counts as an amount (a correction).

### 9.6 TEXT MODE (backup guess channel)
- A text containing a number, from the **current guesser's phone**, during `GUESS_LISTEN` or `GUESS_CONFIRM`, counts as a locked guess with `channel: 'text'`. No confirm-back (we know who sent it). The host says `guess.textack`. Texts from anyone else are ignored until their turn.
- TEXT MODE turns on automatically if STT is silent for two windows in a row, or if Chert reports audio not ready. It shows the `TEXT MODE` badge on the stage, the host says `guess.textmode` once, and the countdown becomes 20 s.
- This also gives us true speaker identity, which spoken guesses cannot.

### 9.7 Name round (Plan A fallback only)
Host asks "Who's our first player? Say your name!" (6 s listen). Take the transcript text after removing "my name is", "i'm", "it's", "this is". Max 12 characters. Repeat up to 4 times; stop on "that's everyone", "that's all", "we're good", or 4 names. These players have no phone number, so the item text path does not exist for them; use the camera/voice path (state 7c/7d) for their items, and the results card goes only to registered phones.

---

## 10. Pricing pipeline and camera fallback

### 10.1 Inputs and outputs
`PricingPort.price(ItemRequest): Promise<PriceResult>`. It **never throws** and always returns within `PRICE_TIMEOUT_MS` (8 s). Worst case is a labeled estimate.

### 10.2 Reference list
`data/reference-items.json`, about 200 common home and school items with real US retail prices, one object each:
```json
{ "id": "ref_0042", "name": "Owala FreeSip water bottle 24 oz", "aliases": ["owala", "owala bottle", "owala freesip"],
  "category": "drinkware", "priceCents": 2799, "sizeNote": "24 oz", "source": "owalalife.com", "checkedAt": "2026-11-14" }
```
Cover: drinkware, school supplies, calculators, headphones, chargers, snacks and drinks (multi-pack or full-size), kitchen basics, small appliances, toiletries, cleaning, bedding/decor, small electronics, clothing basics, sports, toys/games, books. Price = **new, regular retail, US**, no sales or bundles, with a source URL or store and the date checked. Aditri owns it and fills it with help from coding agents that can browse; every price must have a source.

### 10.3 Steps
1. **Clean:** lowercase, remove emoji and filler ("my", "a", "this is"), keep brand and size words.
2. **List match** (instant): score = max of (a) exact alias hit = 1.0, (b) token-set similarity (Dice coefficient on word tokens, plus brand-word bonus), (c) optional embedding similarity using Gemini embeddings (`GEMINI_EMBED_MODEL`, 768 dimensions) stored with each item in Atlas and searched with **Atlas Vector Search** (`StorePort.vectorSearch`); local fallback `data/reference-embeddings.json` with plain cosine similarity.
   - `score >= 0.85` and no size conflict → **result from list** (`source: 'list'`, `confidence = score`).
   - Size conflict (text says "32 oz", list says 24 oz) → treat as 0.6 to 0.85 case.
3. **Web search with Gemini + Google Search grounding** (0.6 ≤ score < 0.85, or no match): ask Gemini, with the `googleSearch` grounding tool on, for the current new US retail price of `"{clean text}"`; request strict JSON `{displayName, priceCents, confidence, sources[]}` validated with zod. Read the sources from the response's grounding metadata (`groundingMetadata.groundingChunks[].web.uri/title`, `webSearchQueries`) and keep them in `evidence` (kind `web`). Rules in the prompt: new, regular price; ignore used, resellers, bundles, shipping. If grounding returned two or more distinct prices, use the median and drop outliers over 3× the median.
   - Grounding with at least 2 sources that agree within 20% → confidence 0.9. 1 source → 0.75. Grounding returned no sources → treat as step 4 (estimate).
   - **UNVERIFIED:** whether Gemini returns grounding metadata when JSON output is also requested in the same call. A Nov 2026 report says it works (after an earlier bug where grounding was silently dropped). Fallback: **two calls**: first a grounded call that answers in plain text, then a second plain call that turns that text into JSON (keep the sources from the first call). Always check that `groundingMetadata` is present before trusting a result as "web".
   - `SearchProvider` interface (so the pipeline is testable): `search(q): Promise<{priceCents: number | null; sources: {title: string; url: string}[]; text: string}>`. Default implementation = Gemini grounding. Fallbacks only if Gemini grounding is unavailable: Tavily or Brave Search plus Gemini extraction; then step 4. The stage shows a small source label at the reveal (for example "Google Search: target.com").
4. **Estimate:** Gemini (no search) gives a typical US new retail price, as JSON `{displayName, priceCents, confidence}`. In the "similar items" case, the prompt includes the top 5 list matches as reference examples ("other items on our price list: ..."), to calibrate. `source: 'estimate'`, `isEstimate: true` whenever this branch supplied the final price **or** confidence < 0.5.
5. **Run steps 3 and 4 in parallel** and use the web result if it arrives in time (6 s); otherwise use the estimate. Overall hard timeout 8 s.
6. **Sanity:** clamp to 100 to 100000 cents. If the model refuses or the item is not a physical product → return `source: 'estimate'` with a prop-closet suggestion flag so the engine can swap it.
7. **Cache** by cleaned text (memory plus `data/cache.json`). Warm the cache for the demo items before the demo.
8. `displayName`: the canonical list name or the model's clean product name; the host says this, not the raw text.
9. The price is **never shown or spoken before the reveal.**

### 10.4 The three variants the accuracy harness compares (section 17.3)
- **A. AI alone:** Gemini prices the text from its own knowledge. No list, no Google Search grounding.
- **B. List + AI:** list match when confident, else Gemini with the top 5 list items (by Atlas Vector Search or local similarity) as reference examples. No grounding.
- **C. Full pipeline:** B plus Gemini with Google Search grounding as in the steps above.

### 10.5 Camera fallback (when no item text arrived)
1. Host (`item.camera`): "I didn't get your text, {owner}! Hold it up close and fill the screen." Wait 1.5 s.
2. `CallPort.latestCallerFrames(3)`: three frames about 400 ms apart from `facetime-remote-video`, resized to 768 px wide, JPEG quality 70. Return `null` if there is no video track, caller capture is off, or the track is muted.
3. `identifyFromFrames(jpegs)`: send the JPEGs to **Gemini** as inline images (multimodal input) with this instruction: *"This is a screenshot of a FaceTime call. Ignore people's faces and FaceTime buttons or names. Find the ONE physical product a person is holding up to the camera. Return JSON: {label: string (brand + product + size if visible), confidence: 0 to 1, notHolding: boolean}. If you cannot tell, set notHolding true."* If a name tile is visible, prefer the one matching `{owner}`.
4. `confidence >= 0.5` and not `notHolding` → price using `label` as the raw text, `origin: 'camera'`.
5. Otherwise → voice path: host `item.ask` ("What is it, in a few words?"), listen 8 s, use the transcript as raw text, `origin: 'voice'`.
6. Still nothing at 12 s total → prop closet (random list item, `origin: 'prop_closet'`).
7. **Privacy:** frames stay in memory only, are never saved to disk or logged, and are dropped right after the call to the model.
8. **UNVERIFIED in group calls:** whether the capture shows the owner's tile or a composite. That is why the text path is primary.

---

## 11. iMessage messages (exact templates)

Send with `MessagePort.send(phone, text)`. Replace `{...}`. Emoji are fine. Never exceed 4,000 characters. Use idempotency key `{gameId}:{type}:{last4}:{n}`. If a send fails, retry once, then log and move on (the game continues).

**Unknown text (anyone texts anything else while idle)**
`Hey! I'm the host of THE PRICE IS LIVE 🎤 Text me "I'm in, I'm {yourName}" to join a game.`

**Join reply** (to "I'm in ...", sent immediately)
`🎉 You're in, {name}! You're player {n}. Players so far: {names}. When it's your turn, I'll text you to send your item (like "Owala bottle"). The first player can text "start" to begin.`

**Starting a call (Plan B), to every registered phone**
`📞 Calling you now! Pick up the FaceTime to play THE PRICE IS LIVE.`

**Can't connect**
`Hmm, I couldn't connect the call. Try FaceTiming this number, or text "start" again.`

**Item prompt** (sent to owner k+1 at the start of round k; owner 1 at `RULES`)
`{name}, you're up {when}! Text me the item you're holding up, like "Owala bottle". Brand and size help! 🛍️`
where `{when}` is `next` (round k+1) or `first` (round 1).

**Item received (clear)**
`Got it: {item}. 👍 Hold it up when the host calls you!`
**Item received (unsure, sent when pricing returns an estimate)**
`Got it: {item}. I'm not 100% sure on this one, so I'll call the price an estimate. Hold it up when the host calls you!`
**Item received too late** (after the owner's round started)
`Thanks! That came in a little late, so the host used the camera. Next time send it before your turn.`

**Guess received by text**
`Got your guess: {amount}. 🔒`
**Bad guess text (no number)**
`I need a number, like "25" or "$12.99".`

**Results card** (sent to every registered player at the start of `FINALE`)
```
🏆 THE PRICE IS LIVE: FINAL SCOREBOARD
🥇 {name1}: {total1} pts
🥈 {name2}: {total2} pts
🥉 {name3}: {total3} pts
4️⃣ {name4}: {total4} pts

🛍️ THE ITEMS AND REAL PRICES
• {owner1}'s {item1}: {price1}{estimateTag1}
• {owner2}'s {item2}: {price2}{estimateTag2}
...

👑 {champion} wins!   (or: 👑 {nameA} and {nameB} tie for the win!)
{capLine}
🔁 Want a rematch? Reply REMATCH and I'll FaceTime everyone back.
```
Rules for the card: rank by section 6.4 (ties share a place); `{price}` is `$34.99`; `{estimateTag}` is ` (estimate)` or empty; skip lines for missing players (2 or 3 player games); `{capLine}` is `⏱️ Time ran out after {k} of {n} rounds.` or empty; one blank line between blocks.

**Rematch** (also appended as the last line of the card; sent alone if the call drops)
`🔁 Want a rematch? Reply REMATCH and I'll FaceTime everyone back.`
**Rematch acknowledged**
`You got it! Calling everyone back in a few seconds. 📞`
**Call dropped** (if at least one round was scored)
`😬 The call dropped. Here are the scores so far:` followed by the results card body.

---

## 12. Host script and personality prompt

Host name: **Chip Dollar** (our own character, not a real person). Style: a retro TV game show host. Fast, warm, loud-ish, silly. Light jokes about the situation, never about a player's body, money, family, school, race, gender, or anything personal. **Never mean.** Short sentences so TTS stays quick. No emoji in spoken lines.

### 12.1 Personality prompt (for `ai/host/persona.ts`, used for quips and any generated line)
```
You are Chip Dollar, host of THE PRICE IS LIVE, a retro TV game show played on a group FaceTime call.
Voice: upbeat, fast, big game show energy, a little cheesy. Kind and funny, never mean.
Rules: speak in 1 short sentence (max 15 words). Plain everyday words. No emoji. No hashtags.
Never insult or tease a player's looks, money, family, school, or identity. Joke about the ITEM or the SITUATION only.
Never say the price or hint at it. Never mention being an AI unless asked.
If you are unsure, say something simple and cheerful.
```
Host lines are generated by **Gemini** (sponsor track), always inside the personality prompt and the filters below; every generated line has a canned fallback. Besides item quips, Gemini may vary the round recap line and the intro, but each generated line must stay at or under 18 words (ElevenLabs characters are limited). Quip request: `Item: {itemName}. Owner: {ownerName}. Give one playful one-liner about the item, with no price or number.` Reject any output over 18 words, with digits, or with a `$` sign, and fall back to a canned line. Timeout 1.5 s, then skip the quip.

### 12.2 Line bank (keys used by the engine; the host picks a random variant, never the same one twice in a row)
Variables: `{name}` guesser or player, `{owner}`, `{amount}` spoken amount, `{price}` spoken price, `{winner}`, `{item}`, `{n}` count.

- `connect.hello`: "Hello, hello, HELLO! Welcome to THE PRICE IS LIVE! I'm your host, Chip Dollar!" / "Ladies and gentlemen, the lights are up and the cameras are rolling! I'm Chip Dollar!"
- `lobby.waiting`: "I only see {n} of you so far. Text me 'I'm in' and your name!" / "Waiting on contestants! Text this number 'I'm in', then your name!"
- `lobby.joined`: "Welcome to the show, {name}!" / "{name} just walked on stage! Give it up!"
- `lobby.nameask`: "Who's our first player? Say your name!" / "Next contestant, say your name!"
- `lobby.giveup`: "Looks like we need at least two players. Come back with a friend and we will play!"
- `rules.full`: "Here's how it works. Everyone brings one item from home. Guess the price, closest without going over wins! Go over, and you get zero!"
- `rules.short`: "One item each. Closest without going over wins!"
- `round.start`: "Round {n}! {owner}, you're up with a mystery item!" / "It's round {n}! Come on down, {owner}!"
- `round.nextprompt`: "{next}, text me your item, you're next!" / "Get your item texted in, {next}!"
- `item.pricing`: "Let me check the price tag on that one..." / "One moment, flipping through my big book of prices..."
- `item.camera`: "I didn't get your text, {owner}! Hold it up close and fill the screen." 
- `item.ask`: "What is it, in a few words?" 
- `item.propcloset`: "No worries! I'll grab something from my prop closet."
- `item.holdup`: "{owner}, hold that item up high so everyone can see it!" / "Show it off, {owner}! Nice and close to the camera!"
- `item.quip`: generated (section 12.1), or canned: "Oh, that's a fancy one!" / "I have a feeling about this one." / "Interesting choice, {owner}!"
- `guess.prompt`: "{name}, what's your guess?" / "{name}, how much? Go!" / "{name}, your price, please!"
- `guess.quiet`: "Everyone else, zip it!" (said before the first prompt of a round)
- `guess.nudge`: "Take a swing, {name}! Any number!" 
- `guess.huh`: "That number was too wild for me. Try again, {name}!"
- `guess.confirm`: "{amount}. Right?" / "I heard {amount}. Is that right?" / "{amount}, yes?"
- `guess.locked`: "Locked in!" / "You got it!" / "Done and done!"
- `guess.silent`: "Time's up! Zero for {name}. Ouch!" / "Tick tock! No guess, no points, {name}!"
- `guess.textack`: "Got your text, {name}. {amount}!"
- `guess.textmode`: "Having trouble hearing you! Text me your guesses instead!"
- `reveal.drumroll`: "And the real price is... drumroll, please!" / "Let's see what the price tag says!"
- `reveal.price`: "{price}!" then, if estimate: "That's my best estimate!"
- `score.winner`: "{winner} wins the round! Plus twenty-five bonus points!" / "Closest without going over, it's {winner}!"
- `score.tie`: "A tie! {winner} and {winner2} both get the bonus!"
- `score.allover`: "Everybody went over! Lowest guess wins, so it's {winner}!"
- `score.nowinner`: "No winner this round! Nobody guessed!"
- `score.stump`: "{owner} stumped the crowd for {n} stump points!" / "{owner} fooled them! {n} stump points!" (if n is under 20: "{owner} got {n} stump points. Tough crowd!")
- `finale.drumroll`: "That's the game! Drumroll for the final scoreboard!" 
- `finale.champion`: "Your champion is... {winner}! What a show!" 
- `finale.cochamps`: "It's a tie! {winner} and {winner2} share the crown!" 
- `finale.shortcap`: "We're out of time! Here's the scoreboard so far!"
- `finale.thanks`: "Check your texts for the results and every real price."
- `rematch.offer`: "Want a rematch? Say rematch, or text me REMATCH!"
- `end.bye`: "Thanks for playing THE PRICE IS LIVE! See you next time!"

Every spoken line is also shown as a caption (section 13).

---

## 13. Stage video spec (Ethan)

The agent's video is a drawn **game show stage**, 2D cartoon, drawn live in code at `STAGE_FPS` (15). Landscape 960×540 by default (`STAGE_W`/`STAGE_H` configurable). **UNVERIFIED:** the best size and how Chert's Fit/Fill framing crops it on an iPhone. Keep every important thing inside the central 90% ("safe area": 48 px margin left/right, 27 px top/bottom). Test on a real iPhone in the first hour; if it is cropped or letterboxed badly, change the size (try 720×1280 portrait) and use the portrait layout below.

### 13.1 Look and palette
Retro 1970s TV game show: red velvet curtains, a glossy checkerboard floor, a marquee sign with chasing yellow bulbs, a sunburst behind the host.
Colors: stage navy `#14123A`, curtain red `#8B1A2B`, gold `#FFC83D`, cream `#FFF4D6`, bulb yellow `#FFE27A`, ink `#1B1B2F`, alert red `#E63946`. Seat colors: p1 `#E63946`, p2 `#3A86FF`, p3 `#2EC4B6`, p4 `#FF9F1C`.
Fonts: `Bungee` (titles, price, score) and `Lilita One` or `Nunito ExtraBold` (names, captions). Both are free (SIL OFL) from Google Fonts; save the files in `src/stage/assets/fonts/` and register them with `GlobalFonts.registerFromPath`. Fallback: bold sans-serif.

### 13.2 Layout, landscape 960×540 (x, y, width, height)
| Element | Position | Details |
|---|---|---|
| Background | full frame | Drawn once to an offscreen canvas and reused. Curtains left (0–150) and right (810–960), sunburst behind the host, checkerboard floor from y=440. |
| Marquee title | 280,10, 400×50 | "THE PRICE IS LIVE" in Bungee gold with a bulb border; bulbs alternate on/off at 2 Hz. |
| Round label | 40,18, 220×34 | "ROUND 2 OF 4" (Bungee 24 px, cream). Hidden in `lobby`. |
| Call clock | 700,18, 220×34 | Only in the last 45 s before `HARD_CAP_MS`: "TIME LEFT 0:32" in alert red. |
| Turn-order strip | 200,66, 560×30 | One chip per player in order, in seat color; current chip is bigger with a gold outline; finished chips show a check. |
| Join hint | 180,100, 600×40 | Yellow banner "Text {LINE_DISPLAY_NUMBER}: I'm in, I'm {name}". Only in `wait/connected/lobby` until 2+ players. |
| Host | 330,100, 300×250 | Sprite, see 13.4. |
| Mystery item card | 40,120, 250×190 | Cream card with a big "?" box and "MYSTERY ITEM from {owner}". Shown in `round_start` to `guess_*`. Never shows the item name. |
| Timer ring | 680,120, 240×190 | Circular countdown ring (radius 80) with the seconds in Bungee 90 px in the middle. Cream until 4 s, then alert red and pulsing. Shown in `guess_listen` and `guess_confirm`. |
| Caption bar | 60,360, 840×70 | Black 70% rounded bar. "CHIP:" tag in gold 16 px, then the host line in cream 28 px, max 2 lines (about 55 chars per line). Words appear along with the speech; line stays 1.5 s after speech ends. Hidden when empty. |
| Podiums | y=440, h=100, equal spacing across 48–912 | Width 190 each. Each shows: name plate (Lilita 24 px), score (Bungee 36 px), and a guess chip under it (e.g. "$25.00 ✓"). Seat color body. Owner: gold glow + "OWNER" tag. Current guesser: spotlight cone from above + pulsing outline. Winner: crown. |
| Reveal overlay | full frame | See 13.3. |
| Banner | 120,400, 720×40 | Gold bar with large text ("TEXT REMATCH TO PLAY AGAIN"). |
| Badge | 780,60, 160×28 | "TEXT MODE" / "NO CAMERA" red pill. |

**Portrait variant (720×1280, only if needed):** same elements stacked: marquee (y 40), round + turn strip (y 130), host (y 200–620), timer ring (y 640), caption bar (y 760–880, 34 px text), podiums as a 2×2 grid (y 920–1240). Keep the same `StageState`.

### 13.3 Animations and timings
- **Mouth flap (simple, locked):** three mouth shapes: closed, half, wide. While `hostSpeaking`, use `mouthLevel` (0 to 1, from `VoicePort.onMouthLevel`): open when level > 0.18, close when < 0.10 (hysteresis), minimum 80 ms per shape to avoid flicker; half-open for 0.10 to 0.35, wide above 0.35. If no level data is available while speaking, toggle at 6 Hz. When not speaking, mouth closed with a small smile. The body bobs 2 px at the speech rhythm and blinks every 3 to 5 s.
- **Host poses:** idle (mic held low), talking (mic up), reveal (arm raised, wide mouth held), celebrate (both arms up, in `finale`).
- **Countdown ring:** the ring sweeps clockwise to empty over `total` seconds. At 3, 2, 1 the digit scales 1.3 → 1.0 over 250 ms with a `tick` SFX. At 0 the ring flashes red for 300 ms.
- **Guess chip:** appears under the podium when `guessText` is set. `?` suffix while pending, `✓` when locked (a quick green flash), `—` when silent (gray, buzzer shake 200 ms), red tint and "OVER" after the reveal for over guesses.
- **Drumroll (3 s, 2 s in lightning):** a dim overlay fades in to 55%; two spotlight beams sweep left/right; podiums shake ±2 px at 12 Hz; the center shows a slot-machine style "$ ?? . ??" with digits flickering at 10 Hz.
- **Price pop:** at the `ding`, the real price pops in the center in Bungee 150 px gold with a black outline and a starburst behind: scale 0 → 1.25 → 1.0 over 500 ms (ease-out-back), plus a white flash on frame 1. Item name below in Lilita 40 px cream. If `isEstimate`, a red rotated stamp "ESTIMATE" (−8°). Holds 3 s, then shrinks to the top-center.
- **Score fly:** after the reveal, per podium: guess points float up from the chip (+86) in green, bonus (+25 BONUS) in gold, owner (+38 STUMP!) in purple, each over 1 s; the score number counts up. Winner gets a crown dropping in (300 ms). Over guesses show "OVER" in red.
- **Finale:** podiums slide into rank order (first place tallest in the center), confetti (max 200 particles, 6 s), banner "CHAMPION: {name}!" (or "CO-CHAMPIONS"), and a bottom item-recap strip ("Ethan: Owala $34.99"). Also a small credit line at the bottom: "Voice by ElevenLabs · AI by Gemini · Data on MongoDB Atlas" (section 21).
- **Performance:** background pre-rendered; frame budget under 30 ms at 960×540; if a frame is late, skip it (never queue). `render(state, nowMs)` is pure.
- **Captions matter most.** Audio may be silent (Onset). Everything the host says is on screen; the timer, amounts, and results are all visible without sound.

### 13.4 Host sprite
Cartoon, flat colors with thick dark outlines: round friendly head, big smile, slicked hair with a swoosh, red or gold-trimmed suit, bow tie, a handheld retro microphone in one hand. Build it from vector shapes in code (circles, rounded rects, paths) or a small set of PNG layers: `head`, `eyes_open`, `eyes_blink`, `mouth_closed`, `mouth_half`, `mouth_wide`, `body`, `arm_idle`, `arm_up`. Layers keep animation cheap. Ethan may use `GenerateImage` or an illustration tool for the layers; keep each layer transparent PNG, under 300 KB.

### 13.5 Stage preview and testing
`npm run preview:stage` writes PNGs for every state to `out/stage/{phase}.png` using fake `StageState` objects (a `fixtures/stage-states.ts` with one per phase). The check list: no text overlaps, caption never exceeds 2 lines, long names (12 chars) fit, 2/3/4 players spaced evenly, price fits at $1,000.00, estimate stamp doesn't cover the price.

---

## 14. Demo mode and the 2-minute demo script

### 14.1 What demo mode is
`DEMO=1` (or the main player texts `demo`). 4 players (the four teammates), **2 items**, each round the owner gets stump points and the other 3 guess. Uses `rules.short`, a 1-second lobby settle, a 3-second hold-up, and the lightning timings. Total must be **2:00 or less** with the call connected.

### 14.2 Before the demo (checklist, in this order)
1. Line ready (`chert doctor` green), agent running, `chert dev` connected (Plan A) or `CALL_MODE=outbound_group` ready (Plan B).
2. **All four team phones are verified** with Chert; Gary's phone is verified too if he will play (ask him; it needs a 6-digit text). Otherwise hand Gary a team iPhone.
3. Each of the four phones has texted the line "I'm in, I'm {Name}" in the last 24 hours.
4. Owners (Ethan round 1, Diego round 2) have texted their items. **Round 1 item is on the reference list** (safe, fast: "Owala bottle"). **Round 2 item is NOT on the list** (shows web pricing; pre-run it once so it is cached).
5. Everyone is on FaceTime Video with camera on, phones charged, volume up.
6. A 5-minute trial cap check: the demo uses 2 minutes. Confirm the 50-minute allowance has plenty left (each rehearsal uses minutes!). Plan at most 10 rehearsals.
7. Screen-record the stage as a backup video.
8. Run `warmCache()` so the demo lines (and the four team names) are already cached; check the ElevenLabs characters left; check Atlas connects and Gemini key works (`npm run doctor`).

### 14.3 Script, timed (target 1:41, hard limit 2:00)
Guessers: round 1 = Diego, Akshi, Aditri (owner Ethan). Round 2 = Akshi, Aditri, Ethan (owner Diego). Gary variant: Gary replaces Aditri as a guesser in round 2.

| Time | What happens | Host / stage |
|---|---|---|
| 0:00 | Call picks up (`bridge_ready`). Stage appears. | `connect.hello`: "Hello, hello, HELLO! Welcome to THE PRICE IS LIVE!" Title card, four podiums already lit (they texted "I'm in"). |
| 0:04 | Rules. | `rules.short`. Rules card. |
| 0:09 | Round 1 starts. | "Round one! Come on down, Ethan!" Spotlight on Ethan, "ROUND 1 OF 2". |
| 0:13 | Ethan holds up his Owala bottle. | `item.holdup`. Mystery item card. Price already ready. |
| 0:16 | Diego guesses. | `guess.prompt`, countdown, "Thirty dollars. Right?" "Yes." Locked. |
| 0:23 | Akshi guesses. | Same. |
| 0:30 | Aditri guesses. | Same. |
| 0:37 | Reveal. | Drumroll 3 s. Price pops: "$27.99!" |
| 0:43 | Score. | Points fly, winner crown, "Ethan stumped the crowd for 31 stump points!" |
| 0:47 | Round 2 starts. | "Round two! Diego, you're up!" |
| 0:53 | Diego holds up the second item. | `item.holdup`. |
| 0:56 | Akshi, Aditri, Ethan guess. | 7 s each. |
| 1:17 | Reveal. | Drumroll, price pops, "That's my best estimate!" if the web price had low confidence. |
| 1:23 | Score. | Points fly. |
| 1:27 | Finale. | `finale.drumroll`, `finale.champion`, confetti. **Results text arrives on all 4 phones now.** |
| 1:37 | Rematch offer. | `rematch.offer` |
| 1:41 | Bye and end call. | `end.bye` |
Worst case (every guess uses the full 10 s countdown plus confirm): about 1:55. If the projection goes over, lightning mode kicks in automatically.

### 14.4 The pitch around the demo (Ethan, about 30 s before, 30 s after)
Before: "This is The Price Is Right on a group FaceTime. The host sees your real stuff, a stage is the video, and the price is live."
After: "We tested our pricing on {N} items it had never seen: within 15% on {X}%, versus {Y}% for the AI alone. You can play right now: FaceTime this number." (The number comes from section 17.3.) Then hand Gary the iPhone or tell him to FaceTime the line.

---

## 15. Roles: one section per teammate

### 15.0 Rules for EVERY coding agent (read before your own section)
1. Read this whole file once. Your slice is in section 15.x; the shared contracts are in 8.5 and are the law.
2. **Only edit your own folders** (section 8.3). Need a contract change? Write it in `docs/contract-requests.md` and ping the owner of `src/contracts/` (Aditri). Do not edit contracts yourself.
3. Commit small and often on your own branch (`ethan/*`, `diego/*`, `akshi/*`, `aditri/*`), merge to `main` at each milestone. Run `npm test` and `npm run typecheck` before every commit. Never leave `main` broken.
4. **Never commit secrets** (`.env.local`, API keys, bridge tokens, LiveKit secrets, phone numbers other than the team's). Use `.env.example` with placeholders.
5. **Do not invent Chert or LiveKit facts.** Anything marked UNVERIFIED must be tested against the real line or docs; write what you observed in `docs/verified.md` (what you tried, exact result). Docs: add `.md` to any `https://docs.trychert.com/...` URL.
6. Only call or text **team phones** (and Gary's if he agreed). Trial minutes are limited (50 total, 5 per call). Log every real call in `docs/call-log.md`.
7. If you are blocked, add an entry to `BLOCKED.md` (what, why, what fallback you took) and **continue with the fallback**. Do not stop and wait.
8. Do not post, publish, or message anything outside the repo (no Devpost, Slack, GitHub issues, or texts to non-team numbers) without a human saying so.
9. Keep code plain: small functions, comments in everyday English, no clever tricks. Every module has a fake or test so it can be checked without a live call.
10. **The repo will be public with an open-source license.** Treat every file as public: no secrets, no real phone numbers, no camera frames, no personal data in fixtures or logs. Run `npm run scan:secrets` before each commit.
11. Log with `pino`. Never log full phone numbers (last 4 only), tokens, keys, or camera frames.

---

### 15.1 Ethan (ethnmz): stage video, host look, demo, Devpost, measured-number writeup

**Owns:** `src/stage/*` (all drawing and the video publishing), the host sprite and fonts in `src/stage/assets/`, `fixtures/stage-states.ts`, `scripts/preview-stage.ts`, the demo (section 14), `docs/devpost.md`, `docs/pitch.md`, `docs/framing.md`, the measured-number writeup, and the final call on any design question.

**Tasks and acceptance criteria**
| # | Task | Acceptance criteria |
|---|---|---|
| E1 | Renderer skeleton: `render(StageState, nowMs) → RGBA`, static background, marquee, podiums for 2/3/4 players, round label, turn-order strip, caption bar, banner, badge. Build `fixtures/stage-states.ts` with one state per phase. | `npm run preview:stage` writes a PNG for every phase in 2, 3, and 4 player layouts. No overlapping text; 12-character names fit; caption never exceeds 2 lines for the longest line in the host bank; frame time under 30 ms average over 300 frames (script prints it). |
| E2 | Host sprite (layers in 13.4) with mouth flap per 13.3. | A test feeds a sine wave `mouthLevel` and asserts shape changes with hysteresis (no flicker faster than 80 ms). A preview strip shows closed, half, and wide mouths. |
| E3 | Animations: countdown ring, drumroll, price pop, estimate stamp, score fly, winner crown, finale confetti. | A `preview:anim` script writes a 15-frame PNG sequence per animation. Every animation is a pure function of `(state, t)`. The price `$1,000.00` and `$0.99`-style values both fit. |
| E4 | Captions: word-by-word reveal timed to speech length, fade after 1.5 s, 2-line max. | Unit test: all lines in the section 12 bank, filled with the longest names, fit in 2 lines at 28 px. |
| E5 | `publish.ts`: `StagePort` implementation. Take the connected LiveKit room from `CallPort.roomHandle()`, create the video source and track, publish from the **same participant** that publishes host audio. Run the frame loop at `STAGE_FPS`. Copy the approach from the Chert `--video` starter. | On a real FaceTime Video call to the line, an iPhone sees the stage with moving marquee bulbs and the podiums. At least 10 fps measured (log frames sent per second). Audio still works while video publishes (one audio publisher only). Screenshot of the iPhone saved to `docs/framing-iphone.png`. |
| E6 | Framing test on a real iPhone: size, Fit/Fill crop, readability of 28 px captions. | `docs/framing.md` says which size/aspect to use and why, with the screenshot. If cropped badly, switch `STAGE_W/H` and layout. |
| E7 | Demo: pre-demo checklist, 10 rehearsals, a screen-recorded backup, timing log. | At least 8 of 10 rehearsal runs finish in 2:00 or less with the results text received on all 4 phones. Backup video saved to `docs/demo-backup.mp4`. |
| E8 | Devpost and pitch text, measured-number writeup (section 20) and the **sponsor writeups** (section 21): one paragraph each for Chert, ElevenLabs, Gemini, MongoDB Atlas, and (if we enter it) the A-Team. Once Aditri's eval report exists, add the number. | `docs/devpost.md` is paste-ready: title, tagline, all sections, the measured number with the exact test-set size, every track name, built-with list, screenshots listed, and the sponsor paragraphs. Ethan posts it himself. |
| E10 | **Demo video (1 to 3 minutes)** and sponsor evidence: screen-record the stage plus phone view; capture proof of each sponsor integration (ElevenLabs dashboard usage, Gemini grounded-price response with sources, Atlas collections). | `docs/demo-video.mp4` (1:00 to 2:30) shows the call, the price reveal, and a quick "under the hood" cut naming ElevenLabs, Gemini, Atlas, and Chert. `docs/sponsor-evidence/` has one screenshot per sponsor. |
| E9 (stretch) | Results card as a PNG image. | Only if image sending on the shared line is verified. Same content as the text card. |

**Depends on:** `StageState` and `StagePort` (Aditri, M0); `onMouthLevel` and `roomHandle()` (Diego, M1); Gary's answers about video size and caller capture.
**Hands off:** a working `StagePort` (E5 by M2); preview PNGs for the Devpost; the demo timing log to Aditri if the engine's lightning logic needs tuning.

**Overnight agent instructions (any coding agent; paste the prompt):** see `agent-prompts/ethan.md`. Build order: E1 → E2 → E4 → E5 (use the fixtures; do not wait for the engine) → E3 → E6 → E7 → E8. Draw everything in code with `@napi-rs/canvas`. If the real publish path fails, still produce PNGs and a screen-recordable preview so the demo can fall back to a recorded video.

---

### 15.2 Diego (Navibytes): Chert bridge, voice, calls, iMessage

**Owns:** `src/comms/*`, `src/speech/*`, `src/agent.ts` (wiring), `docs/call-plans.md`, `docs/imessage-sample.json` (redacted), `docs/verified.md` (Chert facts observed).

**Tasks and acceptance criteria**
| # | Task | Acceptance criteria |
|---|---|---|
| D1 | Get the line working with the official starter (`chert new ... --video`, `chert login`, `chert doctor`, `chert dev`). Say "hello" on pickup. | An iPhone FaceTime Video call to the line: host voice heard **and** the starter's face visible within 5 s. If audio is silent, tell the team within 10 minutes and ask Gary; the game continues in TEXT MODE. Log the `audio_ready` result in `docs/verified.md`. |
| D2 | `token.ts` + `call.ts` Plan B. Mint bridge token (section 3.4), join the room, `POST /v1/calls` (first with one `destination`, then `recipients`), watch events for `bridge_ready`, expose `ready` and `ended` events, `end()` with its own idempotency key. Handle `line_busy`, `recipient_not_verified`, `facetime_group_unavailable`, `shared_contact_limit` with clear log messages. | Dial 1 phone: `ready` fires, hello is spoken after `ready` only. Dial 2, then 3-4 phones. `end()` works; a second call right after succeeds (line free). Errors map to a short human message in the log. |
| D3 | `tts.ts` (**ElevenLabs** streaming TTS), `mixer.ts`, `voice.ts` (`VoicePort`). One `AudioSource`; ElevenLabs PCM and SFX mixed into it; `speak()` resolves when finished (±200 ms); `stopSpeaking()`; 20 Hz mouth level callback; speaking-change callback. **Disk cache** for TTS audio keyed by hash of (voice, model, settings, text); a `warmCache()` that pre-generates every static line in the bank at boot (spec 21.2); a **character counter** that logs usage, warns at 70% of `ELEVENLABS_CHAR_BUDGET`, and at 90% switches to cached-only lines plus the fallback voice. Make the SFX files (drumroll 3 s, ding, buzzer, tada, tick) from royalty-free or synthesized audio in `src/comms/sfx/`. | Drumroll over a spoken line mixes cleanly. Exactly one audio publisher in the room (log participants and tracks at start). Mouth-level callback runs about 20 times a second during speech and is 0 in silence. Time to first audio byte from ElevenLabs logged (target under 600 ms; cached lines near 0). Second run of a full demo uses almost no new characters (cache hit rate printed). Voice is the chosen lively game show voice. |
| D4 | `stt.ts`: subscribe to the bridge's `facetime-remote-audio`, stream to **ElevenLabs Scribe v2 Realtime** (default; `STT_PROVIDER=openai\|deepgram` fallbacks), send audio only while `listen(true)`, expose the `listen(on)` gate with 400 ms tail, interim and final results. | Ten spoken guesses transcribed (five digits, five words). Gate drops host-voice echo (test with speakerphone). Time from end of speech to final transcript logged; target under 1.5 s. Switching `STT_PROVIDER` works without code changes. |
| D5 | `speech/parseGuess.ts`, `yesno.ts`, `nameParse.ts`. | Every row of the 9.5 table passes in `test/parseGuess.test.ts`; `yes/no` tests pass; name parser passes 10 cases ("I'm in, I'm Diego" → "Diego", "im in its akshi" → "Akshi"). |
| D6 | `imessage.ts` (`MessagePort`): `POST /shared-messages`, poll `GET /shared-messages` every 1.5 s, dedupe by id, normalize sender to E.164, ignore our own sent messages, retry once. Save one redacted raw sample to `docs/imessage-sample.json` and fix field names. Check whether webhooks/SSE exist for Shared lines; if so note it. | Round trip works: text "I'm in, I'm Diego" from a team phone arrives as an event within 3 s; a reply arrives on the phone. No duplicate events over 100 polls. Reply-window and verification behavior written in `docs/verified.md`. |
| D7 | Caller video: subscribe to `facetime-remote-video`; implement `latestCallerFrames(n)` (JPEG, 768 px wide, quality 70). Handle mute, missing track, new track. | With capture enabled, returns frames that change when the camera moves; with it off or muted, returns `null` with no crash. Saves one example to `docs/caller-frame.jpg` (team members only). Group call: note whether you see one tile or a grid. |
| D8 | `agent.ts`: wire all ports to the engine; start/cleanup per call; survive hangups and take the next call without restart; switch `CALL_MODE`. | Works through `scripts/sim-call.ts` fakes and with the real line. After a hangup the next call works with no restart. No leaked timers or tracks (check after 3 calls). |
| D9 | Group call tests: Plan B with 2, 3, 4 phones; Plan A (call in, add friends); Plan C if enabled. | `docs/call-plans.md` lists, for each plan: worked / failed / not enabled, exact error codes, and what the stage and audio looked like. Tell Ethan right away which plan to use for the demo. |

**Depends on:** contracts (Aditri, M0); `StagePort.start(room)` (Ethan) to publish video from the same participant; the first reference items are not needed by Diego.
**Hands off:** `CallPort`, `VoicePort`, `MessagePort` implementations (D2, D3, D6 by M2); `parseGuess` (D5) by M1; `docs/call-plans.md` by M2.

**Overnight agent instructions:** see `agent-prompts/diego.md`. Build order: D1 (blocker, do first, real line) → D5 (pure code, safe to do while waiting on the line) → D6 → D2 → D3 → D4 → D7 → D8 → D9. Keep a one-command smoke test per module (`npm run smoke:call`, `smoke:voice`, `smoke:stt`, `smoke:imessage`).

---

### 15.3 Akshi (biswalakshi): AI, vision, pricing, host script and personality

**Owns:** `src/ai/*` (pricing, list matching, web search, camera identification, host lines, quips, persona), `test/pricing.test.ts`, `data/vision-test/` (her photo set), `docs/ai-notes.md`.

**Tasks and acceptance criteria**
| # | Task | Acceptance criteria |
|---|---|---|
| A1 | `pricing.ts`: the pipeline in section 10.3 behind `PricingPort.price()`, using **Gemini** for estimates and grounded web prices, with parallel web and estimate, the 8 s hard timeout, and caching (via `StorePort.getCachedPrice` and `persist('priceCache')`). | 10 known list items give a list result with the right price; never throws; returns within 8 s even when Gemini is mocked to hang; estimates are labeled `isEstimate`; a nonsense item ("asdfgh") returns an estimate or a prop-closet flag, not a crash; a missing `GEMINI_API_KEY` falls back to list-only plus a fixed estimate and logs one clear warning. |
| A2 | `matchList.ts` + `scripts/build-embeddings.ts`: alias match, token similarity, optional embeddings. | 30 test strings (aliases, typos, brand-only like "owala", with size) match the right item at top-1 for at least 27 of 30; size conflicts are detected. |
| A3 | `webSearch.ts`: `SearchProvider` implemented with **Gemini + Google Search grounding** (spec 10.3 step 3), zod-validated JSON, sources read from grounding metadata, the one-call vs two-call fallback, median and outlier rule. | For 10 sample non-list items, a price with at least 1 grounded source in at least 9 of 10 and 2 or more agreeing sources in at least 7 of 10, within 6 s. Handles no-grounding, no-results, and bad JSON. Documents in `docs/ai-notes.md` whether JSON + grounding works in one call. |
| A4 | `identify.ts`: `identifyFromFrames()` with the vision prompt in 10.5, using **Gemini** multimodal input. Build 20 photos of held items plus 5 empty-hand/FaceTime-screenshot frames (team members only; team consent). | At least 16 of 20 labels judged correct; at least 4 of 5 empty-hand frames return `notHolding`; one call under 4 s; frames never saved to disk by the code. |
| A5 | `host/lines.ts`: the line bank from section 12.2 as typed data and `HostPort.line(key, vars)` with variants and no immediate repeat. | A test lists every key the engine uses and asserts it exists; every line under 140 characters; no unfilled `{vars}`; no emoji; no repeat twice in a row. |
| A6 | `host/persona.ts` and `host/quips.ts`: `HostPort.quip()` and optional generated recap lines with **Gemini**, the 12.1 prompt, filters, and 1.5 s timeout. | For 20 test items: 100% pass the filter (at most 18 words, no digits, no `$`); on timeout returns `null`; Ethan reads 20 outputs and none are mean. |
| A7 | `parseAmountLLM(text)`: fallback number parser, 1.2 s timeout. | Resolves 8 of 10 weird phrases that the deterministic parser misses; never invents a number when none was spoken. |
| A8 | `cleanItemText` and moderation: strip filler, reject non-products and offensive text → prop closet. | 20 cases pass. |
| A9 | Export harness hooks: `priceVariantA/B/C(rawText)` matching section 10.4 for Aditri's eval. | Aditri's `npm run eval` runs all three variants against the held-out set using your functions. |

**Depends on:** `contracts` (Aditri, M0); first 50 reference items from Aditri by M1 (use a hand-made 10-item list until then); camera frames from Diego (D7) only for the live test (use photos before that).
**Hands off:** `PricingPort` and `HostPort` implementations (A1, A5 by M1; A3, A4, A6 by M3); variant functions (A9) by M2.

**Overnight agent instructions:** see `agent-prompts/akshi.md`. Build order: A5 (fast and unblocks everyone) → A2 → A1 (list + estimate first) → A9 → A3 → A4 → A6 → A7 → A8. Keep temperature at 0 for pricing so results are repeatable. Keep every model call behind a small wrapper with timeout and retry-once so tests can mock it.

---

### 15.4 Aditri (aditrit06): backend, game state and scoring, deployment, data and accuracy harness

**Owns:** `src/config.ts`, `src/contracts/*` (frozen at M0), `src/engine/*`, `data/*`, `eval/*`, `scripts/sim-call.ts`, `test/scoring.test.ts`, `test/engine.sim.test.ts`, `Dockerfile`, `docs/runbook.md`, repo scaffold.

**Tasks and acceptance criteria**
| # | Task | Acceptance criteria |
|---|---|---|
| Z1 | **M0 within 30 minutes:** repo scaffold (Node 22/24, TypeScript, `tsx`, `vitest`, eslint, scripts: `dev`, `test`, `typecheck`, `eval`, `sim`, `preview:stage`), `contracts/types.ts` and `ports.ts` exactly as section 8.5, `config.ts` (section 7.1 + env), `.env.example`, `.gitignore`, a copy of this spec as `SPEC.md`. **Also: `LICENSE` (MIT), a README with sections "How we use ElevenLabs / Gemini / MongoDB Atlas / Chert", and a secret-scanning check (`npm run scan:secrets`, for example gitleaks) in a pre-commit hook, because the repo goes public.** | `npm run typecheck` and `npm test` pass on a clean clone; all four people have pulled by M0. The secret scan passes on a clean clone and fails when a fake key is added. |
| Z2 | `engine/scoring.ts` implementing section 6 exactly. | Tests for all six worked examples in 6.5 pass; property tests: guess points in 0..100, stump in 0..100, winners never include silent players, half-up rounding; 100% branch coverage for the file. |
| Z3 | `engine/registry.ts`: join text parsing and the roster (max 4, main = first), rejecting duplicates and phone changes. | 15 join strings parse right ("I'm in, I'm Diego", "im in", "Im in it's akshi", "in - Aditri"); a 5th person gets a polite reply and is ignored. |
| Z4 | `engine/reducer.ts` + `effects.ts` + `clock.ts`: the full state machine of 7.4 with timers, hard clock, lightning mode, failure rules. | `engine.sim.test.ts` passes these scripted games with a virtual clock: 4-player normal game; 2-player game; demo mode with 2 items; silent guesser; everyone over; tie; item text missing → camera → voice → prop closet; pricing timeout → estimate; `CALL_ENDED` mid-game; hard cap at 4:30 forcing `FINALE`; stray/late events ignored without crash. Final totals match hand-computed values. |
| Z5 | `buildStageState(game, now)` mapping `GameState` to `StageState`. | Snapshot test per phase. The item name and price are **never** in `StageState` before `REVEAL`. |
| Z6 | `buildResultsCard(history, players, opts)` exactly per section 11. | Tests for 4 players, 3, 2, a tie, an estimate tag, a hard-cap line; output equals the template character for character. |
| Z7 | **Data:** `data/reference-items.json` (about 200) and `data/heldout-test.json` (30 to 50), per 10.2 and 17.3, with `data/README.md` describing sources and rules. | A schema check script passes; every item has a source and `checkedAt`; no held-out item is on the list (script flags names with token overlap above 0.7 or the same alias); held-out set spans $3 to $400 with at least 5 items above $100; at least half the held-out items are in categories the list covers (so "similar item" help is testable). |
| Z8 | `eval/run-eval.ts`: runs variants A, B, C over the held-out set. | One command, `npm run eval`, writes `eval/results.json` and `eval/report.md` (and an `eval_runs` document in MongoDB Atlas) with the metrics in 17.3, per-item table, run date, model names, and the exact test-set size. Re-running gives the same numbers within ±1 item (temperature 0). |
| Z9 | Deployment: `Dockerfile`, `docs/runbook.md` (start, stop, restart, where logs are, how to rotate keys), `npm run doctor` (checks env vars, LiveKit connect, Chert line readiness, ElevenLabs key and remaining characters, Gemini key, MongoDB connection), a backup run on a cloud VM. | A fresh machine runs the agent with `docker run` plus the documented `chert dev` step. A second person follows the runbook cold and gets a call answered. |
| Z10 | `scripts/sim-call.ts`: fake `CallPort`, `VoicePort`, `MessagePort`, `PricingPort`, `HostPort`, `StagePort` that drive a whole game with typed events and a virtual clock. | `npm run sim` plays a 4-player game in under 10 real seconds and prints the final scoreboard and the results card. Diego, Ethan and Akshi use this to develop without phones. |
| Z11 | **MongoDB Atlas** (`src/store/*`, spec 21.4): connect to the free M0 cluster; `schemas.ts` (zod) for the collections; `seed.ts` loads `data/reference-items.json` plus Gemini embeddings into `reference_items` and creates the Atlas Vector Search index; `persist.ts` executes the engine's `PERSIST` effects through an in-memory retry queue; `vectorSearch.ts`; `scripts/atlas-stats.ts` prints aggregation results (average points per round, price source mix, pricing error by source from `eval_runs`); the eval harness writes `eval_runs`. Local JSON fallback when Atlas is unreachable. | After one sim game and one real game, `games`, `rounds`, `guesses`, `players`, `results` documents exist and match the engine's final totals. Unplugging the network does not slow or stop a game (a test with the store mocked to hang). `loadReferenceItems()` returns the list from Atlas, and from JSON when Atlas is down. `$vectorSearch` returns the right item for 10 test strings, or the code falls back cleanly (note the result in `docs/verified.md`). Screenshot of the Atlas collections and one aggregation saved to `docs/atlas-*.png` for Devpost. No camera frames, tokens, or full phone numbers stored. |

**Depends on:** Akshi's `PricingPort` for eval (A9); Ethan's `StageState` needs (tell Aditri early if a field is missing); Diego's real port implementations for integration.
**Hands off:** contracts and fakes (M0, first!); engine and sim (Z4/Z10 by M1); results card (Z6 by M1); data (first 50 reference items by M1, full list and held-out set by M3); eval report (by M4).

**Overnight agent instructions:** see `agent-prompts/aditri.md`. Build order: Z1 (30 minutes, everyone waits on this) → Z2 → Z10 skeleton → Z4 → Z5 → Z6 → Z3 → Z7 (start this in parallel with a second agent as soon as Z1 is done; it is the longest) → Z8 → Z9.

---

## 16. Build order, milestones, and the cut line

### 16.1 Milestones (T = the moment the team starts; all four work in parallel)
| M | By | What must work | Owner of the check |
|---|---|---|---|
| M0 | T+0:30 | Repo, contracts, fakes, `npm run sim` skeleton; Chert line connected; starter says hello on a real call. | Aditri + Diego |
| M1 | T+1:30 | Scoring tests pass; engine sim plays a game; stage PNGs for all phases; `parseGuess` passes; pricing list+estimate works; results card builder passes; iMessage round trip. | each owner |
| M2 | T+2:30 | Stage video visible on a real iPhone; host voice from our TTS; Plan B dials 2 phones; `docs/call-plans.md` written. | Ethan + Diego |
| M3 | T+3:30 | **End-to-end real game in TEXT MODE** (ElevenLabs voice speaking, Gemini pricing a list-miss item, game rows appearing in Atlas) (join by text, rounds, typed guesses, reveal, results text). Reference list and held-out set done. | everyone |
| M4 | T+4:30 | Voice guesses with confirm-back; web search; camera fallback tested; eval report; animations done. | Diego, Akshi, Aditri |
| M5 | T+5:30 | Demo mode timed 2:00 or less, 5 rehearsals; backup video. | Ethan |
| M6 | T+6:30 | Freeze code. Devpost text final. 5 more rehearsals. Deploy backup. | all |

### 16.2 Critical path and parallel order
1. Aditri's contracts (M0) unblock everyone. 2. Diego's real call and audio check (is audio silent?) decides how much weight voice carries. 3. Ethan's `publish.ts` needs Diego's room handle. 4. Everything else is independent through the ports and fakes.

### 16.3 If the Devpost deadline really is 11:59 PM tonight (Sat Nov 14)
It was about 5:45 PM Central when this was written, so there are roughly 6 hours. Confirm with the organizers in the first 10 minutes. If true, use the **cut line** and treat T+0 as now:
- **P0 (must ship):** Plan B call; host voice (ElevenLabs, with cache); stage with podiums, captions, timer, reveal; scoring engine; iMessage join, item, results; list + Gemini pricing; voice guesses with TEXT MODE fallback; demo mode; the accuracy eval with at least 30 held-out items; game/round/guess documents written to MongoDB Atlas; public repo with LICENSE and README sponsor sections; Devpost text and demo video.
- **P1 (if time):** Gemini Google Search grounding for prices (if not already working, the list + estimate path still ships); camera fallback; ElevenLabs Scribe as the speech-to-text (else OpenAI/Deepgram); Atlas Vector Search and `atlas-stats`; mouth flap polish; confetti and score fly; hard clock and lightning.
- **P2 (skip tonight):** the SpaceXSI A-Team entry (optional, pending decision), Eleven v3 audio tags, Plan A and C, name round, portrait layout, results PNG, Docker/VM backup, quips from the model (use canned lines).
Compressed milestones: M1 at T+1:00, M2 at T+2:00, M3 at T+3:00 (end-to-end in TEXT MODE), M4 at T+4:00, then rehearse and write Devpost by T+5:00 (about 10:45 PM). **Submit a complete Devpost before the deadline, then improve it if edits are allowed after submitting (UNVERIFIED).**

---

## 17. Test plan and accuracy harness

### 17.1 Automated tests (run in CI or locally with `npm test`)
- `scoring.test.ts`: all 6.5 examples, property tests, edge cases ($0 guess, silent, all-over, tie, price of exactly $1.00).
- `parseGuess.test.ts`: the 9.5 table plus 20 extra cases.
- `registry.test.ts`, `resultsCard.test.ts`, `stageState.test.ts` (no price before reveal), `lines.test.ts`.
- `engine.sim.test.ts`: the scripted games listed in Z4. The sim uses a **virtual clock** so a 4-minute game runs in under a second.
- `pricing.test.ts`: mocked model and search; timeout and never-throws tests.

### 17.2 Manual and integration tests (on the real line, team phones only)
| Test | Pass if |
|---|---|
| Audio check | Two-way voice both ways on a real call; if silent, TEXT MODE game still completes. |
| Group call | Plan B with 4 phones: everyone hears the host and sees the stage. |
| Stage on iPhone | Captions readable, nothing cropped, 10+ fps. |
| Round trip text | "I'm in, I'm X" → reply in under 3 s. |
| Speech under noise | 10 guesses, two people talking over one: confirm-back fixes it in at least 9 of 10. |
| Hold-up camera ID | Remove the item text; camera fallback names 4 of 5 items (or falls back to voice cleanly). |
| Hard cap | Force slow play; game reaches finale by 4:30; results text arrives. |
| Hangup/redial | Hang up mid-game; the next call works without restarting the agent. |
| Full 4-player game | Finishes in 4:30 or less; scoreboard matches hand-calculated scores. |
| Demo mode | 2:00 or less, 8 of 10 times. |

### 17.3 Accuracy harness (the measured number)
**Goal:** one honest sentence for the pitch and Devpost: "On N items our pricing had never seen, the host was within 15% of the real shelf price X% of the time, versus Y% for the AI alone."

**Data (Aditri):**
- `data/reference-items.json`: about 200 items, see 10.2.
- `data/heldout-test.json`: **30 to 50 items NOT on the list**, each `{ id, text, trueCents, source, checkedAt, category, tier }`. `text` is how a player would text it ("Stanley quencher 40oz"). `trueCents` is the **new, regular US retail price** from a named retailer page on a stated date. `tier` is `similar` (same kind of item as something on the list, different brand or model) or `novel` (nothing like it on the list). Aim for about half and half so we can show where the list helps.
- Rule: write the held-out set **before** tuning prompts or thresholds, and do not tune against it. Freeze it at M3.

**Variants:** A (AI alone), B (list + AI), C (full pipeline), see 10.4. Temperature 0. One run for the report, plus two repeat runs to check stability.

**Metrics (per variant, and per tier):**
- Within 15% of true price: count and percent. (Headline.)
- Within 25%: count and percent.
- Median absolute percent error.
- **Over-price rate:** how often the host's price was above the true price. It matters for fairness of "without going over". Just report it; no target.
- Median latency and 95th percentile latency.
- Per-item table: text, true price, A/B/C prices, errors, source.
- Wilson 95% interval for the headline percent (with n=40 it is wide; say so).

**Report (`eval/report.md`):** date, model names, set sizes, the table, 3 sentences in plain words, a short list of the worst misses and why. Never round up or drop bad items. Ethan quotes the numbers exactly as written there.

**Honest limits to say out loud:** the "truth" is a recorded retail price on one date; real prices vary by store; N is small. The game also labels low-confidence prices as estimates.

### 17.4 Acceptance gates
- **Gate 1 (end of M3):** a full game works in TEXT MODE on the real line.
- **Gate 2 (end of M5):** demo mode passes 8 of 10 rehearsals.
- **Gate 3 (freeze):** `npm test` green, eval report committed, `docs/verified.md` complete, backup video saved.

---

## 18. Risks and fallbacks

| Risk | What happens | Fallback |
|---|---|---|
| Group calls not enabled on our line | Plan B dial fails with `facetime_group_unavailable`; Plan A add-friends may not work | Ask Gary on arrival (question 1). Use Plan C if enabled. Last resort: 1-on-1 calls with the host plus the other players in a **second** FaceTime on another phone held up as "the crowd" (ugly). Or demo with 2 players, one call each, whichever Chert supports. |
| Judge phone not verified | Group call with Gary's number is rejected as a whole | Hand Gary a pre-verified team iPhone. Verify his phone in advance with the 6-digit text. |
| Inbound group invites ("add friends") unsupported | Plan A fails | Plan B (agent calls everyone). |
| No caller-camera capture | Camera fallback returns `null` | Text path is primary; voice path "what is it?"; prop closet. Say so in the pitch if asked (fresh use of video is the stage we send, plus real items shown live). |
| Capture shows a composite or the wrong tile | Vision picks a wrong object | Lower the confidence bar, confirm out loud ("Is that an Owala bottle?"), prefer text. |
| Audio silent in both directions (Onset) | Nobody hears the host; STT hears nothing | Captions + on-screen timer; **TEXT MODE** (guesses by iMessage, 20 s timer); tell Gary immediately; keep a recorded backup. |
| Trial 5-minute cap | The call ends at 5:00 | Hard clock at 4:30; results text goes out at the start of the finale. Demo uses only 2 minutes. |
| Caller names missing | No names from FaceTime | Join text gives names; else name round (state 4). |
| Reply window closed (24 h) or phone not joined | Agent cannot text a player | Everyone texts "I'm in" within 24 hours before; on the demo day, text again an hour before. |
| 50-minute trial allowance used up by rehearsals | No call minutes at demo time | Budget: 10 rehearsals max; log minutes in `docs/call-log.md`; ask Gary about a longer allowance (question 6); trial window is 48 hours so also consider the end time. |
| Line busy / one call per line | A second demo or rehearsal collides | One call at a time. Use `when_busy: "queue"` (waits up to 2 minutes). |
| STT misses or mis-hears numbers | Wrong guess locked | Confirm-back; TEXT MODE; parser handles "twenty five bucks"; an optional LLM fallback. |
| Cross-talk (one mixed track) | Bystander's number taken as the guess | Gate the mic; "everyone else, zip it"; confirm-back lets the real guesser correct. |
| Host voice echo (phone speaker into mic) | Host's own words heard as a guess | 400 ms tail gate; STT off while host speaks. |
| Pricing wrong or slow | Bad reveal | Labeled estimates; 8 s timeout; prop closet; pre-cache demo items; eval reports honest numbers. |
| Model or search provider down or key not enabled | Pricing falls back | List + estimate only; mock mode with cached results for the demo. |
| LiveKit or Chert outage | No call | Pre-recorded demo video; show the sim and stage previews; be honest. |
| Video size wrong on iPhone | Cropped captions/podiums | Safe-area layout; E6 test; portrait variant. |
| Agent publishes two audio tracks | Chert may end the call | One `AudioSource` only; log tracks at start (D3). |
| Greeting too late | Chert ends a silent call about 10 s after `bridge_ready` | Greet in under 2 s; the first host line is hard-coded text with pre-generated audio cached at boot. |
| Secrets leaked in repo | Account abuse | `.gitignore`, `.env.example`, no keys in logs; rotate if leaked. |
| ElevenLabs free-tier characters run out | Host goes silent or falls back | Disk cache + pre-generated static lines; character counter with 70% and 90% guards; claim the Creator tier through the ElevenLabs Discord coupon bot with your registered email (MLH page says this works at MLH events; **UNVERIFIED for HackUTA**); fallback voice; captions always on. |
| ElevenLabs latency or outage | Slow or no host voice | Flash model; cached lines; fallback voice (OpenAI TTS optional); captions carry the game. |
| Gemini rate limit, wrong model name, or free-tier privacy | Pricing or camera ID fails; faces sent to a free endpoint | Model names in env; list-only fallback; text path is primary so frames are rarely sent; players are told before camera ID is used; use a paid key if available; never send frames outside the fallback path. |
| Grounding + JSON in one call not working | No sources returned | Two-call fallback (10.3); never label a price "web" without sources. |
| Atlas unreachable, IP not allowed, or wrong connection string | No persistence or vector search | Game keeps going (store is fire-and-forget); local JSON fallback; allow the venue IP in Atlas network access (avoid `0.0.0.0/0` after the event); test connection in `npm run doctor`. |
| Public repo leaks a key | Account abuse | Secret scan hook, `.env.example` only, rotate every key right after submission. |
| Devpost deadline tonight | No overnight time | Section 16.3 cut line; confirm now. |
| Inappropriate item/joke | Awkward moment | Moderation (A8), quip filters (A6), light jokes only. |

---

## 19. Open questions to confirm with Gary (Chert table), in priority order

1. **Group calls:** are group calls enabled on our line? Can a player FaceTime the line and add friends (inbound group)? Or must the agent start the group (`recipients`)? Is link-joining enabled? *(UNVERIFIED all three. Decides Plan A, B, or C.)*
2. **Verification:** can Gary's phone (and other judges' phones) join a group call? What is the fastest way to verify a phone? Can the line skip verification for the demo?
3. **Caller capture:** is it enabled on our line? In a group call, what does the agent see (one tile or the whole grid)? Does it include names?
4. **Agent video:** the best frame size and aspect for iPhone, and how Fit/Fill crops it. Is 15 fps OK?
5. **Audio silence:** has the "audio silent in both directions" issue (Emory/Onset) been fixed? How do we check `audio_ready`?
6. **Limits:** can the 5-minute cap and the 50-minute allowance be raised for the weekend? How many lines are assigned to HackUTA teams (rehearsal collisions)?
7. **iMessage on the trial:** field names for polled messages; webhooks or streaming on shared lines; image attachments on shared lines; can the agent text first (without the 24-hour reply window)?
8. **Caller names:** is there any way to read the FaceTime caller name or participant list? (We assume no.)
9. **Judging mechanics:** does Gary want to play, and from which phone? Can judges call the number during the demo block?
10. **Devpost:** the real deadline (reportedly 11:59 PM Sat Nov 14, unconfirmed), the Devpost link, and whether edits are allowed after submitting.
11. **API hosts:** calls on `facetime.trychert.com/api/v1` vs `app.trychert.com/api/v1` in `skills.md`; which is right for the trial line?
12. Is "Chert Fellowship" or "FDE and SWE intern roles" the correct prize wording?

---

## 20. Devpost and the measured-number writeup (Ethan)

Ethan submits it himself; agents only write `docs/devpost.md`.
- **Track:** select "Best Use of FaceTime (Chert)".
- **Title:** The Price Is Live. **Tagline:** "The Price Is Right, on a group FaceTime, with your own stuff."
- **Sections:** Inspiration (everyone has stuff at home and an opinion about what it costs; game show energy). What it does (section 1). How we built it (section 8: TypeScript LiveKit agent on Chert's FaceTime line, drawn game show stage as the agent's video, speech in, TTS out, texts for items and results). Video use (the host's stage is the video; real items are held up on camera; caller camera used as fallback; drumroll and price reveal). Challenges (group call rules, one mixed audio track, 5-minute cap, silent audio risk, captions). **Accomplishments (the number):** use the exact sentence from `eval/report.md`. What we learned. What's next (more players, link-join, real photos, rematch ladder). Built with: TypeScript, LiveKit, Chert FaceTime and iMessage, ElevenLabs, Gemini API, MongoDB Atlas, node-canvas. Add one paragraph per sponsor track from section 21.6, and tick every track box on Devpost.
- **Screenshots:** stage PNGs from `preview:stage`, the results card, the eval table.
- **Pitch (60 seconds):** hook (the call), what it does, the number, "FaceTime this number and play with us."
- Lesson from HackUTD: lead with the number, make the call live, and let Gary play.

---

## 21. Sponsor tracks (what each needs, how we satisfy it, and what to tick at submission)

Requirements below were read from the MLH and sponsor challenge pages on Nov 14, 2026. Pages vary by event, so **re-read the exact HackUTA wording on the Devpost page** and fix anything that differs (**UNVERIFIED for HackUTA**). We are entering these tracks:

| Track | What it asks for | How we meet it | Where in the code |
|---|---|---|---|
| **Chert: Best Use of FaceTime** | Live FaceTime call; fresh use of video (counts double); wow; usefulness. | Sections 1 to 14. | everywhere |
| **Best Project Built with ElevenLabs** | ElevenLabs used in a meaningful, central way (voice, speech, or audio), **not an afterthought**. Own code in a **public GitHub repo under an open-source license**. Judged on how central and creative the use is, usefulness, and live-demo quality. | The host's whole personality is ElevenLabs: streaming TTS with emotion presets, a cached static line library, and (default) ElevenLabs Scribe speech-to-text to hear the guesses. Voice is half the show. | `src/comms/tts.ts`, `stt.ts`, `voice.ts` |
| **MLH Best Use of Gemini API** | Genuinely use the Gemini API (free key from Google AI Studio). Show the model choice did something a generic call would not. Show the integration in code, README, or demo. Do not send sensitive data through free-tier endpoints. | Gemini does pricing with **Google Search grounding** (cited sources), **camera item identification** (multimodal vision), host line generation, and embeddings. | `src/ai/*` |
| **MLH Best Use of MongoDB Atlas** | Build a hack using MongoDB Atlas as the cloud database (free forever tier or $50 student credit). | Atlas stores the reference price list (with Vector Search), games, players, rounds, guesses, scores, results, a price cache, and eval runs. | `src/store/*`, `scripts/atlas-stats.ts` |
| **MLH Build Your Hackathon A-Team with SpaceXSI** (**optional, pending decision**) | See 21.5. Needs Cursor as the *core* AI coding agent **and** a Grok Bot automation, described in the project text, plus raffle opt-in. | **Only if the team actually uses Cursor as its main coding agent.** Ethan has said Cursor is not the team's coding agent, so the default is **do not enter and do not claim it.** | n/a |

Name note: Ethan wrote "SpaceXAI"; MLH's page title reads "Build Your Hackathon A-Team with **SpaceXSI**" and the raffle is called "Make it Legendary with SpaceXSI". Use whatever the HackUTA Devpost page shows.

### 21.1 Rules that apply to every sponsor track
- **Public repo + open-source license (MIT) by submission time.** Aditri adds `LICENSE` at M0. Make the repo public only after the secret scan passes and keys are removed from history. Rotate all keys right after submission.
- **README has one section per sponsor** ("How we use ElevenLabs", "How we use Gemini", "How we use MongoDB Atlas", "How we use Chert") that points to the exact files. Judges are told to look for the integration "in code, README, or demo."
- **Say it in the demo video** (E10) and in Devpost text. Never claim a sponsor feature that is not really used.
- **All work must be done during the hackathon** (MLH and Devpost norm). Do not commit code written before Nov 14. Commit history should show work starting Nov 14.
- Include all team members on the Devpost submission.
- Plan for a demo video of 1 to 3 minutes (typical Devpost requirement; **UNVERIFIED for HackUTA**).

### 21.2 ElevenLabs: how it is used (Diego owns the code; Akshi owns the line text; Ethan owns the stage credit)
**What is central to the product:**
1. **Host voice (TTS, streamed).** Model `eleven_flash_v2_5` for low latency (about 75 ms model time; first audio in roughly 100 to 150 ms plus network; **measure it**). Use the WebSocket endpoint for lines built word by word, or HTTP streaming when the whole line is known. Ask for PCM (`pcm_24000`; **UNVERIFIED** which output formats the free tier allows; `pcm_16000` is the fallback) and resample to the `AudioSource` rate.
2. **Emotion presets** (this is the "beyond plain text-to-speech" part). `VoicePort.speak(id, text, { emotion })` maps to voice settings: `hype` (stability 0.30, style 0.60, speed 1.08) for intros, round starts, winners; `drumroll` (stability 0.40, style 0.70, speed 0.95) for the reveal build-up; `warm` (stability 0.50, style 0.30, speed 1.0) for confirm-backs and "locked in". Setting names are `stability`, `similarity_boost`, `style`, `speed`, `use_speaker_boost` (**UNVERIFIED**, check the current API). Optional upgrade: Eleven v3 expressive audio tags for finale lines, if the account allows; it is not available on the real-time WebSocket, so use only for cached or pre-generated lines.
3. **Voice choice.** Audition 5 voices from the library for "big retro game show announcer, warm and fast". Save the chosen `ELEVENLABS_VOICE_ID` and the reason in `docs/ai-notes.md`. Check the voice is allowed under our plan.
4. **Speech-to-text for guesses (default).** ElevenLabs Scribe v2 Realtime over WebSocket, audio only while listening (saves credits), VAD commit strategy (`commit_strategy=vad`). Median time to a committed transcript is documented as about 150 ms (their number; **measure ours**). This closes the loop: ElevenLabs is both the host's mouth and ears. If it misbehaves, `STT_PROVIDER=openai|deepgram`.
5. **Stage credit.** The finale shows a small line "Voice by ElevenLabs · AI by Gemini · Data on MongoDB Atlas" (Ethan, in the renderer; static text).

**Free-tier character budget (important).** Sources disagree on the exact free allowance (about 10,000 to 20,000 characters a month depending on model; **check the dashboard**), and free output may not be used commercially. A full 4-player game speaks about 2,500 characters; the demo about 1,100. Without a cache, 10,000 characters is only about 4 games, and rehearsals would use them all. So:
- **`warmCache()` at boot** generates and saves audio for every static line variant (all lines in 12.2 without `{vars}`) to `.cache/tts/<hash>.pcm`. Budget about 3,000 characters once; reuse forever.
- Lines with a name or an amount are generated live and cached too, keyed by the exact text (the same name and the same amount repeat across rehearsals). Pre-warm the **team's four names** into the common name lines (`guess.prompt`, `round.start`, `lobby.joined`, `guess.silent`) during setup.
- Count characters in `tts.ts`. At 70% of `ELEVENLABS_CHAR_BUDGET`, log a warning and stop non-essential live lines (quips); at 90%, speak cached lines only and fall back to the backup voice or captions.
- **Get more credits:** MLH's page says participants can claim 1 month of the ElevenLabs Creator tier through ElevenLabs' Discord coupon bot with the registration email (**UNVERIFIED for HackUTA**). Ask the ElevenLabs rep at the event. Do this at M0.
- Keep generated host lines at or under 18 words.

**Evidence for Devpost:** dashboard usage screenshot, a clip of the host talking with captions, the cache hit-rate line from the logs, the voice ID and settings in the README.

### 21.3 Gemini: how it is used (Akshi owns)
**Why Gemini and not a generic call (say this in the writeup):**
1. **Google Search grounding for prices.** The model verifies prices with live Google Search and returns the sources it used. We show "Google Search: target.com" at the reveal and store the sources. A plain chatbot would guess.
2. **Multimodal vision for the camera fallback.** The same API reads the owner's held-up item from FaceTime frames.
3. **Host lines.** Gemini writes the one-line item reactions and recaps inside strict personality and safety filters.
4. **Embeddings** for the reference-list similarity search stored in Atlas Vector Search.
5. The accuracy harness compares **Gemini alone**, **list + Gemini**, and **list + Gemini + grounding**, so the report itself shows what grounding adds.

**Setup:** free key from Google AI Studio in `GEMINI_API_KEY`; SDK `@google/genai`; call shape `ai.models.generateContent({ model, contents, config: { tools: [{ googleSearch: {} }], responseMimeType: 'application/json', responseSchema } })`. **UNVERIFIED:** current model names, and that grounding plus JSON works in one call (fallback in 10.3). Put timeouts (6 s for pricing, 4 s for vision, 1.5 s for quips) around every call and retry once.

**Free-tier limits and privacy.** Google's free tier has rate limits (requests per minute and per day; check AI Studio) and MLH says not to send sensitive data through free-tier endpoints. Camera frames can contain faces and rooms. So: the **text path is primary**, frames are sent only on the camera fallback, only for team members who agreed, never saved, and the host says "I'm taking a quick look at your item." If a paid key exists, use it for the camera path.

**Evidence for Devpost:** a screenshot of one grounded response with its sources, the eval table (A vs B vs C), the code path in the README.

### 21.4 MongoDB Atlas: how it is used (Aditri owns)
**Setup:** free M0 cluster on Atlas, database `priceislive`, user with read/write on that database only, network access limited to the venue IP and team laptops while building (**avoid `0.0.0.0/0`**, or remove it right after the event), connection string in `MONGODB_URI`. Driver `mongodb` for Node.

**Collections (all validated with zod before insert; money in cents; phone numbers stored as `phoneLast4` plus a salted SHA-256 `phoneHash`, never the full number):**
| Collection | Holds | Indexes |
|---|---|---|
| `reference_items` | The ~200-item price list: `id, name, aliases[], category, priceCents, sizeNote, source, checkedAt, embedding[768]`. Seeded from `data/reference-items.json`. | unique `id`; text index on `name, aliases`; **Atlas Vector Search** index `ref_vec` on `embedding` (cosine, 768 dims) |
| `players` | `phoneHash, phoneLast4, name, gamesPlayed, totalPoints, firstSeenAt, lastSeenAt` (a lifetime leaderboard across games) | unique `phoneHash` |
| `games` | `gameId, startedAt, endedAt, mode (normal/demo), callPlan (A/B/C), playerIds[], totalRounds, lightning, textMode, endReason, finalScoreboard[], championIds[]` | unique `gameId`; `startedAt` |
| `rounds` | `gameId, roundIndex, ownerId, item {rawText, origin, displayName, priceCents, source, isEstimate, confidence, evidence[]}, winnerIds[], winnerReason, stumpPoints, durationMs` | `gameId + roundIndex` unique |
| `guesses` | `gameId, roundIndex, playerId, cents, status, channel, transcript, corrected, points` | `gameId + roundIndex` |
| `results` | `gameId, scoreboard[], items[] {owner, name, priceCents, isEstimate}, cardText, sentAt, sendStatus[]` (statuses by `phoneLast4`) | unique `gameId` |
| `price_cache` | `cleanText, result (PriceResult), createdAt` | unique `cleanText`; TTL 30 days |
| `eval_runs` | `runId, ranAt, variant (A/B/C), models, n, within15, within25, medianAbsPctError, perItem[]` | `ranAt` |

**How data flows:** the pure engine returns `PERSIST {kind, doc}` effects; `store/persist.ts` queues them in memory and writes with retry in the background. **The game never waits for the database.** At boot, `loadReferenceItems()` reads Atlas, and falls back to `data/reference-items.json` if Atlas is down. Pricing reads `price_cache` first. Atlas Vector Search is used for the "similar item" list match in 10.3; if the index is missing or slow, the local similarity runs instead.

**Show-off queries** in `scripts/atlas-stats.ts` (aggregation pipelines): average points per round and per player; share of prices from list, grounded web, and estimate; average absolute pricing error by source (from `eval_runs`); the highest stump score items ("trickiest items"); lifetime leaderboard. Screenshot one or two for Devpost.

**Evidence for Devpost:** Atlas UI screenshot of the collections after a real game, the vector index, and one aggregation result.

### 21.5 MLH Build Your Hackathon A-Team with SpaceXSI (optional, pending decision)
**What MLH asks for:** (1) **use Cursor as your core AI coding agent**; (2) **integrate a Grok Bot automation into your workflow**; (3) in the project description, **describe how you use both Cursor and Grok Bot**; (4) submit and **opt in to the "Make it Legendary with SpaceXSI" raffle**. The prize is a custom Cursor mechanical keyboard for each member of the winning team.

**Our situation:** Ethan has decided that **Cursor is not our coding agent**; the team uses Grok Bot for planning and automation and each teammate uses whichever coding agent they prefer. The requirement is Cursor as the *core* coding agent, so **we qualify only if we actually build mainly in Cursor.** Status: **optional, pending a decision by Ethan. Decide before M0** (it has to be true from the start of the build). Default = **not entering**, and Devpost must not say we did.

**If Ethan chooses to enter:**
- Each teammate runs their coding agent in Cursor (Agent mode) for their slice; the agent prompts in `agent-prompts/` already work in any tool.
- Keep `docs/ai-workflow.md`: a short log of which Cursor agent sessions built what (screenshots of sessions, commit messages naming them).
- **Grok Bot automation ideas (pick at least one that is real and running):** (a) an overnight status routine that every 30 minutes reads the repo (`BLOCKED.md`, test results, last commits) and sends Ethan a short digest; (b) a deadline and checklist watcher that reminds the team of the Devpost deadline and the 21.7 checklist; (c) a call-minutes tracker that reads `docs/call-log.md` and warns before the 50-minute trial allowance is gone; (d) a pre-demo readiness check routine. **Grok Bot would be set up by Ethan; nothing here has been created yet.**
- Devpost text describes honestly how Cursor and Grok Bot were used; opt in to the raffle on the submission form.

**If not entering:** skip 21.5 in Devpost; Grok Bot can still be used for planning and automation but is not claimed as part of this track.

### 21.6 Devpost sponsor paragraphs (drafts for Ethan to edit; replace the {braces} with real numbers)
- **Chert:** "The Price Is Live is a group FaceTime game show. Chert's FaceTime line bridges everyone into a LiveKit room. Our agent publishes a drawn game show stage as its video (podiums, captions, countdown, drumroll, and a price that pops up on screen), and uses the owner's camera to identify an item if they forget to text it. Judges can play by calling the number."
- **ElevenLabs:** "ElevenLabs is the host. Chip Dollar's voice is ElevenLabs streaming text-to-speech with three emotion presets (hype, drumroll, warm), mixed with sound effects into the single audio track Chert allows. ElevenLabs Scribe Realtime listens for spoken price guesses, which we parse ('twenty five bucks' becomes $25.00) and repeat back for confirmation. A line cache keeps us inside the free tier. Code: {repo link}."
- **Gemini:** "Gemini prices every item with Google Search grounding, so prices come with cited sources (shown on screen at the reveal). Gemini's multimodal vision identifies items from FaceTime frames, and it writes the host's one-liners. On {N} held-out items, grounded Gemini was within 15% of the real price {X}% of the time, versus {Y}% for Gemini alone."
- **MongoDB Atlas:** "Atlas holds our ~200-item price list with Atlas Vector Search for similar-item matching, plus every game, player, round, guess, score, and results card, a price cache, and our accuracy runs. Aggregations show {fact from atlas-stats}."
- **A-Team (only if entered):** "We built {describe} with Cursor as our core coding agent: {how}. A Grok Bot automation {describes the real automation}: {what it did}."

### 21.7 Submission checklist (per sponsor, then general)
**Chert (Best Use of FaceTime)**
- [ ] Devpost: select "Best Use of FaceTime (Chert)".
- [ ] Demo shows a real FaceTime call; Gary can play (his phone verified, or a team iPhone).
- [ ] Measured number in sentence one (exact N and X from `eval/report.md`).

**ElevenLabs**
- [ ] Devpost: select "Best Project Built with ElevenLabs".
- [ ] GitHub repo is **public** and has an **open-source license** (`LICENSE` file present).
- [ ] README section "How we use ElevenLabs" with file links (`tts.ts`, `stt.ts`, `voice.ts`).
- [ ] Demo video and live demo clearly use the ElevenLabs voice; Devpost paragraph written.
- [ ] Dashboard usage screenshot saved; free-tier characters not exhausted before judging (cache warmed).
- [ ] ElevenLabs credits claimed (Creator tier coupon) if available.

**Gemini**
- [ ] Devpost: select "MLH Best Use of Gemini API".
- [ ] README section "How we use Gemini" with file links (`ai/pricing.ts`, `ai/webSearch.ts`, `ai/identify.ts`, `ai/host/*`).
- [ ] Devpost paragraph names grounding, vision, host lines, embeddings, and the A/B/C result.
- [ ] Screenshot of a grounded response with sources.
- [ ] No sensitive data sent on the free tier (frames only in the fallback, with consent).

**MongoDB Atlas**
- [ ] Devpost: select "MLH Best Use of MongoDB Atlas".
- [ ] Atlas cluster has real data from real games; screenshot saved; Vector Search index created (or noted as fallback).
- [ ] README section "How we use MongoDB Atlas"; `scripts/atlas-stats.ts` output in Devpost.
- [ ] Network access narrowed or temporary entries removed after the event; DB password rotated after submission.

**SpaceXSI A-Team (only if we decide to enter)**
- [ ] Decision made by Ethan before M0, recorded in `docs/decisions.md`.
- [ ] Cursor really was the core coding agent; `docs/ai-workflow.md` has evidence.
- [ ] A real Grok Bot automation is running and described.
- [ ] Devpost description explains how both Cursor and Grok Bot were used.
- [ ] Opted in to the "Make it Legendary with SpaceXSI" raffle on the submission form.

**General**
- [ ] Devpost deadline confirmed (reportedly 11:59 PM Sat Nov 14, unconfirmed) and submission done before it.
- [ ] Every track box ticked; all four teammates added.
- [ ] Demo video (1 to 3 minutes) uploaded; screenshots added.
- [ ] Repo public, license present, secret scan clean, keys rotated after submission.
- [ ] Project text says what was built during the hackathon.

### 21.8 Questions for the sponsor reps (ask at their tables)
- ElevenLabs: does the Creator coupon apply at HackUTA? Does our key allow `eleven_flash_v2_5`, Scribe Realtime, and `pcm_24000`? Any extra judging criteria?
- Google/MLH: which Gemini model names are best for the free key today; free-tier rate limits; is grounding allowed on free keys?
- MongoDB: is Atlas Vector Search available on the free M0 cluster (we believe so; **UNVERIFIED**)?
- MLH: exact HackUTA track names and the A-Team requirements (if we decide to enter).

---

## Appendix A: environment variables (`.env.example`)
```
# LiveKit (our own project; all three from the same project)
LIVEKIT_URL=wss://YOUR_PROJECT.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
AGENT_NAME=price-is-live-agent
# Chert
CHERT_API_KEY=ftk_...
CHERT_PROJECT_ID=
CHERT_LINE_ID=
CHERT_FACETIME_BASE=https://facetime.trychert.com/api/v1
CHERT_APP_BASE=https://app.trychert.com/api/v1
LINE_DISPLAY_NUMBER=            # shown on stage, e.g. the line's FaceTime number
CALL_MODE=outbound_group        # inbound | outbound_group | link
# Models
# ElevenLabs (host voice; optional speech-to-text)
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=            # chosen lively game show voice
ELEVENLABS_TTS_MODEL=eleven_flash_v2_5
ELEVENLABS_TTS_FORMAT=pcm_24000
ELEVENLABS_CHAR_BUDGET=9000     # warn at 70%, cached-only at 90%
STT_PROVIDER=elevenlabs         # elevenlabs | openai | deepgram
# Gemini (pricing, vision, host lines, embeddings)
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash   # UNVERIFIED best current name; try newer Flash models
GEMINI_EMBED_MODEL=gemini-embedding-001   # UNVERIFIED name; use 768 dimensions
# MongoDB Atlas
MONGODB_URI=
MONGODB_DB=priceislive
# Optional fallbacks only
OPENAI_API_KEY=
SEARCH_PROVIDER=gemini          # gemini | none (tavily/brave only if Gemini grounding is unavailable)
TAVILY_API_KEY=
BRAVE_API_KEY=
# Game
DEMO=0
STAGE_W=960
STAGE_H=540
STAGE_FPS=15
LOG_LEVEL=info
```

## Appendix B: quick glossary
- **Line:** Chert's real FaceTime/iMessage identity for our project. **Bridge:** Chert's worker that joins our LiveKit room. **BYOR:** bring your own room (our setup). **`bridge_ready`:** the signal that FaceTime media is ready; the first moment we may speak.
- **Owner:** the player whose item is shown this round. **Guesser:** every other player. **Stump points:** the owner's points for fooling the guessers.
- **Verified phone:** a phone that texted a 6-digit code to the Chert line from the dashboard flow; required for group calls and texts on free/shared lines.
- **TEXT MODE:** guesses by iMessage when audio is not working.
- **Lightning mode:** shorter lines and timings so the game fits in 4:30.
- **Prop closet:** the host picks a random list item when no item arrives.

*End of spec.*
