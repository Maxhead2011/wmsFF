import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';

// FIX: client self-service never inherits a global/admin scope from an accidental grant.
export function canUseFbsReshipment(user: AuthUser): boolean {
  if (user.isDemo) return false;
  if (user.roleCodes.includes('CLIENT')) {
    return user.permissionCodes.includes('client-requests:write') &&
      user.clientIds.some(id => user.writableClientIds.includes(id) && !user.hiddenClientIds?.includes(id));
  }
  return user.roleCodes.some(role => role === 'ADMIN' || role === 'OWNER');
}

export function requireFbsReshipmentClientAccess(user: AuthUser, clientId: string): void {
  if (!canUseFbsReshipment(user) || (user.roleCodes.includes('CLIENT') &&
    (!user.clientIds.includes(clientId) || !user.writableClientIds.includes(clientId) || user.hiddenClientIds?.includes(clientId)))) {
    throw new ForbiddenException('Нет права повторной отгрузки для выбранного клиента.');
  }
}
