import { describe, expect, it } from 'vitest';
import { canBeat, attackLimit, canThrowIn, canTransfer, createDeck } from './rules.mjs';
import { buildCombatPlan, acceptDefense, playerView } from './combat.mjs';

// TEST: all inputs in this suite are synthetic. No WMS/database/network access.
describe('Durak rules', () => {
  it('creates 36 unique cards from six to ace', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(36); expect(new Set(deck).size).toBe(36);
    expect(deck).toContain('diamonds:10'); expect(deck).toContain('spades:A');
  });
  it.each([
    ['diamonds:10', 'diamonds:J', 'hearts', true],
    ['diamonds:J', 'diamonds:Q', 'hearts', true],
    ['diamonds:Q', 'diamonds:J', 'hearts', false],
    ['diamonds:10', 'clubs:J', 'hearts', false],
    ['diamonds:A', 'hearts:6', 'hearts', true],
    ['hearts:6', 'diamonds:A', 'hearts', false],
    ['hearts:A', 'hearts:K', 'hearts', false],
    ['hearts:K', 'hearts:A', 'hearts', true],
    ['diamonds:J', 'diamonds:J', 'hearts', false],
  ])('%s defended by %s with trump %s: %s', (attack, defense, trump, result) => {
    expect(canBeat(attack, defense, trump)).toBe(result);
  });
  it('rejects malformed cards and suits', () => {
    expect(() => canBeat('diamonds:20', 'clubs:A', 'hearts')).toThrow();
    expect(() => canBeat('diamonds:10', 'clubs:A', 'red')).toThrow();
  });
  it.each([[0,0],[1,1],[4,4],[6,6],[12,6]])('hand at turn start %s limits attack to %s', (hand, limit) => {
    expect(attackLimit(hand)).toBe(limit);
  });
  it('allows throwing matching ranks, including ranks of defending cards', () => {
    const table=[{attack:'diamonds:10',defense:'diamonds:J'}];
    expect(canThrowIn('clubs:J', table, 'throw-in', 6)).toBe(true);
    expect(canThrowIn('clubs:9', table, 'throw-in', 6)).toBe(false);
    expect(canThrowIn('clubs:J', table, 'simple', 6)).toBe(false);
    expect(canThrowIn('clubs:J', table, 'throw-in', 1)).toBe(false);
  });
  it('transfers only equal ranks before any defense and within next hand capacity', () => {
    const table=[{attack:'diamonds:10',defense:null}];
    expect(canTransfer('clubs:10',table,'transfer',2)).toBe(true);
    expect(canTransfer('clubs:10',table,'transfer',1)).toBe(false);
    expect(canTransfer('clubs:J',table,'transfer',6)).toBe(false);
    expect(canTransfer('clubs:10',table,'throw-in',6)).toBe(false);
    expect(canTransfer('clubs:10',[{...table[0],defense:'diamonds:J'}],'transfer',6)).toBe(false);
  });
});

describe('cinematic combat contracts', () => {
  const plan = (attack,defense,trump='hearts') => buildCombatPlan({eventId:'room7:42',revision:42,attack,defense,trump});
  it('Jack emerges and breaks exactly ten bricks for the diamond ten', () => {
    const result=plan('diamonds:10','diamonds:J');
    expect(result.kind).toBe('figure-vs-wall'); expect(result.brickCount).toBe(10);
    expect(result.winner.fighter).toBe('jack');
    expect(result.beats.some(b=>b.action==='emerge')).toBe(true);
    expect(result.beats.some(b=>b.action==='shatter-wall')).toBe(true);
  });
  it.each([['J','Q'],['J','K'],['J','A'],['Q','K'],['Q','A'],['K','A']])('%s versus %s is a full fight, not a one-hit effect', (low,high) => {
    const result=plan(`diamonds:${low}`,`diamonds:${high}`);
    expect(result.kind).toBe('duel');
    expect(result.beats.filter(b=>b.action==='strike').length).toBeGreaterThanOrEqual(2);
    expect(result.beats.some(b=>b.action==='parry')).toBe(true);
    expect(result.beats.some(b=>b.action==='counter')).toBe(true);
    expect(result.beats.some(b=>b.action==='finisher')).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(4000);
  });
  it('a trump Jack defeats an off-suit Ace through a duel with red aura', () => {
    const result=plan('diamonds:A','hearts:J');
    expect(result.kind).toBe('duel'); expect(result.winner.fighter).toBe('jack');
    expect(result.winner.aura).toBe('trump-red'); expect(result.loser.aura).toBeNull();
  });
  it.each(['J','Q','K','A'])('supports a %s mirror duel across suits', rank => {
    const result=plan(`diamonds:${rank}`,`hearts:${rank}`);
    expect(result.kind).toBe('duel'); expect(result.choreography).toContain('mirror');
    expect(result.winner.role).toBe('defender');
  });
  it('keeps red aura on both trump figures without changing the winner', () => {
    const result=plan('hearts:Q','hearts:K');
    expect(result.winner.aura).toBe('trump-red'); expect(result.loser.aura).toBe('trump-red');
  });
  it('does not create a winning movie for an illegal move', () => {
    expect(()=>plan('hearts:A','hearts:J')).toThrow('ILLEGAL_DEFENSE');
    expect(()=>plan('diamonds:10','clubs:J')).toThrow('ILLEGAL_DEFENSE');
  });
  it('is deterministic for all viewers and contains ordered contact timings', () => {
    const a=plan('diamonds:Q','diamonds:A'); expect(plan('diamonds:Q','diamonds:A')).toEqual(a);
    expect(a.beats.map(b=>b.atMs)).toEqual([...a.beats.map(b=>b.atMs)].sort((x,y)=>x-y));
    expect(a.beats.at(-1).atMs).toBe(a.durationMs);
  });
});

