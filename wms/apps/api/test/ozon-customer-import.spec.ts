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
    const db={warehouseClient:{findMany:vi.fn().mockResolvedValue([{warehouseId:'warehouse',warehouse:{name:'Москва'}}]),findFirst:vi.fn().mockResolvedValue({})},client:{findUniqueOrThrow:vi.fn().mockResolvedValue({storesWithoutBoxes:false})},
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
  // TEST: Ozon home must show only this client's assemblies in the selected branch.
  it('lists unified assemblies with direction counts without leaking another branch',async()=>{
    const s=setup();const findMany=vi.fn().mockResolvedValue([{id:'r',number:1,title:'Кубрин',status:'SUBMITTED',items:[{quantity:5}],ozonShipment:{directions:[{},{}]},fboAssembly:null}]);
    Object.assign(s.db,{clientRequest:{findMany}});
    expect((await s.service.list('client',user))[0]).toMatchObject({quantity:5,directions:2,phase:'NOT_STARTED'});
    expect(findMany.mock.calls[0][0].where).toEqual({clientId:'client',warehouseId:'warehouse',ozonShipment:{isNot:null}});
    expect(s.scopes.requireClientAccess).toHaveBeenCalledWith(user,'client','read');
    await expect(s.service.list('client',{...user,activeWarehouseId:null})).rejects.toThrow('филиал');
    s.scopes.requireClientAccess.mockImplementation(()=>{throw Error('denied');});
    await expect(s.service.list('other',user)).rejects.toThrow('denied');
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  // TEST: reproduce the client cabinet with no branch selector or active warehouse.
  it('uses the only active client branch for preview, commit and list',async()=>{
    const s=setup(),cabinet={...user,roleCodes:['CLIENT'],permissionCodes:[],activeWarehouseId:null};
    Object.assign(s.db,{clientRequest:{findMany:vi.fn().mockResolvedValue([])}});
    expect((await s.service.preview(s.file,dto,cabinet)).warehouseId).toBe('warehouse');
    await s.service.commit(s.file,dto,cabinet);
    expect(s.tx.clientRequest.create.mock.calls[0][0].data.warehouseId).toBe('warehouse');
    await s.service.list('client',cabinet);
    expect((s.db as any).clientRequest.findMany.mock.calls[0][0].where.warehouseId).toBe('warehouse');
  });

  // TEST: ambiguity, inactive branches and internal restrictions cannot silently redirect stock.
  it('requires an explicit choice with two branches and commits the chosen one',async()=>{
    const s=setup(),cabinet={...user,roleCodes:['CLIENT'],activeWarehouseId:null};
    s.db.warehouseClient.findMany.mockResolvedValue([{warehouseId:'a',warehouse:{name:'A'}},{warehouseId:'b',warehouse:{name:'B'}}]);
    await expect(s.service.preview(s.file,dto,cabinet)).rejects.toThrow('Выберите филиал');
    await s.service.commit(s.file,{...dto,warehouseId:'b'},cabinet);
    expect(s.tx.clientRequest.create.mock.calls[0][0].data.warehouseId).toBe('b');
    await expect(s.service.preview(s.file,{...dto,warehouseId:'foreign'},cabinet)).rejects.toThrow('недоступен');
  });
  it('does not use a stale cabinet active branch for another client',async()=>{
    const s=setup();
    expect((await s.service.preview(s.file,dto,{...user,roleCodes:['CLIENT'],activeWarehouseId:'stale'})).warehouseId).toBe('warehouse');
  });
  it('rejects a client with no active branch before reading the workbook',async()=>{
    const s=setup();s.db.warehouseClient.findMany.mockResolvedValue([]);
    await expect(s.service.preview(s.file,dto,{...user,roleCodes:['CLIENT'],activeWarehouseId:null})).rejects.toThrow('нет активного');
    expect(s.db.barcode.findMany).not.toHaveBeenCalled();
  });
  it('restricts internal choices to the active writable branch and rejects overrides',async()=>{
    const s=setup(),internal={...user,roleCodes:['BRANCH_MANAGER'],permissionCodes:[],warehouseIds:['warehouse','other'],writableWarehouseIds:['warehouse']};
    await s.service.warehouses('client',internal);
    expect(s.db.warehouseClient.findMany.mock.calls[0][0].where).toEqual({clientId:'client',warehouseId:'warehouse',status:'ACTIVE',warehouse:{isActive:true}});
    await expect(s.service.preview(s.file,{...dto,warehouseId:'other'},internal)).rejects.toThrow('недоступен');
    await expect(s.service.preview(s.file,dto,{...internal,writableWarehouseIds:[]})).rejects.toThrow('только просмотр');
  });
  it('checks client authorization and the feature flag before listing branches',async()=>{
    const s=setup();s.scopes.requireClientAccess.mockImplementation(()=>{throw Error('denied');});
    await expect(s.service.warehouses('foreign',user)).rejects.toThrow('denied');
    expect(s.db.warehouseClient.findMany).not.toHaveBeenCalled();
    vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','false');
    await expect(s.service.warehouses('client',user)).rejects.toThrow('выключен');
  });

});
