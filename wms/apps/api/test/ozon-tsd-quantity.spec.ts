import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

// TEST: use the public scan/complete entry points, including hardware /scan.
function fixture(overrides: Record<string, unknown> = {}) {
  let task: any = { id: 'task', marketplace: 'OZON', orderId: '0115964331-0187-1',
    clientId: 'client', connectionId: 'connection', requestId: 'request', skuId: 'sku',
    productName: 'Аккумулятор', barcodes: ['2046905830135'], itemCount: 2,
    scannedItemCount: 0, boxId: 'box', barcode: null, requiresKiz: false,
    status: 'IN_PROGRESS', ...overrides };
  const update = vi.fn(async ({ data }) => (task = { ...task, ...data }));
  const db: any = { fbsTsdAssembly: { update }, storagePallet: { findFirst: vi.fn().mockResolvedValue(null) } };
  const service = new MarketplaceConnectionsService(db, {} as never) as any;
  vi.spyOn(service, 'loadOwnedFbsTsdAssembly').mockImplementation(async () => task);
  vi.spyOn(service, 'requireFbsOrderStillCollectable').mockResolvedValue(undefined);
  vi.spyOn(service, 'formatFbsTsdAssembly').mockImplementation(async (row: any) => row);
  const submit = vi.spyOn(service, 'submitOzonFbsTask').mockImplementation(async (row: any) => row);
  return { service, update, submit, task: () => task };
}
const user = { id: 'worker' } as never;
afterEach(() => vi.unstubAllEnvs());
describe('Ozon TSD per-unit picking', () => {
  it('requires two physical scans before submitting a two-unit order', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture();
    await f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135', scannedItemCount: 0 }, user);
    expect(f.task().scannedItemCount).toBe(1);
    await expect(f.service.completeFbsTsdAssembly('task', user)).rejects.toThrow(/1 из 2/);
    expect(f.submit).not.toHaveBeenCalled();
    await f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135', scannedItemCount: 1 }, user);
    expect(f.task().scannedItemCount).toBe(2);
    await f.service.completeFbsTsdAssembly('task', user);
    expect(f.submit).toHaveBeenCalledOnce();
  });
  it('does not count a retried hardware request as a second unit', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture();
    const payload = { code: '2046905830135', scannedItemCount: 0 };
    await f.service.scanFbsTsdCode('task', payload, user);
    await f.service.scanFbsTsdCode('task', payload, user);
    expect(f.task().scannedItemCount).toBe(1);
    expect(f.update).toHaveBeenCalledOnce();
  });
  it('rejects a wrong barcode without increasing the count', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture({ barcode: '2046905830135', scannedItemCount: 1 });
    await expect(f.service.scanFbsTsdBarcode('task', { barcode: '1234567890123', scannedItemCount: 1 }, user)).rejects.toThrow('Неверный товар');
    expect(f.update).not.toHaveBeenCalled();
  });
  it('requires an updated terminal rather than counting an unversioned retry', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture();
    await expect(f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135' }, user)).rejects.toThrow(/Обновите/);
    expect(f.update).not.toHaveBeenCalled();
  });
  it('preserves the sold deployment and WB scan behavior', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'false');
    const f = fixture();
    await f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135' }, user);
    expect(f.task().scannedItemCount).toBe(0);
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const wb = fixture({ marketplace: 'WILDBERRIES', itemCount: 1 });
    await wb.service.scanFbsTsdBarcode('task', { barcode: '2046905830135' }, user);
    expect(wb.task().scannedItemCount).toBe(0);
  });
  it('restores legacy progress as one unit and caps scans at the order quantity', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture({ barcode: '2046905830135', scannedItemCount: 0 });
    await expect(f.service.completeFbsTsdAssembly('task', user)).rejects.toThrow('1 из 2');
    await f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135', scannedItemCount: 1 }, user);
    await f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135', scannedItemCount: 2 }, user);
    expect(f.task().scannedItemCount).toBe(2);
    expect(f.update).toHaveBeenCalledOnce();
  });
  it('does not submit a marked multi-unit order using a single KIZ', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture({ barcode: '2046905830135', scannedItemCount: 2, requiresKiz: true, kiz: 'mark', wbMetaStatus: 'ACCEPTED' });
    await expect(f.service.completeFbsTsdAssembly('task', user)).rejects.toThrow('несколькими КИЗами');
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('blocks direct WMS submission before making any marketplace call', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const service: any = new MarketplaceConnectionsService({} as never, {} as never);
    await expect(service.submitOzonFbsTask(fixture({ barcode: '2046905830135', scannedItemCount: 1 }).task())).rejects.toThrow('1 из 2');
  });
  it.each([3, 25])('requires every scan in an order of %i identical units', async (quantity) => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = fixture({ itemCount: quantity });
    for (let count = 0; count < quantity; count++) {
      await expect(f.service.completeFbsTsdAssembly('task', user)).rejects.toThrow(`${count} из ${quantity}`);
      await f.service.scanFbsTsdBarcode('task', { barcode: '2046905830135', scannedItemCount: count }, user);
    }
    expect(f.task().scannedItemCount).toBe(quantity);
    await f.service.completeFbsTsdAssembly('task', user);
    expect(f.submit).toHaveBeenCalledOnce();
  });
});

