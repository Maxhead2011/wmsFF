import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type AuthWarehouseScopeInput = {
  roleCodes: string[];
  permissionCodes: string[];
  isDemo: boolean;
  activeWarehouseId: string | null;
  clientScopes: Array<{
    clientId: string;
    canRead: boolean;
    canWrite: boolean;
    client: { isDemo: boolean; relabelingEnabled: boolean };
  }>;
  warehouseScopes: Array<{
    warehouseId: string;
    canRead: boolean;
    canWrite: boolean;
    warehouse: { isActive: boolean };
  }>;
};

export type ResolvedAuthWarehouseScope = {
  activeWarehouseId: string | null;
  clientScopeMode: 'ALL' | 'LIMITED';
  clientIds: string[];
  writableClientIds: string[];
  relabelingEnabled: boolean;
};

@Injectable()
export class WarehouseAuthScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: AuthWarehouseScopeInput): Promise<ResolvedAuthWarehouseScope> {
    const visibleClientScopes = input.clientScopes.filter(
      (scope) => scope.client.isDemo === input.isDemo,
    );
    const explicitScope = {
      clientIds: visibleClientScopes.filter((scope) => scope.canRead).map((scope) => scope.clientId),
      writableClientIds: visibleClientScopes.filter((scope) => scope.canWrite).map((scope) => scope.clientId),
      relabelingEnabled: visibleClientScopes.some(
        (scope) => scope.canRead && scope.client.relabelingEnabled,
      ),
    };

    const isSystemAdmin = input.permissionCodes.includes('system:admin');
    const isClient = input.roleCodes.includes('CLIENT');
    if (isClient && input.roleCodes.some((code) => code !== 'CLIENT')) {
      throw new ForbiddenException(
        'Роль клиента нельзя совмещать с внутренними ролями сотрудников.',
      );
    }
    if (!isSystemAdmin && input.roleCodes.includes('BRANCH_MANAGER')) {
      if (
        input.warehouseScopes.length !== 1 ||
        !input.warehouseScopes[0].canRead ||
        !input.warehouseScopes[0].canWrite
      ) {
        throw new ForbiddenException(
          'Менеджер филиала должен быть закреплён ровно за одним доступным для работы филиалом.',
        );
      }
    }

    if (isSystemAdmin || isClient) {
      return {
        activeWarehouseId: input.activeWarehouseId,
        clientScopeMode:
          input.isDemo || isClient || visibleClientScopes.length > 0 ? 'LIMITED' : 'ALL',
        ...explicitScope,
      };
    }

    if (input.warehouseScopes.length === 0) {
      return {
        activeWarehouseId: null,
        clientScopeMode: visibleClientScopes.length > 0 ? 'LIMITED' : 'ALL',
        ...explicitScope,
      };
    }

    const readableWarehouseIds = input.warehouseScopes
      .filter((scope) => scope.canRead && scope.warehouse.isActive)
      .map((scope) => scope.warehouseId);
    let activeWarehouseId = readableWarehouseIds.includes(input.activeWarehouseId ?? '')
      ? input.activeWarehouseId
      : null;

    if (!activeWarehouseId && readableWarehouseIds.length > 0) {
      const [fallback] = await this.prisma.warehouse.findMany({
        where: { id: { in: readableWarehouseIds }, isActive: true },
        select: { id: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        take: 1,
      });
      activeWarehouseId = fallback?.id ?? null;
    }

    if (!activeWarehouseId) {
      return {
        activeWarehouseId: null,
        clientScopeMode: 'LIMITED',
        clientIds: [],
        writableClientIds: [],
        relabelingEnabled: false,
      };
    }

    const branchClients = await this.prisma.warehouseClient.findMany({
      where: {
        warehouseId: activeWarehouseId,
        status: 'ACTIVE',
        client: { isDemo: input.isDemo },
      },
      select: {
        clientId: true,
        client: { select: { relabelingEnabled: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const clientIds = branchClients.map((link) => link.clientId);
    const canWriteActiveWarehouse = input.warehouseScopes.some(
      (scope) => scope.warehouseId === activeWarehouseId && scope.canWrite,
    );

    return {
      activeWarehouseId,
      clientScopeMode: 'LIMITED',
      clientIds,
      writableClientIds: canWriteActiveWarehouse ? clientIds : [],
      relabelingEnabled: branchClients.some((link) => link.client.relabelingEnabled),
    };
  }
}
