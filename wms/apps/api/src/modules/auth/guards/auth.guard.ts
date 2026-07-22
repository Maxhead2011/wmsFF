import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AccessTokenService } from '../access-token.service';
import type { AuthUser } from '../auth.types';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: AuthUser }>();
    const token = this.extractBearerToken(request.headers.authorization);
    const payload = this.tokens.verify(token);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
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
      },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь access token не найден.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Пользователь заблокирован.');
    }

    const roleCodes = user.roles.map((item) => item.role.code);
    const permissionCodes = [
      ...new Set(user.roles.flatMap((item) => item.role.permissions.map((permission) => permission.permission.code))),
    ];

    request.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      isDemo: user.isDemo,
      analyticsEnabled: user.analyticsEnabled,
      roleCodes,
      permissionCodes,
      clientScopeMode: user.isDemo ? 'LIMITED' : this.clientScopeMode(roleCodes, permissionCodes, user.clientScopes.length),
      clientIds: user.clientScopes.filter((scope) => scope.canRead).map((scope) => scope.clientId),
      writableClientIds: user.clientScopes.filter((scope) => scope.canWrite).map((scope) => scope.clientId),
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

  private extractBearerToken(authorization?: string) {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Нужен Bearer access token.');
    }

    return token;
  }

  private clientScopeMode(roleCodes: string[], permissionCodes: string[], clientScopesCount: number) {
    if (permissionCodes.includes('system:admin')) {
      return 'ALL';
    }

    // Русский комментарий: внутренние роли без назначенных scope пока видят всех клиентов; клиентская роль всегда ограничена.
    if (!roleCodes.includes('CLIENT') && clientScopesCount === 0) {
      return 'ALL';
    }

    return 'LIMITED';
  }
}
