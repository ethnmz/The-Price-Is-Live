import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../src/engine/reducer';
import { makeFakeDeps, fakePriceResult } from '../src/testing/fakes';
import type { Effect, GameEvent } from '../src/contracts/events';
import type { GameState } from '../src/contracts/types';

function game(n = 4, demo = false) {
  const deps = makeFakeDeps({ demo });
  let state = initialState(deps.config), at = 0;
  const effects: Effect[] = [], pending: Effect[] = [];
  function send(e: Omit<GameEvent, 'at'> | Record<string, unknown>) {
    const before = structuredClone(state);
    const result = reduce(state, { ...e, at: ++at } as GameEvent, deps);
    expect(state).toEqual(before);
    state = result.state; effects.push(...result.effects); pending.push(...result.effects);
    return result;
  }
  function speech(text: string) { send({ type: 'SPEECH_FINAL', text, confidence: 1 }); }
  function text(seat: number, text: string) { send({ type: 'TEXT_RECEIVED', phone: `+1214555010${seat}`, text, msgId: `m${++at}` }); }
  function next() {
    const privateState = state as GameState & { speech: { id: string }[]; timers: Record<string,string> };
    const sp = privateState.speech[0];
    if (sp) { send({ type: 'SPEAK_DONE', speakId: sp.id }); return; }
    const tid = Object.keys(privateState.timers)[0];
    if (tid) {
      const effect = [...effects].reverse().find(e => e.type === 'START_TIMER' && e.timerId === tid);
      if (effect?.type === 'START_TIMER') at += effect.ms;
      send({ type: 'TIMER', timerId: tid }); return;
    }
    throw new Error(`Stalled in ${state.phase}`);
  }
  function until(phase: GameState['phase']) { for (let i=0; state.phase !== phase && i<300; i++) next(); expect(state.phase).toBe(phase); }
  function finish(guesses: (number | null)[][]) {
    for (let i=0; i<1000 && state.phase !== 'wait_call'; i++) {
      if (state.phase === 'guess_listen' && state.timer) {
        const amount = guesses[state.roundIndex][state.guessIndex];
        if (amount !== null) { speech(String(amount)); untilConfirmDone(); speech('yes'); }
        else next();
      } else if (state.phase === 'ending' && effects.at(-1)?.type === 'END_CALL') send({ type: 'CALL_ENDED', reason: 'done' });
      else next();
    }
    expect(state.phase).toBe('wait_call');
  }
  function untilConfirmDone() {
    while ((state as GameState & { speech: unknown[] }).speech.length) next();
  }
  send({ type: 'BOOT' });
  for (let i=1;i<=n;i++) text(i,`I'm in, I'm Player${i}`);
  function ready(priced = true) {
    if (priced) for (let i=1;i<=n;i++) { text(i,`Item ${i}`); send({ type: 'PRICE_READY', itemId: `r${i}`, result: fakePriceResult(`r${i}`,`Item ${i}`,1000) }); }
    text(1,'start'); send({ type: 'CALL_READY', callId: 'call' });
  }
  return { deps, send, speech, text, next, until, ready, finish, effects, get state() { return state; } };
}

