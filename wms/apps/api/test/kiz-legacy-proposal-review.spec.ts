import {afterEach,expect,it,vi} from 'vitest';
import {MarketplaceConnectionsService} from '../src/modules/marketplace-connections/marketplace-connections.service';
import {inspectKizReuse} from '../src/common/kiz-wb-reuse';
import {queueKizReview} from '../src/common/kiz-review-queue';
import {readPhysicalKizRelabel} from '../src/modules/marketplace-connections/fbs-physical-kiz-relabel';
vi.mock('../src/common/kiz-wb-reuse',async o=>({...await o<any>(),inspectKizReuse:vi.fn()}));
vi.mock('../src/common/kiz-review-queue',async o=>({...await o<any>(),queueKizReview:vi.fn()}));
vi.mock('../src/modules/marketplace-connections/fbs-physical-kiz-relabel',async o=>({...await o<any>(),readPhysicalKizRelabel:vi.fn()}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
// TEST: Marifat's persisted proposal must not reject before creating an administrator case.
it('queues uncertain old KIZ before rejecting a legacy replacement scan',async()=>{
 for(const flag of ['WMS_KIZ_REUSE_EVIDENCE_ENABLED','WMS_KIZ_REVIEW_QUEUE_ENABLED','WMS_FBS_KIZ_RELABEL_ENABLED'])vi.stubEnv(flag,'true');
 const task:any={id:'t',clientId:'c',requiresKiz:true,boxId:'b',barcode:'123',relabelRequired:false};
 const service:any=Object.create(MarketplaceConnectionsService.prototype);service.prisma={};
 service.loadOwnedFbsTsdAssembly=vi.fn(async()=>task);service.requireFbsOrderStillCollectable=vi.fn();service.assertFbsTsdLeaseVersion=vi.fn(async()=>task);
 vi.mocked(readPhysicalKizRelabel).mockResolvedValue({id:'proposal',oldKiz:'old',boxCode:'b'});
 const evidence:any={decision:'REVIEW',history:[],orders:[],circulation:null};vi.mocked(inspectKizReuse).mockResolvedValue(evidence);
 vi.mocked(queueKizReview).mockResolvedValue('REVIEW');
 await expect(service.scanFbsTsdKiz('t',{kiz:'0104680992590022215MywwfMmgS<1E\u001d91EE12\u001d92SIGN',confirmKizRelabel:true,kizRelabelProposalId:'proposal'},{})).rejects.toThrow('решения администратора');
 expect(queueKizReview).toHaveBeenCalledWith(service.prisma,'c','old','t',evidence);
});
