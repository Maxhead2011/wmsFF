import { afterEach, expect, it, vi } from 'vitest';
import { onlinePlanView } from '../src/modules/tsd/online-plan-view';
afterEach(()=>vi.unstubAllEnvs());
// TEST: opt-in summaries do not ship hidden history and never mutate the shared full plan.
it('bounds history and preserves legacy, FBS and sold responses',()=>{
 const plan={picked:251,route:[{box:'x'}],pickedUnits:Array.from({length:251},(_,i)=>({id:String(i)}))};
 vi.stubEnv('WMS_MENU_READS_ENABLED','true');
 expect(onlinePlanView(plan,'summary')).toEqual({...plan,pickedUnits:[],pickedUnitsCount:251});
 expect((onlinePlanView(plan,'history','100') as any).pickedUnits).toEqual(plan.pickedUnits.slice(100,200));
 expect((onlinePlanView(plan,'history','-1') as any).pickedUnits).toEqual(plan.pickedUnits.slice(0,100));
 expect(onlinePlanView(plan)).toBe(plan);expect(plan.pickedUnits).toHaveLength(251);
 expect(onlinePlanView({id:'fbs'},'summary')).toEqual({id:'fbs'});
 expect((onlinePlanView({id:'r',fbo:plan},'summary') as any).fbo.pickedUnits).toEqual([]);
 vi.stubEnv('WMS_MENU_READS_ENABLED','false');expect(onlinePlanView(plan,'summary')).toBe(plan);
});
