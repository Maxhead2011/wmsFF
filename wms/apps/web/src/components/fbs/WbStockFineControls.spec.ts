import { expect, it } from 'vitest';
import { canEditWbReserve } from './WbStockFineControls';

// TEST: the client editor follows explicit write assignments, not merely read visibility.
it('offers reserve/exclusion editing only to administrators or writable client managers', () => {
  const user: any = { roleCodes: ['CLIENT'], permissionCodes: ['stock:read'], clientIds: ['own', 'readonly'], writableClientIds: ['own'] };
  expect(canEditWbReserve(user, 'own')).toBe(true);
  expect(canEditWbReserve(user, 'readonly')).toBe(false);
  expect(canEditWbReserve(user, 'other')).toBe(false);
  expect(canEditWbReserve({ ...user, isDemo: true }, 'own')).toBe(false);
  expect(canEditWbReserve({ ...user, roleCodes: ['OPERATOR'] }, 'own')).toBe(false);
  expect(canEditWbReserve({ ...user, roleCodes: ['ADMIN'], permissionCodes: ['system:admin'] }, 'own')).toBe(true);
});
