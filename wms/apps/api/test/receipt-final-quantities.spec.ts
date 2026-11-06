import {expect,it} from 'vitest';
import {receiptFinalQuantities} from '../src/modules/warehouse/receipt-final-quantities';
const row=(boxId:string,skuId:string,quantity:number,id:string)=>({boxId,skuId,quantity,id,createdAt:new Date('2026-11-06')});
// TEST: correction rows disappear; each box/SKU contains its final accepted quantity.
it('consolidates signed corrections, drops cancelled rows and preserves 961',()=>{
 const input=[row('a','s',953,'original'),row('a','s',-2,'minus'),row('a','s',10,'plus'),row('a','cancel',1,'x'),row('a','cancel',-1,'y')];
 const output=receiptFinalQuantities(input);expect(output).toEqual([{...input[0],quantity:961}]);expect(input[0].quantity).toBe(953);
});
it('does not mix boxes or SKUs',()=>expect(receiptFinalQuantities([row('a','s',2,'1'),row('b','s',3,'2'),row('a','other',4,'3')])).toHaveLength(3));
it('rejects a negative final quantity instead of silently hiding a discrepancy',()=>expect(()=>receiptFinalQuantities([row('a','s',-1,'bad')])).toThrow());
