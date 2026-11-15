# Relay setup for Aditri

**Aditri: paste this whole file into Codex on your macOS computer.** Open Codex in any folder (your home folder is fine). It will do the setup with you in about 10 minutes. It will stop and ask you whenever you need to sign in or approve something.

---

## Instructions for the coding agent

You are setting up this computer so **Aditri** can take part in the team's **Relay** build for **HackUTA 2026**. Relay runs Aditri's own Codex on their own subscription, side by side with their teammates' computers. Once a run starts nobody has to watch it (the team may be working, in class, or asleep), so everything must be ready and verified now.

### Rules for you
- Work through the steps **in order**. Run each check, show the human the result, and only move on when it passes.
- **Never type, ask for, or store passwords, tokens or API keys.** When a login is needed, stop and ask the human to run the login command themselves in their own terminal, then re-run the check.
- **Ask the human before installing software** or changing global settings, and say exactly what you will run.
- Do not edit files in the team's project, do not commit, and do not push. Only use the Relay commands below.
- This computer runs **macOS**. The Relay folder will be `$HOME/relay`.
- If a step fails in a way these instructions don't cover, explain the error to the human in plain words and suggest the smallest fix.

### Who's on the team
| Name | GitHub | Computer | Agent | Role |
|---|---|---|---|---|
| Ethan Meza | @ethnmz | macOS | Claude Code | lead-design, host-avatar-and-stage-video, overlays, captions, demo, devpost, pitch, and-the-measured-number-write-, stage |
| Diego | @Navibytes | Windows | Claude Code | chert-bridge, voice-speech-to-text, text-to-speech, calls, imessage-src, comms, src, speech, src, agent-ts |
| Akshi | @biswalakshi | Windows | Codex | ai-and-vision, item-identification-and-pricin, host-script-and-personality-pr, ai |
| Aditri (you) | @aditrit06 | macOS | Codex | backend, game-state-and-scoring, deployment, reference-list-and-test-set-an, engine, src, contracts, src, config-ts, src, store, data, eval |

Aditri's role: **backend, game-state-and-scoring, deployment, reference-list-and-test-set-an, engine, src, contracts, src, config-ts, src, store, data, eval**. The team lead is **Ethan Meza**. The project repo is **https://github.com/ethnmz/The-Price-Is-Live**.

Tasks in this role (their agent builds these during the run):
- T01: Game engine reducer: full game flow
- T02: Harden join registry and iMessage templates
- T03: buildStageState: GameState to StageState
- T04: Game runner: execute effects against the ports
- T05: Reference price list (about 200 items) and data checker
- T06: Held-out test set (40 items not on the list)
- T07: MongoDB Atlas store (StorePort) that never blocks the game
- T08: Engine: hard clock, lightning mode and automatic TEXT MODE
- T09: sim-call: a whole game with fake ports and a virtual clock
- T10: Accuracy harness: npm run eval (variants A, B, C)
- T11: npm run doctor and the human runbook
- T39: Engine: camera and voice fallbacks when no item text arrives
- T41: Atlas seed script and show-off aggregations
- T43: Dockerfile for the backup deployment

### Step 1: Check the basic tools
Run each command and check the result:
- `node --version` must be **v20 or newer**. If missing or older: brew install node   (or the installer from nodejs.org if Homebrew is missing)
- `git --version` must work. If missing: xcode-select --install
- `gh --version` must work. If missing: brew install gh

### Step 2: GitHub sign-in (the human does this part)
1. Run `gh auth status`. It must show a logged-in account.
2. Run `gh api user --jq .login`. It must print **aditrit06**.
3. If either fails, ask the human to run `gh auth login` themselves (GitHub.com → HTTPS → log in with a web browser), then check again.
4. Check for a pending invitation to the project and to Relay: `gh api user/repository_invitations --jq '.[] | "\(.id) \(.repository.full_name)"'`. If you see **ethnmz/The-Price-Is-Live** or **ethnmz/relay**, show it to the human and, **only if they agree**, accept it with `gh api -X PATCH user/repository_invitations/<id>`. If there is no invitation and Step 4 or 5 later fails with "not found", ask the human to message Ethan Meza for an invite.

### Step 3: Sign in to Codex with the subscription (the human does this part)
1. If `codex --version` fails, ask before installing: `npm install -g @openai/codex`
2. Run `codex login status`. It passes when the output mentions "ChatGPT" (a ChatGPT plan login, not an API key).
3. If it fails, ask the human to run `codex login   (choose Sign in with ChatGPT)` themselves, then check again.
4. Relay uses the **subscription**, not API keys. If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set in this shell, tell the human. Relay ignores those keys for its agents, so nothing needs deleting.

### Step 4: Get Relay
- If `$HOME/relay` already exists, run `git -C "$HOME/relay" pull` there. Otherwise run `gh repo clone ethnmz/relay "$HOME/relay"`.
- Then, inside that folder, run `npm install`. It must finish without errors.
- Check it works: `node "$HOME/relay/bin/relay.mjs" help` prints the Relay commands.

### Step 5: Join the team's project
Run:
```
node "$HOME/relay/bin/relay.mjs" join https://github.com/ethnmz/The-Price-Is-Live --node aditri
```
It must end with a line `PROJECT_DIR=...`. Remember that folder; the next steps run inside it. It should also say "This computer is Aditri".

### Step 6: Run the final check
Inside PROJECT_DIR, run:
```
node "$HOME/relay/bin/relay.mjs" preflight --node aditri
```
It checks power, sleep, GitHub access, and does one real test call to Codex. Every line must be ✔ or ! (a warning), with **no ✖**, and it must end with "Ready for the run." For each ✖, explain it in plain words and help fix it, then run the check again. Common ones:
- **power:** the computer must be plugged in.
- **gh auth:** signed in as the wrong GitHub account; repeat Step 2.
- **Codex login / live check:** repeat Step 3.

### Step 7: Hand off to Aditri
Tell the human to do this themselves, because it must keep running after this Codex session ends:

1. Open a **new terminal window** (Terminal).
2. Run:
```
cd "<PROJECT_DIR from step 5>"
node "$HOME/relay/bin/relay.mjs" start --node aditri --wait-for-go
```
3. Leave that window open, the computer **plugged in with the lid open**, and go do something else. It starts on its own when Ethan Meza starts the run.
4. Optional: keep the lid open (or use an external display). Relay keeps the Mac awake while it runs.

They can watch progress any time by running `npm start` inside `$HOME/relay`, which opens the Relay app in the browser.

### Finish
Give Aditri a short checklist of what passed. Remind them that nothing will ask them anything during a run, and that when it finishes the team reviews one report and one pull request.
