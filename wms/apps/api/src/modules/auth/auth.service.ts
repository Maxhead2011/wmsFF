import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserStatus } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AccessModelService } from './access-model.service';
import { AccessTokenService } from './access-token.service';
import type { AuthUser } from './auth.types';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordService } from './password.service';

type UserWithAccess = {
  id: string;
  email: string;
  name: string;
  isDemo: boolean;
  passwordHash: string;
  status: UserStatus;
  clientScopes: Array<{ clientId: string; canRead: boolean; canWrite: boolean }>;
  printerScopes: Array<{ groupCode: string; canPrint: boolean; canManage: boolean }>;
  roles: Array<{
    role: {
      code: string;
      permissions: Array<{
        permission: {
          code: string;
        };
      }>;
    };
  }>;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly accessModel: AccessModelService,
    private readonly passwords: PasswordService,
    private readonly tokens: AccessTokenService,
  ) {}

  async bootstrapAdmin(dto: BootstrapAdminDto) {
    this.assertBootstrapSecret(dto.bootstrapSecret);

    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      throw new BadRequestException('Первичный администратор уже создан.');
    }

    const [adminRole] = await this.accessModel.resolveRoles(['ADMIN']);
    const user = await this.prisma.user.create({
      data: {
        email: this.normalizeEmail(dto.email),
        name: dto.name.trim(),
        passwordHash: await this.passwords.hash(dto.password),
        roles: {
          create: [{ roleId: adminRole.id }],
        },
      },
      include: this.userAccessInclude(),
    });

    return this.authResponse(user);
  }

  async login(dto: LoginDto, context: { ip?: string; userAgent?: string | string[] } = {}) {
    const user = await this.findUserWithAccess(this.normalizeEmail(dto.email));
    if (!user || !(await this.passwords.verify(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Неверный логин или пароль.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Пользователь заблокирован.');
    }

    const authUser = this.toAuthUser(user);
    const maintenance = await this.getMaintenanceMode();
    if (maintenance.enabled && !authUser.permissionCodes.includes('system:admin')) {
      throw new UnauthorizedException(maintenance.message || 'Вход временно закрыт: идут сервисные работы.');
    }

    const session = {
      accessToken: this.tokens.sign(user.id),
      tokenType: 'Bearer' as const,
      user: authUser,
    };

    await this.auditLog.write({
      userId: user.id,
      action: 'auth.login',
      entity: 'user',
      entityId: user.id,
      payload: {
        ip: context.ip,
        userAgent: Array.isArray(context.userAgent) ? context.userAgent.join(', ') : context.userAgent,
        roleCodes: authUser.roleCodes,
        clientIds: authUser.clientIds,
      },
    });

    return session;
  }

  private async findUserWithAccess(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: this.userAccessInclude(),
    });
  }

  private authResponse(user: UserWithAccess) {
    const authUser = this.toAuthUser(user);

    return {
      accessToken: this.tokens.sign(user.id),
      tokenType: 'Bearer' as const,
      user: authUser,
    };
  }

  private toAuthUser(user: UserWithAccess): AuthUser {
    const roleCodes = user.roles.map((item) => item.role.code);
    const permissionCodes = [
      ...new Set(user.roles.flatMap((item) => item.role.permissions.map((permission) => permission.permission.code))),
    ];

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isDemo: user.isDemo,
      roleCodes,
      permissionCodes,
      clientScopeMode: this.clientScopeMode(roleCodes, permissionCodes, user.clientScopes.length),
      clientIds: user.clientScopes.filter((scope) => scope.canRead).map((scope) => scope.clientId),
      writableClientIds: user.clientScopes.filter((scope) => scope.canWrite).map((scope) => scope.clientId),
      printerGroups: user.printerScopes.map((scope) => ({
        groupCode: scope.groupCode,
        canPrint: scope.canPrint,
        canManage: scope.canManage,
      })),
    };
  }

  private userAccessInclude() {
    return {
      clientScopes: true,
      printerScopes: true,
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    } as const;
  }

  private assertBootstrapSecret(input: string) {
    const expected = this.config.get<string>('BOOTSTRAP_ADMIN_SECRET');
    if (!expected || input !== expected) {
      throw new UnauthorizedException('Неверный bootstrap secret.');
    }
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private clientScopeMode(roleCodes: string[], permissionCodes: string[], clientScopesCount: number) {
    if (permissionCodes.includes('system:admin')) {
      return 'ALL';
    }

    if (!roleCodes.includes('CLIENT') && clientScopesCount === 0) {
      return 'ALL';
    }

    return 'LIMITED';
  }

  private async getMaintenanceMode() {
    const event = await this.prisma.auditLog.findFirst({
      where: { action: 'service.maintenance.update', entity: 'system' },
      orderBy: { createdAt: 'desc' },
    });
    const payload = event?.payload;
    if (!isRecord(payload)) {
      return { enabled: false, message: '' };
    }

    return {
      enabled: payload.enabled === true,
      message: typeof payload.message === 'string' ? payload.message : '',
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
