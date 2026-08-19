import { describe, expect, it, vi } from 'vitest';
import { AccessModelService } from '../src/modules/auth/access-model.service';

describe('WMS API access model', () => {
  it('seeds a dedicated role with only integration-api:manage', async () => {
    // TEST: credential managers must not inherit system administration or stock rights.
    const roleUpsert = vi.fn().mockImplementation(({ where }: { where: { code: string } }) =>
      Promise.resolve({ id: `role-${where.code}`, code: where.code }),
    );
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      permission: {
        upsert: vi.fn().mockImplementation(({ where }: { where: { code: string } }) =>
          Promise.resolve({ id: `permission-${where.code}`, code: where.code }),
        ),
        findMany: vi.fn().mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
          Promise.resolve(where.code.in.map((code) => ({ id: `permission-${code}`, code }))),
        ),
      },
      role: { upsert: roleUpsert },
      rolePermission: { createMany },
    };

    await new AccessModelService(prisma as never).seedDefaultAccessModel();

    expect(roleUpsert).toHaveBeenCalledWith({
      where: { code: 'WMS_API_MANAGER' },
      update: { name: 'Управление внешним API WMS' },
      create: { code: 'WMS_API_MANAGER', name: 'Управление внешним API WMS' },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role-WMS_API_MANAGER', permissionId: 'permission-integration-api:manage' }],
      skipDuplicates: true,
    });
  });
});
