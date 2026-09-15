import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { physicalPickConfirmationEnabled, withFbsTsdCapability } from '../src/modules/marketplace-connections/fbs-physical-pick';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { TsdDeviceController } from '../src/modules/tsd/tsd-device.controller';

const user = { id: 'worker', email: 'worker@example.test', name: 'Worker', roleCodes: ['EMPLOYEE'],
  permissionCodes: ['stock:write'], clientScopeMode: 'ALL' as const, clientIds: [], writableClientIds: [] };
const capable = withFbsTsdCapability(user, 'physical-pick-v1');
afterEach(() => vi.unstubAllEnvs());

function fixture(marketplace = 'OZON', overrides: Record<string, unknown> = {}) {
  let task: any = { id: 'task', marketplace, orderId: 'order', itemCount: 1, scannedItemCount: 1,
    clientId: 'client', connectionId: 'connection', requestId: 'request', requestItemId: 'item',
    skuId: 'sku', barcodes: ['1234567890123'], barcode: '1234567890123', boxId: 'box', boxCode: 'FFL_BOX',
    status: 'IN_PROGRESS', requiresKiz: false, marketplaceSubmittedAt: new Date(), ...overrides };
  const update = vi.fn(async ({ data }) => (task = { ...task, ...data }));
  const db: any = { fbsTsdAssembly: { findUnique: vi.fn(async () => task), update,
    aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 0 } }) },
    client: { findUnique: vi.fn().mockResolvedValue(null) }, sku: { findUnique: vi.fn().mockResolvedValue(null) },
    clientRequest: { findUnique: vi.fn().mockResolvedValue({ id: 'request', number: 697, status: 'IN_WORK', warehouseId: 'warehouse' }) },
    clientRequestItem: { findUnique: vi.fn().mockResolvedValue({ id: 'item', skuId: 'sku', quantity: 1 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }) },
    clientRequestBoxSelection: { upsert: vi.fn() }, clientRequestEvent: { create: vi.fn() },
    clientMarketplaceConnection: { findUnique: vi.fn().mockResolvedValue(null) } };
  db.$transaction = vi.fn(async (fn) => fn(db));
  const service: any = new MarketplaceConnectionsService(db, {} as never);
  vi.spyOn(service, 'loadOwnedFbsTsdAssembly').mockImplementation(async () => task);
  vi.spyOn(service, 'requireFbsOrderStillCollectable').mockResolvedValue(undefined);
  vi.spyOn(service, 'reserveCompletedWildberriesStock').mockResolvedValue(undefined);
  vi.spyOn(service, 'fbsTsdCompletedToday').mockResolvedValue(0);
  vi.spyOn(service, 'fbsTsdStickerHistory').mockResolvedValue([]);
  vi.spyOn(service, 'fbsTsdSourceBoxUsage').mockResolvedValue(null);
  const label = vi.spyOn(service, 'loadFbsTsdOrderSticker').mockImplementation(async () => { throw new Error('label service unavailable'); });
  const submit = vi.spyOn(service, 'submitOzonFbsTask').mockImplementation(async () => update({ data: { marketplaceSubmittedAt: new Date() } }));
  return { service, db, label, submit, task: () => task };
}

