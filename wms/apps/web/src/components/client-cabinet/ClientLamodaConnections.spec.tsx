import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClientLamodaConnections } from './ClientLamodaConnections';
import type { AuthSession } from '../../lib/api';
// TEST: client-card access must not grant Lamoda credential writes to a read-only or demo user.
it('offers a Lamoda connection in the client card for API administrators',()=>{
 const html=renderToStaticMarkup(<ClientLamodaConnections clientId="c" session={{accessToken:'test',user:{permissionCodes:['marketplace-api:write']}} as AuthSession}/>);
 expect(html).toContain('Подключить Lamoda');expect(html).toContain('Client Secret');expect(html).toMatch(/class="primary-button">/);
});
it('disables credential creation for read-only and demo users',()=>{
 for(const user of [{permissionCodes:['client-requests:read']},{permissionCodes:['system:admin'],isDemo:true}]){
  const html=renderToStaticMarkup(<ClientLamodaConnections clientId="c" session={{accessToken:'test',user} as AuthSession}/>);
  expect(html).toMatch(/disabled=""[^>]*>Подключить Lamoda/);
 }
});
