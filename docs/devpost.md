# Devpost submission: The Price Is Live (paste-ready)

**BEFORE SUBMITTING: fill {N}, {X}, {Y} from eval/report.md (see docs/measured-number.md).**

Fill the placeholders before posting: **{N}** = number of held-out items, **{X}** = percent within 15% with the reference list, **{Y}** = percent within 15% for the AI alone. Take all three from `eval/report.md` and use its exact sentence. Do not guess them. Do not post while any `{...}` is still in the text.

---

## Project name

The Price Is Live

## Tagline

The Price Is Right, on a group FaceTime, with your own stuff.

## Inspiration

Everyone has stuff at home and an opinion about what it costs. We wanted to turn that into a game show you can play with friends on a call you already know how to make. The Price Is Right is the right shape: hold up an item, everyone guesses, closest without going over wins. We added a host who never gets tired and a stage that is the video itself.

## What it does

The Price Is Live is a game show on a group FaceTime call. Two to four friends join one call with an AI host named Chip Dollar. Chip hosts from a drawn game show stage with a podium for each player.

- Before a turn, the item's owner texts the line what the item is (for example "Owala bottle").
- The agent prices it in the background. It checks a reference list of about 200 common items first. If there is no match, it uses a web-grounded lookup.
- The owner holds the item up to their camera.
- The other players guess the price out loud, one at a time, with a 10-second countdown. The host repeats each guess back, and the player says yes or fixes it.
- A drumroll plays, then the real price pops up on the stage.
- A guess at or under the price scores up to 100 points by closeness. A guess over scores 0. The closest guess without going over gets +25. The owner earns up to 100 stump points if the crowd is far off.
- At the end, the agent texts everyone a results card with the scoreboard and each item's real price, and offers a rematch.

Prices are list prices, not what any one store charges today. Each price is marked verified or unverified. When a price is unverified or low confidence, the host calls it an estimate at the reveal.

**The measured number:** we tested pricing on {N} items that were not on the reference list. The agent was within 15% of the real price on {X}% of them, compared with {Y}% for the AI alone.

## How we built it

One TypeScript process on Node 22. There is no web server and no web link. You play by calling a phone number.

- **Chert** puts a FaceTime line in front of our agent. Group calls join a LiveKit room. Our agent connects to that room with one audio track and one video track.
- **The video** is a stage we draw ourselves with `@napi-rs/canvas`: background, marquee, podiums with names and scores, word-by-word captions, the countdown ring, the drumroll, and the price pop. The host is a sprite with a mouth that flaps while the host talks.
- **The audio** is one mixed track. The host's voice and the sound effects (drumroll, sting, ding) are mixed together, because the line allows one audio track.
- **ElevenLabs** speaks the host's lines. A disk cache keeps repeated lines free.
- **Gemini** prices items that are not on the list.
- **MongoDB Atlas** stores the reference list and the game records.
- **Texts** (iMessage through Chert) carry the join message, the item, the backup guess channel, and the results card.
- **The game rules are a pure state machine.** It takes events and returns effects, so scoring and flow are unit tested with no network.

## Challenges

- Group call rules. A call can be set up only some ways, so the game does not care how people are connected.
- One mixed audio track. Voice and effects have to share it without clipping.
- The 5-minute trial cap. The demo game is built to fit in under 2 minutes, with a "lightning mode" that speeds things up if the clock runs short.
- Silent audio. If speech is not heard, players can text a guess instead.
- Captions that fit the stage, wrap well, and show up in time with the voice.
- Keeping text-to-speech inside a small free character budget.

## Accomplishments

We tested our pricing on {N} items it had never seen: within 15% on {X}% of them, versus {Y}% for the AI alone. (Replace this sentence with the exact one from `eval/report.md`.)

We also built a full game that runs end to end on a live call, with a stage that looks like a real show.

## What we learned

- A drawn stage can carry a whole product when the video is the interface.
- Cache everything you say. It saves money and time.
- Show the number we measured, not the number we hoped for.
- Small pure functions for the rules made a rushed build safe to change.

## What's next

- More players per game.
- Join by link, not only by phone.
- A rematch ladder across games.
- More items on the reference list, with a re-check date for every price.

## Built with

TypeScript, Node.js, LiveKit, Chert (FaceTime and iMessage), ElevenLabs, Gemini API, MongoDB Atlas, @napi-rs/canvas

## Tracks to tick

- [ ] Best Use of FaceTime (Chert)
- [ ] Best Project Built with ElevenLabs
- [ ] MLH Best Use of Gemini API
- [ ] MLH Best Use of MongoDB Atlas

