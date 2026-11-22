import {afterEach,expect,it,vi} from 'vitest';
import {closedSupplyMatches,closedSupplyBillingKeys} from '../src/modules/marketplace-connections/wb-closed-supply-proof';
afterEach(()=>vi.unstubAllEnvs());
// TEST: membership, closure, client isolation and default-disabled sold installation.
it('requires a closed supply with exact unique membership',()=>{
 expect(closedSupplyMatches(['1','2'],{done:true,orderIds:['2','1']})).toBe(true);
 for(const s of [{done:false,orderIds:['1','2']},{done:true,orderIds:['1']},{done:true,orderIds:['1','2','3']},{done:true,orderIds:['1','1']}])expect(closedSupplyMatches(['1','2'],s)).toBe(false);
});
it('does not read evidence when disabled',async()=>{vi.stubEnv('WMS_WB_CLOSED_SUPPLY_COMPLETION_ENABLED','false');expect(await closedSupplyBillingKeys({},'c')).toEqual(new Set());});
it('isolates persisted billing proof by client',async()=>{
 vi.stubEnv('WMS_WB_CLOSED_SUPPLY_COMPLETION_ENABLED','true');
 const db={systemSetting:{findMany:async()=>[{value:{clientId:'c',orders:[{connectionId:'cab',id:'1'}]}},{value:{clientId:'other',orders:[{connectionId:'cab',id:'2'}]}}]}};
 expect(await closedSupplyBillingKeys(db,'c')).toEqual(new Set(['cab:1']));
});
