import type { AdminNotification } from './adminNotifications';
export type WarehouseNotificationTarget = { clientId: string; boxCode: string; warehouseId?: string | null; nonce: number };
type Target = { workspace: 'monitoring' }
 | { workspace: 'warehouse'; clientId: string; boxCode: string; warehouseId?: string | null }
 | { workspace: 'inventory'; sessionId: string; auditBoxId?: string | null }
 | { workspace: 'requests'; requestId: string };
// FIX: historical missing-box signals store the exact box in their structured TSD message.
export function resolveAdminNotificationTarget(item: AdminNotification): Target {
 // FIX: retain the published WB synchronization health destination.
 if (item.type === 'WB_SYNC_HEALTH') return {workspace:'monitoring'};
 if (item.type === 'MISSING_PALLET_BOX') {
  const boxCode = /\[FBS_MISSING_PALLET_BOX\]\s*Короб:\s*([^;\r\n]+);/u.exec(item.body)?.[1].trim();
  if (!boxCode || !item.clientId) throw new Error('В уведомлении не указан точный короб. Откройте «Склад → Короба» и проверьте сигнал.');
  return { workspace: 'warehouse', clientId: item.clientId, boxCode, warehouseId: item.warehouseId };
 }
 if (item.sessionId) return {workspace:'inventory',sessionId:item.sessionId,auditBoxId:item.auditBoxId};
 if (item.requestId) return {workspace:'requests',requestId:item.requestId};
 throw new Error('В уведомлении нет ссылки на проверку или заявку.');
}
