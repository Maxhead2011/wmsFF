import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { ClientRequestMarketplaceFilesService } from '../src/modules/client-requests/client-request-marketplace-files.service';
const boxes = ['FFL_001','FFL_002'].map(boxCode=>({boxId:boxCode,boxCode,closedAt:new Date(),confirmedAt:new Date()}));
const units = ['0012345678901','0012345678901','0012345678901','9999999999999'].map((barcode,i)=>({id:String(i),barcode,state:'PACKED',targetBoxId:boxes[i<2?0:1].boxId,targetBoxCode:boxes[i<2?0:1].boxCode}));
function fixture(phase='COMPLETED'){
 const assembly={phase,boxes:structuredClone(boxes),units:structuredClone(units)};
 const item={barcode:'wrong-request-barcode',quantity:4,requestItem:{barcode:'wrong-request-barcode',sku:null},sku:null};
 const request={id:'r',clientId:'c',warehouseId:'w',type:'OUTBOUND',status:'PACKED',title:'Test',packages:[{packageCode:'legacy',items:[item]}]};
 const db={clientRequest:{findUnique:vi.fn().mockResolvedValue(request)},fboAssembly:{findUnique:vi.fn().mockResolvedValue(assembly)}};
 const scopes={requireClientAccess:vi.fn()};const service=new ClientRequestMarketplaceFilesService(db as any,scopes as any);
 const user={roleCodes:['ADMIN'],permissionCodes:['system:admin'],clientScopeMode:'ALL'} as any;
 return {assembly,db,service,user,scopes};
}
function read(file:{content:Buffer}){const wb=XLSX.read(file.content,{type:'buffer'});return {wb,rows:XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:''}) as any[][]};}
afterEach(()=>vi.unstubAllEnvs());
describe('confirmed FBO WB template exports',()=>{
 // TEST: exact template columns, scanned barcodes, combined rows and numeric counts agree across both exports.
 it('exports two reconciled files from actual packed units, preserving leading zeroes',async()=>{
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const f=fixture();
  const totals=read(await f.service.getWbProductsTemplate('r',f.user));
  expect(totals.wb.SheetNames).toEqual(['Sheet1']);expect(totals.rows).toEqual([['Баркод','Количество'],['0012345678901',3],['9999999999999',1]]);
  const perBox=read(await f.service.getWbPackagingTemplate('r',f.user));
  expect(perBox.wb.SheetNames).toEqual(['Sheet1']);expect(perBox.rows).toEqual([
   ['Баркод товара','Кол-во товаров','ШК короба','Срок годности','ШК короба для печати в стороннем сервисе'],
   ['0012345678901',2,'FFL_001','',''],['0012345678901',1,'FFL_002','',''],['9999999999999',1,'FFL_002','','']]);
  expect(totals.wb.Sheets.Sheet1.A2.t).toBe('s');expect(totals.wb.Sheets.Sheet1.B2.t).toBe('n');expect(perBox.rows.slice(1).reduce((n,r)=>n+r[1],0)).toBe(4);
  expect(f.scopes.requireClientAccess).toHaveBeenCalledWith(f.user,'c','read');
 });
 it.each(['PACKING','CONTROL'])('blocks both files in %s even if the request status is packed',async phase=>{
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const f=fixture(phase);
  await expect(f.service.getWbProductsTemplate('r',f.user)).rejects.toThrow('короба');await expect(f.service.getWbPackagingTemplate('r',f.user)).rejects.toThrow('короба');
 });
 it.each(['unconfirmed','foreignBox','missingBarcode','unpacked','missingUnit'])('refuses inconsistent completed data: %s',async problem=>{
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const f=fixture();
  if(problem==='unconfirmed')f.assembly.boxes[0].confirmedAt=null as any;
  if(problem==='foreignBox')f.assembly.units[0].targetBoxId='foreign';
  if(problem==='missingBarcode')f.assembly.units[0].barcode='';
  if(problem==='unpacked')f.assembly.units[0].state='PICKED';
  if(problem==='missingUnit')f.assembly.units.pop();
  await expect(f.service.getWbProductsTemplate('r',f.user)).rejects.toThrow();await expect(f.service.getWbPackagingTemplate('r',f.user)).rejects.toThrow();
 });
 it('retains sold/legacy workbook shape and does not query FBO tables with the feature off',async()=>{
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','false');const f=fixture();
  const result=read(await f.service.getWbPackagingTemplate('r',f.user));expect(result.wb.SheetNames).toEqual(['TDSheet']);expect(result.rows[0]).toHaveLength(4);expect(f.db.fboAssembly.findUnique).not.toHaveBeenCalled();
 });
 it('does not bypass client access checks',async()=>{
  vi.stubEnv('WMS_FBO_TWO_STAGE_ENABLED','true');const f=fixture();f.scopes.requireClientAccess.mockImplementation(()=>{throw Error('denied');});
  await expect(f.service.getWbProductsTemplate('r',f.user)).rejects.toThrow('denied');expect(f.db.fboAssembly.findUnique).not.toHaveBeenCalled();
 });
});
