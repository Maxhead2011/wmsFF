import { afterEach, expect, it, vi } from 'vitest';
import { MarketplaceConnectionsService } from '../src/modules/marketplace-connections/marketplace-connections.service';
import { inspectKizReuse } from '../src/common/kiz-wb-reuse';
vi.mock('../src/common/kiz-wb-reuse', async original => ({...await original<any>(), inspectKizReuse: vi.fn()}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
// TEST: actual picker guard honors ALLOW/REVIEW/RELABEL and records its evidence.
it('does not turn a past WB binding into a relabel decision',async()=>{
  vi.stubEnv('WMS_KIZ_REUSE_EVIDENCE_ENABLED','true');
  const service:any=Object.create(MarketplaceConnectionsService.prototype);
  service.prisma={auditLog:{create:vi.fn(async()=>({}))}};
  for(const decision of ['ALLOW','REVIEW','RELABEL'] as const) {
    vi.mocked(inspectKizReuse).mockResolvedValue({decision,checkedAt:'2026-09-21',history:[{orderId:'old',requestId:'r',at:new Date(),event:'event',request:null}],orders:[],circulation:null});
    const call=service.findPreviousWildberriesKizUsage('client','kiz','current');
    if(decision==='ALLOW')expect(await call).toBeNull();
    else if(decision==='REVIEW')await expect(call).rejects.toThrow('Нужна проверка администратора');
    else expect(await call).toMatchObject({orderId:'old'});
  }
  expect(service.prisma.auditLog.create).toHaveBeenCalledTimes(3);
  expect(inspectKizReuse).toHaveBeenLastCalledWith(service.prisma,'client','kiz','current');
});