describe('FBS physical pick confirmation', () => {
  // TEST: a missing Ozon label must not trigger a fetch or block picking.
  it('offers Ozon physical confirmation without loading a label', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    const f = fixture('OZON');
    const result = await f.service.formatFbsTsdAssembly(f.task(), capable, '');
    expect(result.state).toBe('READY_TO_COMPLETE');
    expect(result.task.physicalPickConfirmation).toBe(true);
    expect(result.task.orderSticker).toBeNull();
    expect(f.label).not.toHaveBeenCalled();
    const completed = await f.service.completeFbsTsdAssembly('task', capable);
    expect(completed.state).toBe('COMPLETED');
    expect(f.label).not.toHaveBeenCalled();
  });
  // TEST: WB still prepares sticker identifiers for cargo packing; only the display changes.
  it('preserves WB sticker preparation but never sends its image to the updated terminal', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    const f = fixture('WILDBERRIES');
    f.label.mockResolvedValue({ partB: '1234', barcode: 'wb-order', imageBase64: 'large-image' });
    const result = await f.service.formatFbsTsdAssembly(f.task(), capable, '');
    expect(result.state).toBe('READY_TO_COMPLETE');
    expect(result.task.physicalPickConfirmation).toBe(true);
    expect(result.task.orderSticker).toBeNull();
    expect(f.label).toHaveBeenCalledOnce();
    f.label.mockResolvedValue(null);
    expect((await f.service.formatFbsTsdAssembly(f.task(), capable, '')).state).toBe('READY_TO_COMPLETE');
    expect((await f.service.completeFbsTsdAssembly('task', capable)).state).toBe('COMPLETED');
  });
  it('submits an Ozon order and completes picking with one confirmation', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    const f = fixture('OZON', { marketplaceSubmittedAt: null });
    const initial = await f.service.formatFbsTsdAssembly(f.task(), capable, '');
    expect(initial.state).toBe('READY_TO_COMPLETE');
    const result = await f.service.completeFbsTsdAssembly('task', capable);
    expect(f.submit).toHaveBeenCalledOnce();
    expect(result.state).toBe('COMPLETED');
    expect(f.label).not.toHaveBeenCalled();
  });
  it('still rejects missing KIZs and unscanned Ozon units', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const marked = fixture('WILDBERRIES', { requiresKiz: true, kiz: null, wbMetaStatus: 'PENDING' });
    await expect(marked.service.completeFbsTsdAssembly('task', capable)).rejects.toThrow('КИЗ');
    const incomplete = fixture('OZON', { itemCount: 2 });
    await expect(incomplete.service.completeFbsTsdAssembly('task', capable)).rejects.toThrow('1 из 2');
    expect(incomplete.submit).not.toHaveBeenCalled();
  });
  it('does not complete when Ozon rejects submission', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    const f = fixture('OZON', { marketplaceSubmittedAt: null });
    f.submit.mockRejectedValue(new Error('Ozon rejected order'));
    await expect(f.service.completeFbsTsdAssembly('task', capable)).rejects.toThrow('Ozon rejected order');
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it('preserves old terminals and the sold deployment', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    const f = fixture();
    f.label.mockResolvedValue(null);
    expect((await f.service.formatFbsTsdAssembly(f.task(), user, '')).state).toBe('WAIT_MARKETPLACE_LABEL');
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'false');
    expect(physicalPickConfirmationEnabled(f.task(), capable)).toBe(false);
  });
  it('adds capability without changing worker identity or permissions', () => {
    expect(capable.id).toBe(user.id);
    expect(capable.permissionCodes).toEqual(user.permissionCodes);
    expect('tsdPhysicalPickConfirmation' in user).toBe(false);
    expect(withFbsTsdCapability(user, undefined).tsdPhysicalPickConfirmation).toBe(false);
  });
  // TEST: WB completion performs the same stock/accounting operations in both UI modes.
  it('preserves WB completion and prevents a duplicate confirmation from counting stock twice', async () => {
    vi.stubEnv('WMS_TSD_PHYSICAL_PICK_CONFIRMATION', 'true');
    const old = fixture('WILDBERRIES', { requiresKiz: true, kiz: 'kiz', wbMetaStatus: 'ACCEPTED', marketplaceSubmittedAt: new Date('2026-09-16T00:00:00Z') });
    const updated = fixture('WILDBERRIES', { requiresKiz: true, kiz: 'kiz', wbMetaStatus: 'ACCEPTED', marketplaceSubmittedAt: new Date('2026-09-16T00:00:00Z') });
    await old.service.completeFbsTsdAssembly('task', user);
    await updated.service.completeFbsTsdAssembly('task', capable);
    expect(updated.db.clientRequestBoxSelection.upsert.mock.calls).toEqual(old.db.clientRequestBoxSelection.upsert.mock.calls);
    expect(updated.service.reserveCompletedWildberriesStock).toHaveBeenCalledOnce();
    expect(updated.service.reserveCompletedWildberriesStock.mock.calls[0].slice(1)).toEqual(
      old.service.reserveCompletedWildberriesStock.mock.calls[0].slice(1));
    expect(updated.submit).not.toHaveBeenCalled();
    await updated.service.completeFbsTsdAssembly('task', capable);
    expect(updated.db.clientRequestBoxSelection.upsert).toHaveBeenCalledOnce();
    expect(updated.service.reserveCompletedWildberriesStock).toHaveBeenCalledOnce();
  });
  // TEST: exercise Nest's actual route-parameter factories, including scan and completion.
  it.each(['getNextFbsAssembly', 'scanFbsBox', 'scanFbsCode', 'scanFbsBarcode', 'scanFbsKiz',
    'validateFbsStockAudit', 'undoFbsKiz', 'completeFbsAssembly', 'releaseFbsAssembly'])(
    'passes the terminal capability through %s without modifying authentication', method => {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TsdDeviceController, method);
      const factories = Object.values(args).filter((arg: any) => typeof arg.factory === 'function') as any[];
      expect(factories).toHaveLength(1);
      const context = (headers: Record<string, string>) => ({ switchToHttp: () => ({ getRequest: () => ({ user, headers }) }) });
      expect(factories[0].factory(undefined, context({ 'x-tsd-fbs-capability': 'physical-pick-v1' }))).toEqual(capable);
      expect(factories[0].factory(undefined, context({}))).toEqual({ ...user, tsdPhysicalPickConfirmation: false });
    });
});
