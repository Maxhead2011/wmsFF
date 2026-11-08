import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from './marketplace-connections.service';
import { PDFDocument } from 'pdf-lib';
import { readWbSupplyLabels, buildWbSupplyLabelsPdf } from './wb-supply-label';

afterEach(() => vi.unstubAllEnvs());

// TEST: a created, unshipped supply must have a printable QR without a delivery mutation.
it('prints a supply label before delivery using full WB membership', async () => {
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true');
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  const order = { id: '42', connectionId: 'cab', marketplace: 'WILDBERRIES', supplyId: 'WB-GI-306846466', supplierStatus: 'confirm' };
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.resolveFbsLabelOrders = async () => ({ orders: [order] });
  service.loadFbsDeliveryPlan = async () => ({ requiresCargoPlaces: false });
  service.loadSelectedConnections = async () => [{ id: 'cab', apiKey: 'synthetic' }];
  const reads: string[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    expect(init?.method).toBe('GET');
    const path = new URL(String(url)).pathname; reads.push(path);
    const data = path.endsWith('/order-ids') ? { orderIds: [42, 43] } : path.endsWith('/offices') ? [{ id: 7, name: 'Москва_Восток' }] : { id: order.supplyId, done: false, destinationOfficeId: 7 };
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const result = await service.getFbsSupplyStickersPdf({ clientId: 'client', orders: [order] }, {});
    const pdf = await PDFDocument.load(result.buffer);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(58 * 72 / 25.4, 2);
    expect(reads.some(p => /deliver|barcode|trbx/.test(p))).toBe(false);
    expect(reads.some(p => p.endsWith('/order-ids'))).toBe(true);
  } finally { fetch.mockRestore(); }
});

// TEST: no guessed counts, no cross-cabinet joins, no stale supply membership.
function fixture() {
  const orders = [{ id: '42', connectionId: 'cab', marketplace: 'WILDBERRIES', supplyId: 'WB-GI-123' }];
  const connections = [{ id: 'cab', apiKey: 'synthetic' }];
  const state = { members: [42, 43], destination: 7, supplyId: 'WB-GI-123' };
  const read = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe('GET');
    return url.endsWith('/order-ids') ? { orderIds: state.members } : url.endsWith('/offices') ? [{ id: 7, name: 'Москва_Восток' }] : { id: state.supplyId, destinationOfficeId: state.destination };
  });
  return { orders, connections, state, read };
}
it('deduplicates a supply and counts its complete membership, refreshing each download', async () => {
  const x = fixture();
  expect(await readWbSupplyLabels([...x.orders, ...x.orders], x.connections, x.read)).toEqual([{ supplyId: 'WB-GI-123', quantity: 2, destination: 'Москва_Восток' }]);
  expect(x.read).toHaveBeenCalledTimes(3);
  x.state.members.push(44);
  expect((await readWbSupplyLabels(x.orders, x.connections, x.read))[0].quantity).toBe(3);
});
it('rejects missing cabinets before marketplace reads', async () => {
  const x = fixture();
  await expect(readWbSupplyLabels(x.orders, [], x.read)).rejects.toThrow('недоступен');
  expect(x.read).not.toHaveBeenCalled();
});
it.each(['missing', 'duplicate', 'empty', 'destination', 'supply'])('rejects unverified %s metadata', async kind => {
  const x = fixture();
  if (kind === 'missing') x.state.members = [43];
  if (kind === 'duplicate') x.state.members = [42, 42];
  if (kind === 'empty') x.state.members = [];
  if (kind === 'destination') x.state.destination = 8;
  if (kind === 'supply') x.state.supplyId = 'WB-GI-999';
  await expect(readWbSupplyLabels(x.orders, x.connections, x.read)).rejects.toThrow();
});
it('propagates access and rate-limit errors without generating a guessed sticker', async () => {
  const x = fixture(); const error = new Error('429');
  x.read.mockRejectedValue(error);
  await expect(readWbSupplyLabels(x.orders, x.connections, x.read)).rejects.toBe(error);
});
it('keeps one 58x40 page per supply with a long direction', async () => {
  const buffer = await buildWbSupplyLabelsPdf([
    { supplyId: 'WB-GI-306846466', quantity: 1000, destination: 'Москва_Восток' },
    { supplyId: 'WB-GI-306846467', quantity: 1, destination: 'Санкт-Петербург, Ленинградская область и Северо-Западный федеральный округ' },
  ]);
  expect((await PDFDocument.load(buffer)).getPageCount()).toBe(2);
});
it('preserves the legacy delivery guard when our WMS flag is off', async () => {
  vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'false');
  const service: any = Object.create(MarketplaceConnectionsService.prototype);
  service.clientScopes = { requireClientAccess: vi.fn() };
  service.resolveFbsLabelOrders = async () => ({ orders: [{ id: '42', marketplace: 'WILDBERRIES', supplyId: 'WB-GI-123', supplierStatus: 'confirm' }] });
  service.loadFbsDeliveryPlan = async () => ({ requiresCargoPlaces: false });
  await expect(service.getFbsSupplyStickersPdf({ clientId: 'client', orders: [] }, {})).rejects.toThrow('после её передачи');
});
// TEST: preserve reference portrait artwork rotated into physical 58x40 media, with a large QR.
it('embeds the reference 40x58 artwork into 58x40 media without page rotation', async () => {
  const pdf = await PDFDocument.load(await buildWbSupplyLabelsPdf([{ supplyId: 'WB-GI-306846466', quantity: 1, destination: 'Москва_Восток' }]));
  const page = pdf.getPage(0);
  expect(page.getWidth()).toBeCloseTo(58 * 72 / 25.4, 2);
  expect(page.getHeight()).toBeCloseTo(40 * 72 / 25.4, 2);
  expect(page.getRotation().angle).toBe(0);
  const resources = page.node.Resources();
  expect(resources?.toString()).toContain('/XObject');
});
