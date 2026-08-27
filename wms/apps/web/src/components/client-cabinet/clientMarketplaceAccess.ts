import type { AuthUser } from '../../lib/api';

// FIX: право API не должно одновременно открывать редактирование реквизитов клиента.
export function canManageClientMarketplaceApi(user: AuthUser) {
  return (
    user.permissionCodes.includes('system:admin') ||
    user.permissionCodes.includes('clients:write') ||
    user.permissionCodes.includes('marketplace-api:write')
  );
}
