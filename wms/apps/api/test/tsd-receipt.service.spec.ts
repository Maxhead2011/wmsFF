import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { TsdReceiptService } from '../src/modules/tsd/tsd-receipt.service';

describe('TsdReceiptService checkKiz', () => {
  const user: AuthUser = {
    id: 'user-1',
    email: 'operator@example.com',
    name: 'Operator',
    roleCodes: ['OPERATOR'],
    permissionCodes: ['stock:write'],
    clientScopeMode: 'ALL',
    clientIds: [],
    writableClientIds: [],
    deviceId: 'device-1',
  };

  it('сообщает короб, в котором уже находится КИЗ', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      value: 'KIZ-EXISTING-VALUE-00001',
      box: { code: 'FFL_BOX_001' },
      sku: { name: 'Костюм' },
    });
    const requireClientAccess = vi.fn();
    const service = new TsdReceiptService(
      { productMark: { findFirst } } as never,
      { requireClientAccess } as never,
      { touchActiveDevice: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(service.checkKiz('client-1', 'KIZ-EXISTING-VALUE-00001', user)).resolves.toMatchObject({
      duplicate: true,
      boxCode: 'FFL_BOX_001',
      skuName: 'Костюм',
      message: 'ДУБЛЬ КИЗ. Этот КИЗ уже находится в коробе FFL_BOX_001.',
    });
    expect(requireClientAccess).toHaveBeenCalledWith(user, 'client-1', 'write');
  });

  it('разрешает неизвестный КИЗ', async () => {
    const service = new TsdReceiptService(
      { productMark: { findFirst: vi.fn().mockResolvedValue(null) } } as never,
      { requireClientAccess: vi.fn() } as never,
      { touchActiveDevice: vi.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(service.checkKiz('client-1', 'KIZ-NEW-VALUE-00000000001', user)).resolves.toMatchObject({
      duplicate: false,
      boxCode: null,
      message: 'КИЗ свободен.',
    });
  });
});
