import { describe, expect, it } from 'vitest';
import { WarehouseAuthScopeService } from '../src/modules/auth/warehouse-auth-scope.service';

describe('WMS API client role compatibility', () => {
  it('allows CLIENT together with WMS_API_MANAGER without internal warehouse rights', async () => {
    // TEST: the narrow API role must not block a normal client login.
    const service = new WarehouseAuthScopeService({} as never);

    await expect(
      service.resolve({
        roleCodes: ['CLIENT', 'WMS_API_MANAGER'],
        permissionCodes: ['clients:read', 'integration-api:manage'],
        isDemo: false,
        activeWarehouseId: null,
        clientScopes: [
          {
            clientId: 'client-1',
            canRead: true,
            canWrite: false,
            client: { isDemo: false, relabelingEnabled: false },
          },
        ],
        warehouseScopes: [],
      }),
    ).resolves.toMatchObject({
      clientScopeMode: 'LIMITED',
      clientIds: ['client-1'],
      writableClientIds: [],
    });
  });
});
