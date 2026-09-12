type DeletionUser = {
  status: string;
  roles: ReadonlyArray<{ role: { code: string } }>;
  warehouseScopes: ReadonlyArray<{ canRead: boolean; canWrite: boolean; warehouse: { id: string } }>;
};

// FIX: explicit persisted branch assignment controls deletion; activeWarehouseId is only a UI selection.
export function canDeleteUser(actor: DeletionUser | undefined | null, target: DeletionUser): boolean {
  if (!actor || actor.status !== 'ACTIVE') return false;
  const roles = actor.roles.map(row => row.role.code);
  if (roles.includes('OWNER')) return true;
  if (!roles.includes('ADMIN') || target.roles.some(row => ['ADMIN', 'OWNER'].includes(row.role.code))) return false;
  if (actor.warehouseScopes.length !== 1 || target.warehouseScopes.length !== 1) return false;
  const assigned = actor.warehouseScopes[0];
  return assigned.canRead && assigned.canWrite && assigned.warehouse.id === target.warehouseScopes[0].warehouse.id;
}
