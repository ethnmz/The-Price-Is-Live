# Pitch: The Price Is Live

Placeholders: **{N}**, **{X}**, **{Y}** come from `eval/report.md`. Fill them in before saying them out loud. If the eval is not done, skip the number and say nothing made up.

---

## The 30 seconds before the demo

"This is The Price Is Right on a group FaceTime. The host sees your real stuff, a stage is the video, and the price is live."

Then say who is playing: four of us on the call, Ethan holds up an item, the other three guess.

## The 30 seconds after the demo

"We tested our pricing on {N} items it had never seen: within 15% on {X}%, versus {Y}% for the AI alone. You can play right now: FaceTime this number."

Say that prices are list prices, each marked verified or unverified. Then hand Gary the iPhone, or tell him to FaceTime the line.

---

## Timed demo script (target 1:41, hard limit 2:00)

Round 1: guessers are Diego, Akshi, Aditri. Owner is Ethan.
Round 2: guessers are Akshi, Aditri, Ethan. Owner is Diego.
If Gary plays, he replaces Aditri as a guesser in round 2.

| Time | What happens | Host / stage |
|---|---|---|
| 0:00 | Call picks up. Stage appears. | "Hello, hello, HELLO! Welcome to THE PRICE IS LIVE!" Title card, four podiums lit. |
| 0:04 | Rules. | Short rules line. Rules card. |
| 0:09 | Round 1 starts. | "Round one! Come on down, Ethan!" Spotlight on Ethan, "ROUND 1 OF 2". |
| 0:13 | Ethan holds up his Owala bottle. | Mystery item card. Price already ready. |
| 0:16 | Diego guesses. | Countdown, "Thirty dollars. Right?" "Yes." Locked. |
| 0:23 | Akshi guesses. | Same. |
| 0:30 | Aditri guesses. | Same. |
| 0:37 | Reveal. | Drumroll 3 s. Price pops: "$27.99!" |
| 0:43 | Score. | Points fly, winner crown, "Ethan stumped the crowd for 31 stump points!" |
| 0:47 | Round 2 starts. | "Round two! Diego, you're up!" |
| 0:53 | Diego holds up the second item. | Item not on the list, so this one is priced from the web (run it once before so it is cached). |
| 0:56 | Akshi, Aditri, Ethan guess. | 7 s each. |
| 1:17 | Reveal. | Drumroll, price pops. "That's my best estimate!" if confidence was low. |
| 1:23 | Score. | Points fly. |
| 1:27 | Finale. | Finale drumroll, champion line, confetti. Results text arrives on all four phones now. |
| 1:37 | Rematch offer. | Host offers a rematch. |
| 1:41 | Bye and end call. | Host says goodbye. |

Worst case, with every guess using the full 10 seconds, is about 1:55. If the projection goes over, lightning mode speeds the game up on its own.

The example numbers in the table ($27.99, 31 stump points) are from the plan. Real values on the day will differ.

---

## Three likely judge questions

**1. How do you know the prices are right?**
We do not claim they are exact. They are list prices, and each one is marked verified or unverified. We tested on {N} items that were not on our reference list. The pricing was within 15% on {X}% of them, and the AI alone was within 15% on {Y}%. When we are unsure, the host says "estimate" at the reveal.

**2. What is the AI doing, and what is just code?**
The game rules and scoring are plain code with tests, so a guess is scored the same way every time. The AI prices items that are not on the list. The voice is ElevenLabs. The stage is drawn by our own code and sent as the video on the call.

**3. What happens if something breaks mid-game?**
There are fallbacks. If speech is not heard, players can text a guess. If the database is down, the game loads the price list from a local file and keeps going. If voice credits run low, it uses cached lines and captions. The demo is built to finish in under 2 minutes, so the 5-minute trial cap is not a risk.
