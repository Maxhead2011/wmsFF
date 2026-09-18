import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { readFbsCalculationLinks } from '../src/modules/marketplace-connections/fbs-calculation-links';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

afterEach(() => vi.unstubAllEnvs());

function relabelFixture() {
  let comparisons = 0;
  let quantity = 3;
  const sources = ['M', 'L'].map(size => ({ id: `source-${size}`, name: 'Source',
    internalSku: `SOURCE-${size}`, clientSku: 'SOURCE', article: 'SOURCE',
    get size() { comparisons++; return size; }, barcodes: [{ value: `barcode-${size}` }],
    get balances() { return [{ quantity, status: 'AVAILABLE', box: { code: `box-${size}` } }]; },
  }));
  const db = { client: { findUnique: vi.fn(async () => ({ relabelingEnabled: true })) },
    clientArticleMapping: { findMany: vi.fn(async () => [{ targetArticle: 'TARGET', sourceArticle: 'SOURCE' }]) },
    sku: { findMany: vi.fn(async () => sources) } };
  const service: any = new MarketplaceConnectionsService(db as never, {} as never);
  const order = (id: string, size = 'M', article = 'TARGET', storageBoxes: any[] = []) => ({ id,
    connectionId: 'cabinet', article, product: { id: `target-${size}`, article: 'TARGET',
      clientSku: 'TARGET', internalSku: `TARGET-${size}`, size }, storageBoxes, relabeling: null });
  return { service, order, db, comparisons: () => comparisons, reset: () => { comparisons = 0; },
    setQuantity: (value: number) => { quantity = value; } };
}

