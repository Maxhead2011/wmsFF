import { describe, expect, it, vi } from 'vitest';
import { canManageMarketplaceStockControl } from './AdministrationMarketplaceStockControl';
import { updateMarketplaceStockControl, type AuthSession } from '../../lib/api';

describe('Marketplace stock control administration', () => {
  // TEST: clients and demos must never see the administration switch.
  it('restricts the tab to real staff administrators', () => {
    const session = { user: { permissionCodes: ['system:admin'], roleCodes: ['ADMIN'] } } as AuthSession;
    expect(canManageMarketplaceStockControl(session)).toBe(true);
    expect(canManageMarketplaceStockControl({ ...session, user: { ...session.user, roleCodes: ['CLIENT'] } })).toBe(false);
    expect(canManageMarketplaceStockControl({ ...session, user: { ...session.user, isDemo: true } })).toBe(false);
    expect(canManageMarketplaceStockControl({ ...session, user: { ...session.user, permissionCodes: ['administration:demo'] } })).toBe(false);
  });

  // TEST: the API receives both the requested state and the version of the state shown to the admin.
  it('sends boolean state and expected previous state', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'client-1', enabled: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    try {
      await updateMarketplaceStockControl('test-token', { id: 'client-1', code: 'CL-1', name: 'Клиент', enabled: true, updatedAt: null, updatedBy: null }, false);
      expect(fetch.mock.calls[0][0]).toContain('/administration/marketplace-stock-control/client-1');
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ enabled: false, expectedEnabled: true });
    } finally { vi.unstubAllGlobals(); }
  });
});
