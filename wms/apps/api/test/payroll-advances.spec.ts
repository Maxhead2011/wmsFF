import { describe, expect, it } from 'vitest';
import { planPayrollAdvances, requirePayrollAdvances } from '../src/modules/expenses/payroll-advances';
// TEST: a previous overpayment must reduce cash once, without reducing earned wages.
describe('payroll advance allocation', () => {
  const row = (key: string, amountKopecks: number, rootId='a') => ({key,amountKopecks,rootId});
  const credit = (id: string, remainingKopecks: number, rootId='a') => ({id,remainingKopecks,rootId});
  it('deducts the agreed overpayment from the next payout', () => {
    const p=planPayrollAdvances([row('day',600000)],[credit('overpayment',438439)]);
    expect(p).toMatchObject({grossKopecks:600000,deductedKopecks:438439,netKopecks:161561});
    expect(p.allocations).toEqual([{advanceId:'overpayment',settlementKey:'day',amountKopecks:438439}]);
  });
  it('carries the excess forward without negative cash',()=>{
    expect(planPayrollAdvances([row('day',100000)],[credit('advance',438439)])).toMatchObject({netKopecks:0,deductedKopecks:100000});
  });
  it('does not deduct another employee or an already used balance',()=>{
    expect(planPayrollAdvances([row('day',100000)],[credit('used',0),credit('other',900000,'b')])).toMatchObject({netKopecks:100000,deductedKopecks:0});
  });
  it('allocates deterministically across rows without double spending',()=>{
    const p=planPayrollAdvances([row('one',100),row('two',300)],[credit('first',200),credit('second',300)]);
    expect(p.allocations).toEqual([{advanceId:'first',settlementKey:'one',amountKopecks:100},{advanceId:'first',settlementKey:'two',amountKopecks:100},{advanceId:'second',settlementKey:'two',amountKopecks:200}]);
    expect(p.netKopecks).toBe(0);
  });
  it('keeps the feature unavailable when the own-WMS flag is disabled',()=>{const old=process.env.WMS_PAYROLL_ADVANCES_ENABLED;try{delete process.env.WMS_PAYROLL_ADVANCES_ENABLED;expect(()=>requirePayrollAdvances()).toThrow('Авансы ФОТ не включены.');}finally{if(old===undefined)delete process.env.WMS_PAYROLL_ADVANCES_ENABLED;else process.env.WMS_PAYROLL_ADVANCES_ENABLED=old;}});
  it('rejects duplicate selections and invalid amounts',()=>{
    expect(()=>planPayrollAdvances([row('x',1),row('x',1)],[])).toThrow();
    expect(()=>planPayrollAdvances([row('x',-1)],[])).toThrow();
  });
});
