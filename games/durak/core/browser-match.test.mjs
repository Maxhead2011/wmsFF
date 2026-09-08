import {it,expect} from 'vitest';
import {BrowserMatch} from '../web/match.mjs';

// TEST: complete games cover dealing, refill, pickup, transfer and deck conservation.
for (const mode of ['simple','throw-in','transfer']) {
  it(`finishes 100 seeded ${mode} games without losing or duplicating cards`,()=>{
    for(let seed=1;seed<=100;seed++) {
      const game=new BrowserMatch(mode,seed);
      expect(game.hands.map(h=>h.length)).toEqual([6,6]);
      for(let turn=0;turn<5000 && game.step!=='over';turn++) {
        expect(game.autoMove()).toBe(true);
        expect(game.conservesDeck()).toBe(true);
        expect(game.table.length).toBeLessThanOrEqual(6);
      }
      expect(game.step).toBe('over');
    }
  });
}
it('rejects out-of-turn actions without changing inventory',()=>{
  const game=new BrowserMatch('throw-in',15);
  const before=JSON.stringify(game.hands);
  expect(game.play(1-game.toAct(),0)).toBe(false);
  expect(JSON.stringify(game.hands)).toBe(before);
});
it('uses the initial defender hand as the round limit',()=>{
  const game=new BrowserMatch('throw-in',15);
  expect(game.capacity).toBe(6);
  game.capacity=1;
  const attacker=game.attacker;
  expect(game.play(attacker,0)).toBe(true);
  expect(game.take(1-attacker)).toBe(true);
  expect(game.play(attacker,0)).toBe(false);
});
