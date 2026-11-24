import {describe,it,expect} from 'vitest';
import {payrollAdvanceSummary} from './PayrollAdvances';
// TEST: the visible payout subtracts remaining credit, not all historical advance amounts.
describe('payroll advance summary',()=>{
 const people=[{id:'a',name:'Employee',isActive:true},{id:'alias',name:'Alias',isActive:true,payrollPrimaryId:'a'},{id:'b',name:'Other',isActive:true}];
 it('shows a prior-period credit in the next payout without double counting aliases',()=>{
  const rows=[{key:'1',employeeId:'a',amountKopecks:300000,status:'UNPAID'},{key:'2',employeeId:'alias',amountKopecks:300000,status:'UNPAID'},{key:'3',employeeId:'a',amountKopecks:792138,status:'PAID'}];
  const credits=[{id:'c',employeeId:'a',issuedDate:'2026-10-30',amountKopecks:438439,remainingKopecks:438439,kind:'OVERPAYMENT',reason:'correction',cancelledAt:null}];
  expect(payrollAdvanceSummary(people,rows,credits,'2026-11-01','2026-11-30')).toEqual([{id:'a',name:'Employee',gross:600000,balance:438439,used:438439,net:161561,period:0}]);
 });
 it('carries unused balance and excludes cancelled advances',()=>{
  const credits=[{id:'a',employeeId:'a',issuedDate:'2026-11-02',amountKopecks:500,remainingKopecks:200,kind:'ADVANCE',reason:'cash',cancelledAt:null},{id:'b',employeeId:'a',issuedDate:'2026-11-02',amountKopecks:900,remainingKopecks:900,kind:'ADVANCE',reason:'error',cancelledAt:'2026-11-03'}];
  expect(payrollAdvanceSummary(people,[{key:'1',employeeId:'a',amountKopecks:100,status:'UNPAID'}],credits,'2026-11-01','2026-11-30')[0]).toMatchObject({gross:100,balance:200,used:100,net:0,period:500});
 });
});
