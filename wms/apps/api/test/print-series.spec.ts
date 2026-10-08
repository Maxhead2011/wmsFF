import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PrintSeriesService as SourcePrintSeriesService } from '../src/modules/print/print-series.service';
import { ClientScopeService } from '../src/modules/auth/client-scope.service';
// TEST: the same contract can run against the exact compiled candidate module.
const PrintSeriesService:typeof SourcePrintSeriesService=process.env.PRINT_SERIES_RUNTIME
  ? createRequire(import.meta.url)(process.env.PRINT_SERIES_RUNTIME).PrintSeriesService : SourcePrintSeriesService;

const user: any = { id: 'operator', activeWarehouseId: 'moscow', permissionCodes: ['print:write'], roleCodes: ['OPERATOR'], clientScopeMode: 'LIMITED', clientIds: ['client'] };
function fixture() {
  process.env.WMS_PRINT_SERIES_ENABLED = 'true';
  const station = { id: 'station', enabled: true };
  const db: any = { fbsPrintStation: { findFirst: vi.fn().mockResolvedValue(station) },
    warehouseClient: { findFirst: vi.fn().mockResolvedValue({ clientId: 'client' }) },
    systemSetting: { findUnique: vi.fn().mockResolvedValue({ value: { userId: user.id, warehouseId: 'moscow', seenAt: Date.now() } }) },
    printJob: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockImplementation(({data}) => data), findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({count: 1}) },
    $transaction: vi.fn((fn) => fn(db)) };
  const service = new PrintSeriesService(db, new ClientScopeService());
  const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a','hex').copy(png); png.writeUInt32BE(600,16); png.writeUInt32BE(400,20);
  const body: any = { requestId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', stationId: 'station', clientId: 'client', widthMm: 60, heightMm: 40, pages: [1,2,3].map(n=>({value: `BOX_${n}`, imageBase64: png.toString('base64')})) };
  return { db, service, body };
}
afterEach(()=> { delete process.env.WMS_PRINT_SERIES_ENABLED; });
describe('print series',()=> {
  // TEST: a series is one ordered job, not N queue entries separated by agent polls.
  it('creates one job with all numbered pages', async()=> {
    const {db,service,body}=fixture(); await service.create(body,user);
    expect(db.printJob.create).toHaveBeenCalledTimes(1);
    const data=db.printJob.create.mock.calls[0][0].data;
    expect(data.printerCode).toBe('SERIES:station');
    expect(data.payload.pages.map((p:any)=>p.value)).toEqual(['BOX_1','BOX_2','BOX_3']);
  });
  it('validates every page before saving anything',async()=> {
    const {db,service,body}=fixture(); body.pages[2].imageBase64='bad';
    await expect(service.create(body,user)).rejects.toThrow(); expect(db.printJob.create).not.toHaveBeenCalled();
  });
  it('rejects another client and an unavailable updated agent',async()=> {
    const {db,service,body}=fixture(); await expect(service.create({...body,clientId:'foreign'},user)).rejects.toThrow();
    db.systemSetting.findUnique.mockResolvedValue(null);
    await expect(service.create(body,user)).rejects.toThrow(); expect(db.printJob.create).not.toHaveBeenCalled();
  });
  it('is disabled on other installations',async()=> {
    const {service,body}=fixture(); delete process.env.WMS_PRINT_SERIES_ENABLED;
    await expect(service.create(body,user)).rejects.toThrow();
  });
  it('does not reclaim sent jobs after a timeout',async()=> {
    const {db,service}=fixture(); await service.claim('station',user);
    expect(db.printJob.findFirst.mock.calls[0][0].where).toEqual({printerCode:'SERIES:station',status:'queued'});
  });
  it('rejects another agent user',async()=> {
    const {service}=fixture(); await expect(service.claim('station',{...user,id:'foreign'})).rejects.toThrow();
  });
  it('reuses an existing operation and rejects changed content',async()=> {
    const {db,service,body}=fixture();await service.create(body,user);
    const saved=db.printJob.create.mock.calls[0][0].data;
    db.printJob.findUnique.mockResolvedValue(saved);
    await service.create(body,user);expect(db.printJob.create).toHaveBeenCalledTimes(1);
    await expect(service.create({...body,pages:[...body.pages].reverse()},user)).rejects.toThrow();
  });
  it('returns no job after a competing agent wins the claim',async()=> {
    const {db,service}=fixture();db.printJob.findFirst.mockResolvedValue({id:'job',payload:{pages:[]}});db.printJob.updateMany.mockResolvedValue({count:0});
    expect(await service.claim('station',user)).toBeNull();
  });
  it('acknowledges a completed job idempotently and refuses conflicting results',async()=> {
    const {db,service}=fixture();db.printJob.findFirst.mockResolvedValue({id:'job',status:'printed',payload:{}});
    expect(await service.finish('station','job',true,null,user)).toEqual({id:'job',status:'printed'});
    await expect(service.finish('station','job',false,'failed',user)).rejects.toThrow();expect(db.printJob.updateMany).not.toHaveBeenCalled();
  });
});
