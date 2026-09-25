import { afterEach, describe, expect, it, vi } from 'vitest';
import 'reflect-metadata';
import { createRequire } from 'node:module';
import type { OzonPickState } from '../src/modules/marketplace-connections/ozon-fbs-pick-lines';
// TEST: identical scenarios run against source and the actual patched production artifact.
const load = createRequire(import.meta.url);
const entry = process.env.OZON_LINES_RUNTIME;
const { MarketplaceConnectionsService } = entry ? load(entry + '/marketplace-connections.service.js') : await import('../src/modules/marketplace-connections/marketplace-connections.service');
const { handleOzonPickLines } = entry ? load(entry + '/ozon-fbs-pick-workflow.js') : await import('../src/modules/marketplace-connections/ozon-fbs-pick-workflow');
const { ozonPickCount, recordOzonLineScan, requireOzonLineComposition, resolveOzonLineSku } = entry ? load(entry + '/ozon-fbs-pick-lines.js') : await import('../src/modules/marketplace-connections/ozon-fbs-pick-lines');
const { reconcileFbsRequestStatus } = entry ? load(entry + '/../../common/stock/fbs-request-auto-status.js') : await import('../src/common/stock/fbs-request-auto-status');

const barcodeA = '2052925578278', barcodeB = '2051548539567';
const posting = () => ({ posting_number: '73641454-0104-12', status: 'awaiting_packaging', products: [
  { sku: 5756653301, offer_id: '1220989182', quantity: 1 },
  { sku: 5756654172, offer_id: '1075356340', quantity: 1 },
] });
const state = (): OzonPickState => ({ version: 1, submission: 'PICKING', source: { boxId: null, boxCode: 'БЕЗ КОРОБА' }, legacyScansDiscarded: false,
  lines: posting().products.map((p, i) => ({ productId: p.sku, offerId: p.offer_id, quantity: 1, skuId: `sku${i}`, requestItemId: `item${i}`,
    name: i ? 'Champion' : 'Freestyle', article: i ? 'Champion' : 'Freestyle', barcodes: [i ? barcodeB : barcodeA], picks: [] })) });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// TEST: the incident was two scans of the first barcode being accepted as two different products.
describe('Ozon per-product scan evidence', () => {
  it('rejects Freestyle twice and accepts Freestyle + Champion', () => {
    let s = recordOzonLineScan(state(), barcodeA, 0, 'picker');
    s.source = { boxId: null, boxCode: 'БЕЗ КОРОБА' };
    expect(() => recordOzonLineScan(s, barcodeA, 1, 'picker')).toThrow('Champion');
    s = recordOzonLineScan(s, barcodeB, 1, 'picker');
    expect(ozonPickCount(s)).toBe(2);
    expect(() => requireOzonLineComposition(s, posting())).not.toThrow();
  });
  it('replays an old accepted scan without consuming the next article', () => {
    const s = recordOzonLineScan(state(), barcodeA, 0, 'picker');
    expect(recordOzonLineScan(s, barcodeA, 0, 'picker')).toBe(s);
    expect(() => recordOzonLineScan(s, barcodeB, 0, 'picker')).toThrow('другим товаром');
    expect(() => recordOzonLineScan(s, barcodeB, undefined, 'picker')).toThrow('счётчик');
  });
  it('does not trust the total if product IDs, quantities or marking requirements changed', () => {
    let s = recordOzonLineScan(state(), barcodeA, 0, 'picker');
    s.source = { boxId: null, boxCode: 'БЕЗ КОРОБА' };
    s = recordOzonLineScan(s, barcodeB, 1, 'picker');
    const changed = posting(); changed.products[1].sku++;
    expect(() => requireOzonLineComposition(s, changed)).toThrow('Состав');
    expect(() => requireOzonLineComposition(s, { ...posting(), requirements: { products_requiring_mandatory_mark: [5756654172] } })).toThrow('маркировку');
    expect(() => requireOzonLineComposition(state(), posting())).toThrow('не все товары');
  });
  it('matches exact catalog identifiers and rejects ambiguous or marked goods', () => {
    const product = { productId: 5756653301, offerId: '1220989182', quantity: 1, barcodes: [] };
    const sku = { id: 'sku', marketplaceProductId: '1220989182:1796609512', barcodes: [{ value: barcodeA }] };
    expect(resolveOzonLineSku(product, [sku])).toEqual(sku);
    expect(() => resolveOzonLineSku(product, [sku, { ...sku, id: 'other' }])).toThrow('однозначное');
    expect(() => resolveOzonLineSku(product, [{ ...sku, marketplaceProductId: '01220989182' }])).toThrow('однозначное');
    expect(() => resolveOzonLineSku(product, [{ ...sku, needsChestnyZnak: true }])).toThrow('КИЗ');
  });
});

