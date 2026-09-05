import type { AuthUser } from '../auth/auth.types';

// FIX: pilot authorization uses the signed device identity, never a body/header supplied by the scanner.
export function skuSortingAllowed(user: Pick<AuthUser, 'deviceId'> | undefined, requestId: string): boolean {
  if (process.env.WMS_SKU_SORTING_ENABLED === 'true') return true;
  const device = process.env.WMS_SKU_SORTING_PILOT_DEVICE_ID?.trim();
  const request = process.env.WMS_SKU_SORTING_PILOT_REQUEST_ID?.trim();
  return Boolean(device && request && user?.deviceId === device && requestId === request);
}
