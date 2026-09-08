import {BrowserMatch} from './match.mjs';
import {parseCard} from '../core/rules.mjs';
const $=id=>document.getElementById(id);
const symbols={clubs:'♣',diamonds:'♦',hearts:'♥',spades:'♠'};
const suitNames={clubs:'трефы',diamonds:'бубны',hearts:'червы',spades:'пики'};
const names={'throw-in':'Подкидной',transfer:'Переводной',simple:'Простой'};
let game=null,target=-1,transfer=false,timer=null;
function card(value,button=false){
  const c=parseCard(value),el=document.createElement(button?'button':'div');
  el.className='card'+(['diamonds','hearts'].includes(c.suit)?' red':'');
  el.setAttribute('aria-label',`${c.rank}, ${suitNames[c.suit]}`);
  // FIX: actual print-ready court art and correct pip layouts, not oversized text substitutes.
  const image=document.createElement('img');image.alt='';image.draggable=false;
  image.src=`./web/cards/${c.rank==='10'?'T':c.rank}${c.suit[0].toUpperCase()}.svg`;
  el.append(image);return el;
}
function message(){
  if(game.error) return game.error;
  if(game.step==='over') return game.winner===0?'Вы выиграли. Сыграем ещё?':game.winner===1?'В этот раз победил соперник. Реванш?':'Ничья. Карты закончились у обоих.';
  if(game.toAct()===1) return game.step==='pickup'?'Вы берёте. Соперник завершает подкидывание…':'Соперник выбирает ход…';
  if(transfer) return 'Выберите карту того же номинала для перевода.';
  return {attack:'Ваш ход. Положите карту на стол.',defend:'Отбейте выделенную карту или возьмите.', 'throw-in':'Подкиньте совпадающий номинал или нажмите «Бито».',pickup:'Соперник берёт. Можно подкинуть или завершить ход.'}[game.step];
}
function render(){
  $('mode-title').textContent=names[game.mode];$('round').textContent=`КРУГ ${game.round} · НЕ БОЛЬШЕ ${game.capacity} КАРТ`;
  $('opponent-label').textContent=`СОПЕРНИК · ${game.hands[1].length} КАРТ`;
  $('opponent-hand').replaceChildren(...Array.from({length:Math.min(12,game.hands[1].length)},()=>{const e=document.createElement('i');e.className='back';return e;}));
  $('trump').replaceChildren(card(game.trumpCard));$('deck-count').textContent=`${game.deck.length} в колоде`;$('discard-count').textContent=game.discard.length;
  if(!game.table[target] || game.table[target].defense) target=game.openTarget();
  const human=game.toAct()===0;
  $('pairs').replaceChildren(...game.table.map((p,i)=>{
    const pair=document.createElement('div');pair.className='pair played';
    const a=card(p.attack,true);a.disabled=!human||!!p.defense||game.step!=='defend';
    if(!p.defense && i===target) a.classList.add('selected');
    a.onclick=()=>{target=i;render();};pair.append(a);
    if(p.defense){const d=document.createElement('div');d.className='defense';d.append(card(p.defense));pair.append(d);}return pair;
  }));
  $('empty-table').hidden=game.table.length>0;$('empty-table').textContent=game.step==='over'?'Партия завершена':'Ваш карточный стол';
  $('hand').replaceChildren(...game.hands[0].map((c,i)=>{const e=card(c,true);const legal=game.canPlay(0,i,target,transfer);e.disabled=!legal;if(legal)e.classList.add('playable');e.onclick=()=>act(()=>game.play(0,i,target,transfer));return e;}));
  $('hand-label').textContent=`У вас ${game.hands[0].length} карт`;
  $('take').disabled=!human||game.step!=='defend';$('pass').disabled=!human||!['throw-in','pickup'].includes(game.step);
  $('pass').textContent=game.step==='pickup'?'Завершить ход':'Бито';
  $('transfer').hidden=game.mode!=='transfer';$('transfer').disabled=!human||game.step!=='defend';$('transfer').setAttribute('aria-pressed',String(transfer));
  $('message').textContent=message();
}
function schedule(){
  clearTimeout(timer);
  if(game?.toAct()===1) timer=setTimeout(()=>{
    if($('restart-dialog').open){schedule();return;}
    game.autoMove();transfer=false;render();schedule();
  },800);
}
function act(action){if(action()) transfer=false;render();schedule();}
$('start').onclick=()=>{
  clearTimeout(timer);game=new BrowserMatch(document.querySelector('[name=mode]:checked').value);target=-1;transfer=false;
  $('lobby').hidden=true;$('game').hidden=false;render();schedule();$('game').scrollIntoView({block:'start'});
};
$('take').onclick=()=>act(()=>game.take(0));$('pass').onclick=()=>act(()=>game.pass(0));
$('transfer').onclick=()=>{transfer=!transfer;render();};
$('new-game').onclick=()=>{if(game.step==='over') showLobby();else $('restart-dialog').showModal();};
function showLobby(){clearTimeout(timer);game=null;$('game').hidden=true;$('lobby').hidden=false;$('start').focus();}
$('restart-dialog').onclose=()=>{if($('restart-dialog').returnValue==='restart')showLobby();else schedule();};
// FIX: only advertise an actual published archive; no fake or broken download CTA.
fetch('./release.json',{cache:'no-store',credentials:'omit'}).then(r=>r.ok?r.json():null).then(release=>{
  if(!release?.windows?.url) {$('download-status').textContent='Windows-сборка готовится к публикации. Браузерная игра уже доступна.';return;}
  const url=new URL(release.windows.url,location.href);
  if(url.origin!==location.origin || !url.pathname.startsWith('/durak/downloads/')) throw new Error('INVALID_DOWNLOAD');
  $('download').href=url.href;$('download').hidden=false;
  $('download-status').textContent=`Windows 10/11 · ${release.windows.sizeLabel} · распакуйте архив и запустите DurakArena.exe`;
}).catch(()=>{$('download-status').textContent='Ссылка на Windows-сборку временно недоступна. Попробуйте обновить страницу.';});
