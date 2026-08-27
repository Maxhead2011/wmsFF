import { describe, expect, it, vi } from 'vitest';
import { IntegrationApiGuard } from '../src/modules/integration-api/integration-api.guard';
import { hashWmsApiKey } from '../src/modules/integration-api/integration-api-key';

const rawKey = `wms_live_a1b2c3d4e5f6_${'A'.repeat(43)}`;

describe('IntegrationApiGuard', () => {
  it('accepts a valid key only while the client-to-warehouse link remains active', async () => {
    // TEST: revoking the branch link immediately disables the external credential.
    const request = { headers: { 'x-wms-api-key': rawKey }, ip: '127.0.0.1' } as Record<string, unknown>;
    const prisma = prismaMock('ACTIVE');
    const guard = new IntegrationApiGuard(prisma as never);

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.integration).toMatchObject({
      scopes: ['stock:read'],
      credential: { clientId: 'client-1', warehouseId: 'warehouse-1' },
    });
  });

  it('rejects a key after the client-to-warehouse link is disabled', async () => {
    const request = { headers: { 'x-wms-api-key': rawKey }, ip: '127.0.0.1' };
    const guard = new IntegrationApiGuard(prismaMock('DISABLED') as never);

    await expect(guard.canActivate(context(request))).rejects.toMatchObject({ status: 401 });
  });
});

function prismaMock(linkStatus: string) {
  return {
    wmsApiCredential: {
      findUnique: vi.fn(async () => ({
        id: 'credential-1',
        name: '1C',
        clientId: 'client-1',
        warehouseId: 'warehouse-1',
        keyPrefix: 'a1b2c3d4e5f6',
        keyHash: hashWmsApiKey(rawKey),
        scopes: ['stock:read'],
        allowedIps: [],
        expiresAt: null,
        revokedAt: null,
        createdByUserId: null,
        lastUsedAt: null,
        lastUsedIp: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        client: { status: 'ACTIVE' },
        warehouse: { isActive: true },
      })),
      update: vi.fn(async () => ({})),
    },
    warehouseClient: {
      findUnique: vi.fn(async () => ({ status: linkStatus })),
    },
  };
}

function context(request: object) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}
