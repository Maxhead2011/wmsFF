import {expect,it} from 'vitest';
import {preparePickingBoxes, routeBoxSelect} from '../src/modules/tsd/fbo-pick-plan-reads';

// TEST: partial picking still requires historical AVAILABLE marks and keeps natural pallet order.
it('scans mark rows once regardless of the number of requested SKUs', () => {
  let reads=0;
  const mark={get skuId(){reads++;return 'historical';},status:'AVAILABLE'};
  const lines=[{skuId:'historical',requiresKiz:false},{skuId:'blocked',requiresKiz:false},
    {skuId:'configured',requiresKiz:true},...Array.from({length:174},(_,i)=>({skuId:String(i),requiresKiz:false}))];
  const boxes=[
    {code:'BOX_12',storagePlacement:null,pallet:{code:'PAL_10'},productMarks:[mark]},
    {code:'BOX_2',storagePlacement:{pallet:{code:'PAL_2'}},pallet:null,productMarks:[{skuId:'blocked',status:'BLOCKED'}]},
    {code:'BOX_1',storagePlacement:null,pallet:{code:'PAL_2'},productMarks:[]},
  ];
  preparePickingBoxes(boxes,lines);
  expect(boxes.map(b=>b.code)).toEqual(['BOX_1','BOX_2','BOX_12']);
  expect(lines.filter(l=>l.requiresKiz).map(l=>l.skuId)).toEqual(['historical','configured']);
  expect(reads).toBe(1);
  expect(routeBoxSelect.productMarks.where).toEqual({status:{not:'SHIPPING'}});
  expect(routeBoxSelect.productMarks.select).toEqual({value:true,skuId:true,status:true});
  expect(routeBoxSelect.balances.select).toEqual({skuId:true,quantity:true,status:true});
});