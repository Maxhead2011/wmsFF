import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PalletSortingController } from '../src/modules/inventory/pallet-sorting.controller';
import { PalletSortingService } from '../src/modules/inventory/pallet-sorting.service';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';

afterEach(() => vi.unstubAllEnvs());
describe('ADMIN-only sorting access', () => {
  it('allows an ADMIN without stock:write through the endpoint permission gate', () => {
    // TEST: ADMIN must not need a second independent permission for this menu.
    const context = {
      getClass: () => PalletSortingController,
      getHandler: () => PalletSortingController.prototype.action,
      switchToHttp: () => ({ getRequest: () => ({ user: { roleCodes: ['ADMIN'], permissionCodes: [] } }) }),
    };
    expect(new PermissionsGuard(new Reflector()).canActivate(context as any)).toBe(true);
  });
  it.each(['OWNER', 'MANAGER', 'OPERATOR', 'CLIENT'])('denies %s before any database mutation', async role => {
    // TEST: removing stock:write must never grant non-ADMIN access, even with system:admin.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'true');
    const service = Object.create(PalletSortingService.prototype) as PalletSortingService;
    await expect(service.action('session', {} as any, {
      roleCodes: [role], permissionCodes: ['stock:write', 'system:admin'], activeWarehouseId: 'wh',
    } as any)).rejects.toThrow();
  });
  it('keeps this mutation path disabled in installations without its feature flag', async () => {
    // TEST: sold WMS remains opted out even when the caller is ADMIN.
    vi.stubEnv('WMS_PALLET_SORTING_ENABLED', 'false');
    const service = Object.create(PalletSortingService.prototype) as PalletSortingService;
    await expect(service.action('session', {} as any, { roleCodes: ['ADMIN'], activeWarehouseId: 'wh' } as any)).rejects.toThrow();
  });
});