// TEST: exercise the real response formatter, including a label cached before the update.
describe('Ozon terminal response', () => {
  function responseFixture() {
    const total = vi.fn().mockResolvedValue({ _sum: { quantity: 2, itemCount: 0 } });
    const db: any = { client: { findUnique: vi.fn().mockResolvedValue(null) },
      sku: { findUnique: vi.fn().mockResolvedValue(null) },
      clientRequest: { findUnique: vi.fn().mockResolvedValue({ number: 697 }) },
      clientRequestItem: { aggregate: total }, fbsTsdAssembly: { aggregate: total },
      clientMarketplaceConnection: { findUnique: vi.fn().mockResolvedValue(null) } };
    const service: any = new MarketplaceConnectionsService(db, {} as never);
    vi.spyOn(service, 'fbsTsdCompletedToday').mockResolvedValue(0);
    vi.spyOn(service, 'fbsTsdStickerHistory').mockResolvedValue([]);
    vi.spyOn(service, 'fbsTsdSourceBoxUsage').mockResolvedValue(null);
    const label = vi.spyOn(service, 'loadFbsTsdOrderSticker').mockResolvedValue({ marketplace: 'OZON', barcode: 'order', imageBase64: 'large-bitmap' });
    return { service, label, task: fixture({ barcode: '2046905830135', scannedItemCount: 1,
      marketplaceSubmittedAt: new Date(), marketplaceLabelBase64: 'cached-bitmap' }).task() };
  }
  it('keeps a partially picked order at SCAN_BARCODE even with a cached label', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = responseFixture();
    const response = await f.service.formatFbsTsdAssembly(f.task, user, '');
    expect(response.state).toBe('SCAN_BARCODE');
    expect(response.task.scannedItemCount).toBe(1);
    expect(f.label).not.toHaveBeenCalled();
  });
  it('preserves the label for terminals without physical-pick capability', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    const f = responseFixture();
    const response = await f.service.formatFbsTsdAssembly({ ...f.task, scannedItemCount: 2 }, user, '');
    expect(response.state).toBe('READY_TO_COMPLETE');
    expect(response.task.orderSticker.imageBase64).toBe('large-bitmap');
    expect(response.task.orderId).toBe('0115964331-0187-1');
  });
  it('keeps label rendering and a numeric response for the sold deployment', async () => {
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'false');
    const f = responseFixture();
    const response = await f.service.formatFbsTsdAssembly(f.task, user, '');
    expect(response.task.perUnitScanning).toBe(false);
    expect(response.task.scannedItemCount).toBe(0);
    expect(response.task.orderSticker.imageBase64).toBe('large-bitmap');
  });
});
