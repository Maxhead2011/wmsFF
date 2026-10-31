import {afterEach,expect,it,vi} from 'vitest';
import {validateFboPackedBoxes,fboCompletionPackages,saveFboCompletionSelections,fboCompletionError} from '../src/modules/tsd/fbo-completion-batch';
const r={id:'r',clientId:'c',warehouseId:'w',items:[{id:'i',skuId:'s'}]};
function fixture(n=159){
 const boxes=Array.from({length:n},(_,i)=>({boxId:'b'+i,boxCode:'BOX'+i}));
 const units=boxes.map(b=>({targetBoxId:b.boxId,requestItemId:'i',skuId:'s',state:'PACKED',markId:'m'+b.boxId}));
 const physical=boxes.map(b=>({id:b.boxId,clientId:'c',warehouseId:'w',status:'active'}));
 const balances=boxes.map(b=>({boxId:b.boxId,clientId:'c',warehouseId:'w',skuId:'s',status:'PACKING',quantity:1}));
 const marks=units.map(u=>({id:u.markId,boxId:u.targetBoxId,skuId:'s',status:'PACKING'}));
 const tx:any={$queryRaw:vi.fn(async()=>[]),box:{findMany:vi.fn(async()=>physical)},stockBalance:{findMany:vi.fn(async()=>balances)},productMark:{findMany:vi.fn(async()=>marks)},clientRequestBoxSelection:{deleteMany:vi.fn(),createMany:vi.fn()}};
 return {boxes,units,physical,balances,marks,tx};
}
afterEach(()=>vi.unstubAllEnvs());
// TEST: constant read count for159 cartons, including exact marks and foreign stock guards.
it('validates159 cartons with four database calls and saves selections in one batch',async()=>{
 const {boxes,units,tx}=fixture();await validateFboPackedBoxes(tx,r,boxes,units);
 for(const mock of [tx.$queryRaw,tx.box.findMany,tx.stockBalance.findMany,tx.productMark.findMany])expect(mock).toHaveBeenCalledTimes(1);
 const packages=fboCompletionPackages(r,boxes,units);expect(packages).toHaveLength(159);
 await saveFboCompletionSelections(tx,r,boxes,packages);expect(tx.clientRequestBoxSelection.createMany).toHaveBeenCalledTimes(1);
 expect(tx.clientRequestBoxSelection.createMany.mock.calls[0][0].data).toHaveLength(159);
});
it.each(['foreign','quantity','mark','missing','archived','extraSku','wrongBox','duplicateMark'])('rejects %s mismatch',async kind=>{
 const f=fixture(2);if(kind==='foreign')f.balances[0].clientId='other';
 if(kind==='quantity')f.balances[0].quantity=2;if(kind==='mark')f.marks[0].status='AVAILABLE';
 if(kind==='missing')f.physical.pop();if(kind==='archived')f.physical[0].status='archived';
 if(kind==='extraSku')f.balances.push({...f.balances[0],skuId:'other'});
 if(kind==='wrongBox')f.units[0].targetBoxId='other';
 if(kind==='duplicateMark'){f.units.push({...f.units[0]});f.balances[0].quantity++;}
 await expect(validateFboPackedBoxes(f.tx,r,f.boxes,f.units)).rejects.toThrow();
});
it('ignores returned units and preserves item ordering and quantities',()=>{
 const f=fixture(1);const request={...r,items:[{id:'j',skuId:'t'},...r.items]};
 expect(fboCompletionPackages(request,f.boxes,[...f.units,{...f.units[0],requestItemId:'j',skuId:'t'},...f.units,{...f.units[0],state:'RETURNED'}])[0].items)
 .toEqual([{requestItemId:'j',quantity:1},{requestItemId:'i',quantity:2}]);
});
it('leaves errors unchanged with flag off and never conceals business conflicts',()=>{
 const e={code:'P2028'};expect(fboCompletionError(e)).toBe(e);vi.stubEnv('WMS_FBO_COMPLETION_RELIABILITY_ENABLED','true');
 expect(fboCompletionError(e).getStatus()).toBe(503);const business=new Error('KIZ duplicate');expect(fboCompletionError(business)).toBe(business);
});