// A serialized in-memory transaction adapter exercises the actual workflow without production writes.
function fixture() {
  vi.stubEnv('WMS_OZON_MULTILINE_PICKING', 'true');
  vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED', 'false');
  const task: any = { id: 'task', clientId: 'client', connectionId: 'connection', orderId: posting().posting_number,
    marketplace: 'OZON', requestId: 'request', requestItemId: 'item0', skuId: 'sku0', itemCount: 2,
    status: 'IN_PROGRESS', workerUserId: 'picker', deviceCode: 'device', updatedAt: new Date() };
  const items: any[] = [{ id: 'item0', requestId: 'request', skuId: 'sku0', quantity: 2 }];
  let saved: OzonPickState | null = null;
  let remote: any = posting();
  const db: any = {
    $queryRaw: vi.fn(async (sql: TemplateStringsArray) => sql.join('').includes('OzonFbsPickState') ? saved ? [{ data: structuredClone(saved) }] : [] : [{ id: 'request' }]),
    $executeRaw: vi.fn(async (_sql: any, _id: any, data: string) => { saved = JSON.parse(data); return 1; }),
    fbsTsdAssembly: {
      findUnique: vi.fn(async () => ({ ...task })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: any) => Object.assign(task, data)),
      aggregate: vi.fn(async () => ({ _sum: { itemCount: task.status === 'COMPLETED' ? 2 : 0 } })),
    },
    clientRequest: { findUnique: vi.fn(async () => ({ id: 'request', clientId: 'client', number: 1398, status: 'IN_WORK' })) },
    clientRequestItem: {
      findUnique: vi.fn(async ({ where }: any) => items.find(i => i.id === where.id)),
      findFirst: vi.fn(async ({ where }: any) => items.find(i => i.skuId === where.skuId)),
      update: vi.fn(async ({ where, data }: any) => { const i = items.find(i => i.id === where.id); if (typeof data.quantity === 'number') i.quantity = data.quantity; else i.quantity += data.quantity.increment ?? -data.quantity.decrement; return i; }),
      create: vi.fn(async ({ data }: any) => { const item = { ...data, id: `item${items.length}` }; items.push(item); return item; }),
      aggregate: vi.fn(async () => ({ _sum: { quantity: items.reduce((n, i) => n + i.quantity, 0) } })),
    },
    sku: { findMany: vi.fn(async () => state().lines.map(l => ({ id: l.skuId, name: l.name, article: l.article,
      marketplaceProductId: l.offerId + ':legacy', barcodes: l.barcodes.map(value => ({ value })) }))) },
    client: { findUnique: vi.fn(async () => ({ id: 'client', name: 'Client' })) },
    stockBalance: { findMany: vi.fn(async () => []) },
    clientRequestEvent: { create: vi.fn(async () => ({})) },
    clientRequestBoxSelection: { upsert: vi.fn(async () => ({})) },
  };
  let queue = Promise.resolve();
  db.$transaction = (fn: any) => {
    const result = queue.then(async () => {
      const before = structuredClone({ task, items, saved });
      try { return await fn(db); } catch (error) {
        for (const key of Object.keys(task)) delete task[key]; Object.assign(task, before.task);
        items.splice(0, items.length, ...before.items); saved = before.saved; throw error;
      }
    });
    queue = result.catch(() => {});
    return result;
  };
  const service: any = {
    prisma: db, fbsTsdDeviceCode: () => 'device',
    requireCurrentFbsTsdLease: (fresh: any, user: any) => { if (fresh.workerUserId !== user.id || fresh.status !== 'IN_PROGRESS') throw new Error('lease'); },
    readOzonFbsPickPosting: vi.fn(async () => structuredClone(remote)),
    resolveFbsTsdExpectedWarehouseId: vi.fn(async () => 'warehouse'),
    fbsTsdReservationRowsBySku: vi.fn(async () => new Map()),
    submitOzonFbsTask: vi.fn(async () => { remote.status = 'awaiting_deliver'; task.marketplaceSubmittedAt = new Date(); return task; }),
    fbsOrdersCache: new Map(), notifyFbsAutoStatusChanges: vi.fn(async () => {}),
  };
  const action = (name: any, payload = {}) => handleOzonPickLines(service, task, { id: 'picker' }, name, payload);
  const source = (count: number) => action('box', { boxCode: 'БЕЗ КОРОБА', scannedItemCount: count });
  const scan = (code: string, count: number) => action('barcode', { barcode: code, scannedItemCount: count });
  const pickAll = async () => { await action('view'); await source(0); await scan(barcodeA, 0); await source(1); await scan(barcodeB, 1); };
  return { service, db, task, items, action, source, scan, pickAll, get saved() { return saved; }, remote };
}

