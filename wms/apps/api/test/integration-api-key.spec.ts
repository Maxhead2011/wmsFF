import { describe, expect, it, vi } from 'vitest';
import { IntegrationAccessService } from '../src/modules/integration-api/integration-access.service';
import {
  generateWmsApiKey,
  hashWmsApiKey,
  integrationIdempotencyKey,
  parseWmsApiKey,
  safeApiKeyHashEquals,
} from '../src/modules/integration-api/integration-api-key';

describe('WMS integration API keys', () => {
  it('generates a parseable key and verifies it with a constant-time hash comparison', () => {
    // TEST: a valid generated key is accepted, while a modified secret is rejected.
    const generated = generateWmsApiKey();

    expect(parseWmsApiKey(generated.rawKey)?.keyPrefix).toBe(generated.keyPrefix);
    expect(generated.keyHash).toBe(hashWmsApiKey(generated.rawKey));
    expect(safeApiKeyHashEquals(generated.keyHash, generated.rawKey)).toBe(true);
    expect(safeApiKeyHashEquals(generated.keyHash, `${generated.rawKey}x`)).toBe(false);
  });

  it('persists only the hash and returns the raw key once', async () => {
    // TEST: regression guard against accidentally storing the raw secret in PostgreSQL.
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'credential-id',
      name: data.name,
      clientId: data.clientId,
      warehouseId: data.warehouseId,
      keyPrefix: data.keyPrefix,
      createdAt: new Date(),
    }));
    const prisma = {
      warehouseClient: {
        findUnique: vi.fn(async () => ({ status: 'ACTIVE', warehouse: { isActive: true } })),
      },
      wmsApiCredential: { create },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const clientScopes = { requireClientAccess: vi.fn() };
    const service = new IntegrationAccessService(prisma as never, clientScopes as never);

    const result = await service.create(
      {
        name: '1C test',
        clientId: '11111111-1111-4111-8111-111111111111',
        warehouseId: '22222222-2222-4222-8222-222222222222',
        scopes: ['stock:read'],
      },
      {
        id: 'user-id',
        email: 'owner@example.test',
        name: 'Owner',
        roleCodes: ['OWNER'],
        permissionCodes: ['system:admin'],
        clientScopeMode: 'ALL',
        clientIds: [],
        writableClientIds: [],
      },
    );

    const persisted = create.mock.calls[0][0].data;
    expect(result.apiKey).toMatch(/^wms_live_/);
    expect(persisted.keyHash).toBe(hashWmsApiKey(result.apiKey));
    expect(JSON.stringify(persisted)).not.toContain(result.apiKey);
    expect(persisted).not.toHaveProperty('rawKey');
    expect(result.shownOnce).toBe(true);
    expect(clientScopes.requireClientAccess).toHaveBeenCalledWith(
      expect.anything(),
      '11111111-1111-4111-8111-111111111111',
      'read',
    );
  });

  it('namespaces idempotency keys per credential', () => {
    // TEST: equal operation ids from two client systems must not collide in the global ledger.
    expect(integrationIdempotencyKey('aaaaaaaaaaaa', 'operation-1')).not.toBe(
      integrationIdempotencyKey('bbbbbbbbbbbb', 'operation-1'),
    );
  });
});
