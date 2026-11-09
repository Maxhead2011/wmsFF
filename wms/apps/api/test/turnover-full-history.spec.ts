import { describe, expect, it, vi } from 'vitest';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

const user = { id: 'admin', roleCodes: ['ADMIN'], permissionCodes: ['system:admin'],
  clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] };

function fixture() {
  const move = (type: string, quantity: number, id: number) => ({
    id: `${id}`, type, quantity, status: 'AVAILABLE', createdAt: new Date('2026-11-06'),
    box: null, productMarks: [], sourceDocument: null, comment: null,
  });
  const history = [move('RECEIPT', 325, 0), move('INVENTORY_ADJUSTMENT', 27, 1),
    move('INVENTORY_ADJUSTMENT', -27, 2), move('SHIP', -164, 3),
    ...Array.from({ length: 246 }, (_, i) => move('MOVE', i % 2 ? 1 : -1, i + 4)),
    move('SHIP', -110, 250), move('RETURN', 3, 251), move('INITIAL_IMPORT', 2, 252),
    move('INVENTORY_ADJUSTMENT', -4, 253)];
  const groupBy = vi.fn(async ({ where, by }: any) => {
    const groups = new Map<string, any>();
    for (const row of history.filter(row => where.type.in.includes(row.type)
      && (where.quantity.gt !== undefined ? row.quantity > where.quantity.gt : row.quantity < where.quantity.lt))) {
      const key = by.includes('type') ? row.type : 'all';
      const group = groups.get(key) ?? { skuId: 'sku-1', type: row.type, _sum: { quantity: 0 } };
      group._sum.quantity += row.quantity;
      groups.set(key, group);
    }
    return [...groups.values()];
  });
  const findMany = vi.fn(async (_args: any) => [{ id: 'sku-1', name: 'Winter raglan',
    client: { id: 'client-1' }, barcodes: [], productMarks: [],
    balances: [{ quantity: 52, boxId: null, box: null, pallet: null }],
    movements: history.slice(0, 250) }]);
  const prisma = { sku: { findMany }, stockMovement: { groupBy },
    client: { findMany: vi.fn(async () => []) } };
  const scopes = { resolveClientFilter: vi.fn(() => 'client-1') };
  return { service: new TurnoverService(prisma as never, scopes as never), findMany, groupBy };
}

describe('Turnover full-history counters', () => {
  // TEST: all counter types include movements beyond the 250-row detail preview.
  it('counts the complete movement history in SKU rows and totals', async () => {
    const { service } = fixture();
    const result = await service.list({ clientId: 'client-1' } as never, user as never);
    expect(result.totals).toEqual({ skuCount: 1, currentQuantity: 52,
      receivedQuantity: 357, shippedQuantity: 274, writtenOffQuantity: 31 });
    expect(result.items[0]).toMatchObject({ receivedQuantity: 357, shippedQuantity: 274, writtenOffQuantity: 31 });
    expect(result.items[0].movements).toHaveLength(250);
  });

  // TEST: complete-history totals retain the detail query's date and client visibility restrictions.
  it('retains the selected period and client visibility filters', async () => {
    const { service, findMany, groupBy } = fixture();
    await service.list({ clientId: 'client-1', dateFrom: '2026-11-01', dateTo: '2026-11-08' } as never,
      { ...user, roleCodes: ['CLIENT'], permissionCodes: [] } as never);
    const detailWhere = findMany.mock.calls[0][0].include.movements.where;
    expect(groupBy).toHaveBeenCalledTimes(2);
    for (const [args] of groupBy.mock.calls) {
      expect(args.where).toMatchObject({ skuId: { in: ['sku-1'] }, AND: detailWhere.AND });
      expect(args).not.toHaveProperty('take');
    }
  });

  // TEST: another warehouse must not contribute to the selected warehouse totals.
  it('retains the selected warehouse in both aggregate queries', async () => {
    const { service, findMany, groupBy } = fixture();
    await service.list({ clientId: 'client-1' } as never,
      { ...user, activeWarehouseId: 'warehouse-1' } as never);
    const detailWhere = findMany.mock.calls[0][0].include.movements.where;
    expect(detailWhere.AND).toContainEqual(expect.objectContaining({
      OR: expect.arrayContaining([{ warehouseId: 'warehouse-1' }]),
    }));
    expect(groupBy).toHaveBeenCalledTimes(2);
    for (const [args] of groupBy.mock.calls) {
      expect(args.where.AND).toEqual(detailWhere.AND);
    }
  });

  // TEST: no visible SKU must never trigger an unrestricted movement aggregation.
  it('returns zero totals without querying movements for an empty SKU selection', async () => {
    const { service, findMany, groupBy } = fixture();
    findMany.mockResolvedValueOnce([]);
    const result = await service.list({} as never, user as never);
    expect(result.totals).toEqual({ skuCount: 0, currentQuantity: 0,
      receivedQuantity: 0, shippedQuantity: 0, writtenOffQuantity: 0 });
    expect(groupBy).not.toHaveBeenCalled();
  });
});
