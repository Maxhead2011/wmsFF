import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { AccessModelService } from '../auth/access-model.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { SetTsdActivationCodeDto } from './dto/set-tsd-activation-code.dto';
import { UpdateUserClientScopesDto } from './dto/update-user-client-scopes.dto';
import { UpdateUserPrinterScopesDto } from './dto/update-user-printer-scopes.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { normalizePrinterGroupCode } from '../auth/printer-scope.service';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessModel: AccessModelService,
    private readonly passwords: PasswordService,
  ) {}

  async list(currentUser: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: {
        isDemo: Boolean(currentUser.isDemo),
        ...(currentUser.permissionCodes.includes('system:admin') || !(currentUser.warehouseIds?.length)
          ? {}
          : {
              OR: [
                { id: currentUser.id },
                {
                  warehouseScopes: {
                    some: { warehouseId: { in: currentUser.warehouseIds } },
                  },
                },
              ],
            }),
      },
      orderBy: { createdAt: 'desc' },
      select: this.userSummarySelect(),
    });
    return users.map((user) => this.toUserSummary(user));
  }

  async create(dto: CreateUserDto, currentUser: AuthUser) {
    const roles = await this.accessModel.resolveRoles(dto.roleCodes?.length ? dto.roleCodes : ['OPERATOR']);
    this.assertCompatibleRoleCodes(roles.map((role) => role.code));
    await this.ensureDemoSafeRoles(roles.map((role) => role.id), currentUser);
    const clientScopes = this.buildCreateClientScopes(dto.clientIds, dto.writableClientIds);
    await this.ensureClientsExist(clientScopes.map((scope) => scope.clientId), currentUser);
    const warehouseId = await this.resolveCreationWarehouse(
      dto.warehouseId,
      roles.map((role) => role.code),
      currentUser,
    );

    // Русский комментарий: API никогда не возвращает passwordHash; пароль сохраняется только как scrypt hash.
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        name: dto.name.trim(),
        passwordHash: await this.passwords.hash(dto.password),
        isDemo: Boolean(currentUser.isDemo),
        activeWarehouseId: warehouseId,
        roles: {
          create: roles.map((role) => ({ roleId: role.id })),
        },
        warehouseScopes: warehouseId
          ? {
              create: {
                warehouseId,
                canRead: true,
                canWrite: true,
              },
            }
          : undefined,
        clientScopes: clientScopes.length
          ? {
              create: clientScopes,
            }
          : undefined,
      },
      select: this.userSummarySelect(),
    });
    return this.toUserSummary(user);
  }

  private async resolveCreationWarehouse(
    requestedWarehouseId: string | undefined,
    roleCodes: string[],
    currentUser: AuthUser,
  ) {
    if (roleCodes.some((code) => ['ADMIN', 'OWNER', 'CLIENT'].includes(code))) {
      return null;
    }
    const warehouseId = requestedWarehouseId?.trim() || currentUser.activeWarehouseId || '';
    if (!warehouseId) {
      throw new BadRequestException('Для сотрудника укажите филиал.');
    }
    const isNetworkAdmin = currentUser.permissionCodes.includes('system:admin');
    if (
      !isNetworkAdmin &&
      (currentUser.activeWarehouseId !== warehouseId ||
        !(currentUser.writableWarehouseIds ?? []).includes(warehouseId))
    ) {
      throw new BadRequestException('Сотрудника можно создать только в своём филиале.');
    }
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException('Выбранный филиал не найден или отключён.');
    }
    return warehouse.id;
  }

  async updateClientScopes(userId: string, dto: UpdateUserClientScopesDto, currentUser: AuthUser) {
    await this.ensureUserInSameMode(userId, currentUser);
    const scopes = [...new Map(dto.scopes.map((scope) => [scope.clientId, scope])).values()].map((scope) => ({
      clientId: scope.clientId,
      canWrite: scope.canWrite ?? false,
      canRead: (scope.canRead ?? true) || (scope.canWrite ?? false),
    }));

    await this.ensureClientsExist(scopes.map((scope) => scope.clientId), currentUser);

    await this.prisma.$transaction(async (tx) => {
      await tx.userClient.deleteMany({ where: { userId } });

      if (scopes.length > 0) {
        await tx.userClient.createMany({
          data: scopes.map((scope) => ({
            userId,
            ...scope,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.findUserSummary(userId);
  }

  async updatePrinterScopes(userId: string, dto: UpdateUserPrinterScopesDto, currentUser: AuthUser) {
    await this.ensureUserInSameMode(userId, currentUser);
    const scopes = [...new Map(dto.scopes.map((scope) => [normalizePrinterGroupCode(scope.groupCode), scope])).values()].map(
      (scope) => ({
        groupCode: normalizePrinterGroupCode(scope.groupCode),
        canManage: scope.canManage ?? false,
        canPrint: (scope.canPrint ?? true) || (scope.canManage ?? false),
      }),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true },
      });
      await tx.userPrinterGroup.deleteMany({ where: { userId } });

      if (scopes.length > 0) {
        await tx.userPrinterGroup.createMany({
          data: scopes.map((scope) => ({
            userId,
            ...scope,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.findUserSummary(userId);
  }

  async updateProfile(userId: string, dto: UpdateUserProfileDto, currentUser: AuthUser) {
    await this.ensureUserInSameMode(userId, currentUser);
    if (dto.status && dto.status !== UserStatus.ACTIVE) {
      await this.ensureSystemAdminStatusSurvives(userId);
    }

    const warehouseId = dto.warehouseId === undefined
      ? undefined
      : await this.resolveUpdatedWarehouse(userId, dto.warehouseId, currentUser);
    const passwordHash = dto.password === undefined
      ? undefined
      : await this.passwords.hash(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(dto.email === undefined ? {} : { email: dto.email.trim().toLowerCase() }),
            ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
            ...(passwordHash === undefined ? {} : { passwordHash }),
            ...(dto.status === undefined ? {} : { status: dto.status }),
            ...(dto.analyticsEnabled === undefined ? {} : { analyticsEnabled: dto.analyticsEnabled }),
            ...(warehouseId === undefined ? {} : { activeWarehouseId: warehouseId }),
          },
        });

        if (warehouseId !== undefined) {
          await tx.userWarehouse.deleteMany({ where: { userId } });
          if (warehouseId) {
            await tx.userWarehouse.create({
              data: {
                userId,
                warehouseId,
                canRead: true,
                canWrite: true,
              },
            });
          }
        }

        return tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: this.userSummarySelect(),
        });
      });
      return this.toUserSummary(user);
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Пользователь не найден.');
      }
      if (isUniqueUserEmailError(caught)) {
        throw new BadRequestException('Пользователь с таким логином или email уже существует.');
      }
      throw caught;
    }
  }

  private async resolveUpdatedWarehouse(
    userId: string,
    requestedWarehouseId: string | null,
    currentUser: AuthUser,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        roles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!target) throw new NotFoundException('Пользователь не найден.');

    const warehouseId = requestedWarehouseId?.trim() || '';
    const roleCodes = target.roles.map((item) => item.role.code);
    const mayWorkAcrossBranches = roleCodes.some((code) => ['ADMIN', 'OWNER', 'CLIENT'].includes(code));
    if (!warehouseId) {
      if (!mayWorkAcrossBranches) {
        throw new BadRequestException('Для сотрудника нужно выбрать филиал.');
      }
      return null;
    }

    const isNetworkAdmin = currentUser.permissionCodes.includes('system:admin');
    if (
      !isNetworkAdmin &&
      (currentUser.activeWarehouseId !== warehouseId ||
        !(currentUser.writableWarehouseIds ?? []).includes(warehouseId))
    ) {
      throw new BadRequestException('Сотрудника можно закрепить только за своим филиалом.');
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { id: true },
    });
    if (!warehouse) {
      throw new BadRequestException('Выбранный филиал не найден или отключён.');
    }
    return warehouse.id;
  }

  async updateRoles(userId: string, dto: UpdateUserRolesDto, currentUser?: AuthUser) {
    if (currentUser) {
      await this.ensureUserInSameMode(userId, currentUser);
    }
    const roleCodes = this.normalizeRoleCodes(dto.roleCodes);
    if (roleCodes.length === 0) {
      throw new BadRequestException('Нужно выбрать хотя бы одну роль пользователя.');
    }

    const roles = await this.accessModel.resolveRoles(roleCodes);
    this.assertCompatibleRoleCodes(roles.map((role) => role.code));
    if (currentUser) {
      await this.ensureDemoSafeRoles(roles.map((role) => role.id), currentUser);
    }
    await this.ensureSystemAdminSurvives(userId, roles.map((role) => role.id));

    await this.prisma.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true },
      });
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: roles.map((role) => ({
          userId,
          roleId: role.id,
        })),
        skipDuplicates: true,
      });
    });

    return this.findUserSummary(userId);
  }

  async setTsdActivationCode(userId: string, dto: SetTsdActivationCodeDto) {
    if (!/^\d{4}$/.test(dto.code)) {
      throw new BadRequestException('Код подтверждения должен состоять ровно из 4 цифр.');
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          tsdActivationCodeHash: await this.passwords.hash(dto.code),
        },
        select: this.userSummarySelect(),
      });
      return this.toUserSummary(user);
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Пользователь не найден.');
      }
      throw caught;
    }
  }

  async clearTsdActivationCode(userId: string) {
    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          tsdActivationCodeHash: null,
        },
        select: this.userSummarySelect(),
      });
      return this.toUserSummary(user);
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Пользователь не найден.');
      }
      throw caught;
    }
  }

  async listRoles(currentUser: AuthUser) {
    const roles = await this.accessModel.listRoles();
    return roles
      .filter(
        (role) =>
          !currentUser.isDemo ||
          !role.permissions.some((item) => item.permission.code === 'system:admin'),
      )
      .map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      permissions: role.permissions.map((item) => ({
        code: item.permission.code,
        name: item.permission.name,
      })),
      }));
  }

  private buildCreateClientScopes(clientIds?: string[], writableClientIds?: string[]) {
    const readSet = new Set(clientIds ?? []);
    const writeSet = new Set(writableClientIds ?? []);
    writeSet.forEach((clientId) => readSet.add(clientId));

    return [...readSet].map((clientId) => ({
      clientId,
      canRead: true,
      canWrite: writeSet.has(clientId),
    }));
  }

  private async ensureClientsExist(clientIds: string[], currentUser?: AuthUser) {
    const uniqueClientIds = [...new Set(clientIds)];
    if (uniqueClientIds.length === 0) {
      return;
    }

    const foundClients = await this.prisma.client.findMany({
      where: {
        id: { in: uniqueClientIds },
        ...(currentUser ? { isDemo: Boolean(currentUser.isDemo) } : {}),
      },
      select: { id: true },
    });

    if (foundClients.length !== uniqueClientIds.length) {
      throw new BadRequestException('Один или несколько клиентов для scope не найдены.');
    }
  }

  private normalizeRoleCodes(roleCodes: string[]) {
    return [...new Set(roleCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  }

  private assertCompatibleRoleCodes(roleCodes: string[]) {
    if (roleCodes.includes('CLIENT') && roleCodes.some((code) => code !== 'CLIENT')) {
      throw new BadRequestException(
        'Роль клиента нельзя совмещать с внутренними ролями сотрудников.',
      );
    }
  }

  private async ensureSystemAdminSurvives(userId: string, nextRoleIds: string[]) {
    const currentHasSystemAdmin = await this.prisma.userRole.count({
      where: {
        userId,
        role: {
          permissions: {
            some: {
              permission: { code: 'system:admin' },
            },
          },
        },
      },
    });

    if (currentHasSystemAdmin === 0) {
      return;
    }

    const nextHasSystemAdmin = await this.prisma.role.count({
      where: {
        id: { in: nextRoleIds },
        permissions: {
          some: {
            permission: { code: 'system:admin' },
          },
        },
      },
    });

    if (nextHasSystemAdmin > 0) {
      return;
    }

    const otherSystemAdmins = await this.prisma.user.count({
      where: {
        id: { not: userId },
        status: UserStatus.ACTIVE,
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: { code: 'system:admin' },
                },
              },
            },
          },
        },
      },
    });

    if (otherSystemAdmins === 0) {
      throw new BadRequestException('Нельзя снять последнюю роль с полным административным доступом.');
    }
  }

  private async findUserSummary(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: this.userSummarySelect(),
    });
    return this.toUserSummary(user);
  }

  private async ensureUserInSameMode(userId: string, currentUser: AuthUser) {
    const target = await this.prisma.user.findFirst({
      where: { id: userId, isDemo: Boolean(currentUser.isDemo) },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Пользователь не найден.');
    }
  }

  private async ensureDemoSafeRoles(roleIds: string[], currentUser: AuthUser) {
    if (!currentUser.isDemo) {
      return;
    }
    const unsafeRoles = await this.prisma.role.count({
      where: {
        id: { in: roleIds },
        permissions: {
          some: {
            permission: { code: 'system:admin' },
          },
        },
      },
    });
    if (unsafeRoles > 0) {
      throw new BadRequestException('В демонстрационном режиме нельзя назначать production-роли владельца и администратора.');
    }
  }

  private userSummarySelect() {
    return {
      id: true,
      email: true,
      name: true,
      status: true,
      analyticsEnabled: true,
      activeWarehouseId: true,
      tsdActivationCodeHash: true,
      createdAt: true,
      roles: {
        select: {
          role: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
      clientScopes: {
        select: {
          canRead: true,
          canWrite: true,
          client: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
      printerScopes: {
        select: {
          groupCode: true,
          canPrint: true,
          canManage: true,
        },
      },
      warehouseScopes: {
        select: {
          canRead: true,
          canWrite: true,
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              city: true,
            },
          },
        },
      },
    } as const;
  }

  private toUserSummary<T extends { tsdActivationCodeHash: string | null }>(user: T) {
    const { tsdActivationCodeHash: _tsdActivationCodeHash, ...summary } = user;
    return {
      ...summary,
      hasTsdActivationCode: Boolean(_tsdActivationCodeHash),
    };
  }

  private async ensureSystemAdminStatusSurvives(userId: string) {
    const currentHasSystemAdmin = await this.prisma.userRole.count({
      where: {
        userId,
        role: {
          permissions: {
            some: {
              permission: { code: 'system:admin' },
            },
          },
        },
      },
    });

    if (currentHasSystemAdmin === 0) {
      return;
    }

    const otherSystemAdmins = await this.prisma.user.count({
      where: {
        id: { not: userId },
        status: UserStatus.ACTIVE,
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: { code: 'system:admin' },
                },
              },
            },
          },
        },
      },
    });

    if (otherSystemAdmins === 0) {
      throw new BadRequestException('Нельзя заблокировать последнего пользователя с полным административным доступом.');
    }
  }
}

function isRecordNotFoundError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2025';
}

function isUniqueUserEmailError(caught: unknown) {
  return caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === 'P2002';
}
