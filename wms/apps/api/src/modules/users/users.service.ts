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
import { UpdateUserReferralClientsDto } from './dto/update-user-referral-clients.dto';
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

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: this.userSummarySelect(),
    });
    return users.map((user) => this.toUserSummary(user));
  }

  async create(dto: CreateUserDto) {
    const roles = await this.accessModel.resolveRoles(dto.roleCodes?.length ? dto.roleCodes : ['OPERATOR']);
    const clientScopes = this.buildCreateClientScopes(dto.clientIds, dto.writableClientIds);
    await this.ensureClientsExist(clientScopes.map((scope) => scope.clientId));

    // Русский комментарий: API никогда не возвращает passwordHash; пароль сохраняется только как scrypt hash.
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.trim().toLowerCase(),
        name: dto.name.trim(),
        passwordHash: await this.passwords.hash(dto.password),
        roles: {
          create: roles.map((role) => ({ roleId: role.id })),
        },
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

  async updateClientScopes(userId: string, dto: UpdateUserClientScopesDto) {
    const scopes = [...new Map(dto.scopes.map((scope) => [scope.clientId, scope])).values()].map((scope) => ({
      clientId: scope.clientId,
      canWrite: scope.canWrite ?? false,
      canRead: (scope.canRead ?? true) || (scope.canWrite ?? false),
    }));

    await this.ensureClientsExist(scopes.map((scope) => scope.clientId));

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

  async listReferralClients(userId: string) {
    await this.ensureUserExists(userId);

    const assignments = await this.prisma.userReferralClient.findMany({
      where: { userId },
      include: {
        client: { select: { id: true, code: true, name: true } },
        updatedBy: { select: { id: true, email: true, name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
    });

    return assignments.map((assignment) => this.toReferralClientSummary(assignment));
  }

  async updateReferralClients(userId: string, dto: UpdateUserReferralClientsDto, currentUser: AuthUser) {
    await this.ensureUserExists(userId);

    const assignments = [...new Map(dto.assignments.map((assignment) => [assignment.clientId, assignment])).values()];
    await this.ensureClientsExist(assignments.map((assignment) => assignment.clientId));

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const activeClientIds: string[] = [];

      for (const assignment of assignments) {
        const termMonths = assignment.termMonths ?? null;
        const isActive = assignment.isActive ?? assignment.percent > 0;
        activeClientIds.push(assignment.clientId);

        await tx.userReferralClient.upsert({
          where: {
            userId_clientId: {
              userId,
              clientId: assignment.clientId,
            },
          },
          create: {
            userId,
            clientId: assignment.clientId,
            percent: new Prisma.Decimal(roundPercent(assignment.percent)),
            isActive,
            startsAt: now,
            expiresAt: termMonths ? addMonths(now, termMonths) : null,
            termMonths,
            updatedByUserId: currentUser.id,
          },
          update: {
            percent: new Prisma.Decimal(roundPercent(assignment.percent)),
            isActive,
            startsAt: now,
            expiresAt: termMonths ? addMonths(now, termMonths) : null,
            termMonths,
            updatedByUserId: currentUser.id,
          },
        });
      }

      await tx.userReferralClient.updateMany({
        where: {
          userId,
          ...(activeClientIds.length > 0 ? { clientId: { notIn: activeClientIds } } : {}),
        },
        data: {
          isActive: false,
          updatedByUserId: currentUser.id,
        },
      });
    });

    return this.listReferralClients(userId);
  }

  async updatePrinterScopes(userId: string, dto: UpdateUserPrinterScopesDto) {
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

  async updateProfile(userId: string, dto: UpdateUserProfileDto) {
    if (dto.status && dto.status !== UserStatus.ACTIVE) {
      await this.ensureSystemAdminStatusSurvives(userId);
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(dto.email === undefined ? {} : { email: dto.email.trim().toLowerCase() }),
          ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
          ...(dto.password === undefined ? {} : { passwordHash: await this.passwords.hash(dto.password) }),
          ...(dto.status === undefined ? {} : { status: dto.status }),
        },
        select: this.userSummarySelect(),
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

  async updateRoles(userId: string, dto: UpdateUserRolesDto) {
    const roleCodes = this.normalizeRoleCodes(dto.roleCodes);
    if (roleCodes.length === 0) {
      throw new BadRequestException('Нужно выбрать хотя бы одну роль пользователя.');
    }

    const roles = await this.accessModel.resolveRoles(roleCodes);
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

  async listRoles() {
    const roles = await this.accessModel.listRoles();
    return roles.map((role) => ({
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

  private async ensureClientsExist(clientIds: string[]) {
    const uniqueClientIds = [...new Set(clientIds)];
    if (uniqueClientIds.length === 0) {
      return;
    }

    const foundClients = await this.prisma.client.findMany({
      where: { id: { in: uniqueClientIds } },
      select: { id: true },
    });

    if (foundClients.length !== uniqueClientIds.length) {
      throw new BadRequestException('Один или несколько клиентов для scope не найдены.');
    }
  }

  private async ensureUserExists(userId: string) {
    try {
      await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true },
      });
    } catch (caught) {
      if (isRecordNotFoundError(caught)) {
        throw new NotFoundException('Пользователь не найден.');
      }
      throw caught;
    }
  }

  private normalizeRoleCodes(roleCodes: string[]) {
    return [...new Set(roleCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
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

  private userSummarySelect() {
    return {
      id: true,
      email: true,
      name: true,
      status: true,
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
    } as const;
  }

  private toUserSummary<T extends { tsdActivationCodeHash: string | null }>(user: T) {
    const { tsdActivationCodeHash: _tsdActivationCodeHash, ...summary } = user;
    return {
      ...summary,
      hasTsdActivationCode: Boolean(_tsdActivationCodeHash),
    };
  }

  private toReferralClientSummary(assignment: {
    clientId: string;
    percent: Prisma.Decimal | number | string;
    isActive: boolean;
    startsAt: Date;
    expiresAt: Date | null;
    termMonths: number | null;
    createdAt: Date;
    updatedAt: Date;
    client: { id: string; code: string; name: string };
    updatedBy: { id: string; email: string; name: string } | null;
  }) {
    return {
      clientId: assignment.clientId,
      client: assignment.client,
      percent: Number(assignment.percent),
      isActive: assignment.isActive,
      startsAt: assignment.startsAt.toISOString(),
      expiresAt: assignment.expiresAt?.toISOString() ?? null,
      termMonths: assignment.termMonths,
      createdAt: assignment.createdAt.toISOString(),
      updatedAt: assignment.updatedAt.toISOString(),
      updatedBy: assignment.updatedBy,
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

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}
