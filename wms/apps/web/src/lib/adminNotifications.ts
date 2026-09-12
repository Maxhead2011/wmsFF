import { request } from './api';
export type AdminNotification = {
  id: number; type: string; title: string; body: string; createdAt: string; isRead: boolean;
  clientId: string; warehouseId?: string | null; sessionId?: string | null; auditBoxId?: string | null; requestId?: string | null;
};
export type InventoryNotificationTarget = { sessionId: string; auditBoxId?: string | null; nonce: number };
export type AdminNotificationFeed = {
  enabled: boolean; items: AdminNotification[]; popupCandidates: AdminNotification[];
  unreadCount: number; nextBeforeId: number | null;
};
export function fetchAdminNotifications(accessToken: string, beforeId?: number) {
  return request<AdminNotificationFeed>(`/admin-notifications${beforeId ? `?beforeId=${beforeId}` : ''}`, { accessToken });
}
export function readAdminNotification(accessToken: string, id: number) {
  return request<{ isRead: boolean }>(`/admin-notifications/${id}/read`, { method: 'POST', accessToken });
}
export function claimAdminPopup(accessToken: string, id: number) {
  return request<{ claimed: boolean }>(`/admin-notifications/${id}/popup`, { method: 'POST', accessToken });
}
const openingKeys = new Map<string, { id: string; expires: number }>();
// FIX: called from deliberate user actions only; repeated clicks share an idempotency key.
export function reportInventoryOpened(accessToken: string, userId: string, sessionId: string, auditBoxId?: string) {
  const key = `${userId}:${sessionId}:${auditBoxId ?? ''}`;
  for (const [name, value] of openingKeys) if (value.expires < Date.now()) openingKeys.delete(name);
  let opening = openingKeys.get(key);
  if (!opening) { opening = { id: openingUuid(), expires: Date.now() + 60000 }; openingKeys.set(key, opening); }
  return request<{ recorded: boolean }>(`/inventory/sessions/${sessionId}/opened`, {
    method: 'POST', accessToken, body: { auditBoxId, openingId: opening.id },
  });
}

// FIX: warehouse LAN installations may use HTTP, where randomUUID is unavailable.
function openingUuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
