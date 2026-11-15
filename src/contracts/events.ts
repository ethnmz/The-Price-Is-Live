// Engine events and effects. FROZEN contract. See docs/API.md "Engine".
// The engine is: reduce(state, event, deps) -> { state, effects }. It does no I/O.
// src/engine/runner.ts executes the effects against the ports and feeds events back.
import type { HostLineKey } from './hostLines';
import type {
  Cents, Emotion, GameConfig, GameState, ItemRequest, ParsedGuess, PlayerId, PriceResult, ReferenceItem, SfxName,
} from './types';

/** Every event carries `at` (ms epoch, or virtual ms in the sim). The engine never reads a clock. */
export type GameEvent =
  | { type: 'BOOT'; at: number }
  | { type: 'TEXT_RECEIVED'; at: number; phone: string; text: string; msgId: string }
  | { type: 'CALL_READY'; at: number; callId: string } // bridge_ready
  | { type: 'CALL_FAILED'; at: number; reason: string } // dial error or timeout
  | { type: 'CALL_ENDED'; at: number; reason: string }
  | { type: 'SPEECH_PARTIAL'; at: number; text: string }
  | { type: 'SPEECH_FINAL'; at: number; text: string; confidence: number }
  | { type: 'SPEAK_DONE'; at: number; speakId: string }
  | { type: 'TIMER'; at: number; timerId: string }
  | { type: 'PRICE_READY'; at: number; itemId: string; result: PriceResult }
  | { type: 'PRICE_FAILED'; at: number; itemId: string }
  | { type: 'FRAME_ID_READY'; at: number; itemId: string; label: string | null; confidence: number }
  | { type: 'TICK'; at: number }; // once per second: hard clock and countdown

export type PersistKind = 'player' | 'game' | 'round' | 'guess' | 'result' | 'priceCache' | 'evalRun';

export type Effect =
  | { type: 'SPEAK'; speakId: string; key: HostLineKey; text: string; emotion: Emotion } // also the caption
  | { type: 'SFX'; name: SfxName }
  | { type: 'SEND_TEXT'; phone: string; text: string; idemKey: string } // idemKey: `${gameId}:${type}:${last4}:${n}`
  | { type: 'PRICE_ITEM'; request: ItemRequest } // answered by PRICE_READY / PRICE_FAILED
  | { type: 'IDENTIFY_FROM_CAMERA'; itemId: string; ownerId: PlayerId } // answered by FRAME_ID_READY
  | { type: 'LISTEN'; on: boolean }
  | { type: 'START_TIMER'; timerId: string; ms: number } // answered by TIMER { timerId }
  | { type: 'CANCEL_TIMER'; timerId: string }
  | { type: 'DIAL'; phones: string[] } // answered by CALL_READY / CALL_FAILED
  | { type: 'END_CALL' } // answered by CALL_ENDED
  | { type: 'PERSIST'; kind: PersistKind; doc: Record<string, unknown> }
  | { type: 'LOG'; level: 'info' | 'warn' | 'error'; msg: string; data?: Record<string, unknown> };

/** Everything impure or owned by another lane is injected, so the engine can be built and tested alone. */
export interface EngineDeps {
  config: GameConfig;
  parseGuess(text: string, sttConfidence?: number): ParsedGuess; // src/speech/parseGuess.ts
  spokenAmount(cents: Cents): string; // src/speech/spokenAmount.ts: 2500 -> "twenty-five dollars"
  line(key: HostLineKey, vars?: Record<string, string | number>): string; // src/ai/host/lines.ts
  propItem(): ReferenceItem; // random reference item for the prop closet
  newGameId(): string;
}

export interface ReduceResult {
  state: GameState;
  effects: Effect[];
}
export type Reduce = (state: GameState, event: GameEvent, deps: EngineDeps) => ReduceResult;
