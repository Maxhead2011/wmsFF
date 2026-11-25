import { beforeEach,describe,expect,it,vi } from 'vitest';
import { existingSupplyPreview,createExistingSupplyReshipment } from '../src/modules/marketplace-connections/fbs-existing-supply-reshipment';
import { FbsReshipmentService } from '../src/modules/marketplace-connections/fbs-reshipment.service';
const dto={clientId:'c',existingSupplyId:'new',mode:'NEW_ITEM' as const,orders:[{id:'1',connectionId:'conn'}]};
const user={id:'owner',roleCodes:['OWNER'],permissionCodes:['system:admin'],activeWarehouseId:'w',writableWarehouseIds:[]} as any;
describe('existing supply without prior TSD scans',()=>{
 let db:any,wb:any,links:any[],runs:any[],tasks:any[];
 beforeEach(()=>{
  vi.stubEnv('WMS_FBS_RESHIPMENT_ENABLED','true');runs=[];tasks=[];
  links=[{id:'l',clientId:'c',orderId:'1',connectionId:'conn',requestId:'old',updatedAt:'date',lastSupplyId:'old-supply',lastSkuId:'sku',lastItemCount:1,syncStatus:'ACTIVE',request:{id:'old',clientId:'c',warehouseId:'w',status:'DONE',number:3,updatedAt:'date'}}];
  db={client:{findUnique:vi.fn(async()=>({id:'c',isDemo:false}))},warehouse:{findFirst:vi.fn(async()=>({id:'w'}))},
   fbsOrderRequestLink:{findMany:vi.fn(async()=>structuredClone(links)),updateMany:vi.fn(async({data}:any)=>{Object.assign(links[0],data);return {count:1};})},
   fbsTsdAssembly:{count:vi.fn(async()=>tasks.length),create:vi.fn(async({data}:any)=>{tasks.push(data);return data;})},
   sku:{findMany:vi.fn(async()=>[{id:'sku',clientId:'c',name:'Fabric',article:'ivory_3',updatedAt:'date',needsChestnyZnak:false,barcodes:[{value:'123'}]}])},
   fbsSupplyPlan:{findMany:vi.fn(async()=>[{supplyId:'old-supply',deliveryDestination:'PICKUP_POINT',itemsPerCargoPlace:100}]),findFirst:vi.fn(async()=>null),create:vi.fn()},
   fbsReshipmentRun:{findUnique:vi.fn(async()=>runs[0]??null),create:vi.fn(async({data}:any)=>{runs.push(data);return data;})},fbsReshipmentClaim:{createMany:vi.fn()},
   clientRequest:{create:vi.fn(async({data}:any)=>({...data,id:'new-request',number:5,items:data.items.create.map((i:any)=>({...i,id:'item'}))})),findUniqueOrThrow:vi.fn(async()=>({id:'new-request',number:5,status:'IN_WORK'}))},
   clientRequestEvent:{create:vi.fn()},auditLog:{create:vi.fn()},$queryRaw:vi.fn(),
   stockMovement:{create:vi.fn()},billingCharge:{create:vi.fn()},billingInvoice:{create:vi.fn()}};
  db.$transaction=vi.fn(async(fn:any)=>fn(db));
  wb={readReshipmentWbSupply:vi.fn(async()=>({id:'new',done:false,orderIds:['1']})),readReshipmentWbStatuses:vi.fn(async()=>new Map([['1',{supplierStatus:'confirm',wbStatus:'waiting'}]]))};
 });
 // TEST: owner with global administration permission is not denied by an empty explicit branch list.
 it('authorizes global owner while retaining ordinary branch restrictions',async()=>{
  const service=new FbsReshipmentService(db,{requireClientAccess:vi.fn()} as any,wb);
  expect((await service.preview(dto,user)).additionalUnits).toBe(1);
  await expect(service.preview(dto,{...user,permissionCodes:[]})).rejects.toThrow('Выберите доступный');
 });
 it('creates fresh waiting tasks once and does not spend stock or create billing',async()=>{
  const preview=await existingSupplyPreview(db,wb,dto,'w',user),input={...dto,confirm:true,previewToken:preview.previewToken};
  const created=await createExistingSupplyReshipment(db,wb,input,'w',user);
  expect(created.requestNumber).toBe(5);expect(tasks[0]).toMatchObject({status:'WAITING_STOCK',supplyId:'new',requestId:'new-request',stockWarehouseId:'w'});
  expect(tasks[0].completedAt).toBeUndefined();expect(tasks[0].barcode).toBeUndefined();
  expect(await createExistingSupplyReshipment(db,wb,input,'w',user)).toEqual(created);
  expect(db.clientRequest.create).toHaveBeenCalledTimes(1);expect(db.fbsTsdAssembly.create).toHaveBeenCalledTimes(1);
  expect(db.stockMovement.create).not.toHaveBeenCalled();expect(db.billingCharge.create).not.toHaveBeenCalled();expect(db.billingInvoice.create).not.toHaveBeenCalled();
 });
 it('rejects a changed selection on retry',async()=>{
  const preview=await existingSupplyPreview(db,wb,dto,'w',user),input={...dto,confirm:true,previewToken:preview.previewToken};await createExistingSupplyReshipment(db,wb,input,'w',user);
  await expect(createExistingSupplyReshipment(db,wb,{...input,orders:[{id:'2',connectionId:'conn'}]},'w',user)).rejects.toThrow('другой операции');
 });
 it('rejects closed, partial and cancelled remote compositions before writes',async()=>{
  for(const supply of [{id:'new',done:true,orderIds:['1']},{id:'new',done:false,orderIds:['1','2']}]){wb.readReshipmentWbSupply.mockResolvedValue(supply);await expect(existingSupplyPreview(db,wb,dto,'w',user)).rejects.toThrow('WB:');}
  wb.readReshipmentWbSupply.mockResolvedValue({id:'new',done:false,orderIds:['1']});wb.readReshipmentWbStatuses.mockResolvedValue(new Map([['1',{supplierStatus:'cancel',wbStatus:'canceled'}]]));
  await expect(existingSupplyPreview(db,wb,dto,'w',user)).rejects.toThrow('не подтверждает');expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
 it('rejects another branch and existing physical attempts',async()=>{
  await expect(existingSupplyPreview(db,wb,dto,'other',user)).rejects.toThrow('этого филиала');tasks.push({id:'physical'});
  await expect(existingSupplyPreview(db,wb,dto,'w',user)).rejects.toThrow('Есть задания ТСД');
 });
 it('rejects stale preview and same-item mode',async()=>{
  const p=await existingSupplyPreview(db,wb,dto,'w',user);links[0].updatedAt='changed';
  await expect(createExistingSupplyReshipment(db,wb,{...dto,confirm:true,previewToken:p.previewToken},'w',user)).rejects.toThrow('изменились');
  await expect(existingSupplyPreview(db,wb,{...dto,mode:'SAME_ITEM'},'w',user)).rejects.toThrow('новую физическую');expect(db.clientRequest.create).not.toHaveBeenCalled();
 });
});