describe('game flow', () => {
  it('scores a four-player game with hand-computed totals and persists every guess', () => {
    const g=game(); g.ready(); g.finish([[10,5,20],[10,5,20],[10,5,20],[10,5,20]]);
    const final = g.effects.find(e => e.type === 'PERSIST' && e.kind === 'result');
    expect(final?.type === 'PERSIST' && (final.doc.scoreboard as { id:string; total:number }[]).map(p=>[p.id,p.total])).toEqual([['p1',275],['p2',275],['p3',275],['p4',275]]);
    expect(g.effects.filter(e=>e.type === 'PERSIST' && e.kind === 'guess')).toHaveLength(12);
    expect(g.effects.filter(e=>e.type === 'SEND_TEXT' && e.text.startsWith('🏆'))).toHaveLength(4);
    expect(g.state.players.every(p=>p.score === 0)).toBe(true);
  });
  it('plays two players', () => { const g=game(2); g.ready(); g.finish([[10],[5]]); const result=g.effects.find(e=>e.type === 'PERSIST' && e.kind === 'result'); expect(result?.type === 'PERSIST' && result.doc.items).toHaveLength(2); });
  it('uses two demo rounds for four players', () => { const g=game(4); g.text(1,'demo'); g.ready(); g.finish([[10,10,10],[10,10,10]]); expect(g.effects.filter(e=>e.type === 'PERSIST' && e.kind === 'round')).toHaveLength(2); expect(g.effects.some(e=>e.type==='SPEAK' && e.key==='rules.short')).toBe(true); expect(g.effects.some(e=>e.type==='START_TIMER' && e.ms===3000)).toBe(true); });
  it('scores everyone over and tied guesses', () => { const g=game(4,true); g.ready(); g.finish([[20,20,30],[10,10,10]]); const rounds=g.effects.filter(e=>e.type==='PERSIST' && e.kind==='round'); expect(rounds[0].type==='PERSIST' && rounds[0].doc.winnerReason).toBe('lowest_over'); expect(rounds[0].type==='PERSIST' && rounds[0].doc.winnerIds).toEqual(['p2','p3']); expect(g.effects.some(e=>e.type==='SPEAK' && e.key==='score.tie')).toBe(true); });
  it('records a silent guesser', () => { const g=game(2); g.ready(); g.finish([[null],[10]]); expect(g.effects.some(e=>e.type==='PERSIST' && e.kind==='guess' && e.doc.status==='silent')).toBe(true); });
  it('allows one confirmation correction and locks the second correction immediately', () => { const g=game(2); g.ready(); g.until('guess_listen'); g.speech('5'); g.next(); g.speech('6'); expect(g.state.pendingGuess?.corrections).toBe(1); g.next(); g.speech('7'); expect(g.state.guesses[0]).toMatchObject({ cents:700, corrected:true }); });
  it('opens listening at the prompt deadline and ignores late speech completion', () => {
    const g=game(2); g.ready(); g.until('guess_prompt');
    const prompts=g.effects.filter(e=>e.type==='SPEAK' && ['guess.quiet','guess.prompt'].includes(e.key));
    const deadline=g.effects.at(-1);
    expect(deadline).toMatchObject({type:'START_TIMER',ms:g.deps.config.guessPromptMaxMs});
    if (deadline?.type !== 'START_TIMER') throw new Error('Missing prompt deadline');
    g.send({type:'TIMER',timerId:deadline.timerId});
    expect(g.state.phase).toBe('guess_listen');
    const before=g.state;
    for (const prompt of prompts) if (prompt.type==='SPEAK') {
      g.send({type:'SPEAK_DONE',speakId:prompt.speakId});
      expect(g.state).toBe(before);
    }
    expect(g.state.timer?.ms).toBe(g.deps.config.guessSeconds*1000);
  });
  it('cancels the prompt deadline when speech finishes first', () => {
    const g=game(2); g.ready(); g.until('guess_prompt');
    const deadline=g.effects.at(-1);
    expect(deadline?.type).toBe('START_TIMER');
    if (deadline?.type !== 'START_TIMER') throw new Error('Missing prompt deadline');
    g.until('guess_listen');
    expect(g.effects).toContainEqual({type:'CANCEL_TIMER',timerId:deadline.timerId});
    const before=g.state; g.send({type:'TIMER',timerId:deadline.timerId}); expect(g.state).toBe(before);
  });
  it('ignores repeated amounts without consuming corrections or restarting confirmation', () => {
    const g=game(2); g.ready(); g.until('guess_listen'); g.speech('5');
    const pending=g.state.pendingGuess;
    const repeated=g.send({type:'SPEECH_FINAL',text:'5',confidence:1});
    expect(g.state.pendingGuess).toEqual(pending); expect(repeated.effects).toEqual([]);
    g.next(); const timer=g.state.timer; g.speech('5');
    expect(g.state.timer).toEqual(timer); expect(g.state.pendingGuess?.corrections).toBe(0);
    g.speech('6'); expect(g.state.guesses).toHaveLength(0);
    expect(g.state.pendingGuess).toMatchObject({cents:600,corrections:1});
    g.next(); g.speech('6'); expect(g.state.pendingGuess?.corrections).toBe(1);
    g.speech('7'); expect(g.state.guesses[0]).toMatchObject({cents:700,corrected:true});
  });
  it('relistens after no with remaining time and rejects late timers', () => { const g=game(2); g.ready(); g.until('guess_listen'); const old=g.state.timer!.timerId; g.speech('5'); g.next(); g.speech('no'); expect(g.state.phase).toBe('guess_listen'); expect(g.state.timer!.ms).toBeGreaterThanOrEqual(g.deps.config.minRelistenMs); const before=g.state; g.send({type:'TIMER',timerId:old}); expect(g.state).toEqual(before); });
  it('locks a text guess only for the current guesser', () => { const g=game(2); g.ready(); g.until('guess_listen'); g.text(2,'hello'); expect(g.state.guesses).toHaveLength(0); g.text(2,'$8'); expect(g.state.guesses[0]).toMatchObject({ cents:800,channel:'text' }); });
  it('uses the prop closet when pricing times out', () => { const g=game(2); g.text(1,'Item one'); g.ready(false); g.until('item_resolve'); g.next(); g.next(); expect(g.state.currentItem?.request.origin).toBe('prop_closet'); g.until('show_item'); });
  it('retries dialing once then returns to waiting', () => { const g=game(2); g.text(1,'start'); g.send({type:'CALL_FAILED',reason:'offline'}); expect(g.effects.filter(e=>e.type==='DIAL')).toHaveLength(2); g.send({type:'CALL_FAILED',reason:'offline'}); expect(g.state.phase).toBe('wait_call'); });
  it('sends scores on a dropped call after a scored round', () => { const g=game(2); g.ready(); g.until('guess_listen'); g.text(2,'10'); g.until('round_score'); g.send({type:'CALL_ENDED',reason:'dropped'}); expect(g.state.phase).toBe('wait_call'); expect(g.effects.filter(e=>e.type==='SEND_TEXT' && e.text.includes('call dropped'))).toHaveLength(2); });
  it('ignores stray and late events without throwing or changing state', () => { const g=game(2); for(const e of [{type:'TIMER',timerId:'old'},{type:'SPEAK_DONE',speakId:'old'},{type:'PRICE_FAILED',itemId:'r99'},{type:'SPEECH_FINAL',text:'5',confidence:1},{type:'TICK'}]) { const before=g.state; const result=g.send(e); expect(result.state).toBe(before); expect(result.effects[0].type).toBe('LOG'); } });
  it('dials the preserved roster on a rematch text after a game', () => { const g=game(2); g.ready(); g.finish([[10],[10]]); g.text(2,'rematch'); expect(g.state.phase).toBe('dialing'); expect(g.effects.filter(e=>e.type==='DIAL')).toHaveLength(2); });
});


