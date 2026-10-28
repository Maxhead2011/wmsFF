import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {FboActiveCount} from './FboWorkspace';

describe('FBO active card badge',()=>{
  // TEST: loading/errors must never claim zero active requests.
  it('distinguishes loading, failed, zero and positive totals',()=>{
    expect(renderToStaticMarkup(<FboActiveCount />)).toContain('Загрузка…');
    const error=renderToStaticMarkup(<FboActiveCount error />);
    expect(error).toContain('Не удалось загрузить');
    expect(error).not.toContain('0 заявок');
    for(const [count,label] of [[0,'0 заявок'],[1,'1 заявка'],[2,'2 заявки'],[11,'11 заявок'],[21,'21 заявка'],[205,'205 заявок']] as const)
      expect(renderToStaticMarkup(<FboActiveCount count={count} />)).toContain(label);
  });
});
