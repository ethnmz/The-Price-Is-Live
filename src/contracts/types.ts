// Shared data types. FROZEN: do not edit in a task. Ask for a contract change instead.
// Human-readable version: docs/DATA_MODEL.md. Source spec: docs/SPEC.md section 8.5.
export const CONTRACT_VERSION = 1;

/** Money is always integer cents. */
export type Cents = number;
export type PlayerId = 'p1' | 'p2' | 'p3' | 'p4';
export const PLAYER_IDS: PlayerId[] = ['p1', 'p2', 'p3', 'p4'];

export interface Player {
  id: PlayerId;
  seat: number; // 0..3, fixed turn order (join order)
  name: string; // max 12 chars
  phone: string; // E.164, e.g. "+12145550100". Never log in full (last 4 only).
  isMain: boolean; // first to join
  score: number;
  roundWins: number;
  joinedAt: number; // ms epoch
}

export interface ItemRequest {
  itemId: string; // "r1", "r2", ... (round number, 1-based)
  ownerId: PlayerId;
  origin: 'text' | 'camera' | 'voice' | 'prop_closet';
  rawText?: string; // "Owala bottle"
  imageJpegBase64?: string[]; // camera frames (max 3), memory only
}

export interface PriceEvidence {
  kind: 'list' | 'web' | 'model'; // 'web' = Gemini + Google Search grounding source
  label: string; // list item name, or page title
  url?: string;
  priceCents?: Cents;
  matchScore?: number; // 0..1 for list matches
}

export interface ReferenceItem {
  id: string; // "ref_0042"
  name: string;
  aliases: string[]; // lowercase
  category: string;
  priceCents: Cents;
  sizeNote?: string;
  source: string; // retailer or manufacturer domain / URL
  checkedAt: string; // YYYY-MM-DD
  verified?: boolean; // true only if the price was actually checked on the source page
  embedding?: number[];
}

export interface HeldoutItem {
  id: string; // "held_001"
  text: string; // how a player would text it: "Stanley quencher 40oz"
  trueCents: Cents;
  source: string;
  checkedAt: string;
  category: string;
  tier: 'similar' | 'novel';
  verified?: boolean;
}

export interface PriceResult {
  itemId: string;
  displayName: string; // clean name the host can say
  priceCents: Cents; // 100..100000
  source: 'list' | 'web' | 'estimate';
  isEstimate: boolean; // true when source === 'estimate' or confidence < 0.5
  confidence: number; // 0..1
  evidence: PriceEvidence[];
  latencyMs: number;
  propClosetSuggested?: boolean; // not a real product / refused: the engine may swap in a prop-closet item
}

export interface Guess {
  playerId: PlayerId;
  status: 'locked' | 'silent' | 'pass';
  cents: Cents | null; // after the max(100) rule; null unless locked
  rawTranscript: string | null;
  channel: 'voice' | 'text' | null;
  corrected: boolean; // player changed it after confirm-back
}

export interface RoundItem {
  displayName: string;
  priceCents: Cents;
  isEstimate: boolean;
  source: PriceResult['source'];
}

export interface RoundResult {
  roundIndex: number; // 0-based
  ownerId: PlayerId;
  item: RoundItem;
  guesses: Guess[];
  guessPoints: Record<PlayerId, number>; // 0 for owner and non-guessers
  winnerIds: PlayerId[];
  winnerReason: 'closest_under' | 'lowest_over' | 'none';
  bonus: 25;
  stumpPoints: number; // goes to owner
  totals: Record<PlayerId, number>; // running totals after this round
}

export type Phase =
  | 'boot' | 'wait_call' | 'dialing' | 'connected' | 'lobby' | 'rules' | 'round_start' | 'item_resolve'
  | 'show_item' | 'guess_prompt' | 'guess_listen' | 'guess_confirm' | 'guess_silent' | 'reveal' | 'round_score'
  | 'finale' | 'rematch_offer' | 'ending';

export const PHASES: Phase[] = [
  'boot', 'wait_call', 'dialing', 'connected', 'lobby', 'rules', 'round_start', 'item_resolve',
  'show_item', 'guess_prompt', 'guess_listen', 'guess_confirm', 'guess_silent', 'reveal', 'round_score',
  'finale', 'rematch_offer', 'ending',
];

/** Result of the deterministic spoken-guess parser (src/speech/parseGuess.ts). */
export interface ParsedGuess {
  kind: 'amount' | 'pass' | 'yes' | 'no' | 'none';
  cents?: Cents; // for 'amount', after clamping to [100, 9999900]
  ambiguous: boolean; // e.g. "two fifty" could be $2.50 or $250
  confidence: number; // sttConfidence, times 0.8 if ambiguous
  spokenForm?: string; // what the host repeats: "twenty-five dollars"
}

export type Emotion = 'hype' | 'drumroll' | 'warm';
export type SfxName = 'drumroll' | 'ding' | 'buzzer' | 'tada' | 'tick';

