import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FbsReshipmentService } from '../src/modules/marketplace-connections/fbs-reshipment.service';
import type { AuthUser } from '../src/modules/auth/auth.types';
import { Prisma } from '@prisma/client';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: a fake WB gateway and durable fake journal exercise retries without real WB/stock mutations.
describe('WB reshipment journal', () => {
  const user = { id: 'admin', name: 'Admin', roleCodes: ['ADMIN'], activeWarehouseId: 'warehouse', writableWarehouseIds: ['warehouse'] } as AuthUser;
  const now = new Date('2026-09-10T10:00:00Z');
  let db: any, wb: any, service: FbsReshipmentService, runs: any[], task: any, link: any;
  const dto = { clientId: 'client', orders: [{ id: 'order', connectionId: 'connection' }], mode: 'SAME_ITEM' as const };
  beforeEach(() => {
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'true'); runs = [];
    task = { id: 'physical', clientId: 'client', connectionId: 'connection', orderId: 'order', requestId: 'old-request',
      requestItemId: 'old-item', marketplace: 'WILDBERRIES', supplyId: 'old-supply', skuId: 'sku', productName: 'Suit', article: 'Article',
      status: 'COMPLETED', requiresKiz: true, kiz: 'mark', barcode: 'barcode', barcodes: ['barcode'], itemCount: 1,
      completedAt: now, updatedAt: now, cargoPackingId: null, workerUserId: 'worker', workerName: 'Worker', wbMetaStatus: 'ACCEPTED' };
    link = { id: 'link', requestId: 'old-request', clientId: 'client', connectionId: 'connection', orderId: 'order',
      lastSupplierStatus: 'complete', lastCategory: 'shipped', lastSupplyId: 'old-supply', syncStatus: 'ACTIVE', updatedAt: now,
      request: { id: 'old-request', number: 712, status: 'SUBMITTED', warehouseId: 'warehouse' } };
    const matches = (r: any, w: any) => (!w.id || r.id === w.id) && (!w.fingerprint || r.fingerprint === w.fingerprint) &&
      (!w.clientId || r.clientId === w.clientId) && (!w.warehouseId || r.warehouseId === w.warehouseId) &&
      (!w.leaseToken || r.leaseToken === w.leaseToken) && (!w.status?.not || r.status !== w.status.not) &&
      (!w.phase || r.phase === w.phase) && (!w.previewToken || w.previewToken === r.previewToken) && (!w.mode || w.mode === r.mode) &&
      (!w.leaseUntil?.gt || new Date(r.leaseUntil) > w.leaseUntil.gt) && (!w.OR || !r.leaseUntil || new Date(r.leaseUntil) < new Date());
    db = {
      client: { findUnique: vi.fn(async () => ({ id: 'client', isDemo: false })) },
      warehouse: { findFirst: vi.fn(async () => ({ id: 'warehouse', isActive: true })) },
      fbsOrderRequestLink: { findMany: vi.fn(async () => [link]), updateMany: vi.fn(async ({ data }) => { Object.assign(link, data); return { count: 1 }; }) },
      fbsTsdAssembly: { findMany: vi.fn(async () => [task]), updateMany: vi.fn(async ({ data }) => { Object.assign(task, data); return { count: 1 }; }) },
      fbsReshipmentRun: {
        findUnique: vi.fn(async ({ where }) => runs.find(r => matches(r, where)) ?? null),
        findFirst: vi.fn(async ({ where }) => runs.find(r => matches(r, where)) ?? null),
        findMany: vi.fn(async () => runs),
        create: vi.fn(async ({ data }) => { const r = { phase: 'PLANNED', status: 'PENDING', supplyId: null, requestId: null,
          leaseToken: null, leaseUntil: null, createdAt: now, ...data }; runs.push(r); return r; }),
        updateMany: vi.fn(async ({ where, data }) => { const r = runs.find(r => matches(r, where)); if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; }),
        update: vi.fn(async ({ where, data }) => { const r = runs.find(r => matches(r, where)); Object.assign(r, data); return r; }),
      },
      fbsReshipmentClaim: { createMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []) },
      clientRequest: { create: vi.fn(async ({ data }) => ({ id: 'new-request', number: 900, ...data,
        items: data.items.create.map((item: any, i: number) => ({ id: `new-item-${i}`, ...item })) })),
        findUnique: vi.fn(async () => ({ id: 'new-request', number: 900 })) },
      fbsAssemblyAttemptHistory: { create: vi.fn(async () => ({})) },
      fbsSupplyPlan: { findMany: vi.fn(async () => [{ id: 'old-plan', clientId: 'client', connectionId: 'connection', supplyId: 'old-supply',
        deliveryDestination: 'PICKUP_POINT', marketplaceWarehouseId: 'wb-warehouse', marketplaceWarehouseName: 'WB Warehouse',
        destinationOfficeId: 'office', destinationOfficeName: 'Office', itemsPerCargoPlace: 100 }]), create: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => ({})), findMany: vi.fn(async () => []) }, clientRequestEvent: { create: vi.fn(async () => ({})) },
      stockBalance: { update: vi.fn() }, stockMovement: { create: vi.fn() }, productMark: { update: vi.fn() },
      $queryRaw: vi.fn(async () => []),
    };
    db.$transaction = vi.fn(async (fn: any) => {
      const before = structuredClone(runs);
      try { return await fn(db); } catch (error) { runs.splice(0, runs.length, ...before); throw error; }
    });
    wb = { readReshipmentWbCandidates: vi.fn(async () => [{ id: 'order', connectionId: 'connection', supplyId: 'old-supply' }]),
      readReshipmentWbStatuses: vi.fn(async () => new Map([['order', { supplierStatus: 'complete', wbStatus: 'waiting' }]])),
      findReshipmentWbSupply: vi.fn(async () => null), createReshipmentWbSupply: vi.fn(async () => 'new-supply'),
      readReshipmentWbSupply: vi.fn(async () => ({ id: 'new-supply', done: false, orderIds: [] })),
      addReshipmentWbOrders: vi.fn(async () => {
        wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order'] });
        wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
      }), invalidateRepeatAssemblyCache: vi.fn(), finishStockTransferRequests: vi.fn(async () => undefined),
    };
    service = new FbsReshipmentService(db, { requireClientAccess: vi.fn() } as never, wb);
  });

  // TEST: a delivery order without stock uses the named supply, without reshipment-report evidence or stock deductions.
  it('routes an unpicked delivery order to the no-stock supply', async () => {
    vi.stubEnv('WMS_FBS_NO_STOCK_TRANSFER_ENABLED', 'true');
    Object.assign(task, { status: 'WAITING_STOCK', barcode: null, kiz: null, completedAt: null, workerUserId: null });
    wb.readReshipmentWbCandidates.mockResolvedValue([]);
    wb.prepareFbsStockTransfer = vi.fn(async () => ({ orders: [{ id: 'order', connectionId: 'connection',
      warehouseId: 'wb-warehouse', cargoType: '1', crossBorderType: '0', supplierStatus: 'complete',
      product: { id: 'sku' }, noStock: true }], skippedOrders: [] }));
    const result = await (service as any).moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0]).toMatchObject({ status: 'CREATED', supplyName: 'logoff нет на складе', orderCount: 1 });
    expect(wb.createReshipmentWbSupply).toHaveBeenCalledWith('client', 'connection', 'logoff нет на складе', user);
    expect(link.lastSupplierStatus).toBe('confirm');
    expect(task.status).toBe('WAITING_STOCK');
    expect(db.stockMovement.create).not.toHaveBeenCalled();
    expect(db.fbsAssemblyAttemptHistory.create).not.toHaveBeenCalled();
  });

  function setupStockTransfer() {
    vi.stubEnv('WMS_FBS_NO_STOCK_TRANSFER_ENABLED', 'true');
    Object.assign(task, { status: 'WAITING_STOCK', barcode: null, kiz: null, completedAt: null, workerUserId: null });
    wb.readReshipmentWbCandidates.mockResolvedValue([]);
    wb.prepareFbsStockTransfer = vi.fn(async () => ({ orders: [{ id: 'order', connectionId: 'connection',
      warehouseId: 'wb-warehouse', cargoType: '1', crossBorderType: '0', supplierStatus: 'complete',
      product: { id: 'sku' }, noStock: true }], skippedOrders: [] }));
    wb.moveFbsOrdersToNewSupply = vi.fn(async () => ({ moved: 1, targetSupply: { id: 'regular' } }));
  }
  // TEST: sold WMS uses precisely its previous code path when the flag is absent.
  it('keeps the legacy move unchanged with stock routing disabled', async () => {
    wb.moveFbsOrdersToNewSupply = vi.fn(async () => ({ moved: 1 }));
    expect(await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user)).toEqual({ moved: 1 });
    expect(wb.moveFbsOrdersToNewSupply).toHaveBeenCalledTimes(1);
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled();
  });
  // TEST: a lost fixed-name POST must not adopt someone else's same-name supply or create a duplicate.
  it('keeps an unknown no-stock supply POST in reconciliation on retry', async () => {
    setupStockTransfer();
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('timeout'));
    wb.findReshipmentWbSupply.mockResolvedValue({ id: 'unrelated-same-name', done: false, orderIds: [] });
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0].status).toBe('NEEDS_RECONCILIATION');
    const retry: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(retry.transfers[0].runId).toBe(result.transfers[0].runId);
    expect(wb.createReshipmentWbSupply).toHaveBeenCalledTimes(1);
    expect(wb.findReshipmentWbSupply).not.toHaveBeenCalled();
    expect(wb.addReshipmentWbOrders).not.toHaveBeenCalled();
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('recovers a lost order-move response by membership without another PATCH', async () => {
    setupStockTransfer();
    wb.addReshipmentWbOrders.mockImplementation(async () => {
      wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order'] });
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
      throw new Error('lost response');
    });
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0].status).toBe('NEEDS_RECONCILIATION');
    const recovered = await service.resume({ clientId: 'client', runId: result.transfers[0].runId }, user);
    expect(recovered.status).toBe('CREATED');
    expect(wb.addReshipmentWbOrders).toHaveBeenCalledTimes(1);
    expect(db.clientRequest.create).toHaveBeenCalledTimes(1);
  });
  it('does not finalize local state when WB refuses delivery transfer', async () => {
    setupStockTransfer(); wb.addReshipmentWbOrders.mockRejectedValue(new Error('WB 409'));
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0]).toMatchObject({ status: 'NEEDS_RECONCILIATION', errorMessage: 'WB 409' });
    expect(link.lastSupplyId).toBe('old-supply'); expect(task.requestId).toBe('old-request');
    expect(db.clientRequest.create).not.toHaveBeenCalled(); expect(db.stockMovement.create).not.toHaveBeenCalled();
  });
  it('partitions stock shortages from ordinary transfers and reports a failed ordinary group', async () => {
    setupStockTransfer();
    const prepare = wb.prepareFbsStockTransfer.getMockImplementation();
    wb.prepareFbsStockTransfer.mockImplementation(async () => {
      const selected = await prepare();
      return { ...selected, orders: [...selected.orders, { ...selected.orders[0], id: 'regular-order', noStock: false, supplierStatus: 'confirm' }] };
    });
    wb.moveFbsOrdersToNewSupply.mockRejectedValue(new Error('regular failed'));
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: [...dto.orders, { id: 'regular-order', connectionId: 'connection' }] }, user);
    expect(result.transfers[0].status).toBe('CREATED'); expect(result.errors[0]).toContain('regular failed');
    expect(wb.moveFbsOrdersToNewSupply.mock.calls[0][0].orders).toEqual([{ id: 'regular-order', connectionId: 'connection' }]);
    expect(wb.addReshipmentWbOrders.mock.calls[0][3]).toEqual(['order']);
  });
  it('transfers a delivery order with stock using an ordinary distinct supply name', async () => {
    setupStockTransfer();
    const prepare = wb.prepareFbsStockTransfer.getMockImplementation();
    wb.prepareFbsStockTransfer.mockImplementation(async () => { const value = await prepare(); value.orders[0].noStock = false; return value; });
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0].status).toBe('CREATED'); expect(result.transfers[0].supplyName).toMatch(/^WMS-RES-/);
    expect(wb.moveFbsOrdersToNewSupply).not.toHaveBeenCalled();
  });
  it('uses configured delivery defaults for a new order without a previous supply', async () => {
    setupStockTransfer(); task.supplyId = null; link.lastSupplyId = null;
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'new', wbStatus: 'waiting' }]]));
    wb.stockTransferDefaultDelivery = vi.fn(async () => ({ deliveryDestination: 'PICKUP_POINT', itemsPerCargoPlace: 100 }));
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0].status).toBe('CREATED'); expect(wb.stockTransferDefaultDelivery).toHaveBeenCalledWith('client');
    expect(wb.finishStockTransferRequests).toHaveBeenCalledWith('client', 'connection', 'new-supply', expect.arrayContaining([expect.objectContaining({ requestId: 'old-request' })]));
  });
  it('rejects a physical scan appearing after planning but before WB mutation', async () => {
    setupStockTransfer();
    db.fbsReshipmentClaim.createMany.mockImplementation(async () => { task.barcode = 'scanned'; return { count: 1 }; });
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0].status).toBe('NEEDS_RECONCILIATION');
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled(); expect(db.stockMovement.create).not.toHaveBeenCalled();
  });
  // TEST: the unique journal key must never be replaced by a repeating WB display name.
  it('retains a unique journal identity for the fixed WB name', async () => {
    setupStockTransfer();
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(runs[0].supplyName).toBe(`WMS-RES-${runs[0].id}`);
    expect(result.transfers[0].supplyName).toBe('logoff нет на складе');
    expect(db.auditLog.create.mock.calls[0][0].data.payload.additionalStockConsumptionConfirmed).toBe(false);
  });
  it('resumes source composition after local commit without repeating WB or creating a request', async () => {
    setupStockTransfer(); wb.finishStockTransferRequests.mockRejectedValueOnce(new Error('database busy'));
    const result: any = await service.moveWithStockRouting({ clientId: 'client', orders: dto.orders }, user);
    expect(result.transfers[0]).toMatchObject({ status: 'CREATED', sourceSyncPending: true });
    expect(result.transfers[0].errorMessage).toContain('database busy');
    const resumed = await service.resume({ clientId: 'client', runId: result.transfers[0].runId }, user);
    expect(resumed).toMatchObject({ status: 'CREATED', sourceSyncPending: false, errorMessage: null });
    expect(wb.finishStockTransferRequests).toHaveBeenCalledTimes(2);
    expect(wb.addReshipmentWbOrders).toHaveBeenCalledTimes(1); expect(db.clientRequest.create).toHaveBeenCalledTimes(1);
  });
  afterEach(() => vi.unstubAllEnvs());
  // TEST: a scoped client can use both approved modes, but never another tenant/branch or revoked access.
  const clientUser = { id: 'client-user', name: 'Client', email: 'client@example.invalid', roleCodes: ['CLIENT'],
    permissionCodes: ['client-requests:write'], clientScopeMode: 'LIMITED', clientIds: ['client'], writableClientIds: ['client'],
    activeWarehouseId: 'warehouse', writableWarehouseIds: ['warehouse'] } as AuthUser;
  it.each(['SAME_ITEM', 'NEW_ITEM'] as const)('allows scoped CLIENT check, preview, create and resume in %s', async mode => {
    expect(service.capabilities(clientUser)).toEqual({ enabled: true });
    expect((await service.check({ clientId: 'client' }, clientUser)).candidates).toHaveLength(1);
    const input = { ...dto, mode }; const preview = await service.preview(input, clientUser);
    const result = await service.create({ ...input, previewToken: preview.previewToken, confirm: true }, clientUser);
    expect(result.status).toBe('CREATED');
    // TEST: client confirmation must not be falsely attributed to an administrator.
    if (mode === 'NEW_ITEM') {
      expect(db.clientRequest.create.mock.calls[0][0].data.comment).toContain('Дополнительный расход подтверждён пользователем');
    }
    expect((await service.resume({ clientId: 'client', runId: result.runId }, clientUser)).runId).toBe(result.runId);
    expect(db.stockMovement.create).not.toHaveBeenCalled();
  });
  it('rechecks revoked client rights before create and resume', async () => {
    const preview = await service.preview(dto, clientUser);
    const revoked = { ...clientUser, permissionCodes: [] };
    await expect(service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, revoked)).rejects.toThrow();
    await expect(service.resume({ clientId: 'client', runId: 'run' }, revoked)).rejects.toThrow();
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled(); expect(db.fbsReshipmentRun.create).not.toHaveBeenCalled();
  });
  // TEST: client recovery must pass the real pending journal path, not only return an already-created run.
  it('allows own pending run recovery without another WB supply POST', async () => {
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('lost response'));
    const preview = await service.preview(dto, clientUser);
    const pending = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, clientUser);
    expect(pending.status).toBe('NEEDS_RECONCILIATION');
    wb.findReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: [] });
    const resumed = await service.resume({ clientId: 'client', runId: pending.runId }, clientUser);
    expect(resumed.status).toBe('CREATED'); expect(wb.createReshipmentWbSupply).toHaveBeenCalledTimes(1);
    expect(db.clientRequest.create).toHaveBeenCalledTimes(1); expect(db.stockMovement.create).not.toHaveBeenCalled();
  });
  it('rejects foreign tenant even with accidental ALL/system:admin and refuses foreign warehouse/run', async () => {
    const broad = { ...clientUser, clientScopeMode: 'ALL' as const, permissionCodes: [...clientUser.permissionCodes, 'system:admin'] };
    await expect(service.check({ clientId: 'foreign' }, broad)).rejects.toThrow();
    await expect(service.preview(dto, { ...clientUser, activeWarehouseId: 'foreign' })).rejects.toThrow();
    for (const row of [{ id: 'foreign', clientId: 'foreign', warehouseId: 'warehouse' }, { id: 'foreign-wh', clientId: 'client', warehouseId: 'foreign' }]) {
      runs.push(row);
      await expect(service.resume({ clientId: 'client', runId: row.id }, clientUser)).rejects.toThrow('не найдена');
    }
    expect(wb.readReshipmentWbCandidates).not.toHaveBeenCalled(); expect(wb.findReshipmentWbSupply).not.toHaveBeenCalled();
  });
  it('check is read-only, exposes previous request and two modes', async () => {
    const result = await service.check({ clientId: 'client' }, user);
    expect(result.candidates[0]).toMatchObject({ id: 'order', sourceRequestNumber: 712, eligibleModes: ['SAME_ITEM', 'NEW_ITEM'] });
    expect(db.fbsReshipmentRun.create).not.toHaveBeenCalled(); expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled();
  });
  // TEST: discovery reads history, but the work list must contain only current WB problems.
  it.each(['sold', 'canceled', 'canceled_by_client', 'declined_by_client', 'defect', 'canceled_by_carrier',
    'sorted', 'ready_for_pickup', 'postponed_delivery', 'accepted_by_carrier', 'sent_to_carrier'])(
    'hides %s orders even when the WB reshipment list still includes them', async wbStatus => {
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'complete', wbStatus }]]));
      expect(await service.check({ clientId: 'client' }, user)).toMatchObject({ candidates: [], unverifiedCount: 0 });
    });
  it.each(['cancel', 'cancel_carrier'])('hides supplier cancellation %s even with waiting WB state', async supplierStatus => {
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus, wbStatus: 'waiting' }]]));
    expect(await service.check({ clientId: 'client' }, user)).toMatchObject({ candidates: [], unverifiedCount: 0 });
  });
  // TEST: hiding a row is not authorization; forged selections and previously valid tokens remain blocked server-side.
  it.each([
    { supplierStatus: 'complete', wbStatus: 'sold' },
    { supplierStatus: 'complete', wbStatus: 'canceled' },
    { supplierStatus: 'complete', wbStatus: 'canceled_by_client' },
    { supplierStatus: 'complete', wbStatus: 'declined_by_client' },
    { supplierStatus: 'complete', wbStatus: 'defect' },
    { supplierStatus: 'complete', wbStatus: 'canceled_by_carrier' },
    { supplierStatus: 'cancel', wbStatus: 'waiting' },
    { supplierStatus: 'cancel_carrier', wbStatus: 'waiting' },
  ])('rejects manually submitted terminal/cancelled order %j before any WB mutation', async status => {
    const inputs = await Promise.all((['SAME_ITEM', 'NEW_ITEM'] as const).map(async mode => {
      const input = { ...dto, mode };
      return { ...input, previewToken: (await service.preview(input, user)).previewToken, confirm: true };
    }));
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', status]]));
    expect((await service.check({ clientId: 'client' }, user)).candidates).toEqual([]);
    for (const input of inputs) {
      await expect(service.preview(input, user)).rejects.toThrow('WB не подтверждает');
      await expect(service.create(input, user)).rejects.toThrow('WB не подтверждает');
      await expect(service.create({ ...input, previewToken: 'f'.repeat(64) }, user)).rejects.toThrow('WB не подтверждает');
    }
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled(); expect(wb.addReshipmentWbOrders).not.toHaveBeenCalled();
    expect(db.fbsReshipmentRun.create).not.toHaveBeenCalled(); expect(db.clientRequest.create).not.toHaveBeenCalled();
    expect(db.stockMovement.create).not.toHaveBeenCalled(); expect(db.productMark.update).not.toHaveBeenCalled();
  });
  it('still polls historical delivery orders but hides normal complete/waiting deliveries without reshipment proof', async () => {
    wb.readReshipmentWbCandidates.mockResolvedValue([]);
    expect(await service.check({ clientId: 'client' }, user)).toMatchObject({ candidates: [], unverifiedCount: 0 });
    expect(wb.readReshipmentWbStatuses).toHaveBeenCalledWith('client', 'connection', ['order'], user);
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
    expect((await service.check({ clientId: 'client' }, user)).candidates).toHaveLength(1);
  });
  it.each([null, { supplierStatus: 'complete', wbStatus: '' }, { supplierStatus: '', wbStatus: 'waiting' },
    { supplierStatus: 'future', wbStatus: 'waiting' }, { supplierStatus: 'complete', wbStatus: 'future' }])(
    'counts unavailable/unknown status %j separately without claiming an actionable order', async status => {
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map(status ? [['order', status]] : []));
      expect(await service.check({ clientId: 'client' }, user)).toMatchObject({ candidates: [], unverifiedCount: 1 });
    });
  it('keeps fresh WB-listed missing-local and mismatched-supply orders visible but unselectable', async () => {
    wb.readReshipmentWbCandidates.mockResolvedValue([{ id: 'order', connectionId: 'connection', supplyId: 'different-supply' }]);
    let result = await service.check({ clientId: 'client' }, user);
    expect(result.candidates).toHaveLength(1); expect(result.candidates[0].eligibleModes).toEqual([]);
    await expect(service.preview(dto, user)).rejects.toThrow('подтверждения');
    db.fbsTsdAssembly.findMany.mockResolvedValue([]);
    result = await service.check({ clientId: 'client' }, user);
    expect(result.candidates).toHaveLength(1); expect(result.candidates[0].eligibleModes).toEqual([]);
    expect(result.candidates[0].blockedReason).toContain('Нет подтверждённой сборки');
  });
  it.each([{ cargoPackingId: 'cargo' }, { status: 'IN_PROGRESS' }, { kiz: null }, { itemCount: 2 }])(
    'keeps fresh WB-confirmed local blockers %j for review', async changes => {
      Object.assign(task, changes);
      const result = await service.check({ clientId: 'client' }, user);
      expect(result.candidates).toHaveLength(1); expect(result.candidates[0].eligibleModes).toEqual([]);
      expect(result.candidates[0].blockedReason).toBeTruthy();
    });
  it('keeps independent unfinished runs visible when the related candidate is now cancelled', async () => {
    runs.push({ id: 'pending', status: 'NEEDS_RECONCILIATION', mode: 'SAME_ITEM', requestId: null, supplyId: null });
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'complete', wbStatus: 'canceled_by_client' }]]));
    const result = await service.check({ clientId: 'client' }, user);
    expect(result.candidates).toEqual([]);
    expect(result.runs).toEqual([expect.objectContaining({ runId: 'pending', status: 'NEEDS_RECONCILIATION' })]);
    expect(db.fbsReshipmentRun.updateMany).not.toHaveBeenCalled(); expect(wb.addReshipmentWbOrders).not.toHaveBeenCalled();
  });
  it('blocks feature off, nonadmin, demo and nonwritable warehouse before WB', async () => {
    for (const auth of [{ ...user, roleCodes: ['MANAGER'] }, { ...user, isDemo: true }, { ...user, writableWarehouseIds: [] }]) {
      await expect(service.check({ clientId: 'client' }, auth)).rejects.toThrow();
    }
    vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED', 'false'); await expect(service.check({ clientId: 'client' }, user)).rejects.toThrow();
    expect(wb.readReshipmentWbCandidates).not.toHaveBeenCalled();
  });
  it('rejects stale preview or absent confirmation before WB mutations', async () => {
    const preview = await service.preview(dto, user);
    await expect(service.create({ ...dto, previewToken: preview.previewToken, confirm: false }, user)).rejects.toThrow();
    task.kiz = 'changed-mark';
    await expect(service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user)).rejects.toThrow();
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled();
  });
  it('journals before remote POST and preserves SAME_ITEM physical identity and old composition', async () => {
    wb.createReshipmentWbSupply.mockImplementation(async () => { expect(runs[0].phase).toBe('WB_CREATE_STARTED'); return 'new-supply'; });
    const preview = await service.preview(dto, user);
    const result = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    expect(result.status).toBe('CREATED');
    expect(task).toMatchObject({ id: 'physical', status: 'COMPLETED', kiz: 'mark', workerUserId: 'worker', requestId: 'new-request', supplyId: 'new-supply' });
    expect(db.fbsAssemblyAttemptHistory.create).not.toHaveBeenCalled();
    expect(db.stockMovement.create).not.toHaveBeenCalled(); expect(db.stockBalance.update).not.toHaveBeenCalled(); expect(db.productMark.update).not.toHaveBeenCalled();
  });
  it('retries the original create response without creating a second supply/request', async () => {
    const preview = await service.preview(dto, user); const input = { ...dto, previewToken: preview.previewToken, confirm: true };
    const first = await service.create(input, user); const second = await service.create(input, user);
    expect(second.runId).toBe(first.runId); expect(wb.createReshipmentWbSupply).toHaveBeenCalledTimes(1); expect(db.clientRequest.create).toHaveBeenCalledTimes(1);
  });
  it('NEW_ITEM creates a fresh attempt and history but consumes nothing before physical scans', async () => {
    const input = { ...dto, mode: 'NEW_ITEM' as const }; const preview = await service.preview(input, user);
    expect(preview.additionalUnits).toBe(1);
    expect((await service.create({ ...input, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('CREATED');
    expect(task.id).not.toBe('physical'); expect(task).toMatchObject({ status: 'WAITING_STOCK', kiz: null, completedAt: null, barcode: null });
    expect(db.fbsAssemblyAttemptHistory.create).toHaveBeenCalledTimes(1); expect(db.stockMovement.create).not.toHaveBeenCalled();
  });
  it('uncertain supply POST remains reconciliation-only even when later name search returns none', async () => {
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('timeout'));
    const preview = await service.preview(dto, user);
    const first = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    expect(first.status).toBe('NEEDS_RECONCILIATION');
    const second = await service.resume({ clientId: 'client', runId: first.runId }, user);
    expect(second.status).toBe('NEEDS_RECONCILIATION'); expect(wb.createReshipmentWbSupply).toHaveBeenCalledTimes(1);
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('recovers a remote supply after lost POST response and does not repeat POST', async () => {
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('timeout'));
    const preview = await service.preview(dto, user); const first = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    wb.findReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: [] });
    expect((await service.resume({ clientId: 'client', runId: first.runId }, user)).status).toBe('CREATED');
    expect(wb.createReshipmentWbSupply).toHaveBeenCalledTimes(1);
  });
  it('reconciles membership after ambiguous PATCH before considering another PATCH', async () => {
    wb.addReshipmentWbOrders.mockImplementation(async () => {
      wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order'] });
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
      throw new Error('lost PATCH response');
    });
    const preview = await service.preview(dto, user); const first = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    expect((await service.resume({ clientId: 'client', runId: first.runId }, user)).status).toBe('CREATED');
    expect(wb.addReshipmentWbOrders).toHaveBeenCalledTimes(1);
  });
  it('offers NEW_ITEM for untouched tasks without duplicating an uncompleted physical attempt in history', async () => {
    Object.assign(task, { status: 'RESERVED', completedAt: null, barcode: null, kiz: null, workerUserId: null,
      reservedBoxId: 'source-box', reservedBoxCode: 'SOURCE', startedAt: null });
    expect((await service.check({ clientId: 'client' }, user)).candidates[0].eligibleModes).toEqual(['NEW_ITEM']);
    const input = { ...dto, mode: 'NEW_ITEM' as const }; const preview = await service.preview(input, user);
    expect((await service.create({ ...input, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('CREATED');
    expect(db.fbsAssemblyAttemptHistory.create).not.toHaveBeenCalled();
    expect(task).toMatchObject({ status: 'WAITING_STOCK', reservedBoxId: null });
  });
  it('detects confirmed return from exact persisted transition, not unrelated audit history', async () => {
    wb.readReshipmentWbCandidates.mockResolvedValue([]);
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
    Object.assign(link, { lastSupplierStatus: 'confirm', lastCategory: 'assembly', lastSupplyId: 'new-wb-supply' });
    const event = { entityId: 'link', payload: { clientId: 'client', connectionId: 'connection', orderId: 'order',
      requestId: 'old-request', assemblyId: 'physical', sourceSupplyId: 'old-supply', targetSupplyId: 'new-wb-supply',
      supplierStatusFrom: 'complete', supplierStatusTo: 'confirm', wbStatus: 'waiting' } };
    db.auditLog.findMany.mockResolvedValue([event]);
    expect((await service.check({ clientId: 'client' }, user)).candidates[0]?.eligibleModes).toEqual(['SAME_ITEM', 'NEW_ITEM']);
    event.payload.assemblyId = 'unrelated-attempt';
    expect((await service.check({ clientId: 'client' }, user)).candidates[0]?.eligibleModes ?? []).toEqual([]);
  });
  it('blocks overlapping per-order claims before any remote mutation', async () => {
    db.fbsReshipmentClaim.createMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('claim already owned', { code: 'P2002', clientVersion: 'test' }));
    const preview = await service.preview(dto, user);
    await expect(service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user)).rejects.toThrow('другую операцию');
    expect(runs).toHaveLength(0); expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled();
  });
  it('never resumes another client or warehouse run', async () => {
    runs.push({ id: 'other', clientId: 'other-client', warehouseId: 'warehouse' });
    await expect(service.resume({ clientId: 'client', runId: 'other' }, user)).rejects.toThrow('не найдена');
    expect(wb.findReshipmentWbSupply).not.toHaveBeenCalled();
  });
  it('does not mutate or finalize a run leased by another worker', async () => {
    runs.push({ id: 'leased', clientId: 'client', warehouseId: 'warehouse', status: 'PENDING',
      leaseToken: 'other-worker', leaseUntil: new Date(Date.now() + 60_000) });
    expect((await service.resume({ clientId: 'client', runId: 'leased' }, user)).status).toBe('PENDING');
    expect(wb.readReshipmentWbStatuses).not.toHaveBeenCalled();
  });
  it('does not commit a request when WB has not confirmed all memberships', async () => {
    wb.addReshipmentWbOrders.mockResolvedValue(undefined);
    const preview = await service.preview(dto, user);
    expect((await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('does not commit or take new stock if cancellation arrives after remote mutation', async () => {
    wb.addReshipmentWbOrders.mockImplementation(async () => {
      wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order'] });
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'cancel', wbStatus: 'canceled' }]]));
    });
    const preview = await service.preview(dto, user);
    expect((await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(db.clientRequest.create).not.toHaveBeenCalled(); expect(db.stockMovement.create).not.toHaveBeenCalled();
  });
  it('does not reuse a closed supply or a supply containing unrelated orders', async () => {
    wb.findReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['unexpected'] });
    wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['unexpected'] });
    const preview = await service.preview(dto, user);
    expect((await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(wb.addReshipmentWbOrders).not.toHaveBeenCalled();
  });
  it('does not wipe a concurrent picker start even if status remains RESERVED', async () => {
    Object.assign(task, { status: 'RESERVED', completedAt: null, barcode: null, kiz: null, workerUserId: null, startedAt: null });
    wb.addReshipmentWbOrders.mockImplementation(async () => {
      task.startedAt = new Date();
      wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order'] });
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['order', { supplierStatus: 'confirm', wbStatus: 'waiting' }]]));
    });
    const input = { ...dto, mode: 'NEW_ITEM' as const }; const preview = await service.preview(input, user);
    expect((await service.create({ ...input, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(db.clientRequest.create).not.toHaveBeenCalled();
  });
  it('rejects reuse of a preview token with a different submitted selection', async () => {
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('timeout'));
    const preview = await service.preview(dto, user);
    await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    await expect(service.create({ ...dto, orders: [{ id: 'other', connectionId: 'connection' }], previewToken: preview.previewToken, confirm: true }, user)).rejects.toThrow('состав');
  });
  it('revalidates physical state before remote writes on resumed operations', async () => {
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('timeout'));
    const preview = await service.preview(dto, user); const first = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    task.kiz = 'now-different';
    wb.findReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: [] });
    expect((await service.resume({ clientId: 'client', runId: first.runId }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(wb.addReshipmentWbOrders).not.toHaveBeenCalled();
  });
  it('does not move completed/waiting orders on resume after WB revokes reship eligibility', async () => {
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('timeout'));
    const preview = await service.preview(dto, user); const first = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    wb.readReshipmentWbCandidates.mockResolvedValue([]);
    wb.findReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: [] });
    expect((await service.resume({ clientId: 'client', runId: first.runId }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(wb.addReshipmentWbOrders).not.toHaveBeenCalled();
  });
  it('creates a fresh cargo-packing supply plan without old cargo ids or sent timestamps', async () => {
    const preview = await service.preview(dto, user); await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    expect(db.fbsSupplyPlan.create).toHaveBeenCalledWith({ data: expect.objectContaining({ supplyId: 'new-supply',
      deliveryDestination: 'PICKUP_POINT', orderIds: ['order'], cargoPlaceCount: 0 }) });
    expect(db.fbsSupplyPlan.create.mock.calls[0][0].data.sentToWbAt).toBeUndefined();
  });
  it('blocks before WB if the destination of the previous supply is unknown', async () => {
    db.fbsSupplyPlan.findMany.mockResolvedValue([]);
    await expect(service.preview(dto, user)).rejects.toThrow('назначени');
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled();
  });
  it('reloads durable create intent after acquiring an expired lease, never using stale PLANNED', async () => {
    const preview = await service.preview(dto, user);
    wb.createReshipmentWbSupply.mockRejectedValue(new Error('first outcome unknown'));
    const first = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    runs[0].phase = 'PLANNED';
    db.fbsReshipmentRun.findFirst.mockImplementation(async () => structuredClone(runs[0]));
    const original = db.fbsReshipmentRun.updateMany.getMockImplementation();
    db.fbsReshipmentRun.updateMany.mockImplementation(async (args: any) => {
      if (args.data.leaseToken) runs[0].phase = 'WB_CREATE_STARTED'; // predecessor committed intent before lease handover
      return original(args);
    });
    wb.createReshipmentWbSupply.mockClear();
    expect((await service.resume({ clientId: 'client', runId: first.runId }, user)).status).toBe('NEEDS_RECONCILIATION');
    expect(wb.createReshipmentWbSupply).not.toHaveBeenCalled();
  });
  it('never changes a committed request back to reconciliation if cache invalidation fails', async () => {
    wb.invalidateRepeatAssemblyCache.mockImplementation(() => { throw new Error('local cache failed'); });
    const preview = await service.preview(dto, user);
    const result = await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    expect(result.status).toBe('CREATED'); expect(result.requestId).toBe('new-request');
  });
  it('paginates candidate history instead of rejecting mature clients or truncating it', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ ...link, id: `link-${i}`, orderId: `historical-${i}` }));
    db.fbsOrderRequestLink.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([link]);
    const result = await service.check({ clientId: 'client' }, user);
    expect(result.candidates.find(row => row.id === 'order')?.eligibleModes).toEqual(['SAME_ITEM', 'NEW_ITEM']);
    expect(db.fbsOrderRequestLink.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'link-999' }, skip: 1 });
    expect(db.fbsOrderRequestLink.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([
      expect.objectContaining({ lastSupplierStatus: 'complete', lastCategory: 'shipped' }),
    ]));
  });
  it('partial membership moves only still-missing orders and creates one aggregate request item', async () => {
    const secondTask = { ...task, id: 'physical2', orderId: 'second' };
    const secondLink = { ...link, id: 'link2', orderId: 'second' };
    db.fbsTsdAssembly.findMany.mockResolvedValue([task, secondTask]);
    db.fbsOrderRequestLink.findMany.mockResolvedValue([link, secondLink]);
    db.fbsTsdAssembly.updateMany.mockImplementation(async ({ where, data }: any) => { Object.assign(where.id === task.id ? task : secondTask, data); return { count: 1 }; });
    db.fbsOrderRequestLink.updateMany.mockImplementation(async ({ where, data }: any) => { Object.assign(where.id === link.id ? link : secondLink, data); return { count: 1 }; });
    wb.readReshipmentWbCandidates.mockResolvedValue([{ id: 'order', connectionId: 'connection', supplyId: 'old-supply' }, { id: 'second', connectionId: 'connection', supplyId: 'old-supply' }]);
    wb.readReshipmentWbStatuses.mockResolvedValue(new Map(['order', 'second'].map(id => [id, { supplierStatus: 'complete', wbStatus: 'waiting' }])));
    wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order'] });
    wb.addReshipmentWbOrders.mockImplementation(async (_c: string, _connection: string, _s: string, orders: string[]) => {
      expect(orders).toEqual(['second']);
      wb.readReshipmentWbSupply.mockResolvedValue({ id: 'new-supply', done: false, orderIds: ['order', 'second'] });
      wb.readReshipmentWbStatuses.mockResolvedValue(new Map(['order', 'second'].map(id => [id, { supplierStatus: 'confirm', wbStatus: 'waiting' }])));
    });
    const input = { ...dto, orders: [...dto.orders, { id: 'second', connectionId: 'connection' }] };
    const preview = await service.preview(input, user);
    expect((await service.create({ ...input, previewToken: preview.previewToken, confirm: true }, user)).status).toBe('CREATED');
    expect(db.clientRequest.create.mock.calls[0][0].data.items.create).toHaveLength(1);
    expect(db.clientRequest.create.mock.calls[0][0].data.items.create[0].quantity).toBe(2);
  });
  it('NEW_ITEM immediately appears ready in the existing TSD request selector', async () => {
    const input = { ...dto, mode: 'NEW_ITEM' as const }; const preview = await service.preview(input, user);
    await service.create({ ...input, previewToken: preview.previewToken, confirm: true }, user);
    link.request = { id: 'new-request', number: 900, title: 'Repeat', status: 'IN_WORK',
      fbsEmergencyAssemblyAt: null, fbsEmergencyAssemblyByName: null, client: { id: 'client', code: 'C', name: 'Client' } };
    db.fbsTsdAssembly.findFirst = vi.fn(async () => null);
    db.fbsTsdAssembly.findMany.mockImplementation(async ({ where }: any) => where.status?.in?.includes(task.status) ? [task] : []);
    db.stockBalance.findMany = vi.fn(async () => [{ skuId: 'sku', clientId: 'client', boxId: 'available-box' }]);
    db.client.findMany = vi.fn(async () => []);
    const marketplace = new MarketplaceConnectionsService(db, { resolveClientFilter: () => 'client', requireClientAccess: vi.fn() } as never);
    const result = await marketplace.listFbsTsdRequests('tsd', user);
    expect(result.requests).toEqual([expect.objectContaining({ requestId: 'new-request', readyOrders: 1, awaitingWbConfirmation: 0, totalOrders: 1 })]);
  });
  it('SAME_ITEM is available in existing cargo packing, without becoming a fresh picker task', async () => {
    const preview = await service.preview(dto, user); await service.create({ ...dto, previewToken: preview.previewToken, confirm: true }, user);
    const newPlan = { id: 'new-plan', ...db.fbsSupplyPlan.create.mock.calls[0][0].data,
      createdAt: now, updatedAt: now, client: { id: 'client', code: 'C', name: 'Client' } };
    const newRequest = { id: 'new-request', number: 900, title: 'Delivery', status: 'IN_WORK',
      fbsEmergencyAssemblyAt: null, fbsEmergencyAssemblyByName: null, client: newPlan.client };
    link.request = newRequest;
    db.fbsSupplyPlan.findMany.mockResolvedValue([newPlan]);
    db.fbsCargoPlacePacking = { findMany: vi.fn(async () => []) };
    db.clientMarketplaceConnection = { findMany: vi.fn(async () => [{ id: 'connection' }]) };
    db.sku = { findMany: vi.fn(async () => [{ id: 'sku', color: null, size: null }]) };
    db.clientRequest.findMany = vi.fn(async () => [newRequest]);
    db.fbsTsdAssembly.findFirst = vi.fn(async () => null);
    const marketplace = new MarketplaceConnectionsService(db, { resolveClientFilter: () => 'client', requireClientAccess: vi.fn() } as never);
    const packing = await (marketplace as any).loadFbsCargoPackingData('client', 'PICKUP_POINT');
    expect(packing.summaries).toEqual([expect.objectContaining({ supplyId: 'new-supply', requestNumbers: [900],
      hasActiveRequest: true, totalPlannedItems: 1, completedItems: 1, remainingToPack: 1, waitingAssembly: 0 })]);
    const queue = await marketplace.listFbsTsdRequests('tsd', user);
    expect(queue.requests).toEqual([]);
  });
});
