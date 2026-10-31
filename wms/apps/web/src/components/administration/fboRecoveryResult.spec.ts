import {expect,it,vi} from 'vitest';
import {applyRecoveryResult,fboRecoveryFailure} from './fboRecoveryResult';
// TEST: timeout/lost acknowledgement must preserve the token, including a successful commit hidden by network loss.
it('retains receipt identity on an uncertain mutation result',async()=>{
 const ack=vi.fn(),refresh=vi.fn();await expect(applyRecoveryResult(async()=>{throw Error('timeout')},ack,refresh)).rejects.toThrow('timeout');
 expect(ack).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();
});
it('reports committed operation separately from a failed details refresh',async()=>{
 const ack=vi.fn();expect(await applyRecoveryResult(async()=>({applied:true}),ack,async()=>{throw Error('offline')})).toEqual({details:null,refreshFailed:true});
 expect(ack).toHaveBeenCalledTimes(1);
});
it('refreshes after receipt acknowledgement',async()=>{
 const order:string[]=[];const result=await applyRecoveryResult(async()=>{order.push('apply')},()=>{order.push('ack')},async()=>{order.push('refresh');return {phase:'COMPLETED'}});
 expect(order).toEqual(['apply','ack','refresh']);expect(result.details?.phase).toBe('COMPLETED');
});
it('explains technical failures without hiding stock or KIZ errors',()=>{
 expect(fboRecoveryFailure(Error('Internal server error'))).toContain('Проверить результат');
 expect(fboRecoveryFailure(Error('КИЗ занят другой сборкой'))).toBe('КИЗ занят другой сборкой');
});
