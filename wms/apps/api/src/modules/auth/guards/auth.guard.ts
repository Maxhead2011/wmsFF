import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SystemSettingsService } from '../../../common/settings/system-settings.service';
import { AccessTokenService } from '../access-token.service';
import type { AuthUser } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserSessionService } from '../user-session.service';
import { WarehouseAuthScopeService } from '../warehouse-auth-scope.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private demoClientIdsCache: { ids: string[]; expiresAt: number } | null = null;
  private administrationCache:
    | {
        ownerIds: string[];
        visibility: Record<string, Record<string, boolean>>;
        expiresAt: number;
      }
    | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
    private readonly userSessions: UserSessionService,
    private readonly warehouseAuthScope: WarehouseAuthScopeService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      ip?: string;
      user?: AuthUser;
    }>();
    const token = this.extractBearerToken(request.headers.authorization);
    const payload = this.tokens.verify(token);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        clientScopes: {
          include: {
            client: {
              select: { isDemo: true, relabelingEnabled: true },
            },
          },
        },
        printerScopes: true,
        warehouseScopes: {
          include: { warehouse: { select: { isActive: true } } },
        },
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
      },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь access token не найден.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Пользователь заблокирован.');
    }

    if (!payload.deviceId) {
      await this.userSessions.assertActive(user.id, token, payload, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
    }

    const roleCodes = user.roles.map((item) => item.role.code);
    const permissionCodes = [
      ...new Set(user.roles.flatMap((item) => item.role.permissions.map((permission) => permission.permission.code))),
    ];
    const resolvedScope = await this.warehouseAuthScope.resolve({
      roleCodes,
      permissionCodes,
      isDemo: user.isDemo,
      activeWarehouseId: user.activeWarehouseId,
      clientScopes: user.clientScopes,
      warehouseScopes: user.warehouseScopes,
    });
    const hasGlobalClientAccess = !user.isDemo && resolvedScope.clientScopeMode === 'ALL';
    const hiddenClientIds = hasGlobalClientAccess ? await this.demoClientIds() : [];
    const administration = await this.administrationControls();

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      isDemo: user.isDemo,
      analyticsEnabled: user.analyticsEnabled,
      relabelingEnabled:
        hasGlobalClientAccess ||
        resolvedScope.relabelingEnabled,
      administrationEnabled:
        administration.ownerIds.includes(user.id) ||
        (user.isDemo && permissionCodes.includes('administration:demo')),
      workspaceVisibility: normalizeWorkspaceVisibility(administration.visibility[user.id]),
      roleCodes,
      permissionCodes,
      clientScopeMode: resolvedScope.clientScopeMode,
      clientIds: resolvedScope.clientIds,
      writableClientIds: resolvedScope.writableClientIds,
      activeWarehouseId: resolvedScope.activeWarehouseId,
      warehouseIds: user.warehouseScopes.filter((scope) => scope.canRead).map((scope) => scope.warehouseId),
      writableWarehouseIds: user.warehouseScopes.filter((scope) => scope.canWrite).map((scope) => scope.warehouseId),
      hiddenClientIds,
      printerGroups: user.printerScopes.map((scope) => ({
        groupCode: scope.groupCode,
        canPrint: scope.canPrint,
        canManage: scope.canManage,
      })),
      deviceId: payload.deviceId,
      deviceCode: payload.deviceCode,
    };

    return true;
  }

  private async demoClientIds() {
    const now = Date.now();
    if (this.demoClientIdsCache && this.demoClientIdsCache.expiresAt > now) {
      return this.demoClientIdsCache.ids;
    }

    const clients = await this.prisma.client.findMany({
      where: { isDemo: true },
      select: { id: true },
    });
    const ids = clients.map((client) => client.id);
    this.demoClientIdsCache = { ids, expiresAt: now + 60_000 };
    return ids;
  }

  private async administrationControls() {
    const now = Date.now();
    if (this.administrationCache && this.administrationCache.expiresAt > now) {
      return this.administrationCache;
    }
    const [ownerIds, visibility] = await Promise.all([
      this.settings.get<string[]>('administration.ownerUserIds', []),
      this.settings.get<Record<string, Record<string, boolean>>>('ui.workspaceVisibility', {}),
    ]);
    this.administrationCache = {
      ownerIds: Array.isArray(ownerIds) ? ownerIds.filter((item) => typeof item === 'string') : [],
      visibility:
        visibility && typeof visibility === 'object' && !Array.isArray(visibility) ? visibility : {},
      expiresAt: now + 5_000,
    };
    return this.administrationCache;
  }

  private extractBearerToken(authorization?: string | string[]) {
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    const [scheme, token] = value?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Нужен Bearer access token.');
    }

    return token;
  }

}

function normalizeWorkspaceVisibility(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  );
}
