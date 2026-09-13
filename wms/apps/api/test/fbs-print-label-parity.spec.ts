import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { MarketplaceConnectionsController } from '../src/modules/marketplace-connections/marketplace-connections.controller';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { fitSortingWarehouse } from '../src/modules/marketplace-connections/fbs-sorting-label';

const user={id:'operator',name:'Склад',roleCodes:['TSD','OPERATOR'],permissionCodes:['print:write'],clientScopeMode:'ALL',clientIds:[]};
const task={id:'assembly',clientId:'client',requestId:'request',connectionId:'connection',orderId:'5497088111',kiz:'unique-mark',productName:'Костюм',article:'A',boxCode:'BOX',supplyId:'WB-GI-1'};
function fixture(){
 const job={id:'job',stationId:'station',requestNumber:832,orderId:task.orderId,warehouseName:'Коледино',status:'QUEUED'};
 const db={fbsTsdAssembly:{findMany:vi.fn().mockResolvedValue([task]),findUnique:vi.fn().mockResolvedValue(task)},fbsWebKizStickerPrint:{findFirst:vi.fn().mockResolvedValue(null),create:vi.fn().mockResolvedValue({id:'history'}),findUnique:vi.fn().mockResolvedValue({...task,assemblyId:task.id})},clientRequest:{findUnique:vi.fn().mockResolvedValue({number:832})},fbsSupplyPlan:{findFirst:vi.fn().mockResolvedValue({marketplaceWarehouseName:'Коледино'})},fbsPrintStation:{findFirst:vi.fn().mockResolvedValue({id:'station'}),update:vi.fn().mockResolvedValue({id:'station'})},fbsPrintJob:{findFirst:vi.fn().mockResolvedValue(job),update:vi.fn().mockResolvedValue(job),create:vi.fn().mockResolvedValue(job)}};
 const service=new MarketplaceConnectionsService(db as never,{resolveClientFilter:()=>undefined} as never);
 vi.spyOn(service as any,'loadFbsTsdOrderSticker').mockResolvedValue({imageBase64:'WB-PNG',barcode:'WB-code'});return {service,db};
}
describe('FBS print parity',()=>{
 it('fits the entire long warehouse name inside the label',()=>{
  // TEST: the initial shared template clipped the last lines of long destinations.
  const name='МОСКВА ВОСТОЧНЫЙ РАСПРЕДЕЛИТЕЛЬНЫЙ ЦЕНТР LOGOFF НОГИНСК';
  const fitted=fitSortingWarehouse(name,153,28);
  expect(fitted.text.replace(/\s/g,'')).toBe(name.replace(/\s/g,''));
  expect(fitted.text.split('\n').length*fitted.fontSize*1.3).toBeLessThanOrEqual(28);
 });
 it('permits the Склад operator through every agent route without system:admin',()=>{
  // TEST: protect existing narrow access from an accidental administrator-only requirement.
  const guard=new PermissionsGuard(new Reflector());
  for(const method of ['listFbsPrintStations','createFbsPrintStation','heartbeatFbsPrintStation','claimFbsPrintJob','finishFbsPrintJob'] as const){
   expect(guard.canActivate({getHandler:()=>MarketplaceConnectionsController.prototype[method],getClass:()=>MarketplaceConnectionsController,switchToHttp:()=>({getRequest:()=>({user,method:'POST'})})} as never)).toBe(true);
  }
 });
 it('returns the same Russian sorting PNG for web scan, reprint and TSD station',async()=>{
  // TEST: previously the Windows agent created a different English four-row label.
  const {service}=fixture();
  const web:any=await service.scanWebOrderAssembly(task.kiz,user as never);
  const repeat:any=await service.reprintWebOrderAssemblyHistory('history',user as never);
  const station:any=await service.claimFbsPrintJob('station',user as never);
  expect(web.sortingLabel).toMatchObject({contentType:'image/png',widthMm:58,heightMm:40});
  expect(repeat.sortingLabel).toEqual(web.sortingLabel);expect(station.sortingLabel).toEqual(web.sortingLabel);
  expect(Buffer.from(web.sortingLabel.imageBase64,'base64').subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 },15000);
});
