import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';

export type WarehouseAccessMode = 'read' | 'write';

/**
 * Branch isolation is intentionally limited to internal users with an explicit
 * warehouse scope. System administrators and client-cabinet users keep their
 * existing cross-warehouse behaviour.
 */
export function isWarehouseScopedInternalUser(user: AuthUser) {
  const permissionCodes = user.permissionCodes ?? [];
  const roleCodes = user.roleCodes ?? [];
  return (
    !permissionCodes.includes('system:admin') &&
    !roleCodes.includes('CLIENT') &&
    (roleCodes.includes('BRANCH_MANAGER') ||
      Array.isArray(user.warehouseIds) ||
      Array.isArray(user.writableWarehouseIds))
  );
}

export function effectiveWarehouseId(user: AuthUser, mode: WarehouseAccessMode): string | null {
  if (!isWarehouseScopedInternalUser(user)) {
    return null;
  }

  const warehouseId = user.activeWarehouseId?.trim() ?? '';
  const readableWarehouseIds = user.warehouseIds ?? [];
  if (!warehouseId || !readableWarehouseIds.includes(warehouseId)) {
    throw new ForbiddenException('Активный филиал не выбран или недоступен пользователю.');
  }

  if (mode === 'write' && !(user.writableWarehouseIds ?? []).includes(warehouseId)) {
    throw new ForbiddenException('В выбранном филиале доступен только просмотр.');
  }

  return warehouseId;
}

export function warehouseScopeWhere(user: AuthUser, mode: WarehouseAccessMode = 'read') {
  const warehouseId = effectiveWarehouseId(user, mode);
  return warehouseId ? { warehouseId } : {};
}

export function assertWarehouseAccess(
  user: AuthUser,
  entity: { warehouseId: string | null },
  mode: WarehouseAccessMode,
  notFoundMessage = 'Объект не найден в выбранном филиале.',
) {
  const warehouseId = effectiveWarehouseId(user, mode);
  if (warehouseId && entity.warehouseId !== warehouseId) {
    throw new NotFoundException(notFoundMessage);
  }
  return warehouseId;
}
