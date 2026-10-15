import {describe,it,expect,vi,afterEach} from 'vitest';
import {OperationsToolsService,exactRequestNumber} from '../src/modules/operations-tools/operations-tools.service';
const user:any={id:'u',permissionCodes:[],roleCodes:['BRANCH_MANAGER'],activeWarehouseId:'w',warehouseIds:['w'],writableWarehouseIds:[]};
afterEach(()=>{delete process.env.WMS_OPERATIONS_TOOLS_ENABLED;});
describe('operations tools scope',()=>{
 // TEST: history in an old branch cannot expose a mark currently boxed elsewhere.
 it('uses historical location only for unboxed marks',async()=>{
  process.env.WMS_OPERATIONS_TOOLS_ENABLED='true';
  const db:any=Object.fromEntries(['clientRequest','box','storagePallet','stockBalance','productMark'].map(k=>[k,{findMany:vi.fn().mockResolvedValue([])}]));
  await new OperationsToolsService(db,{resolveClientFilter:()=>({in:['c']})} as any).search('123',user);
  expect(db.productMark.findMany.mock.calls[0][0].where.OR[1]).toEqual({boxId:null,stockMovement:{warehouseId:'w'}});
  for(const k of ['clientRequest','box','storagePallet','stockBalance'])expect(db[k].findMany.mock.calls[0][0].where).toMatchObject({clientId:{in:['c']},warehouseId:'w'});
 });
 it('does not read anything when disabled',async()=>{
  const db:any={clientRequest:{findFirst:vi.fn()}};
  await expect(new OperationsToolsService(db,{} as any).readiness('r',user)).rejects.toThrow();expect(db.clientRequest.findFirst).not.toHaveBeenCalled();
 });
 it('does not disclose readiness for a hidden request',async()=>{
  process.env.WMS_OPERATIONS_TOOLS_ENABLED='true';const db:any={clientRequest:{findFirst:vi.fn().mockResolvedValue(null)}};
  await expect(new OperationsToolsService(db,{resolveClientFilter:()=>({in:['c']})} as any).readiness('r',user)).rejects.toThrow();
 });
 it('retains large external identifiers as text',()=>{expect(exactRequestNumber('9007199254740993')).toBeUndefined();expect(exactRequestNumber('\u2116002058')).toBe(2058);});
});
