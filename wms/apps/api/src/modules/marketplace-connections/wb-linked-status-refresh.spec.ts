import {describe, expect, it, vi} from 'vitest';
import {refreshLinkedWbStatuses} from './wb-linked-status-refresh';

describe('WB linked orders', () => {
  it('updates the ready order even when WB omits another order of the same request', async () => {
    // TEST: no history discovery, a missing WB row must not hide its sibling from TSD.
    const rows = ['100','101'].map(id => ({id,orderId:id,requestId:'req',updatedAt:new Date(),lastSupplierStatus:'new',lastWbStatus:'waiting',lastCategory:'active'}));
    const updateMany=vi.fn().mockResolvedValue({count:1});
    const db={clientMarketplaceConnection:{findMany:async()=>[{id:'cab',clientId:'client',apiKey:'key'}]},fbsOrderRequestLink:{findMany:async()=>rows,updateMany}};
    const read=vi.fn(async()=>new Map([['101',{supplierStatus:'confirm',wbStatus:'waiting'}]]));
    await refreshLinkedWbStatuses(db as never,read,()=> 'active',()=>{});
    expect(read).toHaveBeenCalledWith('key',['100','101']);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0]).toMatchObject({where:{id:'101',connectionId:'cab',clientId:'client',requestId:'req',syncStatus:'ACTIVE',updatedAt:rows[1].updatedAt},data:{lastSupplierStatus:'confirm',lastWbStatus:'waiting',lastCategory:'active'}});
  });
});
