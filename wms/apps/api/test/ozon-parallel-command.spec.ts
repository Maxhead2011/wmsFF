// TEST: execute the actual command handler through the phase guard, not just the plan flag.
import {it as test, afterEach, vi} from 'vitest';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
afterEach(()=>vi.unstubAllEnvs());
import {FboTwoStageService as S} from '../src/modules/tsd/fbo-two-stage.service';
function fixture(count=1,enabled=true){
 vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');vi.stubEnv('WMS_FBO_PARALLEL_PACKING_ENABLED',String(enabled));
 const r={id:'r',status:'IN_WORK',items:[{id:'i',skuId:'sku',barcode:'barcode',quantity:2}]};
 const hash=createHash('sha256').update(JSON.stringify([['i','sku','barcode',2]])).digest('hex');
 const tx={$queryRaw:async()=>[],ozonFboShipment:{findUnique:async()=>({directions:[{name:'Краснодар',items:[{skuId:'sku',barcode:'barcode',quantity:2}]}]})},fboAssemblyAction:{findUnique:async()=>null},fboAssembly:{findUnique:async()=>({phase:'PICKING',compositionHash:hash})},fboAssemblyUnit:{findMany:async()=>Array.from({length:count},()=>({requestItemId:'i',skuId:'sku',barcode:'barcode',state:'PICKED'}))},fboAssemblyBox:{findMany:async()=>[]}};
 const s:any=new S({$transaction:fn=>fn(tx)},{},{},{},{assertStockMovementsAllowed:async()=>{}},{});s.load=async()=>r;s.requireFbo=()=>{};s.fastAcknowledgementEnabled=()=>false;
 const reached=Error('PACKING_GUARD_PASSED');s.target=async()=>{throw reached};s.box=async()=>{throw reached};return {s,reached};
}
for(const action of ['OPEN_BOX','PACK_UNIT'])test(action+' accepts partial Ozon pick',async()=>{
 const {s,reached}=fixture();await assert.rejects(()=>s.act('r',{action,operationId:'op',direction:'Краснодар',targetBoxCode:'BOX',barcode:'barcode'},{id:'worker'}),e=>e===reached);
});
for(const [count,enabled]of [[0,true],[1,false]])test('packing remains blocked '+count+'/'+enabled,async()=>{
 const{s,reached}=fixture(count,enabled);await assert.rejects(()=>s.act('r',{action:'OPEN_BOX',operationId:'op',direction:'Краснодар',targetBoxCode:'BOX'},{id:'worker'}),e=>e!==reached&&e.message.includes('Этап изменился'));
});
