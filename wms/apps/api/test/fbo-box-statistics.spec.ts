import {it,expect,vi} from 'vitest';
import {fboBoxStatistics} from '../src/modules/tsd/fbo-box-statistics';
import {onlinePlanView} from '../src/modules/tsd/online-plan-view';
// TEST: duplicates, returns, open/empty parcels and completed routes cannot inflate totals.
it('counts distinct sources, closed nonempty parcels and completed plus remaining work',()=>{
 const units=[{state:'PACKED',sourceBoxCode:'A',wholeBox:true,targetBoxId:'X'},{state:'PACKED',sourceBoxCode:'A',wholeBox:true,targetBoxId:'X'},{state:'PICKED',sourceBoxCode:'B',wholeBox:false},{state:'RETURNED',sourceBoxCode:'C',wholeBox:true},{state:'PACKED',sourceBoxCode:'B',wholeBox:false,targetBoxId:'Y'}];
 const route=[{boxCode:'D',wholeBox:true,tasks:[{quantity:20}]},{boxCode:'E',wholeBox:false,tasks:[{quantity:3},{quantity:2}]}];
 const boxes=[{boxId:'X',closedAt:new Date()},{boxId:'Y',closedAt:null},{boxId:'EMPTY',closedAt:new Date()}];
 expect(fboBoxStatistics(units,route,boxes)).toEqual({remainingWholeBoxes:0,pickedBoxes:2,packedBoxes:1,partialUnits:7,wholeBoxes:2});
 expect(fboBoxStatistics(units,[],boxes)).toEqual({remainingWholeBoxes:0,pickedBoxes:2,packedBoxes:1,partialUnits:2,wholeBoxes:1});
});
it('retains totals in summary and excludes loose storage from box count',()=>{
 const boxStatistics=fboBoxStatistics([{state:'PICKED',sourceBoxCode:'',wholeBox:false}],[],[],4);
 expect(boxStatistics).toEqual({remainingWholeBoxes:0,pickedBoxes:0,packedBoxes:0,partialUnits:5,wholeBoxes:0});
 vi.stubEnv('WMS_MENU_READS_ENABLED','true');expect(onlinePlanView({boxStatistics,pickedUnits:[{}]},'summary')).toMatchObject({boxStatistics,pickedUnits:[]});vi.unstubAllEnvs();
});

// TEST: whole boxes count once regardless of units; packing removes only the packed box.
it('counts only picked whole boxes awaiting packing',()=>{
 const whole=(sourceBoxCode:string,state='PICKED')=>({sourceBoxCode,state,wholeBox:true});
 const units=[whole('A'),whole('A'),whole('B'),whole('C','PACKED'),whole('D','RETURNED'),{...whole('E'),wholeBox:false}];
 expect(fboBoxStatistics(units,[],[])).toMatchObject({remainingWholeBoxes:2});
 expect(fboBoxStatistics(units.map(u=>u.sourceBoxCode==='A'?{...u,state:'PACKED'}:u),[],[])).toMatchObject({remainingWholeBoxes:1});
 expect(fboBoxStatistics([], [{boxCode:'FUTURE',wholeBox:true,tasks:[{quantity:50}]}],[])).toMatchObject({remainingWholeBoxes:0});
});
