import 'reflect-metadata';
import {describe,it,expect,vi} from 'vitest';
import {PrismaClient} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
const url=process.env.KIZ_DUPLICATE_TEST_DATABASE_URL;
if(url&&!/^postgresql:\/\/codex_tests@127\.0\.0\.1:55469\/kiz_duplicate_tests/.test(url))throw Error('Dedicated local test DB only');
// TEST: real row locks serialize two terminals and persist the external receipt.
describe.skipIf(!url)('Ozon durable supply link',()=>{
 it('sends once under concurrent upload and rejects a second assembly for the same order',async()=>{
  vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');const db=new PrismaClient({datasources:{db:{url}}});
  const [id,c,w,u]=Array.from({length:4},()=>randomUUID());
  try{
   await db.client.create({data:{id:c,code:c,name:'Ozon test'}});await db.warehouse.create({data:{id:w,code:w,name:'test'}});await db.user.create({data:{id:u,name:'test',email:u+'@invalid',passwordHash:'test'}});
   const link:any={connectionId:'c',orderId:id,orderNumber:'1',place:'Москва',date:'',state:'DATA_FILLING',checkedAt:'',mapping:{Москва:'42'},operations:{},supplies:[{id:'42',name:'Москва',items:[{barcode:'123',offerId:'a',quantity:1,quant:1}]}]};
   await db.clientRequest.create({data:{id,clientId:c,warehouseId:w,type:'OUTBOUND',title:'test',ozonShipment:{create:{importKey:id,externalOrderKey:'seller:'+id,integration:link,directions:[{name:'Москва',items:[{skuId:'sku',barcode:'123',quantity:1}]}]}},fboAssembly:{create:{phase:'CONTROL',compositionHash:'test',boxes:{create:{id:'b'+id,boxId:'box',boxCode:id,direction:'Москва',closedAt:new Date(),confirmedAt:new Date()}},units:{create:{skuId:'sku',requestItemId:'item',barcode:'123',state:'PACKED',sourceBoxId:'source',sourceBoxCode:'source',targetBoxId:'box',pickedByUserId:u}}}}}});
   const service=new OzonAssemblySupplyService(db as any,{requireClientAccess(){}} as any),user:any={id:u,activeWarehouseId:w,permissionCodes:['system:admin']};
   vi.spyOn(service as any,'connection').mockResolvedValue({id:'c'});vi.spyOn(service,'refresh').mockImplementation(()=>service.view(id,user));
   const send=vi.spyOn(service,'call').mockImplementation(async(_c,path)=>{if(path.endsWith('/supplies/get'))return {supplies_cargoes:[{supply_id:42}]};if(path==='/v1/cargoes/create'){await new Promise(r=>setTimeout(r,50));return {operation_id:'op'};}return {status:'SUCCESS',result:{cargoes:[{key:'b'+id,value:{cargo_id:99}}]}};});
   await Promise.all([service.upload(id,true,user),service.upload(id,true,user)]);
   expect(send.mock.calls.filter(v=>v[1]==='/v1/cargoes/create')).toHaveLength(1);
   expect((await db.ozonFboShipment.findUniqueOrThrow({where:{requestId:id}})).integration).toMatchObject({operations:{'42':{state:'SUCCESS',operationId:'op'}}});
   await expect(db.clientRequest.create({data:{clientId:c,type:'OUTBOUND',title:'duplicate',ozonShipment:{create:{importKey:randomUUID(),externalOrderKey:'seller:'+id,directions:[]}}}})).rejects.toThrow();
  }finally{
   await db.auditLog.deleteMany({where:{entityId:id}});await db.fboAssemblyUnit.deleteMany({where:{requestId:id}});await db.fboAssemblyBox.deleteMany({where:{requestId:id}});await db.fboAssembly.deleteMany({where:{requestId:id}});await db.ozonFboShipment.deleteMany({where:{requestId:id}});await db.clientRequest.deleteMany({where:{clientId:c}});await db.user.deleteMany({where:{id:u}});await db.warehouse.deleteMany({where:{id:w}});await db.client.deleteMany({where:{id:c}});await db.$disconnect();vi.restoreAllMocks();vi.unstubAllEnvs();
  }
 });
});
