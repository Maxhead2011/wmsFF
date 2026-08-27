import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../auth.types';

type TsdCapabilityRequest = {
  body?: unknown;
  method?: string;
  originalUrl?: string;
  path?: string;
  url?: string;
  user?: AuthUser;
};

const WAREHOUSE_KEEPER_ROLE = 'WAREHOUSE_KEEPER';
const ALLOWED_SYNC_OPERATION_TYPES = new Set(['move_scan', 'inventory_scan']);
const ELEVATED_TSD_ROLE_CODES = new Set([
  'ADMIN',
  'OWNER',
  'MANAGER',
  'OPERATOR',
  'BRANCH_MANAGER',
]);

/**
 * Server-side TSD capability boundary for the restricted warehouse-keeper role.
 *
 * UI menu hiding is not an authorization boundary: older APKs and direct HTTP
 * clients can still call routes that the current APK no longer renders.  TSD
 * access tokens are identifiable by deviceId/deviceCode, so web sessions keep
 * their existing permission model while a warehouse-keeper TSD token is
 * fail-closed outside the three explicitly supported workflows.
 */
export function assertTsdWarehouseKeeperCapability(request: TsdCapabilityRequest) {
  const user = request.user;
  if (!isRestrictedWarehouseKeeperTsdUser(user)) return;

  const method = String(request.method ?? 'GET').toUpperCase();
  const path = normalizedCapabilityPath(request);

  if (isAllowedWarehouseKeeperTsdRoute(method, path, request.body)) return;

  throw new ForbiddenException({
    message:
      'Роль «Кладовщик» на ТСД может работать только с перемещениями, сборкой паллетов и инвентаризацией.',
    code: 'TSD_CAPABILITY_FORBIDDEN',
    allowedCapabilities: ['TRANSFERS', 'PALLET_ASSEMBLY', 'INVENTORY'],
  });
}

export function isAllowedWarehouseKeeperTsdRoute(method: string, path: string, body?: unknown) {
  if (method === 'GET' && path === '/tsd/clients') return true;

  if (
    method === 'POST' &&
    (path === '/tsd/monitor/heartbeat' || path === '/tsd/monitor/error')
  ) {
    return true;
  }

  if (
    (method === 'GET' && path === '/tsd/storage-pallet/current') ||
    (method === 'POST' && path === '/tsd/storage-pallet/open') ||
    (method === 'POST' && /^\/tsd\/storage-pallet\/[^/]+\/(scan-box|restore-box|close)$/.test(path)) ||
    (method === 'DELETE' && /^\/tsd\/storage-pallet\/[^/]+$/.test(path))
  ) {
    return true;
  }

  if (
    (method === 'GET' && path === '/tsd/transfers/source') ||
    (method === 'POST' && /^\/tsd\/transfers\/(item|execute|execute-batch)$/.test(path))
  ) {
    return true;
  }

  // The inventory controller is the complete inventory workflow. Its service
  // still enforces client/warehouse scope and the role-specific approval rules.
  if (path.startsWith('/inventory/') && ['GET', 'POST', 'PATCH'].includes(method)) {
    return true;
  }

  // One-window inventory can relocate an audited box after resolution.
  if (method === 'POST' && path === '/stock/transfers/whole-box') return true;

  // Legacy/offline APKs submit transfer and inventory scans through the sync
  // queue. Reject the complete batch when it contains even one other workflow.
  if (method === 'POST' && (path === '/tsd/operations' || path === '/tsd/sync')) {
    return hasOnlyAllowedSyncOperations(body, path === '/tsd/sync');
  }

  return false;
}

function hasOnlyAllowedSyncOperations(body: unknown, isBatch: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;
  const operations = isBatch ? record.operations : [record];
  if (!Array.isArray(operations) || operations.length === 0) return false;

  return operations.every((operation) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return false;
    return ALLOWED_SYNC_OPERATION_TYPES.has(
      String((operation as Record<string, unknown>).operationType ?? ''),
    );
  });
}

function isRestrictedWarehouseKeeperTsdUser(user: AuthUser | undefined) {
  if (!user || (!user.deviceId && !user.deviceCode)) return false;
  const roleCodes = [...new Set((user.roleCodes ?? []).map((role) => role.trim().toUpperCase()))];
  if (!roleCodes.includes(WAREHOUSE_KEEPER_ROLE)) return false;

  // Only a known privileged role (or system:admin) is an elevation. CLIENT and
  // unknown/custom roles must never become an accidental capability bypass.
  return (
    !user.permissionCodes?.includes('system:admin') &&
    !roleCodes.some((roleCode) => ELEVATED_TSD_ROLE_CODES.has(roleCode))
  );
}

function normalizedCapabilityPath(request: Pick<TsdCapabilityRequest, 'originalUrl' | 'url' | 'path'>) {
  const raw = String(request.originalUrl ?? request.url ?? request.path ?? '')
    .split('?')[0]
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');

  for (const marker of ['/tsd/', '/inventory/', '/stock/']) {
    const index = raw.indexOf(marker);
    if (index >= 0) return raw.slice(index);
  }

  return raw || '/';
}
