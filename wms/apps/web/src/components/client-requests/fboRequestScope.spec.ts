import {describe,it,expect} from 'vitest';
import {isWbFboRequest} from './fboRequestScope';
import type {ClientRequestSummary} from '../../lib/api';
describe('FBO marketplace list separation',()=>{
  const row={type:'OUTBOUND',title:'Кросс-докинг',comment:null,_count:{fbsOrderLinks:0}} as ClientRequestSummary;
  // TEST: Ozon1861 has an arbitrary title, so membership must use the persisted shipment relation.
  it('excludes Ozon regardless of title or status',()=>{
    for(const status of ['SUBMITTED','IN_WORK','DONE'] as const)
      expect(isWbFboRequest({...row,status,ozonShipment:{requestId:'ozon-1861'}})).toBe(false);
  });
  it('retains ordinary WB outbound requests',()=>{
    expect(isWbFboRequest({...row,ozonShipment:null})).toBe(true);
    expect(isWbFboRequest(row)).toBe(true);
  });
});