describe('FBS full calculation cost', () => {
  // TEST: thousands of orders for the same SKU used to repeat every source/size comparison.
  it('resolves identical product/size sources once per calculation, with identical results', async () => {
    const f = relabelFixture();
    const orders = Array.from({ length: 2000 }, (_, i) => f.order(String(i), i % 2 ? 'M' : 'L'));
    vi.stubEnv('WMS_FBS_CALCULATION_FAST_ENABLED', 'false');
    const legacy = await f.service.applyFbsRelabelingStockSources('client', orders);
    const oldComparisons = f.comparisons(); f.reset();
    vi.stubEnv('WMS_FBS_CALCULATION_FAST_ENABLED', 'true');
    const fast = await f.service.applyFbsRelabelingStockSources('client', orders);
    expect(fast).toEqual(legacy);
    expect(f.comparisons()).toBeLessThanOrEqual(4);
    expect(oldComparisons).toBeGreaterThanOrEqual(2000);
    expect(orders.every(o => o.relabeling === null && o.storageBoxes.length === 0)).toBe(true);
  });

  // TEST: memoization must not leak old quantities, cross clients or confuse an order-specific article.
  it('keeps the direct stock, size and article rules and reloads changed stock on the next call', async () => {
    const f = relabelFixture();
    f.db.clientArticleMapping.findMany.mockResolvedValue([
      { targetArticle: 'TARGET', sourceArticle: 'MISSING' },
      { targetArticle: 'OVERRIDE', sourceArticle: 'SOURCE' },
    ]);
    const orders = [f.order('a'), f.order('b', 'M', 'OVERRIDE'), f.order('c', 'L', 'OVERRIDE'),
      f.order('d', 'M', 'OVERRIDE', [{ code: 'direct', status: 'AVAILABLE', quantity: 1 }])];
    vi.stubEnv('WMS_FBS_CALCULATION_FAST_ENABLED', 'false');
    const legacy = await f.service.applyFbsRelabelingStockSources('client', orders);
    vi.stubEnv('WMS_FBS_CALCULATION_FAST_ENABLED', 'true');
    expect(await f.service.applyFbsRelabelingStockSources('client', orders)).toEqual(legacy);
    expect(legacy[0].relabeling.sourceSkuId).toBeNull();
    expect(legacy[1].relabeling.sourceSkuId).toBe('source-M');
    expect(legacy[2].relabeling.sourceSkuId).toBe('source-L');
    expect(legacy[3].relabeling).toBeNull();
    f.setQuantity(0);
    const next = await f.service.applyFbsRelabelingStockSources('other-client', orders);
    expect(next[1].storageBoxes).toEqual([]);
    expect(f.db.clientArticleMapping.findMany.mock.lastCall![0]).toMatchObject({ where: { clientId: 'other-client' } });
  });

  // TEST: relation hydration must scale with unique WMS requests, not marketplace order count.
  it('reads each request once across order batches and retains client/connection/status filters', async () => {
    const requests = [{ id: 'request', number: 1099, title: 'Shortage', status: 'SUBMITTED',
      warehouseId: 'moscow', fbsEmergencyAssemblyAt: null, fbsEmergencyAssemblyByUserId: null,
      fbsEmergencyAssemblyByName: null }];
    const db = {
      $queryRaw: vi.fn(async (query: any) => query.values[2].map((orderId: string) => ({
        marketplace: 'WILDBERRIES', connectionId: query.values[1], orderId, requestId: 'request', syncStatus: 'ACTIVE',
      }))),
      clientRequest: { findMany: vi.fn(async () => requests) },
    };
    const service: any = new MarketplaceConnectionsService(db as never, {} as never);
    const orders = Array.from({ length: 5001 }, (_, i) => ({ id: String(i), connectionId: 'cabinet' }));
    orders.push({ id: '0', connectionId: 'second-cabinet' });
    vi.stubEnv('WMS_FBS_CALCULATION_FAST_ENABLED', 'true');
    const links = await service.loadActiveFbsOrderRequestLinks('client', orders);
    expect(links).toHaveLength(5002);
    expect(links.every((row: any) => row.request === requests[0])).toBe(true);
    expect(db.clientRequest.findMany).toHaveBeenCalledTimes(1);
    expect(db.clientRequest.findMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ['request'] }, clientId: 'client' } });
    for (const [query] of db.$queryRaw.mock.calls) {
      expect(query.values[0]).toBe('client');
      expect(query.values[3]).toEqual(['ACTIVE', 'MOVING', 'RETURN_REQUIRED']);
      expect(query.values[2].length).toBeLessThanOrEqual(10000);
      expect(query.values).toHaveLength(4);
      expect(query.text).toContain('"marketplace"');
      expect(query.text).toContain('ANY($3::text[])');
    }
  });

  // TEST: a sold VM without the opt-in flag uses the original relation query.
  it.each([undefined, 'false'])('retains the legacy request loader with flag %s', async flag => {
    vi.stubEnv('WMS_FBS_CALCULATION_FAST_ENABLED', flag);
    const findMany = vi.fn(async () => []);
    const service: any = new MarketplaceConnectionsService({ fbsOrderRequestLink: { findMany } } as never, {} as never);
    await service.loadActiveFbsOrderRequestLinks('client', [{ id: '1', connectionId: 'cabinet' }]);
    expect(findMany.mock.calls[0][0]).toHaveProperty('include.request.select.warehouseId', true);
  });

  // TEST: large histories cannot exceed the database bind limit even when every order has its own request.
  it('bounds request batches, deduplicates order IDs, and omits a request deleted between reads', async () => {
    const db = {
      $queryRaw: vi.fn(async (query: any) => query.values[2].map((id: string) => ({
        marketplace: 'WILDBERRIES', connectionId: query.values[1], orderId: id, requestId: id, syncStatus: 'WB_ACCOUNTED',
      }))),
      clientRequest: { findMany: vi.fn(async (args: any) => args.where.id.in.filter((id: string) => id !== '0')
        .map((id: string) => ({ id, warehouseId: 'warehouse' }))) },
    };
    const ids = Array.from({ length: 10001 }, (_, i) => String(i));
    const result = await readFbsCalculationLinks(db as never, 'client', new Map([['cabinet', [...ids, '1', ' 1 ']]]), ['WB_ACCOUNTED']);
    expect(result).toHaveLength(10000);
    expect(result.every(row => row.marketplace === 'WILDBERRIES' && row.syncStatus === 'WB_ACCOUNTED')).toBe(true);
    expect(result.some(row => row.orderId === '0')).toBe(false);
    expect(db.clientRequest.findMany).toHaveBeenCalledTimes(3);
    expect(db.clientRequest.findMany.mock.calls.flatMap(([args]) => args.where.id.in)).toEqual(ids);
    expect(db.$queryRaw.mock.calls[0][0].values[3]).toEqual(['WB_ACCOUNTED']);
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    db.clientRequest.findMany.mockClear(); db.$queryRaw.mockClear();
    expect(await readFbsCalculationLinks(db as never, 'client', new Map(), ['ACTIVE'])).toEqual([]);
    expect(db.clientRequest.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});

const url = process.env.FBO_TEST_DATABASE_URL;
if (url && !/^postgresql:\/\/codex_tests@127\.0\.0\.1:554(?:69|85)\/kiz_duplicate_tests(?:\?|$)/.test(url)) throw Error('Dedicated local test DB only');
// TEST: real PostgreSQL array binding, client/cabinet isolation, accounted status and full request metadata.
it.skipIf(!url)('preserves exact order pairs and request metadata under a reused PostgreSQL plan', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const clients = [randomUUID(), randomUUID()]; const cabinet = randomUUID();
  try {
    for (const id of clients) await db.client.create({ data: { id, code: id, name: 'Calculation test' } });
    const request = await db.clientRequest.create({ data: { clientId: clients[0], type: 'OUTBOUND', title: 'Test request' } });
    const foreign = await db.clientRequest.create({ data: { clientId: clients[1], type: 'OUTBOUND', title: 'Foreign request' } });
    for (const [orderId, connectionId, clientId, requestId, syncStatus] of [
      ['active', cabinet, clients[0], request.id, 'ACTIVE'],
      ['accounted', cabinet, clients[0], request.id, 'WB_ACCOUNTED'],
      ['removed', cabinet, clients[0], request.id, 'REMOVED'],
      ['foreign', cabinet, clients[1], foreign.id, 'ACTIVE'],
      ['other-pair', cabinet + '-other', clients[0], request.id, 'ACTIVE'],
    ]) await db.fbsOrderRequestLink.create({ data: { marketplace: 'WILDBERRIES', orderId, connectionId, clientId, requestId, syncStatus } });
    const orderIds = ['active', 'accounted', 'removed', 'foreign', 'other-pair', ...Array.from({ length: 33000 }, (_, i) => `missing-${i}`)];
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_generic_plan');
      const rows = await readFbsCalculationLinks(tx as never, clients[0], new Map([[cabinet, orderIds]]), ['ACTIVE', 'WB_ACCOUNTED']);
      expect(rows.map(row => row.orderId).sort()).toEqual(['accounted', 'active']);
      expect(rows.every(row => row.marketplace === 'WILDBERRIES' && row.request.number === request.number && row.request.title === request.title)).toBe(true);
      expect(rows.find(row => row.orderId === 'accounted')?.syncStatus).toBe('WB_ACCOUNTED');
    });
  } finally {
    await db.fbsOrderRequestLink.deleteMany({ where: { clientId: { in: clients } } });
    await db.clientRequest.deleteMany({ where: { clientId: { in: clients } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
    await db.$disconnect();
  }
});
