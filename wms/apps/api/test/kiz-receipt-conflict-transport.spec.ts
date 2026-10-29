import { afterEach, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TsdOperationLogService } from '../src/modules/tsd/tsd-operation-log.service';
import { TsdSyncService } from '../src/modules/tsd/tsd-sync.service';
import { TsdPayloadParser } from '../src/modules/tsd/tsd-payload.parser';

afterEach(() => vi.unstubAllEnvs());
const operation: any = { deviceId: 'device', operationKey: 'scan-1', operationType: 'receipt_scan',
  payload: { clientId: 'client', barcode: '2050000000001', kiz: '010460000000000121ABCDEFGHIJKLM', boxCode: 'FFL_NEW', quantity: 1 } };
const details = { code: 'KIZ_DUPLICATE', duplicate: true, message: 'ОТЛОЖИТЕ ТОВАР', duplicateInfo: {
  identity: operation.payload.kiz, firstReceivedAt: '2026-10-01T09:00:00.000Z', firstBoxCode: 'FFL_OLD', productName: 'Костюм', currentStatus: 'SHIPPING' } };
function fixture() {
  vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'true');
  const rows = new Map<string, any>();
  const db: any = { client: { findUnique: vi.fn(async () => ({ storesWithoutBoxes: false })) }, tsdOperation: {
    findUnique: vi.fn(async ({ where }: any) => rows.get(where.operationKey) ?? null),
    upsert: vi.fn(async ({ where, create, update }: any) => { const row = rows.has(where.operationKey) ? { ...rows.get(where.operationKey), ...update } : create; rows.set(where.operationKey, row); return row; }) } };
  const stock: any = { receiveIntoBox: vi.fn(async () => { throw new ConflictException(details); }) };
  const scopes = { requireClientAccess: vi.fn((user: any) => { if (user.denied) throw new ForbiddenException('Denied'); }) };
  const log = new TsdOperationLogService(db, scopes as any);
  const svc = new TsdSyncService(stock, { touchActiveDevice: vi.fn() } as any, db, {} as any, new TsdPayloadParser(), log);
  return { svc, log, rows, stock, db, scopes };
}
it('returns structured late receipt duplicate and preserves it on outbox replay', async () => {
  // TEST: a successful precheck is not proof that another terminal did not accept the KIZ first.
  const f = fixture();
  const first = await f.svc.acceptOperation(operation, { id: 'picker', deviceCode: 'device' } as any);
  expect(first).toMatchObject({ status: 'NEEDS_REVIEW', ...details });
  const retry = await f.svc.acceptOperation(operation, { id: 'picker', deviceCode: 'device' } as any);
  expect(retry).toMatchObject({ status: 'NEEDS_REVIEW', ...details });
  expect(f.stock.receiveIntoBox).toHaveBeenCalledTimes(1);
});
it('never treats a committed receipt retry as a KIZ duplicate', async () => {
  // TEST: uncertain network delivery must not create false physical alarms.
  const f = fixture(); f.stock.receiveIntoBox.mockResolvedValue({ status: 'APPLIED' });
  await f.svc.acceptOperation(operation, { id: 'picker' } as any);
  expect(await f.svc.acceptOperation(operation, { id: 'picker' } as any)).toMatchObject({ status: 'ALREADY_APPLIED' });
  expect((await f.svc.acceptOperation(operation, { id: 'picker' } as any)) as any).not.toHaveProperty('code');
});
it('does not trust conflict metadata submitted by a scanner', async () => {
  // TEST: only the server exception may supply the persisted diagnostic fields.
  const f = fixture(); f.stock.receiveIntoBox.mockRejectedValue(new Error('Other error'));
  const forged = { ...operation, payload: { ...operation.payload, _kizDuplicate: details } };
  await f.svc.acceptOperation(forged, { id: 'picker' } as any);
  expect(await f.svc.acceptOperation(forged, { id: 'picker' } as any)).not.toHaveProperty('code');
  expect(f.rows.get(operation.operationKey).payload).not.toHaveProperty('_kizDuplicate');
});
it('keeps the sold installation response contract unchanged when disabled', async () => {
  const f = fixture(); vi.stubEnv('WMS_KIZ_CLIENT_GUARD_ENABLED', 'false');
  const result = await f.svc.acceptOperation(operation, { id: 'picker' } as any);
  expect(result.status).toBe('NEEDS_REVIEW'); expect(result).not.toHaveProperty('code');
});

it.each(['client', 'device', 'token-device', 'warehouse', 'permission', 'type'])('does not disclose or overwrite a duplicate replay from another %s scope', async (kind) => {
  // TEST: reusing a foreign operation key must never expose its prior receipt or execute it again.
  const f = fixture();
  vi.stubEnv('WMS_COMPACT_OPERATION_RECEIPTS_ENABLED', 'true');
  const user: any = { id: 'picker', deviceCode: 'device', activeWarehouseId: 'warehouse' };
  await f.svc.acceptOperation(operation, user);
  const before = JSON.stringify(f.rows.get(operation.operationKey));
  const replay: any = { ...operation, payload: { ...operation.payload } };
  const caller = { ...user };
  if (kind === 'client') replay.payload.clientId = 'another-client';
  if (kind === 'device') { replay.deviceId = 'another-device'; caller.deviceCode = 'another-device'; }
  if (kind === 'token-device') caller.deviceCode = 'another-device';
  if (kind === 'warehouse') caller.activeWarehouseId = 'another-warehouse';
  if (kind === 'permission') caller.denied = true;
  if (kind === 'type') replay.operationType = 'inventory_scan';
  const result = await f.svc.acceptOperation(replay, caller);
  expect(result.status).toBe('REJECTED');
  expect(result).not.toHaveProperty('duplicateInfo');
  expect(JSON.stringify(result)).not.toContain('FFL_OLD');
  expect(JSON.stringify(f.rows.get(operation.operationKey))).toBe(before);
  expect(f.stock.receiveIntoBox).toHaveBeenCalledTimes(1);
});
