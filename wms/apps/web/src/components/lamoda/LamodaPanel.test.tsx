import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { LamodaPanel } from './LamodaPanel';
import { FboWorkspace } from '../client-requests/FboWorkspace';
import { createLamodaAccount, fetchLamodaOverview, syncLamoda, type AuthSession } from '../../lib/api';
const session: AuthSession = { accessToken: 'test-token', tokenType: 'Bearer', user: { id: 'user', name: 'Test', email: 'test@example.invalid', roleCodes: ['OWNER'], permissionCodes: ['system:admin'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] } };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
// TEST: the staged contour never advertises working stock publication or TSD assembly.
it('shows preparation limits and independent account credentials', () => {
  const html = renderToStaticMarkup(<LamodaPanel session={session} />);
  for (const label of ['Подключение', 'Товары', 'Планы FBO', 'Заказы FBS', 'Возвраты', 'Журнал обмена', 'Seller ID', 'OAuth Client ID', 'Client secret']) expect(html).toContain(label);
  expect(html).toContain('подтверждение отгрузок пока недоступны');
  expect(html).toContain('type="password"');
  expect(html).not.toContain('test-token');
});
it('keeps the Lamoda card absent without deployment opt-in', () => {
  vi.stubEnv('VITE_LAMODA_ENABLED', 'false');
  expect(renderToStaticMarkup(<FboWorkspace session={session} />)).not.toContain('Lamoda');
});
it('requires marketplace API read access even when deployment opted in', () => {
  vi.stubEnv('VITE_LAMODA_ENABLED', 'true');
  expect(renderToStaticMarkup(<FboWorkspace session={session} />)).toContain('Lamoda');
  expect(renderToStaticMarkup(<FboWorkspace session={{ ...session, user: { ...session.user, permissionCodes: ['client-requests:read'] } }} />)).not.toContain('Lamoda');
});
it('uses isolated encoded routes and authenticated API requests', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await fetchLamodaOverview('token', 'account/foreign');
  await syncLamoda('token', 'account', 'RETURNS');
  expect(fetcher.mock.calls[0][0]).toContain('/lamoda/accounts/account%2Fforeign');
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ kind: 'RETURNS' }), headers: expect.objectContaining({ Authorization: 'Bearer token' }) });
});
it('does not put OAuth secrets in query strings', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await createLamodaAccount('token', { clientId: 'c', name: 'Lamoda', sellerId: 's', oauthClientId: 'o', secret: 'password', fboEnabled: true, fbsEnabled: false });
  expect(fetcher.mock.calls[0][0]).not.toContain('password');
  expect(fetcher.mock.calls[0][1].method).toBe('POST');
});
