import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());

// TEST: selected branch must override global list visibility, not access rights.
describe('FBS selected branch filter', () => {
  function setup() {
    const connections = [
      { id: 'wb', marketplace: 'WILDBERRIES', fbsExecutionWarehouseId: 'msk', fbsAutoRouteNewWarehouses: false },
      { id: 'ozon', marketplace: 'OZON', fbsExecutionWarehouseId: 'ng', fbsAutoRouteNewWarehouses: false },
    ];
    const rules = [
      { connectionId: 'wb', marketplaceWarehouseId: 'one', mode: 'BRANCH', executionWarehouseId: 'msk' },
      { connectionId: 'wb', marketplaceWarehouseId: 'two', mode: 'BRANCH', executionWarehouseId: 'ng' },
      { connectionId: 'wb', marketplaceWarehouseId: 'excluded', mode: 'EXCLUDED' },
      { connectionId: 'wb', marketplaceWarehouseId: 'central', mode: 'CENTRAL' },
    ];
    const prisma = {
      clientMarketplaceConnection: { findMany: vi.fn().mockResolvedValue(connections) },
      fbsWarehouseRoutingRule: { findMany: vi.fn().mockImplementation(async ({ where }) => where.mode ? rules.filter(r => r.mode === where.mode) : rules) },
    };
    const orders = ['one', 'two', 'excluded', 'central', 'unknown'].map((id) => ({
      id, connectionId: 'wb', marketplace: 'WILDBERRIES', warehouseId: id,
      category: 'active', request: { warehouseId: id === 'one' ? 'ng' : 'msk' },
    }));
    orders.push({ id: 'ozon', connectionId: 'ozon', marketplace: 'OZON', warehouseId: 'one', category: 'active', request: { warehouseId: 'msk' } });
    const response = { connected: true, connections, orders, counts: { active: 6, shipped: 0, cancelled: 0, archive: 0, all: 6 } };
    const service = new MarketplaceConnectionsService(prisma as never, {} as never);
    const user = { roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: 'msk' };
    return { service, response, user, prisma };
  }

  it('filters admin orders by current routes despite conflicting historical requests and recounts totals', async () => {
    vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
    const { service, response, user } = setup();
    const result = await (service as any).scopeFbsOrdersForUser(response, user);
    expect(result.orders.map((o: any) => o.id)).toEqual(['one', 'central']);
    expect(result.counts).toEqual({ active: 2, shipped: 0, cancelled: 0, archive: 0, all: 2 });
    expect(response.orders).toHaveLength(6);
    const next = await (service as any).scopeFbsOrdersForUser(response, { ...user, activeWarehouseId: 'ng' });
    expect(next.orders.map((o: any) => o.id)).toEqual(['two', 'ozon']);
  });

  it('preserves legacy global behavior while the deployment flag is off', async () => {
    vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'false');
    const { service, response, user } = setup();
    const result = await (service as any).scopeFbsOrdersForUser(response, user);
    expect(result.orders.map((o: any) => o.id)).toEqual(['one', 'two', 'central', 'unknown', 'ozon']);
  });

  it('uses an explicit display branch without changing the working branch', async () => {
    vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
    const { service, response, user } = setup();
    const result = await (service as any).scopeFbsOrdersForUser(response, user, false, 'ng');
    expect(result.orders.map((o: any) => o.id)).toEqual(['two', 'ozon']);
    expect(user.activeWarehouseId).toBe('msk');
    await expect((service as any).scopeFbsOrdersForUser(response, { ...user, roleCodes: ['MANAGER'], permissionCodes: [], warehouseIds: ['msk'] }, false, 'ng')).rejects.toThrow();
  });

  it('shows all non-excluded orders for an administrator in show-all mode', async () => {
    vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
    const { service, response, user } = setup();
    const result = await (service as any).scopeFbsOrdersForUser(response, user, true);
    expect(result.orders.map((o: any) => o.id)).toEqual(['one', 'two', 'central', 'unknown', 'ozon']);
  });

  it('limits show-all to the permitted branches for a restricted user', async () => {
    vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
    const { service, response } = setup();
    const result = await (service as any).scopeFbsOrdersForUser(response, {
      roleCodes: ['MANAGER'], permissionCodes: [], activeWarehouseId: 'ng', warehouseIds: ['msk'],
    }, true);
    expect(result.orders.map((o: any) => o.id)).toEqual(['one', 'central']);
  });

  it('does not let a restricted user select a branch outside their scope', async () => {
    vi.stubEnv('WMS_FBS_SELECTED_BRANCH_FILTER', 'true');
    const { service, response } = setup();
    const result = await (service as any).scopeFbsOrdersForUser(response, {
      roleCodes: ['MANAGER'], permissionCodes: [], activeWarehouseId: 'msk', warehouseIds: ['ng'],
    });
    expect(result.orders).toEqual([]);
  });
});
