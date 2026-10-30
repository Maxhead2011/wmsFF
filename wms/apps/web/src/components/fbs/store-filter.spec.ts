import {describe,it,expect} from 'vitest';
import {filterOrdersByStore} from './store-filter';
// TEST: equal marketplace order IDs across stores remain separate and missing mappings stay visible.
describe('store order filter',()=>{
 const stores=[{id:'monlarti',name:'Монларти',connectionIds:['m1','m2']},{id:'braibo',name:'Брайбо',connectionIds:['b1','b2']}];
 const orders=[{id:'1',connectionId:'m1'},{id:'1',connectionId:'b1'},{id:'2',connectionId:'m2'},{id:'3',connectionId:'unknown'}];
 it('keeps all orders in All',()=>expect(filterOrdersByStore(orders,stores,'all')).toEqual(orders));
 it('filters both marketplaces of the same store',()=>expect(filterOrdersByStore(orders,stores,'monlarti')).toEqual([orders[0],orders[2]]));
 it('shows unassigned rather than guessing a store',()=>expect(filterOrdersByStore(orders,stores,'unassigned')).toEqual([orders[3]]));
 it('does not fall back to all for a stale selected store',()=>expect(filterOrdersByStore(orders,stores,'deleted')).toEqual([]));
});
