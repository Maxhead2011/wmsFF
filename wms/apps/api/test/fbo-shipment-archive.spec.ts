import { describe,it,expect,vi,afterEach } from 'vitest';
import { captureShippedKizHistory } from '../src/common/shipment-history/shipped-kiz-history';
afterEach(()=>vi.unstubAllEnvs());
// TEST: FBO-only shipment must populate the same archive and preserve later returns on resync.
function fixture(status='PACKED') {
 const date=new Date('2026-09-21T12:00:00Z');
 return {clientRequest:{findUnique:async()=>({id:'r',number:1029,title:'FBO',clientId:'c',warehouseId:'w',client:{name:'Client'},status,updatedAt:date})},
 fbsTsdAssembly:{findMany:async()=>[]}, fbsAssemblyAttemptHistory:{findMany:async()=>[]},
 fboAssemblyUnit:{findMany:async()=>[{id:'u',skuId:'s',kiz:'full-code',barcode:'123',sourceBoxCode:'source',targetBoxId:'target',markId:'mark',state:'PACKED',pickedAt:date}]},
 sku:{findMany:async()=>[{id:'s',internalSku:'s',name:'Suit',article:'a',size:'L'}]},
 shippedKizHistory:{createMany:vi.fn(async()=>({count:1}))},productMark:{updateMany:vi.fn(async()=>({count:1}))}};
}
describe('FBO shipment archive',()=>{
 it('archives exact packed KIZ on confirmed shipment',async()=>{
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const db=fixture(); const at=new Date();
  expect(await captureShippedKizHistory(db as never,'r',at)).toBe(1);
  expect(db.shippedKizHistory.createMany).toHaveBeenCalledWith({skipDuplicates:true,data:[expect.objectContaining({assemblyId:'fbo:u',requestNumber:1029,kiz:'full-code',sourceBoxCode:'source',shippedAt:at})]});
  expect(db.productMark.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'mark',boxId:'target',status:'SHIPPING'}),data:{boxId:null}}));
 });
 it('does not archive merely packed stock',async()=>{vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const db=fixture();expect(await captureShippedKizHistory(db as never,'r')).toBe(0);expect(db.shippedKizHistory.createMany).not.toHaveBeenCalled();});
 it('history rebuild never changes returned marks',async()=>{vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const db=fixture('DONE');await captureShippedKizHistory(db as never,'r');expect(db.productMark.updateMany).not.toHaveBeenCalled();});
 it('leaves sold installation unchanged',async()=>{vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','false');const db=fixture();expect(await captureShippedKizHistory(db as never,'r',new Date())).toBe(0);expect(db.shippedKizHistory.createMany).not.toHaveBeenCalled();});
});
