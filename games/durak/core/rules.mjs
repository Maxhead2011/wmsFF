export const SUITS = Object.freeze(['clubs', 'diamonds', 'hearts', 'spades']);
export const RANKS = Object.freeze(['6','7','8','9','10','J','Q','K','A']);
export function parseCard(value) {
  if (typeof value !== 'string') throw new Error('INVALID_CARD');
  const [suit,rank,...rest] = value.split(':');
  if (rest.length || !SUITS.includes(suit) || !RANKS.includes(rank)) throw new Error('INVALID_CARD');
  return {suit,rank,value:RANKS.indexOf(rank)+6};
}
export function createDeck() { return SUITS.flatMap(s=>RANKS.map(r=>`${s}:${r}`)); }
// FIX: visuals never decide the legal winner.
export function canBeat(attack, defense, trump) {
  if (!SUITS.includes(trump)) throw new Error('INVALID_TRUMP');
  const a=parseCard(attack), d=parseCard(defense);
  return a.suit===d.suit ? d.value>a.value : d.suit===trump && a.suit!==trump;
}
export function attackLimit(handAtStart) {
  if (!Number.isSafeInteger(handAtStart) || handAtStart<0) throw new Error('INVALID_HAND_SIZE');
  return Math.min(6,handAtStart);
}
function tableCards(table, mode) {
  if (!['simple','throw-in','transfer'].includes(mode) || !Array.isArray(table)) throw new Error('INVALID_TABLE');
  const cards=table.flatMap(p=>p.defense ? [p.attack,p.defense] : [p.attack]);
  cards.forEach(parseCard); return cards;
}
export function canThrowIn(card,table,mode,handAtStart) {
  const rank=parseCard(card).rank, cards=tableCards(table,mode), limit=attackLimit(handAtStart);
  return mode!=='simple' && table.length>0 && table.length<limit && !cards.includes(card) && cards.some(c=>parseCard(c).rank===rank);
}
export function canTransfer(card,table,mode,nextHandSize) {
  const rank=parseCard(card).rank,cards=tableCards(table,mode),limit=attackLimit(nextHandSize);
  return mode==='transfer' && table.length>0 && table.length+1<=limit && !cards.includes(card) && table.every(p=>!p.defense && parseCard(p.attack).rank===rank);
}
