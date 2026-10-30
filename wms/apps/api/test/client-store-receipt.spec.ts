import {StockOperationsService} from '../src/modules/stock/stock-operations.service';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {assertStoreReceipt, skuStoresKey, storeDirectoryKey, validateSkuStores} from '../src/modules/clients/client-store-receipt';
import {TsdPayloadParser} from '../src/modules/tsd/tsd-payload.parser';

const stores = [{id: 'monlarti', name: 'Монларти', connectionIds: ['m']}, {id: 'braibo', name: 'Брайбо', connectionIds: ['b']}];
function setup(ids = ['monlarti', 'braibo']) {
  vi.stubEnv('WMS_CLIENT_STORES_ENABLED', 'true');
  vi.stubEnv('WMS_CLIENT_STORE_RECEIPTS_ENABLED', 'true');
  const settings = new Map<string, unknown>([[storeDirectoryKey('c'), stores], [skuStoresKey('c', 'shared'), ids]]);
  const tx: any = {$executeRaw: vi.fn(), clientMarketplaceConnection: {findMany: vi.fn().mockResolvedValue([{id:'m'}, {id:'b'}])},
    systemSetting: {findUnique: vi.fn(async ({where}: any) => settings.has(where.key) ? {value: settings.get(where.key)} : null),
      create: vi.fn(async ({data}: any) => settings.set(data.key, data.value))}};
  return {tx, settings};
}
// TEST: receipt context must not split a common SKU or silently assign old/offline scans.
describe('store receipt guard', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('does no reads when disabled for sold WMS', async () => {
    const {tx} = setup(); vi.stubEnv('WMS_CLIENT_STORES_ENABLED', 'false');
    expect(await assertStoreReceipt(tx, {clientId:'c', skuId:'shared'})).toBeNull();
    expect(tx.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('keeps receipt unchanged while the store directory is being configured',async()=>{
    const {tx}=setup();vi.stubEnv('WMS_CLIENT_STORE_RECEIPTS_ENABLED','false');
    expect(await assertStoreReceipt(tx,{clientId:'c',skuId:'shared'})).toBeNull();
    expect(tx.systemSetting.findUnique).not.toHaveBeenCalled();
  });
  it('allows the same physical SKU through either store', async () => {
    const {tx} = setup();
    for (const storeId of ['monlarti', 'braibo']) expect(await assertStoreReceipt(tx, {clientId:'c', skuId:'shared', storeId, sourceDocument:storeId})).toMatchObject({storeId});
    expect(tx.systemSetting.create).toHaveBeenCalledTimes(2);
  });
  it('rejects another store and does not persist receipt context', async () => {
    const {tx} = setup(['monlarti']);
    await expect(assertStoreReceipt(tx, {clientId:'c', skuId:'shared', storeId:'braibo', sourceDocument:'r'})).rejects.toThrow('не разрешён');
    expect(tx.systemSetting.create).not.toHaveBeenCalled();
  });
  it('does not infer a store for an old offline scan', async () => {
    const {tx} = setup();
    await expect(assertStoreReceipt(tx, {clientId:'c', skuId:'shared', sourceDocument:'r'})).rejects.toThrow('Старый скан');
    expect(tx.systemSetting.create).not.toHaveBeenCalled();
  });
  it('keeps one document bound to its original store on retries', async () => {
    const {tx} = setup(); const input={clientId:'c', skuId:'shared', storeId:'monlarti', sourceDocument:'r'};
    await assertStoreReceipt(tx,input); await assertStoreReceipt(tx,input);
    expect(tx.systemSetting.create).toHaveBeenCalledTimes(1);
    await expect(assertStoreReceipt(tx,{...input,storeId:'braibo'})).rejects.toThrow('другому магазину');
  });
  it('does not change clients without a configured directory', async () => {
    const {tx,settings}=setup();settings.delete(storeDirectoryKey('c'));
    expect(await assertStoreReceipt(tx,{clientId:'c',skuId:'shared'})).toBeNull();
  });
  it('rejects unknown SKU eligibility and duplicated membership',async()=>{
    const {tx}=setup();await expect(assertStoreReceipt(tx,{clientId:'c',skuId:'unknown',storeId:'monlarti',sourceDocument:'r'})).rejects.toThrow('разрешённые магазины');
    expect(()=>validateSkuStores(['monlarti','monlarti'],['monlarti'])).toThrow();
  });
  it('preserves the original store through the TSD parser',()=>{
    const parsed=new TsdPayloadParser().parseReceiptPayload({clientId:'c',skuId:'shared',quantity:1,storeId:'monlarti',sourceDocument:'r'});
    expect(parsed).toMatchObject({storeId:'monlarti',sourceDocument:'r',skuId:'shared'});
  });
  it('blocks the real receipt entry point before any balance or KIZ write',async()=>{
    const {tx}=setup(['monlarti']);tx.stockMovement={findUnique:vi.fn().mockResolvedValue(null),create:vi.fn()};
    tx.stockBalance={upsert:vi.fn()};tx.productMark={create:vi.fn()};
    const service:any=new StockOperationsService({$transaction:(fn:any)=>fn(tx)} as never,{requireClientAccess:vi.fn()} as never,{} as never);
    service.resolveWritableWarehouseId=()=> 'wh';
    service.resolveOrCreateSkuForReceipt=vi.fn().mockResolvedValue({createdDraft:false,sku:{id:'shared'}});
    service.ensureTargetBox=vi.fn();service.incrementTargetBalance=vi.fn();
    await expect(service.receiveIntoBox({clientId:'c',skuId:'shared',storeId:'braibo',boxCode:'FFL_1',quantity:1,sourceDocument:'r',idempotencyKey:'op'}, {id:'u',activeWarehouseId:'wh'})).rejects.toThrow('не разрешён');
    expect(service.ensureTargetBox).not.toHaveBeenCalled();expect(service.incrementTargetBalance).not.toHaveBeenCalled();
    expect(tx.stockMovement.create).not.toHaveBeenCalled();expect(tx.productMark.create).not.toHaveBeenCalled();
  });

});
