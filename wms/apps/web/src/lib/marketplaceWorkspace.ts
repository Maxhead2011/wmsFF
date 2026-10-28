import { fetchClients, type ClientSummary, type AuthSession } from './api';

export const workspaceEnabled = () => import.meta.env.VITE_MARKETPLACE_WORKSPACES_ENABLED === 'true';
// FIX: only our enabled workspace loads the Panthera operational surface overrides.
if (workspaceEnabled()) void import('../components/layout/marketplace-surfaces.css');
// FIX: use persisted connections, not live API availability. Disabled accounts remain accessible.
export function connected(client: ClientSummary, market: string, mode: 'fbo' | 'fbs' = 'fbo') {
  if (market === 'LAMODA') return !!client.lamodaAccounts?.some(a => mode === 'fbo' ? a.fboEnabled : a.fbsEnabled);
  return !!client.marketplaceConnections?.some(a => a.marketplace === market);
}
export function workspaceClients(clients: ClientSummary[], market: string, mode: 'fbo' | 'fbs' = 'fbo') {
  return workspaceEnabled() ? clients.filter(c => connected(c, market, mode)) : clients;
}
export function visibleMarket(session: AuthSession, clients: ClientSummary[], market: string, mode: 'fbo' | 'fbs' = 'fbo') {
  const customer = session.user.roleCodes.includes('CLIENT') && !session.user.permissionCodes.includes('system:admin');
  return !workspaceEnabled() || !customer || clients.some(c => connected(c, market, mode));
}
export async function fetchWorkspaceClients(token: string, market?: string, mode: 'fbo' | 'fbs' = 'fbo') {
  const clients = await fetchClients(token, { marketplaceDirectory: workspaceEnabled() });
  return market ? workspaceClients(clients, market, mode) : clients;
}
