import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LamodaService } from '../src/modules/lamoda/lamoda.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import { LamodaApiError, sealSecret } from '../src/modules/lamoda/lamoda-client';
import { wbReservationQuantities } from '../src/common/stock/wb-order-stock-lifecycle';
import { receiptRules } from '../src/modules/warehouse/receipt-channel-policy';

vi.mock('../src/common/stock/wb-order-stock-lifecycle', async (original) => ({
  ...await original<any>(), wbReservationQuantities: vi.fn(async () => new Map()),
}));
vi.mock('../src/modules/warehouse/receipt-channel-policy', async (original) => ({
  ...await original<any>(), receiptRules: vi.fn(async () => new Map()),
}));

const user: any = { id: 'u', permissionCodes: ['marketplace-api:read', 'marketplace-api:write'], roleCodes: ['CLIENT'], clientScopeMode: 'LIMITED', clientIds: ['c'], writableClientIds: ['c'] };
let account: any, db: any, requests: any, service: LamodaService, remote: any;
beforeEach(() => {
  vi.mocked(wbReservationQuantities).mockResolvedValue(new Map());
  vi.mocked(receiptRules).mockResolvedValue(new Map());
  vi.stubEnv('WMS_LAMODA_ENABLED', 'true'); vi.stubEnv('WMS_LAMODA_SECRET_KEY', Buffer.alloc(32, 4).toString('base64'));
  account = { id: 'a', clientId: 'c', sellerId: 's', oauthClientId: 'oauth', isActive: true, fboEnabled: true, fbsEnabled: true, updatedAt: new Date(0), ordersSyncedAt: null };
  account.encryptedSecret = sealSecret('password', JSON.stringify(['c', 's', 'oauth']));
  db = {
    lamodaAccount: { findUnique: vi.fn(async () => account), updateMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(), findUniqueOrThrow: vi.fn(async () => account) },
    lamodaExchange: { create: vi.fn(async () => ({ id: 'exchange' })), update: vi.fn(), updateMany: vi.fn() },
    lamodaProduct: { findMany: vi.fn(async () => []), updateMany: vi.fn(), upsert: vi.fn() },
    lamodaDocument: { upsert: vi.fn() },
    lamodaPlan: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  requests = { previewAvailability: vi.fn(async () => ({ lines: [] })) };
  service = new LamodaService(db, new ClientScopeService(), requests);
  remote = { collection: vi.fn(async () => []), check: vi.fn() };
  (service as any).remote = remote;
});
afterEach(() => vi.unstubAllEnvs());

// TEST: Lamoda imports own one OUTBOUND demand and cannot bypass scope or product mapping.
describe('Lamoda warehouse assembly',()=>{
 function assemblyFixture(){
  vi.stubEnv('WMS_LAMODA_FBO_ASSEMBLY_ENABLED','true');user.permissionCodes=['marketplace-api:read','marketplace-api:write','client-requests:write'];
  const plan={id:'plan',accountId:'a',warehouseId:'w',title:'Lamoda',remoteShipmentId:null,items:[{barcode:'12345678',quantity:2,article:'',destination:'B'}]};
  db.lamodaPlan.findFirst.mockResolvedValue(plan);
  db.lamodaFboAssembly={findUnique:vi.fn(async()=>null),create:vi.fn()};
  db.lamodaAccount.findFirst=vi.fn(async()=>account);db.$queryRaw=vi.fn();
  db.warehouseClient={findFirst:vi.fn(async()=>({}))};
  db.lamodaProduct.findMany.mockResolvedValue([{remoteSku:'lm',barcode:'12345678',externalSku:'a',skuId:'s',isPresent:true,linkState:'CONFIRMED'}]);
  db.sku={findMany:vi.fn(async()=>[{id:'s',barcodes:[{value:'12345678'}]}])};
  db.clientRequest={create:vi.fn(async()=>({id:'r',number:1}))};db.clientRequestEvent={create:vi.fn()};
  db.client={findUniqueOrThrow:vi.fn(async()=>({storesWithoutBoxes:false}))};
  db.stockBalance={findMany:vi.fn(async()=>[{skuId:'s',boxId:'box',quantity:2}])};
  return plan;
 }
 // TEST: reproduce creation reserving more than physical stock minus existing FBS demand.
 it('rejects an existing FBS reserve inside the creation transaction before any write',async()=>{
  assemblyFixture();vi.mocked(wbReservationQuantities).mockResolvedValue(new Map([['s',1]]));
  await expect(service.createAssembly('a','plan',user)).rejects.toThrow('Недостаточно свободного остатка');
  expect(db.clientRequest.create).not.toHaveBeenCalled();expect(db.lamodaFboAssembly.create).not.toHaveBeenCalled();
  expect(wbReservationQuantities).toHaveBeenCalledWith(db,'c',['s'],'w',undefined);
 });
 it('rejects zero stock even when the user previously previewed the plan',async()=>{
  assemblyFixture();db.stockBalance.findMany.mockResolvedValue([]);
  await expect(service.createAssembly('a','plan',user)).rejects.toThrow('доступно 0');
  expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
 it('does not create demand from a receipt forbidden for FBO',async()=>{
  assemblyFixture();vi.mocked(receiptRules).mockResolvedValue(new Map([['box',{fbo:false,fbs:true,stockAvailable:true} as any]]));
  await expect(service.createAssembly('a','plan',user)).rejects.toThrow('доступно 0');
  expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
 // TEST: customer request permissions suffice only for own plans; API management stays restricted.
 it('lets a writable customer create an own assembly without API administration rights',async()=>{
  assemblyFixture();const customer={...user,permissionCodes:['client-requests:read','client-requests:write']};
  expect(await service.createAssembly('a','plan',customer)).toEqual({id:'r',number:1});
  await expect(service.createAssembly('a','plan',{...customer,clientIds:['foreign'],writableClientIds:['foreign']})).rejects.toThrow();
  await expect(service.createAssembly('a','plan',{...customer,writableClientIds:[]})).rejects.toThrow();
  await expect(service.createAssembly('a','plan',{...customer,permissionCodes:['client-requests:read']})).rejects.toThrow();
  await expect(service.update('a',{secret:'new'},customer)).rejects.toThrow();
  await expect(service.check('a',customer)).rejects.toThrow();
  await expect(service.sync('a','CATALOG',customer)).rejects.toThrow();
 });
 it('creates the common reservation demand with a durable Lamoda relation',async()=>{
  assemblyFixture();expect(await service.createAssembly('a','plan',user)).toEqual({id:'r',number:1});
  expect(db.clientRequest.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({type:'OUTBOUND',status:'SUBMITTED',items:{create:[{skuId:'s',barcode:'12345678',quantity:2}]}})}));
  expect(db.lamodaFboAssembly.create).toHaveBeenCalledTimes(1);
 });
 it('returns the existing request without creating another reservation',async()=>{
  assemblyFixture();db.lamodaFboAssembly.findUnique.mockResolvedValue({request:{id:'r',number:1}});
  expect(await service.createAssembly('a','plan',user)).toEqual({id:'r',number:1});expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
 it('rejects unresolved identities before creating a request',async()=>{
  assemblyFixture();db.lamodaProduct.findMany.mockResolvedValue([]);
  await expect(service.createAssembly('a','plan',user)).rejects.toThrow('соответствие');expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
 it('does not mutate when assembly gate or warehouse rights are absent',async()=>{
  assemblyFixture();vi.stubEnv('WMS_LAMODA_FBO_ASSEMBLY_ENABLED','false');
  await expect(service.createAssembly('a','plan',user)).rejects.toThrow('выключено');expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
});

// TEST: scope, sync consistency, mapping changes and existing reservations.
describe('Lamoda service isolation', () => {
  // TEST: a successful check of old credentials must not certify a concurrently replaced account.
  it('does not report a stale connection check as successful', async () => {
    db.lamodaAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.check('a', user)).rejects.toThrow('изменилось во время проверки');
  });
  // TEST: nullable SKU is a documented draft state, not a reason to lose the entire catalog sync.
  it('skips unfinished catalog cards and reports the skipped count explicitly', async () => {
    remote.collection.mockResolvedValue([{ sku: null, name: 'Draft' }, { sku: 'LM', name: 'Ready' }]);
    const result = await service.sync('a', 'CATALOG', user);
    expect(result).toMatchObject({ count: 1, skipped: 1 });
    expect(result.message).toContain('Пропущено карточек без SKU Lamoda: 1');
    expect(db.lamodaProduct.upsert).toHaveBeenCalledTimes(1);
  });
  // TEST: a crashed worker's expired lease does not leave its journal entry running forever.
  it('marks abandoned runs interrupted only after acquiring the account lease', async () => {
    await service.sync('a', 'CATALOG', user);
    expect(db.lamodaExchange.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: 'a', status: 'RUNNING' }), data: expect.objectContaining({ status: 'FAILED', errorCode: 'INTERRUPTED' }) }));
    expect(db.lamodaAccount.updateMany.mock.invocationCallOrder[0]).toBeLessThan(db.lamodaExchange.updateMany.mock.invocationCallOrder[0]);
  });
  it('does not touch DB when feature flag is off', async () => {
    vi.stubEnv('WMS_LAMODA_ENABLED', 'false');
    await expect(service.overview('a', user)).rejects.toThrow();
    expect(db.lamodaAccount.findUnique).not.toHaveBeenCalled();
  });
  it('rejects foreign clients, read-only users, and demo mutations', async () => {
    await expect(service.sync('a', 'CATALOG', { ...user, clientIds: ['other'], writableClientIds: ['other'] })).rejects.toThrow('Нет доступа');
    await expect(service.sync('a', 'CATALOG', { ...user, permissionCodes: ['marketplace-api:read'] })).rejects.toThrow('права');
    await expect(service.sync('a', 'CATALOG', { ...user, isDemo: true })).rejects.toThrow('демонстрационном');
    expect(remote.collection).not.toHaveBeenCalled();
  });
  it('rejects disabled account/mode and overlapping sync before HTTP', async () => {
    account.isActive = false;
    await expect(service.sync('a', 'CATALOG', user)).rejects.toThrow('отключено');
    account.isActive = true; account.fbsEnabled = false;
    await expect(service.sync('a', 'ORDERS', user)).rejects.toThrow('Схема');
    db.lamodaAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.sync('a', 'CATALOG', user)).rejects.toThrow('Уже выполняется');
    expect(remote.collection).not.toHaveBeenCalled();
  });
  it('keeps cache and cursor unchanged on failed page', async () => {
    remote.collection.mockRejectedValue(new LamodaApiError('HTTP_ERROR', 503));
    await expect(service.sync('a', 'ORDERS', user)).rejects.toThrow('503');
    expect(db.lamodaDocument.upsert).not.toHaveBeenCalled();
    expect(db.lamodaAccount.update).not.toHaveBeenCalled();
    expect(db.lamodaExchange.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorCode: 'HTTP_ERROR' }) }));
    expect(db.lamodaAccount.updateMany.mock.calls.at(-1)[0].data).toEqual({ syncLeaseUntil: null, syncToken: null });
  });
  it('rejects duplicate IDs before persisting a partial catalog', async () => {
    remote.collection.mockResolvedValue([{ sku: 'LM' }, { sku: 'LM' }]);
    await expect(service.sync('a', 'CATALOG', user)).rejects.toThrow('DUPLICATE_REMOTE_ID');
    expect(db.lamodaProduct.upsert).not.toHaveBeenCalled();
  });
  it('revokes a confirmed mapping when remote product identity changed', async () => {
    db.lamodaProduct.findMany.mockResolvedValue([{ remoteSku: 'LM', externalSku: 'A', barcode: '11111111', size: 'S', skuId: 'wms' }]);
    remote.collection.mockResolvedValue([{ sku: 'LM', externalSku: 'A', barcode: '22222222', externalSize: 'S' }]);
    await service.sync('a', 'CATALOG', user);
    expect(db.lamodaProduct.upsert.mock.calls[0][0].update).toMatchObject({ skuId: null, linkState: 'REVIEW', barcode: '22222222' });
  });
  it('preserves manual confirmation for unchanged identity', async () => {
    db.lamodaProduct.findMany.mockResolvedValue([{ remoteSku: 'LM', externalSku: 'A', barcode: '11111111', size: 'S', skuId: 'wms' }]);
    remote.collection.mockResolvedValue([{ sku: 'LM', externalSku: 'A', barcode: '11111111', externalSize: 'S', quantity: 1000 }]);
    await service.sync('a', 'CATALOG', user);
    expect(db.lamodaProduct.upsert.mock.calls[0][0].update).not.toHaveProperty('skuId');
    expect(db.lamodaProduct.upsert.mock.calls[0][0].update).not.toHaveProperty('quantity');
  });
  it('uses internal order IDs and advances cursor only after persistence', async () => {
    account.ordersSyncedAt = new Date('2026-10-25T12:00:00Z');
    remote.collection.mockResolvedValue([{ id: 'internal', orderId: 'public', status: 'CANCELED' }]);
    await service.sync('a', 'ORDERS', user);
    expect(remote.collection.mock.calls[0][2].updatedAtFrom).toBe('2026-10-25T11:55:00.000Z');
    expect(db.lamodaDocument.upsert.mock.calls[0][0].where.accountId_kind_remoteId.remoteId).toBe('internal');
    expect(db.lamodaAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ordersSyncedAt: expect.any(Date) }) }));
  });
  it('combines repeated plan lines before asking the existing scoped availability calculator', async () => {
    db.lamodaPlan.findFirst.mockResolvedValue({ id: 'p', accountId: 'a', warehouseId: 'warehouse', items: [
      { barcode: '12345678', quantity: 5, article: '', destination: 'A' },
      { barcode: '12345678', quantity: 7, article: '', destination: 'B' },
      { barcode: '87654321', quantity: 2, article: '', destination: 'B' },
    ] });
    db.lamodaProduct.findMany.mockResolvedValue([{ barcode: '12345678', skuId: 'sku' }]);
    db.sku={findMany:vi.fn(async()=>[{id:'sku',barcodes:[{value:'12345678'}]}])};
    const result = await service.availability('a', 'p', user);
    expect(result.unresolvedRows).toEqual([4]);
    expect(requests.previewAvailability.mock.calls[0][0]).toEqual({ clientId: 'c', warehouseId: 'warehouse', type: 'OUTBOUND', items: [{ skuId: 'sku', barcode: '12345678', quantity: 12 }] });
    expect(result.canAssemble).toBe(false);
  });
  it('never falls back to ambiguous barcode matches and never previews a foreign branch', async () => {
    db.lamodaPlan.findFirst.mockResolvedValue({ warehouseId: 'other', items: [{ barcode: '12345678', quantity: 1, article: '' }] });
    db.lamodaProduct.findMany.mockResolvedValue([{ barcode: '12345678', skuId: 'a' }, { barcode: '12345678', skuId: 'b' }]);
    expect((await service.availability('a', 'p', user)).unresolvedRows).toEqual([2]);
    expect(requests.previewAvailability).not.toHaveBeenCalled();
    await expect(service.availability('a', 'p', { ...user, roleCodes: ['BRANCH_MANAGER'], warehouseIds: ['own'], writableWarehouseIds: ['own'], activeWarehouseId: 'own' })).rejects.toThrow('филиале');
  });
  it('cannot rotate credentials concurrently with a sync', async () => {
    db.lamodaAccount.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update('a', { secret: 'replacement' }, user)).rejects.toThrow('Подключение изменилось');
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
});
