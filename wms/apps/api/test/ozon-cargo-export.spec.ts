import {afterEach,it,expect,vi} from 'vitest';
import ExcelJS from 'exceljs';
import {OzonAssemblySupplyService} from '../src/modules/client-requests/ozon-assembly-supply.service';
function setup(){
 vi.stubEnv('WMS_OZON_FBO_IMPORT_ENABLED','true');
 const boxes=[{id:'b2',boxCode:'FFL_002',direction:'Ростов'},{id:'b1',boxCode:'FFL_001',direction:'Ростов'}];
 const shipment:any={request:{number:1861,clientId:'c',warehouseId:'w',fboAssembly:{boxes}},directions:[{name:'Ростов'}],integration:{mapping:{Ростов:'42'},orders:[{orderId:'123',orderNumber:'132252983-1',supplies:[{id:'42'}]}],supplies:[{id:'42'}],operations:{'42':{state:'SUCCESS',cargoes:[{key:'b2',cargoId:'1022112766236001'},{key:'b1',cargoId:'1022112766236000'}]}}}};
 const db:any={ozonFboShipment:{findUnique:vi.fn(async()=>shipment)}};
 const scopes={requireClientAccess:vi.fn()},svc=new OzonAssemblySupplyService(db,scopes as any),user:any={activeWarehouseId:'w',permissionCodes:['system:admin']};
 return {shipment,svc,user,scopes};
}
afterEach(()=>vi.unstubAllEnvs());
// TEST: join by receipt key, preserve long identifiers as text, and prohibit incomplete exports.
it('exports the confirmed mapping in box order with exact text identifiers',async()=>{
 const s=setup(),before=JSON.stringify(s.shipment);const file=await s.svc.cargoMappingFile('r',s.user);
 const book=new ExcelJS.Workbook();await book.xlsx.load(file.buffer as any);const sheet=book.worksheets[0];
 expect(file.fileName).toBe('ozon-boxes-1861.xlsx');expect(sheet.rowCount).toBe(3);
 expect(sheet.getRow(2).values).toEqual([undefined,'FFL_001','Ростов','1022112766236000','42','132252983-1']);
 expect(sheet.getCell('C3').value).toBe('1022112766236001');expect(sheet.getCell('C3').numFmt).toBe('@');
 expect(JSON.stringify(s.shipment)).toBe(before);expect(s.scopes.requireClientAccess).toHaveBeenCalled();
});
it.each(['UNKNOWN','SENDING','ACCEPTED','FAILED'])('rejects %s receipts',async state=>{const s=setup();s.shipment.integration.operations['42'].state=state;await expect(s.svc.cargoMappingFile('r',s.user)).rejects.toThrow('подтвержд');});
it.each(['missing','duplicate','foreign','wrong-supply'])('rejects %s box mappings',async kind=>{
 const s=setup(),op=s.shipment.integration.operations['42'];
 if(kind==='missing')op.cargoes.pop();if(kind==='duplicate')op.cargoes[1].cargoId=op.cargoes[0].cargoId;
 if(kind==='foreign')op.cargoes[1].key='foreign';if(kind==='wrong-supply')s.shipment.integration.mapping.Ростов='43';
 await expect(s.svc.cargoMappingFile('r',s.user)).rejects.toThrow();
});
it('respects warehouse and client access on downloads',async()=>{const s=setup();await expect(s.svc.cargoMappingFile('r',{...s.user,activeWarehouseId:'other'})).rejects.toThrow('филиал');s.scopes.requireClientAccess.mockImplementation(()=>{throw Error('denied');});await expect(s.svc.cargoMappingFile('r',s.user)).rejects.toThrow('denied');});
