import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

const permissions = [
  ['system:admin', 'Полный административный доступ'],
  ['users:read', 'Просмотр пользователей и ролей'],
  ['users:write', 'Создание и изменение пользователей'],
  ['clients:read', 'Просмотр клиентов'],
  ['clients:write', 'Создание и изменение клиентов'],
  // ADDED: issuing external WMS keys is isolated from system administration.
  ['integration-api:manage', 'Управление внешними API-доступами WMS'],
  // FIX: отдельное право не открывает клиенту редактирование реквизитов и чужих кабинетов.
  ['marketplace-api:write', 'Управление API маркетплейсов закреплённых клиентов'],
  ['skus:read', 'Просмотр SKU'],
  ['skus:write', 'Создание и изменение SKU'],
  ['warehouse:read', 'Просмотр складской структуры'],
  ['warehouse:write', 'Изменение коробов, паллет и зон'],
  ['stock:read', 'Просмотр остатков'],
  ['stock:write', 'Складские операции и ledger'],
  ['client-requests:read', 'Просмотр клиентских заявок'],
  ['client-requests:write', 'Создание клиентских заявок'],
  ['client-requests:status', 'Изменение статусов клиентских заявок'],
  ['client-notifications:read', 'Просмотр уведомлений клиента'],
  ['client-notifications:write', 'Создание уведомлений клиента'],
  ['imports:write', 'Загрузка XLSX-импортов'],
  ['logistics:read', 'Просмотр тарифов и расчет логистики'],
  ['logistics:request', 'Создание заявок на доставку'],
  ['logistics:write', 'Загрузка и изменение тарифов логистики'],
  ['billing:read', 'Просмотр услуг и начислений биллинга'],
  ['billing:write', 'Создание услуг и начислений биллинга'],
  ['expenses:read', 'Просмотр расходов, материалов и задолженности клиентов'],
  ['expenses:write', 'Управление расходами, материалами и правилами списания'],
  ['print:write', 'Печать этикеток'],
  ['factory-shipments:read', 'Просмотр отправок с фабрики'],
  ['factory-shipments:write', 'Управление отправками с фабрики'],
  ['factory-shipments:scan', 'Сканирование товаров на фабрике'],
  // ADDED: отдельные права позволяют открыть клиенту КИЗ без system:admin.
  ['kiz-circulation:read', 'Просмотр погашения КИЗ'],
  ['kiz-circulation:write', 'Управление погашением КИЗ'],
  ['own-companies:read', 'Просмотр собственных компаний'],
  ['own-companies:write', 'Создание и изменение собственных компаний'],
] as const;

const rolePermissions: Record<string, { name: string; permissions: string[] }> = {
  OWNER: {
    name: 'Владелец системы',
    permissions: ['system:admin'],
  },
  ADMIN: {
    name: 'Администратор',
    permissions: ['system:admin'],
  },
  MANAGER: {
    name: 'Менеджер фулфилмента',
    permissions: [
      'users:read',
      'clients:read',
      'clients:write',
      'skus:read',
      'skus:write',
      'warehouse:read',
      'warehouse:write',
      'stock:read',
      'stock:write',
      'client-requests:read',
      'client-requests:write',
      'client-requests:status',
      'client-notifications:read',
      'client-notifications:write',
      'imports:write',
      'logistics:read',
      'logistics:request',
      'logistics:write',
      'billing:read',
      'billing:write',
      'expenses:read',
      'expenses:write',
      'print:write',
      'own-companies:read',
      'own-companies:write',
    ],
  },
  BRANCH_MANAGER: {
    name: 'Менеджер филиала',
    permissions: [
      'clients:read',
      'clients:write',
      'skus:read',
      'skus:write',
      'warehouse:read',
      'warehouse:write',
      'stock:read',
      'stock:write',
      'client-requests:read',
      'client-requests:write',
      'client-requests:status',
      'client-notifications:read',
      'client-notifications:write',
      'imports:write',
      'logistics:read',
      'logistics:request',
      'print:write',
      'own-companies:read',
      'own-companies:write',
    ],
  },
  OPERATOR: {
    name: 'Оператор склада',
    permissions: [
      'clients:read',
      'skus:read',
      'warehouse:read',
      'warehouse:write',
      'stock:read',
      'stock:write',
      'client-requests:read',
      'client-requests:status',
      'client-notifications:read',
      'client-notifications:write',
      'imports:write',
      'logistics:read',
      'billing:read',
      'print:write',
    ],
  },
  WAREHOUSE_KEEPER: {
    name: 'Кладовщик',
    permissions: [
      'clients:read',
      'skus:read',
      'warehouse:read',
      'warehouse:write',
      'stock:read',
      'stock:write',
    ],
  },
  FACTORY_OPERATOR: {
    name: 'Сотрудник фабрики',
    permissions: [
      'clients:read',
      'skus:read',
      'factory-shipments:read',
      'factory-shipments:scan',
    ],
  },
  CLIENT: {
    name: 'Клиент',
    permissions: [
      'clients:read',
      'skus:read',
      'stock:read',
      'client-requests:read',
      'client-requests:write',
      'client-notifications:read',
      'logistics:read',
      'logistics:request',
      'billing:read',
      // ADDED: клиент управляет только данными закреплённого за ним клиента.
      'factory-shipments:read',
      'factory-shipments:write',
      'kiz-circulation:read',
      'kiz-circulation:write',
    ],
  },
  CLIENT_API_MANAGER: {
    name: 'Управление API клиента',
    permissions: ['marketplace-api:write'],
  },
  WMS_API_MANAGER: {
    name: 'Управление внешним API WMS',
    permissions: ['integration-api:manage'],
  },
};

@Injectable()
export class AccessModelService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Русский комментарий: при деплое новых модулей права должны появляться без ручного вызова справочника ролей.
    await this.seedDefaultAccessModel();
  }

  async seedDefaultAccessModel() {
    for (const [code, name] of permissions) {
      await this.prisma.permission.upsert({
        where: { code },
        update: { name },
        create: { code, name },
      });
    }

    for (const [code, role] of Object.entries(rolePermissions)) {
      const savedRole = await this.prisma.role.upsert({
        where: { code },
        update: { name: role.name },
        create: { code, name: role.name },
      });

      const savedPermissions = await this.prisma.permission.findMany({
        where: { code: { in: role.permissions } },
      });

      // Русский комментарий: createMany с skipDuplicates делает bootstrap повторяемым и безопасным для деплоя.
      await this.prisma.rolePermission.createMany({
        data: savedPermissions.map((permission) => ({
          roleId: savedRole.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  async listRoles() {
    await this.seedDefaultAccessModel();

    return this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });
  }

  async resolveRoles(roleCodes: string[]) {
    await this.seedDefaultAccessModel();

    const normalized = [...new Set(roleCodes.map((code) => code.trim().toUpperCase()))];
    const roles = await this.prisma.role.findMany({
      where: { code: { in: normalized } },
    });

    if (roles.length !== normalized.length) {
      throw new BadRequestException('Одна или несколько ролей не найдены.');
    }

    return roles;
  }
}
