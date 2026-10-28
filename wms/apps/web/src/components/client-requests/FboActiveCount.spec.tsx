import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {FboActiveCount,FboWorkspace} from './FboWorkspace';

describe('FBO active card badge',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  // TEST: the visible Lamoda tile must have its own count badge.
  it('renders a counter on the Lamoda tile',()=>{
    vi.stubEnv('VITE_MARKETPLACE_WORKSPACES_ENABLED','true');
    vi.stubEnv('VITE_LAMODA_ENABLED','true');
    const session={accessToken:'test',user:{roleCodes:[],permissionCodes:['system:admin'],clientIds:[]}} as never;
    const html=renderToStaticMarkup(<FboWorkspace session={session}/>);
    const tile=html.split('fbs-marketplace-card--lamoda')[1].split('</button>')[0];
    expect(tile).toContain('fbs-marketplace-card__active-count');
  });
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