Do not tick the SpaceXSI A-Team track. We did not enter it.

---

## Sponsor paragraphs

### Chert

The Price Is Live is a group FaceTime game show. Chert's FaceTime line brings everyone into a LiveKit room. Our agent publishes a drawn game show stage as its video: podiums, captions, a countdown, a drumroll, and a price that pops up on screen. The players' own items, held up to their cameras, are what the game is about. Judges can play by calling the number.

### ElevenLabs

ElevenLabs is the host. Chip Dollar's voice is ElevenLabs text-to-speech, mixed with sound effects into the single audio track the line allows. A line cache and a character budget keep us inside the free tier. Code: {repo link}, mainly `src/comms/tts.ts`.

### Gemini

Gemini prices items that are not on our reference list. Prices come back with the sources used, and the result is marked verified or unverified. All prices are list prices. On {N} held-out items, the full pricing path was within 15% of the real price {X}% of the time, versus {Y}% for the AI alone.

### MongoDB Atlas

Atlas holds our reference price list (about 200 items) and every game, player, round, guess, score and results card. If Atlas is down, the game loads the list from a local file and keeps going, and writes are queued and retried in the background. The game never waits on the database.

---

## Screenshots to upload

Make the stage images with `npm run preview:stage`. They are written to `out/stage/`.

- [ ] Stage with four podiums and the title (from `out/stage/`)
- [ ] Mystery item and the 10-second countdown ring (from `out/stage/`)
- [ ] Captions on screen while the host talks (from `out/stage/`)
- [ ] Drumroll, then the price pop (from `out/stage/`)
- [ ] Finale scoreboard with the credit line (from `out/stage/`)
- [ ] The results text on a phone (take from a real game)
- [ ] The eval table from `eval/report.md`
- [ ] Atlas collections after a real game
- [ ] ElevenLabs dashboard usage
- [ ] One priced item with its sources

---

## Only if built (delete otherwise)

Each line below may not ship. Keep a line only if it is true in the code at submission time. Delete this whole section if none are.

- Camera item identification: if an owner forgets to text, Gemini vision reads the held-up item from call frames.
- Atlas Vector Search and embeddings: the reference list uses embeddings for similar-item matching.
- Model-written quips: Gemini writes the host's short item reactions.
- Inbound calls: players call the line and the call connects directly (Plan A). Otherwise the agent calls out to everyone.

---

## Submission checklist

**Chert (Best Use of FaceTime)**
- [ ] Devpost: select "Best Use of FaceTime (Chert)".
- [ ] Demo shows a real FaceTime call. Gary can play (his phone is verified, or hand him a team iPhone).
- [ ] The measured number is in sentence one of the pitch (exact N and X from `eval/report.md`).

**ElevenLabs**
- [ ] Devpost: select "Best Project Built with ElevenLabs".
- [ ] GitHub repo is public and has an open-source license (`LICENSE` file present).
- [ ] README section "How we use ElevenLabs" with file links.
- [ ] Demo video and live demo clearly use the ElevenLabs voice. Paragraph above is filled in.
- [ ] Dashboard usage screenshot saved. Free characters not used up before judging (cache warmed).
- [ ] ElevenLabs credits claimed (Creator coupon) if available.

**Gemini**
- [ ] Devpost: select "MLH Best Use of Gemini API".
- [ ] README section "How we use Gemini" with file links.
- [ ] Paragraph above names only what the code does today. Check the "Only if built" list.
- [ ] Screenshot of a priced item with sources.
- [ ] No sensitive data sent on the free tier.

**MongoDB Atlas**
- [ ] Devpost: select "MLH Best Use of MongoDB Atlas".
- [ ] Atlas cluster has real data from real games. Screenshot saved.
- [ ] README section "How we use MongoDB Atlas".
- [ ] Network access narrowed or temporary entries removed after the event. Database password rotated after submission.

**General**
- [ ] Devpost deadline confirmed (reportedly 11:59 PM Sat Nov 14, not confirmed) and submission done before it.
- [ ] Every track box ticked. All four teammates added.
- [ ] Track names match the exact wording on the HackUTA Devpost page.
- [ ] Demo video (1 to 3 minutes) uploaded. Screenshots added.
- [ ] Repo public, license present, secret scan clean, keys rotated after submission.
- [ ] Project text says what was built during the hackathon.
- [ ] No `{N}`, `{X}`, `{Y}` or `{repo link}` left in the posted text.
