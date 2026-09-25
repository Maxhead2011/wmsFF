import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';

afterEach(() => vi.unstubAllEnvs());
describe('bounded physical box search', () => {
  // TEST: the production failure expanded an unrelated box into all 114 orders.
  it('does not resolve all orders when the box has no matching direct or relabel SKU', async () => {
    vi.stubEnv('WMS_FBS_BOX_SCAN_BOUNDED_ENABLED', 'true');
    const db: any = {
      stockBalance: { findMany: vi.fn().mockResolvedValue([{ skuId: 'unrelated', quantity: 1 }]) },
      fbsTsdAssembly: { findMany: vi.fn().mockResolvedValue([]) },
      client: { findUnique: vi.fn().mockResolvedValue({ relabelingEnabled: true }) },
      sku: { findMany: vi.fn().mockResolvedValue([{ id: 'unrelated', article: 'other', size: 'S' }]) },
      clientArticleMapping: { findMany: vi.fn().mockResolvedValue([]) },
      fbsOrderRequestLink: { findFirst: vi.fn().mockResolvedValue({ id: 'link' }) },
    };
    const s = new MarketplaceConnectionsService(db, {} as never) as any;
    const local = vi.spyOn(s, 'loadFbsTsdRequestOrders').mockImplementation(async (...args: any[]) => ({ orders: args[2] ? [] : Array.from({length:114},(_,i)=>({id:String(i),marketplace:'WILDBERRIES',connectionId:'wb',category:'active',supplierStatus:'confirm',wbStatus:'waiting',request:{id:'r'},product:{id:`sku${i}`}})) }));
    const resolve = vi.spyOn(s, 'resolveFbsTsdStockSource').mockResolvedValue(null);
    vi.spyOn(s, 'loadFbsOrders').mockRejectedValue(new Error('unexpected WB request'));
    expect(await s.switchFbsTsdAssemblyToBox({id:'current',clientId:'client',requestId:'r',connectionId:'wb',marketplace:'WILDBERRIES'}, {id:'box',code:'FFL_BOX'}, {})).toBeNull();
    expect(local.mock.calls.every(call => Array.isArray(call[2]) && call[2].length > 0)).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });
  // TEST: concurrent identical scans must execute ownership/business handling once.
  it('coalesces pending scans but retries after the operation settles', async () => {
    vi.stubEnv('WMS_FBS_BOX_SCAN_BOUNDED_ENABLED', 'true');
    const s = new MarketplaceConnectionsService({} as never, {} as never) as any;
    let reject!: (e: Error)=>void;
    const load = vi.spyOn(s, 'loadOwnedFbsTsdAssembly').mockImplementation(()=>new Promise((_,r)=>{reject=r;}));
    const user={id:'u',deviceCode:'d'};
    const a=s.scanFbsTsdBox('task',{boxCode:'FFL_BOX'},user);
    const b=s.scanFbsTsdBox('task',{boxCode:'FFL_BOX'},user);
    const result=Promise.allSettled([a,b]);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    reject(new Error('test rejection')); await result;
    load.mockRejectedValue(new Error('new request'));
    await expect(s.scanFbsTsdBox('task',{boxCode:'FFL_BOX'},user)).rejects.toThrow('new request');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