describe('failure and lobby boundaries', () => {
  it('requires two players and a completed roster for rematch', () => {
    const g=game(1); g.text(1,'start'); expect(g.state.phase).toBe('wait_call');
    expect(g.effects.some(e=>e.type==='SEND_TEXT' && e.text.includes('at least 2'))).toBe(true);
    g.text(2,"I'm in, I'm Second"); g.text(2,'rematch'); expect(g.state.phase).toBe('wait_call');
  });
  it('falls back on pricing failure and rejects a late successful price', () => {
    const g=game(2); g.text(1,'Pending item'); g.ready(false); g.until('item_resolve');
    g.send({type:'PRICE_FAILED',itemId:'r1'});
    expect(g.state.currentItem?.request.origin).toBe('prop_closet');
    const before=g.state; g.send({type:'PRICE_READY',itemId:'r1',result:fakePriceResult('r1','Late',999)});
    expect(g.state).toEqual(before); g.until('show_item');
  });
  it('uses the prop closet when no item was submitted', () => {
    const g=game(2); g.ready(false); g.until('item_resolve'); g.next(); g.until('show_item');
    expect(g.state.currentItem?.request.origin).toBe('prop_closet');
  });
  it('nudges once and records a second pass as silent', () => {
    const g=game(2); g.ready(); g.until('guess_listen'); g.speech('pass'); g.next(); g.speech('pass');
    expect(g.state.guesses[0].status).toBe('silent');
    expect(g.effects.filter(e=>e.type==='SPEAK' && e.key==='guess.nudge')).toHaveLength(1);
  });
  it('lets a player start the lobby and dials again after a live rematch request', () => {
    const g=game(2); g.ready(); g.until('lobby'); g.text(2,"let's go"); expect(g.state.phase).toBe('rules');
    g.until('guess_listen'); g.text(2,'10'); g.until('guess_listen'); g.text(1,'10');
    g.until('rematch_offer'); g.next(); g.speech('again'); g.next();
    g.send({type:'CALL_ENDED',reason:'done'}); expect(g.state.phase).toBe('dialing');
    g.send({type:'CALL_READY',callId:'second'}); expect(g.state.gameId).toBe('game_2');
    expect(g.state.history).toEqual([]); expect(g.state.players.every(p=>p.score===0)).toBe(true);
  });
  it('gives up when the connected lobby never gets a second player', () => {
    const g=game(1); g.send({type:'CALL_READY',callId:'inbound'}); g.until('lobby');
    g.next(); g.next(); expect(g.state.phase).toBe('ending');
    expect(g.effects.some(e=>e.type==='SPEAK' && e.key==='lobby.giveup')).toBe(true);
  });
});
