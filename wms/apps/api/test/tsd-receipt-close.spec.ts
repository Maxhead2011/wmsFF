import { describe, expect, it, vi } from 'vitest';
import { TsdReceiptService } from '../src/modules/tsd/tsd-receipt.service';
import { TsdSyncService } from '../src/modules/tsd/tsd-sync.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
import type { ScanOperationDto } from '../src/modules/tsd/dto/scan-operation.dto';
import { ScanOperationDto as ScanDto } from '../src/modules/tsd/dto/scan-operation.dto';
import { validate } from 'class-validator';

const user = {
  id: 'user-1', email: 'operator@example.com', roleCodes: ['OPERATOR'], permissionCodes: ['stock:write'],
  deviceId: 'device-id', deviceCode: 'TSD-1', activeWarehouseId: 'warehouse-1', writableWarehouseIds: ['warehouse-1'],
} as AuthUser;
const payload = { clientId: 'client-1', boxCode: 'FFL_LKB0409_546', sourceDocument: 'TSD-RECEIPT-1', receiptOperationKeys: '["scan-1","scan-2"]' };
const operation = { operationKey: 'close-1', operationType: 'receipt_close', deviceId: 'TSD-1', payload } as unknown as ScanOperationDto;

function fixture() {
  const box = { id: 'box-1', code: payload.boxCode, clientId: 'client-1', warehouseId: 'warehouse-1', status: 'receiving' };
  const scans = ['scan-1', 'scan-2'].map((key) => ({ operationKey: key, operationType: 'receipt_scan', deviceId: 'TSD-1', status: 'ACCEPTED', createdAt: new Date('2026-09-10T08:01:00Z'), payload: { ...payload, quantity: '1' } }));
  const openings = [{ deviceId: 'TSD-1', createdAt: new Date('2026-09-10T08:00:00Z'), payload: { ...payload, warehouseId: 'warehouse-1', reopened: false, reusedEmpty: false } }];
  const movements = scans.map((scan) => ({ idempotencyKey: scan.operationKey, type: 'RECEIPT', clientId: 'client-1', warehouseId: 'warehouse-1', boxId: 'box-1', sourceDocument: payload.sourceDocument, quantity: 1 }));
  const recorded = new Map<string, Record<string, any>>();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: box.id }]),
    box: {
      findUnique: vi.fn(async () => ({ ...box })),
      updateMany: vi.fn(async ({ where, data }) => { if (where.status && box.status !== where.status) return { count: 0 }; Object.assign(box, data); return { count: 1 }; }),
    },
    tsdOperation: {
      findUnique: vi.fn(async ({ where }) => recorded.get(where.operationKey) ?? null),
      findFirst: vi.fn(async ({ where }) => [...openings].reverse().find((entry) => !where.OR || !entry.payload.reopened || entry.payload.reusedEmpty) ?? null),
      findMany: vi.fn(async () => scans),
      create: vi.fn(async ({ data }) => { if (recorded.has(data.operationKey)) throw new Error('duplicate key'); recorded.set(data.operationKey, data); return data; }),
    },
    stockMovement: { findMany: vi.fn(async () => movements) },
  };
  let tail = Promise.resolve();
  const prisma = { $transaction: vi.fn((task: (value: typeof tx) => Promise<unknown>) => {
    const run = tail.then(async () => {
      const before = { ...box }; const beforeRecorded = new Map(recorded);
      try { return await task(tx); } catch (error) { Object.assign(box, before); recorded.clear(); beforeRecorded.forEach((v, k) => recorded.set(k, v)); throw error; }
    });
    tail = run.then(() => undefined, () => undefined); return run;
  }) };
  const scopes = { requireClientAccess: vi.fn() };
  const devices = { touchActiveDevice: vi.fn() };
  const service = new TsdReceiptService(prisma as never, scopes as never, devices as never);
  const close = (op = operation, actor = user) => (service as unknown as { closeBox(op: ScanOperationDto, actor: AuthUser): Promise<any> }).closeBox(op, actor);
  return { service, close, box, scans, openings, movements, recorded, tx, prisma, scopes, devices };
}

