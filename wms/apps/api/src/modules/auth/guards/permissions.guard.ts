import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth.types';
import {
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';
import { assertTsdWarehouseKeeperCapability } from './tsd-warehouse-keeper-capability';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      body?: unknown;
      method?: string;
      originalUrl?: string;
      path?: string;
      url?: string;
      user?: AuthUser;
    }>();
    assertTsdWarehouseKeeperCapability(request);

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(REQUIRED_ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length && !requiredAny?.length) {
      return true;
    }

    const permissions = new Set(request.user?.permissionCodes ?? []);

    if (
      permissions.has('system:admin') ||
      ((!required?.length || required.every((permission) => permissions.has(permission))) &&
        (!requiredAny?.length || requiredAny.some((permission) => permissions.has(permission))))
    ) {
      return true;
    }

    // Русский комментарий: guard возвращает список недостающих прав, чтобы администратор быстро понял, какой доступ выдать роли.
    throw new ForbiddenException({
      message: 'Недостаточно прав для операции.',
      required: required ?? [],
      requiredAny: requiredAny ?? [],
      missing: (required ?? []).filter((permission) => !permissions.has(permission)),
    });
  }
}
