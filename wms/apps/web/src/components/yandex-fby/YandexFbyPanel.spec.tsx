import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { FboWorkspace } from '../client-requests/FboWorkspace';
import { isWbFboRequest } from '../client-requests/fboRequestScope';
import { previewFby, type AuthSession, type ClientRequestSummary } from '../../lib/api';
const session={accessToken:'secret',user:{permissionCodes:['system:admin'],roleCodes:['OWNER']}} as AuthSession;
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
// TEST: FBY is a real, opt-in marketplace tile and cannot enter WB listings.
it('renders four equal card components inside one grid when enabled',()=>{
 vi.stubEnv('VITE_YANDEX_FBY_ENABLED','true');vi.stubEnv('VITE_LAMODA_ENABLED','true');
 const html=renderToStaticMarkup(<FboWorkspace session={session}/>);
 expect(html.match(/class="fbs-marketplace-card__brand"/g)).toHaveLength(4);
 expect(html).toContain('Яндекс Маркет · FBY');expect(html).not.toContain('Раздел готовится');
});
it('does not show FBY on installations without the flag',()=>{vi.stubEnv('VITE_YANDEX_FBY_ENABLED','false');expect(renderToStaticMarkup(<FboWorkspace session={session}/>)).not.toContain('FBY')});
it('excludes persisted FBY identity from WB regardless of title',()=>{expect(isWbFboRequest({type:'OUTBOUND',title:'WB something',yandexFbyShipment:{requestId:'x'}} as ClientRequestSummary)).toBe(false)});
it('uses authenticated encoded preview endpoints',async()=>{
 const http=vi.fn(async()=>Response.json({}));vi.stubGlobal('fetch',http);
 await previewFby('secret','a/b',{warehouseId:'w',reference:'123'});
 expect(http.mock.calls[0]).toEqual(expect.arrayContaining([expect.stringContaining('/yandex-fby/accounts/a%2Fb/preview'),expect.objectContaining({method:'POST',headers:expect.objectContaining({Authorization:'Bearer secret'})})]));
});
