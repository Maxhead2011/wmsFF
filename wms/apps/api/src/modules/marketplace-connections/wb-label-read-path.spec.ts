import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { wbLabelOrders } from './wb-label-orders';
vi.mock('./wb-label-orders', () => ({ wbLabelOrders: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

// TEST: the actual ribbon handler must not invoke the expensive operational loader.
it('resolves once and reuses the selected snapshot for every section', async () => {
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true');
  const order: any = { id: '42', connectionId: 'cab', marketplace: 'WILDBERRIES', supplyId: 's' };
  vi.mocked(wbLabelOrders).mockResolvedValue([order]);
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.prisma = {};
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.resolveSelectedFbsOrders = vi.fn(async () => { throw Error('Full client refresh forbidden while printing'); });
  const pdf = await PDFDocument.create(); pdf.addPage([58, 40]); const buffer = Buffer.from(await pdf.save());
  for (const name of ['getFbsSupplyStickersPdf', 'getFbsCargoPlaceStickersPdf', 'getFbsOrderStickersPdf']) {
    service[name] = vi.fn(async (dto, _user, snapshot) => {
      expect((await service.resolveFbsLabelOrders(dto.clientId, dto.orders, snapshot)).orders).toEqual([order]);
      return { buffer };
    });
  }
  const result = await service.getFbsAllLabels({ clientId: 'client', orders: [{ id: '42', connectionId: 'cab' }] }, {});
  expect(result.pageCount).toBe(3); expect(wbLabelOrders).toHaveBeenCalledOnce();
  expect(service.resolveSelectedFbsOrders).not.toHaveBeenCalled();
});
it('keeps the old resolver with the deployment flag disabled', async () => {
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'false');
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.resolveSelectedFbsOrders = vi.fn(async () => ({ orders: [] }));
  await service.resolveFbsLabelOrders('client', []);
  expect(service.resolveSelectedFbsOrders).toHaveBeenCalledOnce(); expect(wbLabelOrders).not.toHaveBeenCalled();
});
it('rejects a different order or cabinet in a request-local snapshot', async () => {
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  await expect(service.resolveFbsLabelOrders('client', [{ id: '42', connectionId: 'other' }],
    [{ id: '42', connectionId: 'cab' }])).rejects.toThrow('комплекте');
});
