import { describe, expect, it, vi } from 'vitest';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

const user = { roleCodes: ['CLIENT'], permissionCodes: [], activeWarehouseId: null, clientIds: ['lukin'] } as never;

describe('Turnover barcode search client scope', () => {
  it('keeps the selected client when searching the report by barcode', async () => {
    const resolveClientFilter = vi.fn((_user, clientId?: string) => clientId);
    const service = new TurnoverService({ sku: { findMany: vi.fn(async () => []) } } as never, { resolveClientFilter } as never);

    await service.list({ clientId: 'lukin', barcode: '765' } as never, user);

    expect(resolveClientFilter).toHaveBeenCalledWith(user, 'lukin');
  });

  it('keeps the selected client in barcode suggestions', async () => {
    const resolveClientFilter = vi.fn((_user, clientId?: string) => clientId);
    const empty = { findMany: vi.fn(async () => []) };
    const service = new TurnoverService({ sku: empty, barcode: empty, productMark: empty, box: empty } as never, { resolveClientFilter } as never);

    await service.suggestions({ clientId: 'lukin', search: '765', scope: 'barcode' } as never, user);

    expect(resolveClientFilter).toHaveBeenCalledWith(user, 'lukin');
  });

  it('keeps the selected client in barcode statistics', async () => {
    // TEST: the statistics request is separate from the report and must use the same client.
    const admin = { roleCodes: ['ADMIN'], permissionCodes: ['system:admin'], activeWarehouseId: null } as never;
    const resolveClientFilter = vi.fn((_user, clientId?: string) => clientId);
    const service = new TurnoverService({ sku: { findMany: vi.fn(async () => []) } } as never, { resolveClientFilter } as never);

    await service.statistics({ clientId: 'lukin', barcode: '765' } as never, admin);

    expect(resolveClientFilter).toHaveBeenCalledWith(admin, 'lukin');
  });
});