describe('Ozon multi-line workflow', () => {
  it('concurrent first opens do not split request quantities twice', async () => {
    const f = fixture();
    await Promise.all([f.action('view'), f.action('view')]);
    expect(f.items.map(i => i.quantity)).toEqual([1, 1]);
    expect(f.db.clientRequestEvent.create).toHaveBeenCalledTimes(1);
  });
  it('checks remaining request capacity before contacting the shipping endpoint', async () => {
    const f = fixture(); await f.pickAll(); f.items[1].quantity = 0;
    await expect(f.action('complete')).rejects.toThrow('Количество по позиции');
    expect(f.service.submitOzonFbsTask).not.toHaveBeenCalled();
  });
  it('automatic completion credits both request items and rejects incomplete evidence', async () => {
    const f = fixture(); await f.pickAll(); await f.action('complete');
    vi.stubEnv('WMS_FBS_REQUEST_AUTO_STATUS_ENABLED', 'true');
    f.task.startedAt = new Date();
    f.db.fbsTsdAssembly.findMany.mockResolvedValue([f.task]);
    f.db.clientRequest.findUnique.mockResolvedValue({ id: 'request', clientId: 'client', type: 'OUTBOUND', status: 'IN_WORK',
      number: 1398, title: 'FBS', items: f.items, fbsOrderLinks: [{ marketplace: 'OZON', connectionId: 'connection', orderId: f.task.orderId, syncStatus: 'ACTIVE' }] });
    f.db.clientRequestEvent.findFirst = vi.fn(async () => null);
    f.db.clientRequest.update = vi.fn();
    await reconcileFbsRequestStatus(f.db, 'request', { stage: 'PICK', occurredAt: new Date() });
    expect(f.db.clientRequest.update).toHaveBeenCalledWith({ where: { id: 'request' }, data: { status: 'PACKED' } });
    f.db.clientRequest.update.mockClear();
    f.saved!.lines[1].picks = [];
    await reconcileFbsRequestStatus(f.db, 'request', { stage: 'PICK', occurredAt: new Date() });
    expect(f.db.clientRequest.update).not.toHaveBeenCalled();
  });
  it('background synchronization preserves per-line quantities and their item IDs', async () => {
    const f = fixture(); await f.action('view');
    const link = { id: 'link', marketplace: 'OZON', connectionId: 'connection', orderId: f.task.orderId, lastSkuId: 'sku0', syncStatus: 'ACTIVE' };
    const request = { id: 'request', clientId: 'client', status: 'IN_WORK', title: 'FBS', comment: '', fbsOrderLinks: [link],
      items: f.items.map(i => ({ ...i, packageItems: [], boxSelections: [] })) };
    const order = { id: f.task.orderId, marketplace: 'OZON', connectionId: 'connection', category: 'active',
      product: { id: 'sku0', name: 'Freestyle' }, itemCount: 2, barcodes: [barcodeA] };
    f.db.clientRequest.findUnique.mockResolvedValue(request);
    f.db.clientRequest.update = vi.fn();
    f.db.fbsTsdAssembly.findMany.mockResolvedValue([f.task]);
    f.db.fbsOrderRequestLink = { update: vi.fn() };
    f.db.clientRequestItem.delete = vi.fn();
    f.db.clientNotification = { create: vi.fn() };
    await MarketplaceConnectionsService.prototype['syncOneFbsRequest'].call(f.service, 'client', 'request', new Map([['connection:' + f.task.orderId, order]]), []);
    expect(f.items.map(i => [i.id, i.quantity])).toEqual([['item0', 1], ['item1', 1]]);
    expect(f.db.clientRequestItem.delete).not.toHaveBeenCalled();
  });
  it('the real Ozon submit path accepts both proved product IDs with the legacy counter flag enabled', async () => {
    const f = fixture(); await f.pickAll();
    vi.stubEnv('WMS_OZON_TSD_UNIT_SCANS', 'true');
    f.db.clientMarketplaceConnection = { findFirst: vi.fn(async () => ({ sellerId: 'test', apiKey: 'test' })) };
    const fetch = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/get') ? { result: f.remote } : { result: [] },
    ), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await MarketplaceConnectionsService.prototype['submitOzonFbsTask'].call(f.service, f.task);
    const shipping = fetch.mock.calls.find(([url]) => String(url).endsWith('/ship')) as any;
    expect(shipping).toBeTruthy();
    expect(JSON.parse(shipping[1].body).packages[0].products).toEqual([
      { product_id: 5756653301, quantity: 1 }, { product_id: 5756654172, quantity: 1 },
    ]);
  });
  it('splits request items, advances product, resumes and completes exactly once', async () => {
    const f = fixture();
    await f.action('view');
    expect(f.items.map(i => [i.skuId, i.quantity])).toEqual([['sku0', 1], ['sku1', 1]]);
    await f.source(0);
    await Promise.all([f.scan(barcodeA, 0), f.scan(barcodeA, 0)]);
    const resumed = await f.action('view');
    expect(resumed.task.product.article).toBe('Champion');
    expect(resumed.task.scannedItemCount).toBe(1);
    expect(resumed.state).toBe('SCAN_BOX');
    await expect(f.action('complete')).rejects.toThrow('все товарные');
    await f.source(1); await expect(f.scan(barcodeA, 1)).rejects.toThrow('Champion');
    await f.scan(barcodeB, 1); await f.action('complete'); await f.action('complete');
    expect(f.service.submitOzonFbsTask).toHaveBeenCalledTimes(1);
    expect(f.task.status).toBe('COMPLETED');
    expect(f.db.clientRequestEvent.create).toHaveBeenCalledTimes(2);
  });
  it('does not trust the legacy two-of-two counter', async () => {
    const f = fixture(); Object.assign(f.task, { barcode: barcodeA, scannedItemCount: 2 });
    const response = await f.action('view');
    expect(response.task.scannedItemCount).toBe(0);
    expect(response.message).toContain('Повторите сканы');
    await expect(f.action('complete')).rejects.toThrow('все товарные');
    expect(f.service.submitOzonFbsTask).not.toHaveBeenCalled();
  });
  it('leaves WB and the sold/default configuration on the old path', async () => {
    const f = fixture(); f.task.marketplace = 'WILDBERRIES';
    expect(await f.action('view')).toBeNull();
    f.task.marketplace = 'OZON'; vi.stubEnv('WMS_OZON_MULTILINE_PICKING', 'false');
    expect(await f.action('view')).toBeNull();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
  it('keeps single-product postings on the existing path', async () => {
    const f = fixture(); f.remote.products = [{ ...f.remote.products[0], quantity: 2 }];
    expect(await f.action('view')).toBeNull(); expect(f.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('after an ambiguous HTTP result only reconciles; it never repeats ship blindly', async () => {
    const f = fixture(); await f.pickAll();
    f.service.submitOzonFbsTask.mockRejectedValueOnce(new Error('timeout'));
    await expect(f.action('complete')).rejects.toThrow('timeout');
    await expect(f.action('complete')).rejects.toThrow('Предыдущая отправка');
    f.remote.status = 'awaiting_deliver';
    await f.action('complete');
    expect(f.service.submitOzonFbsTask).toHaveBeenCalledTimes(1);
    expect(f.task.status).toBe('COMPLETED');
  });
  it('the real service scan endpoint dispatches multi-line orders before its legacy barcode guard', async () => {
    const f = fixture(); await f.action('view'); await f.source(0);
    f.service.loadOwnedFbsTsdAssembly = vi.fn(async () => f.task);
    f.service.requireFbsOrderStillCollectable = vi.fn();
    f.service.assertFbsTsdLeaseVersion = vi.fn(async () => f.task);
    f.service.formatFbsTsdAssembly = vi.fn(async () => ({}));
    f.task.boxCode = 'БЕЗ КОРОБА';
    f.task.barcode = barcodeA; // Legacy first-product completion must not bypass the line ledger.
    await MarketplaceConnectionsService.prototype.scanFbsTsdBarcode.call(f.service, 'task', { barcode: barcodeA, scannedItemCount: 0 }, { id: 'picker' } as any);
    expect(ozonPickCount(f.saved!)).toBe(1);
  });
});
