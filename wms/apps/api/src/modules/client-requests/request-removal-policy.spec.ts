import {describe,it,expect} from 'vitest';
import {removalBlockers, canRemoveRequests, ADMIN_REMOVED} from './request-removal-policy';

// TEST: deletion must not hide physical work or allow non-administrative users.
describe('request removal policy',()=>{
 it('is opt-in and restricted to administrator/owner',()=>{
  expect(canRemoveRequests({roleCodes:['ADMIN']},true)).toBe(true);
  expect(canRemoveRequests({roleCodes:['OWNER']},true)).toBe(true);
  for(const user of [{roleCodes:['CLIENT']},{roleCodes:['WORKER']},{roleCodes:['ADMIN'],isDemo:true}]) expect(canRemoveRequests(user,true)).toBe(false);
  expect(canRemoveRequests({roleCodes:['OWNER']},false)).toBe(false);
 });
 const empty={type:'OUTBOUND',status:'SUBMITTED',physical:0,activeWaves:0,deliveries:0};
 it('allows untouched outbound requests',()=>expect(removalBlockers(empty)).toEqual([]));
 it.each(['DONE','PACKED','CANCELLED','REJECTED'])('blocks terminal/packed %s',status=>expect(removalBlockers({...empty,status}).length).toBeGreaterThan(0));
 it.each(['physical','activeWaves','deliveries'])('blocks %s',field=>expect(removalBlockers({...empty,[field]:1}).length).toBeGreaterThan(0));
 it('does not delete receipts',()=>expect(removalBlockers({...empty,type:'INBOUND'}).length).toBeGreaterThan(0));
 it('has a distinct durable link marker',()=>expect(ADMIN_REMOVED).toBe('ADMIN_REMOVED'));
});
