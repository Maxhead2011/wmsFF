import { describe, expect, it } from 'vitest';
import { resolveAdminNotificationTarget } from './adminNotificationTarget';
// TEST: missing boxes must open storage rather than their technical inventory signal.
const item = { id: 1, type: 'MISSING_PALLET_BOX', title: 'Сигнал', body: 'Гулрух · [FBS_MISSING_PALLET_BOX] Короб: FFL_LKB0409_315; паллетсорт: PALET_SORT_102', createdAt: '', isRead: false, clientId: 'client', warehouseId: 'warehouse', sessionId: 'signal' };
describe('operational notification destinations', () => {
 it('opens the exact client box from existing notifications', () => expect(resolveAdminNotificationTarget(item)).toEqual({workspace:'warehouse',clientId:'client',boxCode:'FFL_LKB0409_315',warehouseId:'warehouse'}));
 it.each(['BOX_CHECK_STARTED','BOX_CHECK_OPENED'])('opens the exact reconciliation for %s', type => expect(resolveAdminNotificationTarget({...item,type,auditBoxId:'audit'})).toEqual({workspace:'inventory',sessionId:'signal',auditBoxId:'audit'}));
 it('does not guess a box from a malformed signal', () => expect(()=>resolveAdminNotificationTarget({...item,body:'Нет короба'})).toThrow());
 it('keeps the product problem linked to its request', () => expect(resolveAdminNotificationTarget({...item,type:'PRODUCT_PROBLEM',sessionId:null,requestId:'request'})).toEqual({workspace:'requests',requestId:'request'}));
 it('does not silently read a notification without destination', () => expect(()=>resolveAdminNotificationTarget({...item,type:'BOX_CHECK_STARTED',sessionId:null})).toThrow());
});
