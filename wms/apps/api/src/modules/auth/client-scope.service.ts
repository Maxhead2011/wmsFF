import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from './auth.types';

export type ClientFilter = string | { in: string[] } | { notIn: string[] } | undefined;

@Injectable()
export class ClientScopeService {
  resolveClientFilter(user: AuthUser, requestedClientId?: string): ClientFilter {
    if (requestedClientId) {
      this.requireClientAccess(user, requestedClientId, 'read');
      return requestedClientId;
    }

    if (this.hasGlobalClientAccess(user)) {
      return user.hiddenClientIds?.length ? { notIn: user.hiddenClientIds } : undefined;
    }

    return { in: user.clientIds };
  }

  requireClientAccess(user: AuthUser, clientId: string, mode: 'read' | 'write') {
    if (this.hasGlobalClientAccess(user)) {
      if (user.hiddenClientIds?.includes(clientId)) {
        throw new ForbiddenException({
          message: 'Демонстрационные данные доступны только в демо-режиме.',
          clientId,
          mode,
        });
      }
      return;
    }

    const allowedClientIds = mode === 'write' ? user.writableClientIds : user.clientIds;
    if (!allowedClientIds.includes(clientId)) {
      throw new ForbiddenException({
        message: 'Нет доступа к данным этого клиента.',
        clientId,
        mode,
      });
    }
  }

  requireGlobalClientAccess(user: AuthUser) {
    if (this.hasGlobalClientAccess(user)) {
      return;
    }

    throw new ForbiddenException('Операция доступна только пользователю без клиентского ограничения.');
  }

  private hasGlobalClientAccess(user: AuthUser) {
    if (user.isDemo) {
      return false;
    }

    // Русский комментарий: system:admin всегда обходит клиентские scope; остальные зависят от режима, собранного AuthGuard.
    return user.permissionCodes.includes('system:admin') || user.clientScopeMode === 'ALL';
  }
}