function fixture() {
  return {roomId:'room7',revision:41,mode:'throw-in',trump:'hearts',defenderId:'bob',
    players:[{id:'alice',hand:['clubs:6']},{id:'bob',hand:['diamonds:J','hearts:A']}],
    table:[{attack:'diamonds:10',defense:null}],deck:['spades:6'],discard:[],commands:[]};
}
const command={commandId:'scan1',expectedRevision:41,attackIndex:0,card:'diamonds:J'};
describe('authoritative defense transaction', () => {
  it('commits the move once and returns the matching public cinematic event', () => {
    const before=fixture(),snapshot=structuredClone(before);
    const result=acceptDefense(before,'bob',command);
    expect(before).toEqual(snapshot); expect(result.state.revision).toBe(42);
    expect(result.state.players[1].hand).toEqual(['hearts:A']);
    expect(result.state.table[0].defense).toBe('diamonds:J');
    expect(result.event.brickCount).toBe(10);
    const retry=acceptDefense(result.state,'bob',command);
    expect(retry.replayed).toBe(true); expect(retry.state).toEqual(result.state); expect(retry.event).toEqual(result.event);
  });
  it('rejects a conflicting reuse of command ID', () => {
    const first=acceptDefense(fixture(),'bob',command);
    expect(()=>acceptDefense(first.state,'bob',{...command,card:'hearts:A'})).toThrow('COMMAND_CONFLICT');
  });
  it.each([
    ['alice',command,'NOT_DEFENDER'],
    ['bob',{...command,expectedRevision:40},'STALE_REVISION'],
    ['bob',{...command,card:'diamonds:Q'},'CARD_NOT_IN_HAND'],
    ['bob',{...command,attackIndex:2},'UNKNOWN_ATTACK'],
  ])('rejects unauthorized or stale moves: %s', (player,cmd,reason) => {
    const state=fixture(),copy=structuredClone(state);
    expect(()=>acceptDefense(state,player,cmd)).toThrow(reason); expect(state).toEqual(copy);
  });
  it('does not beat one card twice', () => {
    const first=acceptDefense(fixture(),'bob',command);
    expect(()=>acceptDefense(first.state,'bob',{...command,commandId:'scan2',expectedRevision:42,card:'hearts:A'})).toThrow('ALREADY_DEFENDED');
  });
  it('hides opponents hands, the deck order and internal replay cache', () => {
    const state=acceptDefense(fixture(),'bob',command).state;
    const view=playerView(state,'alice');
    expect(view.players[0].hand).toEqual(['clubs:6']); expect(view.players[1].hand).toBeUndefined();
    expect(view.players[1].cardCount).toBe(1); expect(view.deckCount).toBe(1);
    expect(view.deck).toBeUndefined(); expect(view.commands).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('hearts:A'); expect(JSON.stringify(view)).not.toContain('spades:6');
    expect(()=>playerView(state,'unknown')).toThrow('NOT_IN_ROOM');
  });
});
