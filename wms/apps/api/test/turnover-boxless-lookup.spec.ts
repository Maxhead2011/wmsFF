import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TurnoverService } from '../src/modules/turnover/turnover.service';

function fixture() {
  const db={box:{findFirst:vi.fn().mockResolvedValue(null)}};
  const scopes={resolveClientFilter:vi.fn((_user:unknown,clientId:string)=>clientId)};
  const service=new TurnoverService(db as never,scopes as never);
  (service as any).resolveWarehouseScope=vi.fn().mockResolvedValue(null);
  return {db,scopes,service};
}
describe('turnover box lookup isolation',()=>{
  // TEST: do not resolve a synthetic location to a legacy Box called "Без короба".
  it.each(['Без короба','  БЕЗ КОРОБА  '])('rejects the virtual label %s before any box lookup',async label=>{
    const {db,service}=fixture();
    await expect(service.boxDetails(label,{},{roleCodes:[],permissionCodes:[]} as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(db.box.findFirst).not.toHaveBeenCalled();
  });
  // TEST: a normal box code retains client filtering and regular not-found behavior.
  it('keeps the requested client scope for real boxes',async()=>{
    const {db,service}=fixture();
    await expect(service.boxDetails(' FFL_001 ',{clientId:'lukin'},{roleCodes:[],permissionCodes:[]} as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.box.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({clientId:'lukin',code:{equals:'FFL_001',mode:'insensitive'}})}));
  });
});
