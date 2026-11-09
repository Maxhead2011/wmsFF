import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { listPostPick, queuePostPick, postPickReady, postPickMatches, SOS_POST_PICK } from './sos-post-pick';

// TEST: printing is an independent ledger; warehouse/billing delegates are deliberately absent.
const user: any = { id: 'worker', name: 'Worker', activeWarehouseId: 'moscow' };
const body = { requestId: 'r', barcode: '123456', stationId: 's', operationId: '11111111-1111-4111-8111-111111111111' };
function fixture(marketplace = 'WILDBERRIES') {
  const request = { id: 'r', clientId: 'korolev', number: 100, status: 'PACKED', client: { name: 'Королёв' } };
  const task: any = { id: 'a', clientId: 'korolev', requestId: 'r', connectionId: 'c', orderId: 'o', marketplace,
    status: 'COMPLETED', completedAt: new Date(), requiresKiz: false, barcodes: ['123456'], marketplaceSubmittedAt: new Date() };
  const jobs: any[] = [];
  const db: any = {
    systemSetting: { findMany: vi.fn(async () => []) },
    clientRequest: { findMany: vi.fn(async () => [request]) },
    fbsTsdAssembly: { findMany: vi.fn(async () => [task]) },
    fbsOrderRequestLink: { findMany: vi.fn(async () => [task]) },
    fbsPrintStation: { findFirst: vi.fn(async () => ({ id: 's', lastSeenAt: new Date() })) },
    fbsPrintJob: {
      findMany: vi.fn(async () => jobs), findUnique: vi.fn(async ({where}: any) => jobs.find(j => j.historyId === where.historyId)),
      findFirst: vi.fn(async () => jobs.at(-1)), create: vi.fn(async ({data}: any) => { const j = {...data, status: 'QUEUED'}; jobs.push(j); return j; }),
    },
    $queryRaw: vi.fn(async () => []),
    auditLog: { create: vi.fn(async () => ({})) }, $executeRawUnsafe: vi.fn(async () => 0),
  };
  db.$transaction = vi.fn((fn: any) => fn(db));
  const clients = { resolveClientFilter: vi.fn(() => ({in: ['korolev']})), requireClientAccess: vi.fn() };
  const label = vi.fn(async () => ({barcode:'official',imageBase64:'aW1hZ2U=',contentType:'image/png'}));
  return {db,clients,task,jobs,label,request,run: (b:any=body) => queuePostPick(db,clients,user,b,label)};
}
beforeEach(() => vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED', 'true'));
afterEach(() => vi.unstubAllEnvs());
describe('SOS post-pick printing', () => {
  // TEST: the same active-request scope is enforced for listing and direct scans.
  it.each(['DONE','CANCELLED','REJECTED','PACKED','IN_WORK'])('filters request status %s', async status => {
    const f=fixture(); f.request.status=status;
    f.db.clientRequest.findMany.mockImplementation(async ({where}:any) =>
      where.status.notIn.includes(status) ? [] : [f.request]);
    const active=['PACKED','IN_WORK'].includes(status);
    expect((await listPostPick(f.db,f.clients,user)).requests).toHaveLength(active ? 1 : 0);
    if (active) expect((await f.run()).printStatus).toBe('QUEUED');
    else { await expect(f.run()).rejects.toThrow('недоступна'); expect(f.label).not.toHaveBeenCalled(); }
  });
  it.each(['Королёв','Королёва','Баландин','Другой клиент'])('lists %s without a hardcoded allowlist', async name => {
    const f=fixture();f.request.client.name=name;
    expect((await listPostPick(f.db,f.clients,user)).requests[0]).toMatchObject({printOnly:true,totalOrders:1,availableOrders:1,client:{name}});
    expect(f.db.clientRequest.findMany.mock.calls[0][0].where).toMatchObject({warehouseId:'moscow',clientId:{in:['korolev']}});
  });
  it.each(['WILDBERRIES','OZON'])('queues %s without any stock or billing delegate', async mp => {
    const f=fixture(mp);const result=await f.run();expect(result.printStatus).toBe('QUEUED');
    expect(f.jobs[0]).toMatchObject({source:SOS_POST_PICK,requestId:'r',assemblyId:'a'});
    expect(f.jobs[0].deviceCode.startsWith('SOS-WB:')).toBe(false);
    expect(f.clients.requireClientAccess).toHaveBeenCalledWith(user,'korolev','write');
  });
  it('client requiring KIZ is routed away even when its task is unmarked', async () => {
    const f=fixture();f.db.systemSetting.findMany.mockResolvedValue([{key:'client.receipt-kiz-required.v1:korolev',value:{required:true}}]);
    expect(await listPostPick(f.db,f.clients,user)).toEqual({requests:[]});await expect(f.run()).rejects.toThrow();expect(f.label).not.toHaveBeenCalled();
  });
  it('rechecks changed client KIZ policy before enqueuing', async () => {
    const f=fixture();f.db.systemSetting.findMany.mockResolvedValueOnce([]).mockResolvedValue([{key:'client.receipt-kiz-required.v1:korolev',value:{required:true}}]);
    await expect(f.run()).rejects.toThrow('изменился');expect(f.jobs).toHaveLength(0);
  });
  it('disabled deployment preserves the old workflow', async () => {
    vi.stubEnv('WMS_FBS_UNMARKED_PAIRED_LABELS_ENABLED','false');const f=fixture();
    expect(await listPostPick(f.db,f.clients,user)).toEqual({requests:[]});await expect(f.run()).rejects.toThrow();expect(f.db.clientRequest.findMany).not.toHaveBeenCalled();
  });
  it('rejects unpicked, marked, unknown-source and unsubmitted Ozon', () => {
    const f=fixture('OZON');for(const override of [{status:'IN_PROGRESS'},{completedAt:null},{requiresKiz:true},{kiz:'mark'},{sourceBoxPending:true},{marketplaceSubmittedAt:null}]) expect(postPickReady({...f.task,...override})).toBe(false);
  });
  it('matches actual multiline and warehouse barcodes', () => {
    expect(postPickMatches({ozonPickState:{data:{lines:[{barcodes:['other']}]}}},'other')).toBe(true);
    expect(postPickMatches({sourceBarcodes:['original']},'original')).toBe(true);
    expect(postPickMatches({barcodes:['123456']},'12345')).toBe(false);
  });
  it('retries the same UUID without another label or print', async () => {
    const f=fixture();expect((await f.run()).printJobId).toBe((await f.run()).printJobId);expect(f.label).toHaveBeenCalledTimes(1);expect(f.jobs).toHaveLength(1);
  });
  it('does not reuse an operation for another barcode', async () => {
    const f=fixture();await f.run();await expect(f.run({...body,barcode:'other'})).rejects.toThrow('другого');expect(f.jobs).toHaveLength(1);
  });
  it('blocks an ordinary second scan, supports explicit finished reprint', async () => {
    const f=fixture();await f.run();const next={...body,operationId:'22222222-2222-4222-8222-222222222222'};
    await expect(f.run(next)).rejects.toThrow();await expect(f.run({...next,repeatAssemblyId:'a'})).rejects.toThrow('очереди');
    f.jobs[0].status='PRINTED';await f.run({...next,repeatAssemblyId:'a'});expect(f.jobs).toHaveLength(2);
  });
  it('does not consume an order on unavailable label or offline station', async () => {
    const f=fixture();f.label.mockResolvedValue(null as any);await expect(f.run()).rejects.toThrow('стикер');expect(f.jobs).toHaveLength(0);
    f.db.fbsPrintStation.findFirst.mockResolvedValue({lastSeenAt:new Date(0)});await expect(f.run()).rejects.toThrow('сети');
  });
  it('rechecks a concurrent job before queueing', async () => {
    const f=fixture();f.db.fbsPrintJob.findFirst.mockResolvedValue({status:'QUEUED'});await expect(f.run()).rejects.toThrow('Другой');expect(f.jobs).toHaveLength(0);
  });
  it('rechecks cancellation and missing association', async () => {
    const f=fixture();f.db.fbsOrderRequestLink.findMany.mockResolvedValueOnce([f.task]).mockResolvedValue([]);
    await expect(f.run()).rejects.toThrow('изменился');expect(f.jobs).toHaveLength(0);
  });
  it('does not disclose/print another branch request', async () => {
    const f=fixture();f.db.clientRequest.findMany.mockResolvedValue([]);await expect(f.run()).rejects.toThrow('недоступна');expect(f.label).not.toHaveBeenCalled();
  });
  it('distinguishes printed from queued counts', async () => {
    const f=fixture();await f.run();expect((await listPostPick(f.db,f.clients,user)).requests[0]).toMatchObject({queuedOrders:1,printedOrders:0,availableOrders:0});
    f.jobs[0].status='PRINTED';expect((await listPostPick(f.db,f.clients,user)).requests[0]).toMatchObject({queuedOrders:0,printedOrders:1});
  });
});
