import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WbPrintCheckService } from '../src/modules/service/wb-print-check.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
import type { AuthUser } from '../src/modules/auth/auth.types';

const user = { id: 'admin', permissionCodes: ['system:admin'], roleCodes: ['OWNER'], clientScopeMode: 'ALL', clientIds: [], writableClientIds: [] } as unknown as AuthUser;
const task = (id = 'a', clientId = 'c') => ({ id, clientId, connectionId: 'conn-'+clientId, requestId: 'r-'+clientId, kiz: 'kiz-'+id, completedAt: new Date('2026-09-17T08:08:58Z'), wbMetaStatus: 'ACCEPTED', productName: 'Костюм', boxCode: 'BOX', workerName: 'Марифат' });
function fixture() {
  const db: any = { $executeRawUnsafe: vi.fn(async () => 0) };
  for (const n of ['fbsTsdAssembly','fbsWebKizStickerPrint','fbsAssemblyAttemptHistory','fbsPrintJob','auditLog','clientRequest','client','clientMarketplaceConnection','user']) db[n] = { findMany: vi.fn(async () => []) };
  db.fbsTsdAssembly.findMany.mockResolvedValue([task()]);
  db.client.findMany.mockResolvedValue([{id:'c',name:'Лукин'}]);
  db.clientRequest.findMany.mockResolvedValue([{id:'r-c',clientId:'c',number:1065,warehouse:{name:'ФФ Москва'}}]);
  db.$transaction = vi.fn(async (fn:any) => fn(db));
  return { db, service: new WbPrintCheckService(db, new ClientScopeService()) };
}
describe('WB print evidence', () => {
  beforeEach(() => vi.stubEnv('WMS_WB_PRINT_CHECK_ENABLED','true'));
  afterEach(() => vi.unstubAllEnvs());
  // TEST: distinguish generating a label from the agent's persisted confirmation.
  it('keeps a generated label unconfirmed when there is no print job', async () => {
    const {db,service}=fixture();
    db.fbsWebKizStickerPrint.findMany.mockResolvedValue([{id:'h',assemblyId:'a',clientId:'c',requestId:'r-c',kiz:'kiz-a',printedBy:'Соня',printedAt:new Date()}]);
    const result=await service.inspect('№ 5786259714',user);
    expect(result.orderId).toBe('5786259714');expect(result.results[0].prints).toEqual([]);
    expect(result.results[0].labelRequests[0].hasPrintJob).toBe(false);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY');
    expect(db.$transaction.mock.calls[0][1].isolationLevel).toBe('RepeatableRead');
  });
  // TEST: the same WB order in two client accounts must not inherit the other account's print.
  it('separates clients and attaches scan and print evidence to the physical attempt', async () => {
    const {db,service}=fixture();db.fbsTsdAssembly.findMany.mockResolvedValue([task(),task('b','other')]);
    db.fbsPrintJob.findMany.mockResolvedValue([{id:'j',assemblyId:'a',requestId:'r-c',status:'PRINTED',printedAt:new Date(),attempts:1}]);
    db.auditLog.findMany.mockResolvedValue([{entityId:'a',userId:'u',action:'FBS_KIZ_SCAN_ACCEPTED',createdAt:new Date(),payload:{clientId:'c',orderId:'5786259714',kiz:'kiz-a'}},
      {entityId:'b',userId:'u',payload:{clientId:'c',orderId:'5786259714'}}]);
    db.user.findMany.mockResolvedValue([{id:'u',name:'Марифат'}]);
    const {results}=await service.inspect('5786259714',user);
    expect(results[0].prints[0].status).toBe('PRINTED');expect(results[0].scans[0].worker).toBe('Марифат');
    expect(results[1].prints).toEqual([]);expect(results[1].scans).toEqual([]);
    expect(db.fbsPrintJob.findMany.mock.calls[0][0].select).not.toHaveProperty('stickerBase64');
    expect(db.clientMarketplaceConnection.findMany.mock.calls[0][0].select).toEqual({id:true,accountName:true});
  });
  // TEST: historical collections and orphaned label history remain inspectable without inventing WB acceptance.
  it('includes archived attempts and history without a current assembly', async () => {
    const {db,service}=fixture();db.fbsTsdAssembly.findMany.mockResolvedValue([]);
    db.fbsAssemblyAttemptHistory.findMany.mockResolvedValue([{id:'old',clientId:'c',requestId:'r-c',completedAt:new Date(),archivedAt:new Date(),kiz:'old-kiz',taskSnapshot:{id:'old',workerName:'Марифат',wbMetaStatus:'ACCEPTED'}}]);
    db.fbsWebKizStickerPrint.findMany.mockResolvedValue([{id:'h',assemblyId:'orphan',clientId:'c',requestId:'r-c',kiz:'k',printedAt:new Date(),printedBy:'Соня'}]);
    const {results}=await service.inspect('5786259714',user);
    expect(results).toHaveLength(2);expect(results[0]).toMatchObject({id:'old',archived:true,kiz:'old-kiz'});
    expect(results[1]).toMatchObject({status:'HISTORY_ONLY',wbMetaStatus:'UNKNOWN'});
  });
  // TEST: the report cannot bypass normal service access, demo scope or the rollout flag.
  it('checks permission and disabled rollout before reading the database', async () => {
    const {db,service}=fixture();await expect(service.inspect('123',{...user,permissionCodes:[]})).rejects.toThrow('доступа');
    vi.stubEnv('WMS_WB_PRINT_CHECK_ENABLED','false');await expect(service.inspect('123',user)).rejects.toThrow('выключена');
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('uses client scope for demo administrators', async () => {
    const {db,service}=fixture();await service.inspect('123',{...user,isDemo:true,clientIds:['demo']});
    expect(db.fbsTsdAssembly.findMany.mock.calls[0][0].where.clientId).toEqual({in:['demo']});
    expect(db.fbsWebKizStickerPrint.findMany.mock.calls[0][0].where.clientId).toEqual({in:['demo']});
  });
  it.each(['', 'abc', '5786259714 or 1=1', '1.5', '123456789012345678901'])('rejects invalid order %s', async input => {
    const {db,service}=fixture();await expect(service.inspect(input,user)).rejects.toThrow('номер');expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('returns an empty report for an unknown order', async () => {
    const {db,service}=fixture();db.fbsTsdAssembly.findMany.mockResolvedValue([]);
    expect((await service.inspect('123',user)).results).toEqual([]);expect(db.fbsPrintJob.findMany).not.toHaveBeenCalled();
  });
});