/** All timing and rule constants. Defaults live in src/config.ts (SPEC 7.1). */
export interface GameConfig {
  demo: boolean;
  hardCapMs: number; // 270000
  lastRoundStartMs: number; // 250000: no new round after 4:10
  guessSeconds: number; // 10
  textModeGuessSeconds: number; // 20
  confirmSilenceMs: number; // 3000
  minRelistenMs: number; // 4000
  guessPromptMaxMs: number; // 1500 after speak start
  priceTimeoutMs: number; // 8000
  itemWaitMs: number; // 6000
  itemResolveMaxMs: number; // 12000 then prop closet
  lobbySettleMs: number; // 8000 (1000 in demo)
  lobbyMaxWaitMs: number; // 60000
  dialTimeoutMs: number; // 45000
  showItemMs: number; // 4000 (3000 in demo)
  drumrollMs: number; // 3000
  lightningDrumrollMs: number; // 2000
  revealHoldMs: number; // 3000 (2000 lightning)
  scoreHoldMs: number; // 1000 after the score line
  rematchListenMs: number; // 8000
  avgRoundMsInitial: number; // 48000
  finaleBufferMs: number; // 25000
  lightningConfidence: number; // 0.8: skip confirm-back in lightning when sure
  minPlayers: number; // 2
  maxPlayers: number; // 4
  demoItems: number; // 2
  lineDisplayNumber: string | null;
}

/**
 * Whole game state. Owned by the engine (src/engine). Nothing outside the engine mutates it.
 * The engine may keep extra private fields by extending this interface inside src/engine,
 * but buildStageState() and every other lane may only read the fields below.
 */
export interface GameState {
  phase: Phase;
  gameId: string | null;
  callId: string | null;
  callStartAt: number | null; // hard clock starts here (CALL_READY.at)
  now: number; // `at` of the last event
  phaseEnteredAt: number;
  demo: boolean;
  lightning: boolean;
  textMode: boolean;
  players: Player[];
  turnOrder: PlayerId[];
  roundIndex: number; // 0-based, -1 before round 1
  totalRounds: number;
  currentItem: { itemId: string; ownerId: PlayerId; request: ItemRequest; price: PriceResult | null } | null;
  guessOrder: PlayerId[];
  guessIndex: number;
  guesses: Guess[]; // guesses of the current round so far
  /** Amount heard and waiting for confirm-back. */
  pendingGuess: { cents: Cents; spokenForm: string; rawTranscript: string; corrections: number } | null;
  liveTranscript: string | null; // latest partial transcript, for the stage
  /** The visible countdown (guess window). */
  timer: { timerId: string; startedAt: number; ms: number } | null;
  caption: { text: string; speaker: 'host' | 'system' } | null;
  revealStage: 'none' | 'drumroll' | 'price';
  history: RoundResult[];
  pendingItemTexts: Partial<Record<PlayerId, string>>; // item texts received early
  itemPromptSentTo: PlayerId[];
  silentWindows: number; // guess windows in a row with no speech at all (2 => TEXT MODE)
  roundStartedAt: number | null;
  roundDurationsMs: number[];
  capHit: boolean; // hard clock forced the finale
  rematchRequested: boolean;
}

/** What the renderer needs. Engine builds it (buildStageState), Stage draws it. Nothing else. */
export interface StageState {
  phase: Phase;
  title: string | null; // "THE PRICE IS LIVE"
  roundLabel: string | null; // "ROUND 2 OF 4"
  turnOrder: { id: PlayerId; name: string; done: boolean; current: boolean }[];
  podiums: {
    id: PlayerId;
    name: string;
    score: number;
    seat: number;
    role: 'idle' | 'owner' | 'guesser' | 'winner';
    guessText: string | null; // "$25.00" or "—" or "$25.00 ?"
    guessState: 'none' | 'pending' | 'locked' | 'silent' | 'over';
    delta: { guess: number; bonus: number; stump: number } | null; // animate on round_score
  }[];
  caption: { text: string; speaker: 'host' | 'system' } | null;
  /** secondsLeft is exact at the moment the state was built; the renderer counts down from there while running. */
  timer: { secondsLeft: number; total: number; running: boolean } | null;
  reveal: {
    stage: 'none' | 'drumroll' | 'price';
    priceText: string; // "" until stage === 'price'
    itemName: string; // "" until stage === 'price'
    isEstimate: boolean;
    sourceLabel: string | null; // "Price list", "Google Search: target.com", "Estimate"
  } | null;
  mysteryOwner: string | null; // "MYSTERY ITEM from {owner}" card, round_start..guess_*
  liveTranscript: string | null; // fragment under the current guesser's podium
  banner: string | null; // "TEXT REMATCH TO PLAY AGAIN"
  joinHint: string | null; // 'Text "I'm in, I'm [your name]" to (214) 555-0100'
  fallbackBadge: 'TEXT MODE' | 'NO CAMERA' | null;
  hostSpeaking: boolean; // the runner overrides this from VoicePort.onSpeakingChange
  lightning: boolean;
  capRemainingMs: number | null; // only in the last 45 s before the hard cap
  finale: {
    ranks: { id: PlayerId; name: string; total: number; place: number }[];
    champion: string[];
    items: string[]; // recap strip: "Ethan: Owala $27.99"
  } | null;
}
