import {canBeat,parseCard} from './rules.mjs';
const fighters=Object.freeze({J:'jack',Q:'queen',K:'king',A:'ace'});
export function buildCombatPlan({eventId,revision,attack,defense,trump}) {
  if (!canBeat(attack,defense,trump)) throw new Error('ILLEGAL_DEFENSE');
  if (typeof eventId!=='string' || !eventId || !Number.isSafeInteger(revision) || revision<0) throw new Error('INVALID_EVENT');
  const actor=(card,role)=>({card,role,fighter:fighters[parseCard(card).rank]??null,aura:parseCard(card).suit===trump?'trump-red':null});
  const winner=actor(defense,'defender'),loser=actor(attack,'attacker');
  const duel=winner.fighter && loser.fighter;
  const wall=winner.fighter && !loser.fighter;
  const kind=duel?'duel':wall?'figure-vs-wall':'card-clash';
  const durationMs=duel?6200:wall?4200:2000;
  const timing=duel?[[0,'land'],[400,'emerge'],[1400,'strike'],[1700,'parry'],[2500,'strike'],[3000,'counter'],[4300,'finisher'],[6200,'settle']]
    :wall?[[0,'land'],[400,'emerge'],[2000,'strike'],[2800,'shatter-wall'],[4200,'settle']]
    :[[0,'land'],[1000,'impact'],[2000,'settle']];
  return {eventId,revision,kind,winner,loser,durationMs,brickCount:wall?parseCard(attack).value:0,
    choreography:duel?(winner.fighter===loser.fighter?`mirror-${winner.fighter}`:`${loser.fighter}-vs-${winner.fighter}`):kind,
    beats:timing.map(([atMs,action])=>({atMs,action}))};
}
// FIX: actorId must come from authenticated transport, never from a client's move payload.
// This pure reducer needs serialized, persistent room commits before public broadcast.
export function acceptDefense(state,actorId,command) {
  const {commandId,expectedRevision,attackIndex,card}=command;
  if (typeof commandId!=='string'||!commandId||commandId.length>128||!Number.isSafeInteger(expectedRevision)||!Number.isSafeInteger(attackIndex)||attackIndex<0) throw new Error('INVALID_COMMAND');
  parseCard(card);
  const signature=JSON.stringify([expectedRevision,attackIndex,card]);
  const cached=state.commands.find(c=>c.actorId===actorId&&c.commandId===commandId);
  if (cached) {
    if (cached.signature!==signature) throw new Error('COMMAND_CONFLICT');
    return {state:structuredClone(state),event:structuredClone(cached.event),replayed:true};
  }
  if (state.defenderId!==actorId) throw new Error('NOT_DEFENDER');
  if (expectedRevision!==state.revision) throw new Error('STALE_REVISION');
  const pair=state.table[attackIndex];
  if (!pair) throw new Error('UNKNOWN_ATTACK');
  if (pair.defense) throw new Error('ALREADY_DEFENDED');
  const player=state.players.find(p=>p.id===actorId);
  if (!player?.hand.includes(card)) throw new Error('CARD_NOT_IN_HAND');
  const revision=state.revision+1;
  const event=buildCombatPlan({eventId:`${state.roomId}:${revision}`,revision,attack:pair.attack,defense:card,trump:state.trump});
  const next=structuredClone(state);
  next.revision=revision;
  const hand=next.players.find(p=>p.id===actorId).hand;
  hand.splice(hand.indexOf(card),1);
  next.table[attackIndex].defense=card;
  next.commands.push({actorId,commandId,signature,event:structuredClone(event)});
  next.commands=next.commands.slice(-128);
  return {state:next,event,replayed:false};
}
export function playerView(state,actorId) {
  if (!state.players.some(p=>p.id===actorId)) throw new Error('NOT_IN_ROOM');
  return {roomId:state.roomId,revision:state.revision,mode:state.mode,trump:state.trump,defenderId:state.defenderId,
    players:state.players.map(p=>({id:p.id,cardCount:p.hand.length,...(p.id===actorId?{hand:[...p.hand]}:{})})),
    table:structuredClone(state.table),deckCount:state.deck.length,discardCount:state.discard.length};
}
