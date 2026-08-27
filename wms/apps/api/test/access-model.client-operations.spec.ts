import { describe, expect, it, vi } from 'vitest';
import { AccessModelService } from '../src/modules/auth/access-model.service';

describe('CLIENT operational permissions', () => {
  // ADDED: повторный bootstrap не должен снова скрыть КИЗ и фабрику от клиентов.
  it('назначает роли CLIENT права погашения КИЗ и фабрики', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      permission: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockImplementation(({ where }) =>
          where.code.in.map((code: string) => ({ id: code, code })),
        ),
      },
      role: {
        upsert: vi.fn().mockImplementation(({ where }) => ({ id: where.code, code: where.code })),
      },
      rolePermission: { createMany },
    };

    await new AccessModelService(prisma as never).seedDefaultAccessModel();

    const clientCall = createMany.mock.calls.find(([argument]) =>
      argument.data.some((row: { roleId: string }) => row.roleId === 'CLIENT'),
    );
    const permissionIds = clientCall?.[0].data.map(
      (row: { permissionId: string }) => row.permissionId,
    );
    expect(permissionIds).toEqual(expect.arrayContaining([
      'factory-shipments:read',
      'factory-shipments:write',
      'kiz-circulation:read',
      'kiz-circulation:write',
    ]));
  });
});
