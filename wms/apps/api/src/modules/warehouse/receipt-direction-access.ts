import type { AuthUser } from '../auth/auth.types';
// FIX: client managers use their existing writable client scope, without personal grants.
export async function canManageReceiptDirections(_db: unknown, user: AuthUser, clientId: string): Promise<boolean> {
  if (process.env.WMS_RECEIPT_CHANNELS_ENABLED !== 'true' || user.isDemo) return false;
  if (user.roleCodes.some(role => role === 'ADMIN' || role === 'OWNER')) {
    return user.permissionCodes.some(permission => permission === 'warehouse:write' || permission === 'system:admin');
  }
  return user.roleCodes.includes('CLIENT') && Boolean(user.writableClientIds?.includes(clientId));
}
