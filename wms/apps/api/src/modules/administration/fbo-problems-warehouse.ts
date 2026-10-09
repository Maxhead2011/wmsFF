import { ForbiddenException } from '@nestjs/common';

type Actor = {
  status: string; isDemo: boolean; activeWarehouseId: string | null;
  roles: Array<{ role: { code: string } }>;
  warehouseScopes: Array<{ warehouseId: string; canRead: boolean; canWrite: boolean }>;
};

// FIX: the actor and grants come from the database, never from an action payload.
export function recoveryWarehouse(actor: Actor | null) {
  if (!actor || actor.status !== 'ACTIVE' || actor.isDemo) throw new ForbiddenException('Только администратор и собственник.');
  if (actor.roles.some(r => r.role.code === 'OWNER')) return null;
  if (!actor.roles.some(r => r.role.code === 'ADMIN')) throw new ForbiddenException('Только администратор и собственник.');
  if (process.env.WMS_RECEIPT_BARCODE_REVIEW_ENABLED === 'true') {
    const scope = actor.warehouseScopes.find(s => s.warehouseId === actor.activeWarehouseId && s.canRead && s.canWrite);
    if (scope) return scope.warehouseId;
    throw new ForbiddenException('Выберите закреплённый филиал с правом чтения и изменения.');
  }
  if (actor.warehouseScopes.length !== 1 || !actor.warehouseScopes[0].canRead || !actor.warehouseScopes[0].canWrite) {
    throw new ForbiddenException('Нужен один закреплённый филиал администратора.');
  }
  return actor.warehouseScopes[0].warehouseId;
}