describe('ТСД: серверное закрытие конкретного принятого короба', () => {
  // TEST: receipt_scan alone previously left the box receiving; close must be explicit and auditable.
  it('activates the received box without another receipt and records closure atomically', async () => {
    const f = fixture();
    expect(await f.close()).toMatchObject({ operationKey: 'close-1', status: 'APPLIED' });
    expect(f.box.status).toBe('active');
    expect(f.tx.box.updateMany).toHaveBeenCalledWith({ where: { id: 'box-1', status: 'receiving' }, data: { status: 'active' } });
    expect(f.recorded.get('close-1')?.operationType).toBe('receipt_close');
    expect([...f.recorded.values()].some((v) => v.operationType === 'receipt_box_status' && v.payload.status === 'active')).toBe(true);
    expect(f.scopes.requireClientAccess).toHaveBeenCalledWith(user, 'client-1', 'write');
    expect(f.movements).toHaveLength(2);
  });

  it('does not wait for another box in the same receipt batch', async () => {
    const f = fixture();
    expect(await f.close()).toMatchObject({ status: 'APPLIED' });
    expect(f.tx.tsdOperation.findMany.mock.calls[0][0]).toMatchObject({ where: { operationKey: { in: ['scan-1', 'scan-2'] } } });
  });

  it.each(['missing', 'rejected', 'needs-review', 'missing-movement'])('retries %s dependency without persisting a permanent close result', async (problem) => {
    const f = fixture();
    if (problem === 'missing') f.scans.pop();
    if (problem === 'rejected') f.scans[1].status = 'REJECTED';
    if (problem === 'needs-review') f.scans[1].status = 'NEEDS_REVIEW';
    if (problem === 'missing-movement') f.movements.pop();
    expect(await f.close()).toMatchObject({ status: 'RETRY' });
    expect(f.box.status).toBe('receiving'); expect(f.recorded.size).toBe(0);
  });

  it.each(['device', 'client', 'box', 'source', 'movement-warehouse', 'movement-box'])('rejects %s dependency from another scope', async (field) => {
    const f = fixture();
    if (field === 'device') f.scans[0].deviceId = 'OTHER';
    if (field === 'client') f.scans[0].payload.clientId = 'OTHER';
    if (field === 'box') f.scans[0].payload.boxCode = 'OTHER';
    if (field === 'source') f.scans[0].payload.sourceDocument = 'OTHER';
    if (field === 'movement-warehouse') f.movements[0].warehouseId = 'OTHER';
    if (field === 'movement-box') f.movements[0].boxId = 'OTHER';
    await expect(f.close()).rejects.toThrow(); expect(f.box.status).toBe('receiving');
  });

  it.each(['archived', 'deleted', 'active'])('does not revive or silently adopt a %s box', async (status) => {
    const f = fixture(); f.box.status = status;
    await expect(f.close()).rejects.toThrow(); expect(f.box.status).toBe(status);
  });

  it('rejects a box in another warehouse', async () => {
    const f = fixture(); f.box.warehouseId = 'other';
    await expect(f.close()).rejects.toThrow(); expect(f.box.status).toBe('receiving');
  });

  it('repeat after later archival is idempotent and does not reactivate the box', async () => {
    const f = fixture(); await f.close(); f.box.status = 'archived';
    expect(await f.close()).toMatchObject({ status: 'ALREADY_APPLIED' });
    expect(f.box.status).toBe('archived'); expect(f.tx.box.updateMany).toHaveBeenCalledTimes(1);
  });

  it('concurrent duplicate close requests perform one activation and one closure audit', async () => {
    const f = fixture(); const results = await Promise.all([f.close(), f.close()]);
    expect(results.map((r) => r.status)).toEqual(['APPLIED', 'ALREADY_APPLIED']);
    expect(f.tx.box.updateMany).toHaveBeenCalledTimes(1); expect(f.recorded.size).toBe(2);
    expect(f.tx.$queryRaw).toHaveBeenCalled();
  });

  it('rolls back activation if writing the closure audit fails', async () => {
    const f = fixture(); f.tx.tsdOperation.create.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.close()).rejects.toThrow('database unavailable');
    expect(f.box.status).toBe('receiving'); expect(f.recorded.size).toBe(0);
  });

  // TEST: an idempotency collision must not acknowledge a different receipt quantity.
  it('rejects a receipt movement whose quantity differs from the accepted scan', async () => {
    const f = fixture(); f.movements[0].quantity = 10;
    await expect(f.close()).rejects.toThrow(); expect(f.box.status).toBe('receiving');
  });

  it('a pending close succeeds after its missing scan arrives, without a new close key', async () => {
    const f = fixture(); const pending = f.scans.pop()!;
    expect(await f.close()).toMatchObject({ status: 'RETRY' }); f.scans.push(pending);
    expect(await f.close()).toMatchObject({ status: 'APPLIED' }); expect(f.recorded.size).toBe(2);
  });

  it('rejects a replay of the same close key with a different dependency list', async () => {
    const f = fixture(); await f.close();
    await expect(f.close({ ...operation, payload: { ...payload, receiptOperationKeys: '["scan-1"]' } })).rejects.toThrow();
    expect(f.tx.box.updateMany).toHaveBeenCalledTimes(1);
  });

  // TEST: old accepted scans cannot close the same box after it was emptied and reused.
  it('rejects a delayed old close after the box starts a new receipt generation', async () => {
    const f = fixture(); f.openings[0].createdAt = new Date('2026-09-10T08:02:00Z');
    f.openings[0].payload.reopened = true; f.openings[0].payload.reusedEmpty = true;
    await expect(f.close()).rejects.toThrow(); expect(f.box.status).toBe('receiving');
  });

  it('rejects a close superseded by another receipt session or device opening the box', async () => {
    const f = fixture(); f.openings[0].payload.sourceDocument = 'NEW-SESSION';
    await expect(f.close()).rejects.toThrow(); expect(f.box.status).toBe('receiving');
  });

  it('normal resume does not invalidate scans accepted before reopening the receiving box', async () => {
    const f = fixture(); f.openings.push({ ...f.openings[0], createdAt: new Date('2026-09-10T08:02:00Z'), payload: { ...f.openings[0].payload, reopened: true } });
    expect(await f.close()).toMatchObject({ status: 'APPLIED' });
  });

  it('waits without closing if the receipt opening has no auditable generation', async () => {
    const f = fixture(); f.openings.splice(0);
    expect(await f.close()).toMatchObject({ status: 'RETRY' }); expect(f.recorded.size).toBe(0);
  });

  it('rejects an unauthenticated or different device before querying receipt data', async () => {
    const f = fixture(); await expect(f.close(operation, { ...user, deviceCode: 'OTHER' })).rejects.toThrow();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('enforces client access before querying receipt data', async () => {
    const f = fixture(); f.scopes.requireClientAccess.mockImplementation(() => { throw new Error('access denied'); });
    await expect(f.close()).rejects.toThrow('access denied'); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a warehouse outside the writable scope', async () => {
    const f = fixture(); await expect(f.close(operation, { ...user, writableWarehouseIds: [] })).rejects.toThrow();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires a selected warehouse even for an administrator', async () => {
    const f = fixture(); await expect(f.close(operation, { ...user, permissionCodes: ['system:admin'], activeWarehouseId: null })).rejects.toThrow();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['[]', '["scan-1","scan-1"]', 'broken', '[42]'])('rejects malformed/empty dependencies %s', async (receiptOperationKeys) => {
    const f = fixture(); await expect(f.close({ ...operation, payload: { ...payload, receiptOperationKeys } })).rejects.toThrow();
    expect(f.box.status).toBe('receiving');
  });

  it('sync dispatches close before the generic cached-result path and preserves RETRY', async () => {
    const f = fixture(); f.scans.pop();
    const log = { findExisting: vi.fn(), recordResult: vi.fn() };
    const sync = new TsdSyncService({} as never, f.devices as never, {} as never, f.scopes as never, {} as never, log as never, undefined, f.service);
    expect(await sync.acceptOperation(operation, user)).toMatchObject({ status: 'RETRY' });
    expect(log.findExisting).not.toHaveBeenCalled(); expect(log.recordResult).not.toHaveBeenCalled();
  });

  it('the HTTP operation DTO accepts receipt_close', async () => {
    expect(await validate(Object.assign(new ScanDto(), operation))).toEqual([]);
  });

  it('closes a 1000-scan Android packet without considering unrelated operations', async () => {
    const f = fixture(); const scanTemplate = f.scans[0], movementTemplate = f.movements[0];
    f.scans.splice(0); f.movements.splice(0);
    for (let i = 0; i < 1000; i++) {
      f.scans.push({ ...scanTemplate, operationKey: `scan-${i}` });
      f.movements.push({ ...movementTemplate, idempotencyKey: `scan-${i}` });
    }
    const receiptOperationKeys = JSON.stringify(f.scans.map((scan) => scan.operationKey));
    expect(await f.close({ ...operation, payload: { ...payload, receiptOperationKeys } })).toMatchObject({ status: 'APPLIED' });
    expect(f.movements).toHaveLength(1000);
  });

  it('sync reports transient database failure as nonterminal RETRY without leaking diagnostics', async () => {
    const f = fixture(); f.tx.tsdOperation.create.mockRejectedValueOnce(new Error('private database detail'));
    const log = { findExisting: vi.fn(), recordResult: vi.fn() };
    const sync = new TsdSyncService({} as never, f.devices as never, {} as never, f.scopes as never, {} as never, log as never, undefined, f.service);
    const result = await sync.acceptOperation(operation, user);
    expect(result.status).toBe('RETRY'); expect(result.message).not.toContain('private database detail');
    expect(f.box.status).toBe('receiving'); expect(log.recordResult).not.toHaveBeenCalled();
  });

  it('sync rejects a foreign device without persisting an operation under its key', async () => {
    const f = fixture(); const log = { findExisting: vi.fn(), recordResult: vi.fn() };
    const sync = new TsdSyncService({} as never, f.devices as never, {} as never, f.scopes as never, {} as never, log as never, undefined, f.service);
    expect(await sync.acceptOperation(operation, { ...user, deviceCode: 'OTHER' })).toMatchObject({ status: 'REJECTED' });
    expect(f.recorded.size).toBe(0); expect(log.recordResult).not.toHaveBeenCalled();
  });
});
