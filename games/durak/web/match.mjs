import {createDeck,parseCard,canBeat,canThrowIn,canTransfer,attackLimit} from '../core/rules.mjs';

// FIX: browser play is local and independent of WMS, its session, APIs and inventory.
export class BrowserMatch {
  constructor(mode='throw-in',seed=Date.now()) {
    if(!['simple','throw-in','transfer'].includes(mode)) throw new Error('INVALID_MODE');
    this.mode=mode; this.deck=createDeck(); this.hands=[[],[]]; this.table=[]; this.discard=[];
    this.step='attack'; this.round=1; this.winner=null; this.error=''; this.lastDefense=null;
    let state=seed>>>0;
    const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0; return state/4294967296;};
    for(let i=35;i>0;i--) { const j=Math.floor(random()*(i+1)); [this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]]; }
    this.trumpCard=this.deck[0]; this.trump=parseCard(this.trumpCard).suit;
    for(let i=0;i<6;i++) for(let p=0;p<2;p++) this.hands[p].push(this.deck.pop());
    this.attacker=0; let lowest=15;
    for(let p=0;p<2;p++) for(const card of this.hands[p]) { const c=parseCard(card); if(c.suit===this.trump && c.value<lowest) {lowest=c.value;this.attacker=p;} }
    this.capacity=6; this.sort();
  }
  sort(){for(const hand of this.hands) hand.sort((a,b)=>this.cost(a)-this.cost(b));}
  cost(card){const c=parseCard(card); return c.value+(c.suit===this.trump?20:0);}
  toAct(){return this.step==='over'?-1:this.step==='defend'?1-this.attacker:this.attacker;}
  fail(message){this.error=message;return false;}
  openTarget(){return this.table.findIndex(p=>!p.defense);}
  canPlay(player,index,target=this.openTarget(),transfer=false){
    if(player!==this.toAct() || !Number.isInteger(index) || !this.hands[player]?.[index]) return false;
    const card=this.hands[player][index];
    if(transfer) return this.step==='defend' && canTransfer(card,this.table,this.mode,this.hands[this.attacker].length);
    if(this.step==='defend') return Boolean(this.table[target] && !this.table[target].defense && canBeat(this.table[target].attack,card,this.trump));
    if(this.table.length>=this.capacity) return false;
    return this.table.length===0 || canThrowIn(card,this.table,this.mode,this.capacity);
  }
  play(player,index,target=this.openTarget(),transfer=false){
    if(!this.canPlay(player,index,target,transfer)) return this.fail('Эта карта сейчас не подходит. Выберите подсвеченную карту.');
    const [card]=this.hands[player].splice(index,1); this.lastDefense=null; this.error='';
    if(transfer){
      this.table.push({attack:card}); this.capacity=attackLimit(this.hands[this.attacker].length); this.attacker=player;
    } else if(this.step==='defend'){
      this.table[target].defense=card; this.lastDefense={...this.table[target]};
      if(this.openTarget()<0) this.step='throw-in';
    } else {
      this.table.push({attack:card}); if(this.step!=='pickup') this.step='defend';
    }
    return true;
  }
  take(player){
    if(this.step!=='defend' || player!==this.toAct()) return this.fail('Сейчас нельзя взять карты.');
    this.step='pickup';this.lastDefense=null;this.error='';return true;
  }
  pass(player){
    if(player!==this.attacker || !['pickup','throw-in'].includes(this.step)) return this.fail('Сначала завершите отбой.');
    const defender=1-this.attacker, taken=this.step==='pickup';
    const destination=taken?this.hands[defender]:this.discard;
    for(const pair of this.table) {destination.push(pair.attack);if(pair.defense) destination.push(pair.defense);}
    this.table=[];this.lastDefense=null;this.error='';
    for(const p of [this.attacker,defender]) while(this.hands[p].length<6 && this.deck.length) this.hands[p].push(this.deck.pop());
    this.sort();this.round++;
    if(!this.deck.length && this.hands.some(h=>!h.length)) {
      this.step='over';this.winner=!this.hands[0].length?(!this.hands[1].length?-1:0):1;
    } else {if(!taken) this.attacker=defender;this.step='attack';}
    this.capacity=attackLimit(this.hands[1-this.attacker].length);
    return true;
  }
  autoMove(){
    const player=this.toAct(); if(player<0) return false;
    const legal=this.hands[player].map((card,index)=>({index,cost:this.cost(card)})).filter(x=>this.canPlay(player,x.index)).sort((a,b)=>a.cost-b.cost);
    if(legal.length) return this.play(player,legal[0].index);
    if(this.step==='defend') {
      if(this.mode==='transfer') for(let i=0;i<this.hands[player].length;i++) if(this.canPlay(player,i,this.openTarget(),true)) return this.play(player,i,this.openTarget(),true);
      return this.take(player);
    }
    return this.pass(player);
  }
  conservesDeck(){
    const cards=[...this.deck,...this.hands.flat(),...this.discard,...this.table.flatMap(p=>p.defense?[p.attack,p.defense]:[p.attack])];
    return cards.length===36 && new Set(cards).size===36 && cards.every(c=>createDeck().includes(c));
  }
}
