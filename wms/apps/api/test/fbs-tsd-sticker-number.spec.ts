import { MarketplaceType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
// TEST: verify the physical screen contract on the actual compiled release as well.
const { MarketplaceConnectionsService } = process.env.FBS_RUNTIME_ENTRY
  ? createRequire(import.meta.url)(process.env.FBS_RUNTIME_ENTRY)
  : await import('../src/modules/marketplace-connections/marketplace-connections.service');
const worker = { id: 'worker-1', name: 'Сборщик', deviceCode: 'TSD-1' };
describe('WB sticker number in TSD response', () => {
  // TEST: local recovery still shows stored sticker digits when WB supplies no image.
  it('returns saved sticker digits without inventing a label or changing another marketplace', async () => {
    const task = {
      id: 'product-first-response', clientId: 'client-1', requestId: 'request-1',
      connectionId: 'connection-1', orderId: '5600000001', skuId: 'sku-1',
      marketplace: MarketplaceType.WILDBERRIES, status: 'IN_PROGRESS',
      productName: 'Товар', itemCount: 1, requiresKiz: true, barcode: '4600000000012',
      barcodes: ['4600000000012'], sourceBarcode: null, boxId: null, boxCode: null,
      sourceBoxPending: false, kiz: null, relabelConfirmedAt: null, deviceCode: worker.deviceCode,
    };
    const db = {
      client: { findUnique: vi.fn().mockResolvedValue({ id: 'client-1', code: 'CL', name: 'Клиент' }) },
      sku: { findUnique: vi.fn().mockResolvedValue({ color: null, size: 'M' }) },
      stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
      clientRequest: { findUnique: vi.fn().mockResolvedValue({ number: 1 }) },
      clientRequestItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: 1 } }) },
      fbsTsdAssembly: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { itemCount: 0 } }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      clientMarketplaceConnection: { findUnique: vi.fn().mockResolvedValue(null) },
      // TEST: exercise the real production queue guard against an eligible saved WB order.
      fbsOrderRequestLink: { findUnique: vi.fn().mockResolvedValue({
        marketplace: MarketplaceType.WILDBERRIES, syncStatus: 'ACTIVE',
        lastCategory: 'active', lastSupplierStatus: 'confirm', lastWbStatus: 'waiting',
      }) },
    };
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    // TEST: formatting an assigned/resumed TSD task must reach the status hook.
    const reconcileStatus = vi.spyOn(service, 'reconcileFbsTaskRequestStatus');
    vi.spyOn(service, 'fbsTsdReservationRowsBySku').mockResolvedValue(new Map());
    vi.spyOn(service, 'fbsTsdCompletedToday').mockResolvedValue(0);
    vi.spyOn(service, 'fbsTsdStickerHistory').mockResolvedValue([]);
    vi.spyOn(service, 'fbsTsdNextRequestSources').mockResolvedValue([]);
    vi.spyOn(service, 'loadOwnedFbsTsdAssembly').mockResolvedValue(task);
    vi.spyOn(service, 'updateFbsTsdUnderLease').mockImplementation(async (current: any, _user: any, data: any) => ({ ...current, ...data }));


    const withSticker = { ...task, stickerPartA: '0057894', stickerPartB: '0051', stickerBarcode: '578940051' };
    const response = await service.formatFbsTsdAssembly(withSticker, worker, '');
    expect(reconcileStatus).toHaveBeenCalledWith(withSticker);
    expect(response.task.wbStickerNumber).toBe('0057894 0051');
    expect(response.task.orderSticker).toBeNull();
    // TEST: LOGOFF TSD must receive the physical-pick mode and hide sticker image/printing.
    expect(response.task.physicalPickConfirmation).toBe(true);
    expect((await service.formatFbsTsdAssembly({ ...withSticker, marketplace: MarketplaceType.OZON }, worker, '')).task.wbStickerNumber).toBeNull();
    expect((await service.formatFbsTsdAssembly(task, worker, '')).task.wbStickerNumber).toBeNull();
  });
});
