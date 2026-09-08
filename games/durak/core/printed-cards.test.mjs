import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createDeck,parseCard} from './rules.mjs';
// TEST: every actual game card has a correctly named, inert print-ready face.
it('provides all 36 printed cards and no executable SVG content',()=>{
  for(const card of createDeck()){
    const c=parseCard(card),name=(c.rank==='10'?'T':c.rank)+c.suit[0].toUpperCase();
    const svg=readFileSync(new URL(`../web/cards/${name}.svg`,import.meta.url),'utf8');
    expect(svg).toContain('<svg');expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+=|(?:href|src)=["'](?:https?:|data:text)/i);
  }
});
