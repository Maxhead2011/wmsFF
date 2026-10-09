import {afterEach,describe,expect,it,vi} from 'vitest';
import * as XLSX from 'xlsx';
import {OzonFboImportService} from '../src/modules/client-requests/ozon-fbo-import.service';
// TEST: one transactional request and aggregate demand; no stock mutation on import.
describe('Ozon customer import',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  const user={id:'user',roleCodes:[],permissionCodes:['system:admin'],activeWarehouseId:'warehouse'} as any;
  const dto={clientId:'client',destinationCity:'Москва'};
  function setup(){
    vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
      ['Склад хранения','Артикул','ШК','Поставка, шт'],['Москва','a','4610389216310',2],['Уфа','a','4610389216310',3],
    ]),'Поставка');
    const file={buffer:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),originalname:'test.xlsx',mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} as any;
    const tx={ $executeRaw:vi.fn(),ozonFboShipment:{findUnique:vi.fn().mockResolvedValue(null)},clientRequest:{create:vi.fn().mockResolvedValue({id:'request',number:1})}};
    const db={warehouseClient:{findFirst:vi.fn().mockResolvedValue({})},client:{findUniqueOrThrow:vi.fn().mockResolvedValue({storesWithoutBoxes:false})},
      barcode:{findMany:vi.fn().mockResolvedValue([{value:'4610389216310',skuId:'sku',sku:{name:'Товар'}}])},$transaction:vi.fn(fn=>fn(tx))};
    const scopes={requireClientAccess:vi.fn()};
    return {service:new OzonFboImportService(db as any,scopes as any),tx,db,scopes,file};
  }
  it('creates 5 units once with 2+3 destination quotas and source workbook atomically',async()=>{
    const s=setup();await s.service.commit(s.file,dto,user);
    expect(s.tx.clientRequest.create).toHaveBeenCalledTimes(1);
    const data=s.tx.clientRequest.create.mock.calls[0][0].data;
    expect(data.items.create).toEqual([{skuId:'sku',barcode:'4610389216310',name:'Товар',quantity:5}]);
    expect(data.ozonShipment.create.directions.map((d:any)=>d.items[0].quantity)).toEqual([2,3]);
    expect(data.files.create.content.length).toBeGreaterThan(0);
    expect(data.warehouseId).toBe('warehouse');
  });
  it('returns a previous import after a lost response without duplicating demand',async()=>{
    const s=setup();s.tx.ozonFboShipment.findUnique.mockResolvedValue({request:{id:'old'}} as any);
    expect((await s.service.commit(s.file,dto,user)).existing).toBe(true);
    expect(s.tx.clientRequest.create).not.toHaveBeenCalled();
  });
  it('rejects missing SKU and never creates a partial request',async()=>{
    const s=setup();s.db.barcode.findMany.mockResolvedValue([]);
    await expect(s.service.commit(s.file,dto,user)).rejects.toThrow();expect(s.db.$transaction).not.toHaveBeenCalled();
  });
  it('honours write access and the isolated flag',async()=>{
    const s=setup();s.scopes.requireClientAccess.mockImplementation(()=>{throw Error('denied');});
    await expect(s.service.commit(s.file,dto,user)).rejects.toThrow('denied');
    vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');await expect(s.service.preview(s.file,dto,user)).rejects.toThrow('выключен');
  });
});
