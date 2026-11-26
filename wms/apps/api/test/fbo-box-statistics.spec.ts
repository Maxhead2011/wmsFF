import {it,expect,vi} from 'vitest';
import {fboBoxStatistics} from '../src/modules/tsd/fbo-box-statistics';
import {onlinePlanView} from '../src/modules/tsd/online-plan-view';
// TEST: remaining picking is route work only, never previously picked/packed boxes.
it('separates remaining partial units from whole-box picking and loose storage',()=>{
 const units=[{state:'PICKED',sourceBoxCode:'DONE',wholeBox:true},{state:'PACKED',sourceBoxCode:'OLD',wholeBox:false}];
 const route=[{boxCode:'A',wholeBox:true,tasks:[{quantity:7},{quantity:3}]},{boxCode:'B',wholeBox:true,tasks:[{quantity:20}]},{boxCode:'C',wholeBox:false,tasks:[{quantity:4}]}];
 expect(fboBoxStatistics(units,route,[],2)).toMatchObject({remainingPartialPickUnits:6,remainingWholePickBoxes:2,remainingWholePickUnits:30,remainingWholeBoxes:1});
 expect(fboBoxStatistics(units,[],[])).toMatchObject({remainingPartialPickUnits:0,remainingWholePickBoxes:0,remainingWholePickUnits:0});
});
// TEST: duplicates, returns, open/empty parcels and completed routes cannot inflate totals.
it('counts distinct sources, closed nonempty parcels and completed plus remaining work',()=>{
 const units=[{state:'PACKED',sourceBoxCode:'A',wholeBox:true,targetBoxId:'X'},{state:'PACKED',sourceBoxCode:'A',wholeBox:true,targetBoxId:'X'},{state:'PICKED',sourceBoxCode:'B',wholeBox:false},{state:'RETURNED',sourceBoxCode:'C',wholeBox:true},{state:'PACKED',sourceBoxCode:'B',wholeBox:false,targetBoxId:'Y'}];
 const route=[{boxCode:'D',wholeBox:true,tasks:[{quantity:20}]},{boxCode:'E',wholeBox:false,tasks:[{quantity:3},{quantity:2}]}];
 const boxes=[{boxId:'X',closedAt:new Date()},{boxId:'Y',closedAt:null},{boxId:'EMPTY',closedAt:new Date()}];
 expect(fboBoxStatistics(units,route,boxes)).toEqual({remainingWholeBoxes:0,pickedBoxes:2,packedBoxes:1,partialUnits:7,wholeBoxes:2,remainingPartialPickUnits:5,remainingWholePickBoxes:1,remainingWholePickUnits:20});
 expect(fboBoxStatistics(units,[],boxes)).toEqual({remainingWholeBoxes:0,pickedBoxes:2,packedBoxes:1,partialUnits:2,wholeBoxes:1,remainingPartialPickUnits:0,remainingWholePickBoxes:0,remainingWholePickUnits:0});
});
it('retains totals in summary and excludes loose storage from box count',()=>{
 const boxStatistics=fboBoxStatistics([{state:'PICKED',sourceBoxCode:'',wholeBox:false}],[],[],4);
 expect(boxStatistics).toEqual({remainingWholeBoxes:0,pickedBoxes:0,packedBoxes:0,partialUnits:5,wholeBoxes:0,remainingPartialPickUnits:4,remainingWholePickBoxes:0,remainingWholePickUnits:0});
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
